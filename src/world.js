import * as THREE from 'three';

// Окружение: небо, свет, зоны (стадион/парк/закат/ночь), покрытие трассы,
// трибуны с «живой» толпой, боковой декор. Всё рециклится по мере бега (собака бежит в -Z).

export const LANE_X = [-2.2, 0, 2.2];
export const TRACK_HALF = 4.2; // половина ширины покрытия

const ZONES = [
  { name: 'stadium', sky: 0x2aa3bd, horizon: 0x8fd8cf, sun: 0xfff3d6, sunInt: 2.6, amb: 0x9fb8cc, ambInt: 0.9, fog: 0x9fd8ce, grass: 0x8aa848, trackA: 0x6cc94c, trackB: 0x4da434, rim: 0.55, expo: 1.12, cloud: 0xffffff, cloudOp: 0.85, hill: 0x7fae8e },
  { name: 'park', sky: 0x2f9fc4, horizon: 0x96d8c0, sun: 0xfff8e0, sunInt: 2.5, amb: 0x9cc09c, ambInt: 0.85, fog: 0xa5d8bc, grass: 0x7fa33f, trackA: 0x64c246, trackB: 0x47a337, rim: 0.55, expo: 1.12, cloud: 0xffffff, cloudOp: 0.85, hill: 0x5f9a6a },
  { name: 'sunset', sky: 0x5f6bb4, horizon: 0xff9d5e, sun: 0xff8f3d, sunInt: 2.7, amb: 0xa06a80, ambInt: 0.6, fog: 0xe8a878, grass: 0x6e7a38, trackA: 0x5a8a3e, trackB: 0x44682f, rim: 0.95, expo: 0.98, cloud: 0xffc8a0, cloudOp: 0.6, hill: 0x6b5a80 },
  { name: 'night', sky: 0x101a35, horizon: 0x2c3f66, sun: 0x9fc0f0, sunInt: 1.3, amb: 0x3d4f78, ambInt: 0.75, fog: 0x1e2f4e, grass: 0x3d4a2a, trackA: 0x336336, trackB: 0x254a29, rim: 1.5, expo: 0.88, cloud: 0x2e3d5e, cloudOp: 0.35, hill: 0x1c2b45 },
];
const ZONE_LEN = 260; // метров на зону — смена света видна уже в коротком забеге

// Scratch-цвета для _applyZone: переиспользуются каждый кадр вместо new THREE.Color (без GC-мусора)
const _zc0 = new THREE.Color(), _zc1 = new THREE.Color(), _zc2 = new THREE.Color();

export class World {
  constructor(scene, rng, renderer = null) {
    this.scene = scene;
    this.rng = rng;
    this.renderer = renderer;
    this.decor = []; // { obj, z } — рециклируемый боковой декор
    this.groundSegs = [];
    this.floodlights = [];
    this.time = 0;
    // Juice (#27): волна ликования трибун на perfect/комбо-майлстоун (чисто render-слой)
    this.cheerT = 0;
    this.cheerZ = 0;
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildCrowd();
    this.zoneT = 0;
    this._applyZone(ZONES[0], ZONES[0], 0);
  }

  _buildSky() {
    // Градиентный купол: вершинные цвета сверху-вниз
    const geo = new THREE.SphereGeometry(400, 24, 12);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 400;
      colors.push(0, 0, Math.max(0, y)); // фактические цвета зададим в _applyZone через шейдер-подмену
    }
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x87c5eb) },
        bottomColor: { value: new THREE.Color(0xdff0f7) },
      },
      vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; varying float vY;
        void main(){ float t = smoothstep(-0.05, 0.5, vY); gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.sky);

    // Солнце-диск
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(18, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false })
    );
    this.sunDisc.position.set(-120, 150, -320);
    this.sunDisc.lookAt(0, 0, 0);
    this.scene.add(this.sunDisc);

    // Облака — фасеточные low-poly полиэдры (как в референсе)
    this.clouds = new THREE.Group();
    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.96, fog: false, emissive: 0x666666 });
    const cloudMat = this.cloudMat;
    const jitterGeo = (geo, amp, seedBase) => {
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        // Хэш от позиции, не от индекса: геометрия неиндексирована, дубликаты одной
        // точки обязаны сдвигаться одинаково — иначе щели между гранями («дырки»)
        const h = Math.sin(pos.getX(v) * 127.1 + pos.getY(v) * 311.7 + pos.getZ(v) * 74.7 + seedBase * 19.19) * 43758.5453;
        const r = (h - Math.floor(h)) - 0.5;
        pos.setXYZ(v, pos.getX(v) + r * amp, pos.getY(v) + r * amp * 0.8, pos.getZ(v) - r * amp);
      }
      geo.computeVertexNormals();
      return geo;
    };
    for (let i = 0; i < 10; i++) {
      const cl = new THREE.Group();
      const n = 2 + (i % 3);
      for (let j = 0; j < n; j++) {
        const rad = 7 + ((i + j * 3) % 4) * 3;
        const puff = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(rad, 1), rad * 0.35, i * 7 + j), cloudMat);
        puff.position.set(j * 10 - n * 4.5, (j % 2) * 3.5, (j % 3) * 3);
        puff.scale.y = 0.55;
        cl.add(puff);
      }
      cl.position.set((i % 2 ? 1 : -1) * (60 + (i * 37) % 160), 90 + (i * 23) % 60, -300 + (i * 61) % 200);
      this.clouds.add(cl);
    }
    this.scene.add(this.clouds);
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
    this.sun.position.set(-8, 14, -6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -14; this.sun.shadow.camera.right = 14;
    this.sun.shadow.camera.top = 20; this.sun.shadow.camera.bottom = -14;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.intensity = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.amb = new THREE.HemisphereLight(0x9fb8cc, 0x4a6b3a, 0.9);
    this.scene.add(this.amb);
    // Контровой/заполняющий свет от камеры — читаемость собаки в тёмных зонах
    this.rim = new THREE.DirectionalLight(0xbfd4ff, 0.55);
    this.rim.position.set(2, 5, 9);
    this.scene.add(this.rim);
    this.scene.add(this.rim.target);
    // Aerial perspective (feel-редизайн): туман ближе — даль «тонет», ближний план
    // контрастнее. Спавн снарядов на ~170 м: из дымки выходят за ~6 с — читаемость ок.
    this.scene.fog = new THREE.Fog(0xcfe8f2, 54, 178);
  }

  _buildGround() {
    // Трасса + фасеточный low-poly террейн по бокам. Сегменты по 30 м рециклятся
    // вместе со своим декором (кочки травы, цветы, камни).
    // Газон соревновательного поля: полосы стрижки двумя тонами + спекл-текстура «травинок»
    const lawnTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 128, 128);
      // Короткие штрихи-травинки разной яркости
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * 128, y = Math.random() * 128;
        const l = 2 + Math.random() * 4;
        const b = 200 + Math.floor(Math.random() * 70) - 35;
        ctx.strokeStyle = `rgb(${b},${b + 12},${b})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 1.5, y + l);
        ctx.stroke();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2.2, 16);
      tex.anisotropy = 4;
      return tex;
    })();
    this.trackMatA = new THREE.MeshStandardMaterial({ color: 0x6cc94c, roughness: 1, flatShading: true, map: lawnTex });
    this.trackMatB = new THREE.MeshStandardMaterial({ color: 0x4da434, roughness: 1, flatShading: true, map: lawnTex });
    this.grassMat = new THREE.MeshStandardMaterial({ color: 0x69b04b, roughness: 1, flatShading: true, vertexColors: true });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9 });
    const SEG = 30, COUNT = 8;
    const hash = (a, b) => {
      const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let i = 0; i < COUNT; i++) {
      const seg = new THREE.Group();
      // Scratch для сборки инстанс-матриц декора (копируются в InstancedMesh, переиспользуемы)
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3();
      // Полосы стрижки газона: 6 продольных лент двух тонов
      const stripeW = TRACK_HALF * 2 / 6;
      for (let st = 0; st < 6; st++) {
        const lawn = new THREE.Mesh(
          new THREE.BoxGeometry(stripeW, 0.1, SEG),
          st % 2 ? this.trackMatB : this.trackMatA
        );
        lawn.position.set(-TRACK_HALF + stripeW * (st + 0.5), -0.05, 0);
        lawn.receiveShadow = true;
        seg.add(lawn);
      }
      for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, SEG), lineMat);
        line.position.set(lx, 0.011, 0);
        line.receiveShadow = true;
        seg.add(line);
      }
      // Поперечный ритм покрытия (feel-редизайн): тёмные стыки-полосы через всю трассу
      // каждые 3 м. Продольные полосы стрижки параллельны движению и дают НОЛЬ оптического
      // потока; поперечные — «мелькание земли под ногами» (частота 26/3 ≈ 8.7 Гц — читается
      // как движение, не стробит). Прозрачный тёмный слой работает во всех зонах суток.
      {
        const crossN = Math.ceil(SEG / 3);
        // Общий материал: прозрачность привязана к скорости в update (аудит: на старте
        // «клетка» декоративна; полосы проявляются с разгоном — «мир заводится»)
        if (!this.crossMat) this.crossMat = new THREE.MeshBasicMaterial({ color: 0x0c1a08, transparent: true, opacity: 0 });
        const crossInst = new THREE.InstancedMesh(
          new THREE.BoxGeometry(TRACK_HALF * 2, 0.012, 0.34),
          this.crossMat,
          crossN
        );
        for (let d = 0; d < crossN; d++) {
          M.makeTranslation(0, 0.013, -SEG / 2 + d * 3 + 1.5);
          crossInst.setMatrixAt(d, M);
        }
        crossInst.instanceMatrix.needsUpdate = true; crossInst.computeBoundingSphere();
        seg.add(crossInst);
      }
      // Пунктир центров полос — один InstancedMesh (был ~30 отдельных мешей)
      {
        const dashInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.015, 1.2), lineMat, LANE_X.length * Math.ceil(SEG / 3));
        let di = 0;
        for (const lx of LANE_X) for (let d = 0; d < SEG; d += 3) {
          M.makeTranslation(lx, 0.012, -SEG / 2 + d + 0.6);
          dashInst.setMatrixAt(di++, M);
        }
        dashInst.instanceMatrix.needsUpdate = true; dashInst.computeBoundingSphere();
        seg.add(dashInst);
      }
      // Бордюры: красно-белые сегменты по кромке — 2 InstancedMesh (по цвету, через material.color —
      // точный путь оригинала; instanceColor давал чуть иной цвет из-за color-management). Был ~40 мешей.
      {
        // Период 3 м (было 1.5): на 26 м/с 1.5-метровый шаг мерцал на 17 Гц — выше частоты
        // слежения глаза, читался как шум. 3 м = 8.7 Гц — снова «движение».
        const curbGeo = new THREE.BoxGeometry(0.28, 0.11, 3.0);
        const N = 2 * Math.ceil(SEG / 3.0);
        const mkCurb = (hex) => { const m = new THREE.InstancedMesh(curbGeo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, flatShading: true }), N); m.castShadow = true; m.receiveShadow = true; return m; };
        const curbRed = mkCurb(0xd8434e), curbWhite = mkCurb(0xf5f0e6);
        let ri = 0, wi = 0;
        for (const sd of [-1, 1]) for (let d = 0; d < SEG; d += 3.0) {
          M.makeTranslation(sd * (TRACK_HALF + 0.14), 0.005, -SEG / 2 + d + 1.5);
          if ((d / 3.0) % 2 < 1) curbRed.setMatrixAt(ri++, M); else curbWhite.setMatrixAt(wi++, M);
        }
        curbRed.count = ri; curbWhite.count = wi;
        curbRed.instanceMatrix.needsUpdate = true; curbRed.computeBoundingSphere();
        curbWhite.instanceMatrix.needsUpdate = true; curbWhite.computeBoundingSphere();
        seg.add(curbRed, curbWhite);
      }
      // Фасеточный террейн: subdiv-плоскость с шумом высоты и пятнами двух тонов травы
      for (const sd of [-1, 1]) {
        // Крупные НЕРОВНЫЕ треугольные фасеты: джиттер XZ + пер-фейсовые тона
        let geo = new THREE.PlaneGeometry(58, SEG, 10, 5);
        geo.rotateX(-Math.PI / 2);
        const pos0 = geo.attributes.position;
        for (let v = 0; v < pos0.count; v++) {
          const vx = pos0.getX(v), vz = pos0.getZ(v);
          const edge = (sd * vx + 29) / 58; // 0 у трассы, 1 на внешнем краю
          // Джиттер сетки, чтобы треугольники были неровными (края фиксируем)
          const onEdgeX = Math.abs(Math.abs(vx) - 29) < 0.01;
          const onEdgeZ = Math.abs(Math.abs(vz) - SEG / 2) < 0.01;
          if (!onEdgeX) pos0.setX(v, vx + (hash(i * 3 + vx, vz) - 0.5) * 3.4);
          if (!onEdgeZ) pos0.setZ(v, vz + (hash(vx, i * 5 + vz) - 0.5) * 3.4);
          const h = hash(i * 7 + vx * 0.35, vz * 0.35);
          // Внутренняя кромка совпадает с уровнем трассы; полный рельеф начинается дальше от неё.
          // Кромки Z: высота НЕ зависит от индекса сегмента — иначе на стыках сегментов
          // рельеф не совпадал и в земле были щели (видимые «провалы» до неба).
          if (onEdgeZ) pos0.setY(v, 0.12 + 0.28 * edge);
          else pos0.setY(v, 0.12 + (h - 0.3) * (0.04 + edge * 3.2));
        }
        geo = geo.toNonIndexed();
        const pos = geo.attributes.position;
        const colors = [];
        for (let f = 0; f < pos.count; f += 3) {
          // Один тон на фасет — чёткие цветовые грани, как в референсе
          const t = hash(i * 11 + f, 3);
          const tone = 0.82 + t * 0.28;
          const warm = hash(f, i) > 0.85 ? 0.06 : 0; // редкие тёплые фасеты
          for (let k = 0; k < 3; k++) colors.push(tone + warm, tone, tone - warm * 0.5);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const grass = new THREE.Mesh(geo, this.grassMat);
        grass.position.set(sd * (TRACK_HALF + 29 + 0.3), -0.12, 0);
        grass.receiveShadow = true;
        seg.add(grass);
      }
      // Травинки прямо на игровом поле: инстансированные пучки
      {
        const bladeGeo = new THREE.ConeGeometry(0.022, 0.16, 3);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f2e, roughness: 1, flatShading: true });
        const inst = new THREE.InstancedMesh(bladeGeo, bladeMat, 56);
        const mtx = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        for (let b = 0; b < 56; b++) {
          const rx = hash(i * 31 + b, 11), rz = hash(i * 37 + b, 13), rr = hash(i * 41 + b, 17);
          e.set((rr - 0.5) * 0.5, rr * 6.28, (rx - 0.5) * 0.5);
          q.setFromEuler(e);
          mtx.compose(
            new THREE.Vector3((rx - 0.5) * TRACK_HALF * 2 * 0.96, 0.06, -SEG / 2 + rz * SEG),
            q,
            new THREE.Vector3(1, 0.7 + rr * 0.8, 1)
          );
          inst.setMatrixAt(b, mtx);
        }
        inst.instanceMatrix.needsUpdate = true;
        seg.add(inst);
        // Ромашки по кромкам поля — 2 InstancedMesh (лепестки+сердцевины). Поворот -PI/2 запечён в геометрию.
        const daisyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const centerMat = new THREE.MeshBasicMaterial({ color: 0xf0d05a });
        const petalGeo = new THREE.CircleGeometry(0.05, 6); petalGeo.rotateX(-Math.PI / 2);
        const coreGeo = new THREE.CircleGeometry(0.02, 5); coreGeo.rotateX(-Math.PI / 2);
        const petalInst = new THREE.InstancedMesh(petalGeo, daisyMat, 5);
        const coreInst = new THREE.InstancedMesh(coreGeo, centerMat, 5);
        for (let b = 0; b < 5; b++) {
          const rx = hash(i * 43 + b, 19), rz = hash(i * 47 + b, 23);
          const sdd = rx > 0.5 ? 1 : -1;
          const px = sdd * (TRACK_HALF - 0.35 - rz * 0.9), pz = -SEG / 2 + hash(b, i) * SEG;
          petalInst.setMatrixAt(b, M.makeTranslation(px, 0.035, pz));
          coreInst.setMatrixAt(b, M.makeTranslation(px, 0.04, pz)); // сердцевина y+0.005
        }
        petalInst.instanceMatrix.needsUpdate = true; petalInst.computeBoundingSphere();
        coreInst.instanceMatrix.needsUpdate = true; coreInst.computeBoundingSphere();
        seg.add(petalInst); seg.add(coreInst);
      }

      // Декор сегмента: кочки/цветы/камни → InstancedMesh (было ~20 мешей+материалов на сегмент)
      const flowerCols = [0xf0d05a, 0xe05656, 0xc77fe0, 0xf0f0f0, 0xf09a3d];
      const tuftInst = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 1, 4), new THREE.MeshStandardMaterial({ color: 0x4d8f38, roughness: 1, flatShading: true }), 4 * 3);
      const stemInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 4), new THREE.MeshStandardMaterial({ color: 0x3f7a30, roughness: 1 }), 3);
      const headGeo = new THREE.IcosahedronGeometry(0.06, 0); // общая геометрия головок (материал per-цвет)
      const rockInst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 1, flatShading: true }), 2);
      rockInst.castShadow = true;
      let tk = 0, fk = 0, rk = 0;
      for (let d = 0; d < 9; d++) {
        const r1 = hash(i * 13 + d, 1), r2 = hash(i * 17 + d, 2), r3 = hash(i * 19 + d, 3);
        const sd = r1 > 0.5 ? 1 : -1;
        const x = sd * (TRACK_HALF + 0.8 + r2 * 7);
        const z = -SEG / 2 + r3 * SEG;
        if (d < 4) {
          // Кочка травы: 3 конуса. Высота через scale.Y базового конуса (height=1), поворот.z — в матрицу.
          for (let k = 0; k < 3; k++) {
            const height = 0.28 + hash(d, k) * 0.2;
            E.set(0, 0, (hash(d, k + 7) - 0.5) * 0.5); Q.setFromEuler(E);
            V.set(x + (hash(d, k + 9) - 0.5) * 0.22, 0.14, z + (hash(d, k + 5) - 0.5) * 0.22);
            tuftInst.setMatrixAt(tk++, M.compose(V, Q, new THREE.Vector3(1, height, 1)));
          }
        } else if (d < 7) {
          // Цветок: стебель (инстанс, shared зелёный) + головка (per-mesh, material.color — точный цвет)
          stemInst.setMatrixAt(fk++, M.makeTranslation(x, 0.11, z));
          const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: flowerCols[(i + d) % flowerCols.length], roughness: 0.8, flatShading: true }));
          head.position.set(x, 0.25, z);
          seg.add(head);
        } else {
          // Камень: базовый Icosahedron(1,0) масштабируем до (r, 0.55r, r), без поворота
          const radius = 0.16 + r2 * 0.2;
          rockInst.setMatrixAt(rk++, M.compose(V.set(x, 0.04, z), Q.identity(), new THREE.Vector3(radius, radius * 0.55, radius)));
        }
      }
      tuftInst.instanceMatrix.needsUpdate = true; tuftInst.computeBoundingSphere();
      stemInst.instanceMatrix.needsUpdate = true; stemInst.computeBoundingSphere();
      rockInst.instanceMatrix.needsUpdate = true; rockInst.computeBoundingSphere();
      seg.add(tuftInst, stemInst, rockInst);
      seg.position.z = -i * SEG + SEG;
      seg.userData.z0 = seg.position.z;
      this.scene.add(seg);
      this.groundSegs.push(seg);
    }
    this.segLen = SEG;

    // Арки-ворота с шарами — повторяются по дистанции
    this.arches = [];
    const bannerTex = this._bannerTexture();
    for (let i = 0; i < 2; i++) {
      const arch = new THREE.Group();
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9, flatShading: true });
      for (const sd of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.6, 8), pillarMat);
        pillar.position.set(sd * (TRACK_HALF + 0.6), 2.3, 0);
        pillar.castShadow = true;
        arch.add(pillar);
        // Гроздь воздушных шаров на каждой опоре
        const cols = [0xe05656, 0xf0d05a, 0x56a0e0, 0x7fe056];
        for (let b = 0; b < 4; b++) {
          const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7),
            new THREE.MeshStandardMaterial({ color: cols[(b + i) % cols.length], roughness: 0.4 }));
          balloon.scale.y = 1.15;
          balloon.position.set(sd * (TRACK_HALF + 0.6) + Math.cos(b * 1.7) * 0.3, 4.7 + Math.sin(b * 2.3) * 0.3, Math.sin(b) * 0.25);
          arch.add(balloon);
        }
      }
      const banner = new THREE.Mesh(
        new THREE.BoxGeometry(TRACK_HALF * 2 + 1.6, 0.85, 0.12),
        new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.85 })
      );
      banner.position.y = 4.15;
      banner.castShadow = true;
      arch.add(banner);
      arch.position.z = -90 - i * 240;
      arch.userData.z0 = arch.position.z;
      this.scene.add(arch);
      this.arches.push(arch);
    }

    // Птицы в небе: клин из «галочек»
    this.birds = new THREE.Group();
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a3242, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const bird = new THREE.Group();
      for (const sd of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), birdMat);
        wing.position.x = sd * 0.42;
        wing.userData.side = sd;
        bird.add(wing);
      }
      bird.position.set(i * 2.4 - 5, 22 - Math.abs(i - 2) * 0.9, -i * 1.6);
      this.birds.add(bird);
    }
    this.birds.position.set(8, 0, -70);
    this.scene.add(this.birds);

    // Бабочки у травы (видны в парке/на закате)
    this.butterflies = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: [0xf0d05a, 0xe07fb0, 0x9adcff, 0xf09a3d][i], side: THREE.DoubleSide });
      for (const sd of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), m);
        wing.position.x = sd * 0.07;
        wing.userData.side = sd;
        b.add(wing);
      }
      b.position.set((i % 2 ? 1 : -1) * (TRACK_HALF + 1.5 + i), 0.7, -i * 33 - 12);
      b.userData.z0 = b.position.z;
      this.scene.add(b);
      this.butterflies.push(b);
    }

    this._buildSideProps();
    this._buildBackdrop();
    this._buildGenProps();
  }

  // ============ Сгенерированные GLB-пропы (Tripo-конвейер, приняты VLM-судьёй) ============
  // Асинхронная загрузка ПОСЛЕ старта (не в критическом пути); каждый проп — 1 меш =
  // 1 draw call на клон. Слоты детерминированы hash-ом (без rng), recycle по дистанции.
  // Плотность: ?props=off|light|rich (по умолчанию medium) — для сцен-эвала и слабых устройств.
  _buildGenProps() {
    const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
    const density = q.get('props') || 'medium';
    if (density === 'off') { this.genProps = []; return; }
    const D = density === 'light' ? 1.6 : density === 'rich' ? 0.62 : 1; // множитель периода
    // Манифест: h — целевая высота (м), period — метров между экземплярами типа,
    // xOff — отступ за керб, zones — где виден (null = все зоны)
    // Дистанции/периоды скорректированы по сцен-эвалу (судьи: «пропы слишком далеко
    // и мелко с игровой камеры») — ближе к кербу и чаще; читаемость охраняет xOff≥1.6
    // за кербом + правило «декор не пересекает керб».
    // Осмысленные КОМПОЗИЦИИ (фидбек: «одиночные пропы теряются»): пропы стоят
    // сюжетными кластерами — судейский пост, зрительский уголок, медиа-точка,
    // церемония, вход. Кластер занимает слот каждые ~80 м, состав по зоне.
    // rot — поправка фронта конкретной модели (у скамейки фронт был спинкой).
    const PROPS = {
      'agility-sign':  { h: 3.6,  rot: 0 },
      'flag-cluster':  { h: 4.0,  rot: 0 },
      'water-station': { h: 1.6,  rot: 0 },
      'score-board':   { h: 3.1,  rot: 0 },
      'judge-booth':   { h: 3.8,  rot: 0 },
      'camera-tower':  { h: 5.4,  rot: 0 },
      'food-cart':     { h: 3.2,  rot: 0 },
      'park-bench':    { h: 1.4,  rot: Math.PI }, // фронт модели — спинка: разворот
      'dog-statue':    { h: 2.9,  rot: 0 },
      'podium':        { h: 1.7,  rot: 0 },
      'crate-stack':   { h: 1.5,  rot: 0 }, // переноски: «зона выдержки» стадиона
      'ice-cream':     { h: 3.4,  rot: 0 }, // киоск-мороженое: парковые сцены
    };
    // items: [имя, dxНаружу(м от базовой линии), dzВдоль(м), rotДоп]
    // Разбег dz увеличен под выросшие масштабы; dxOut ограничен — пропы НЕ должны
    // пересекать переднюю грань трибун (см. кап в _updateGenProps)
    const CLUSTERS = [
      { key: 'judge',    zones: ['stadium', 'night'],  items: [['judge-booth', 0, 0, 0], ['flag-cluster', 1.4, 5.2, 0.25], ['water-station', -0.7, -4.6, 0], ['crate-stack', 0.9, 9.2, 0.3]] },
      { key: 'media',    zones: ['stadium', 'night'],  items: [['camera-tower', 1.2, 0, 0], ['score-board', -0.5, 6.0, -0.15], ['crate-stack', 0.8, -5.2, -0.2]] },
      { key: 'spect',    zones: ['park', 'sunset'],    items: [['park-bench', 0, 0, 0], ['park-bench', 0.4, 3.8, 0.12], ['food-cart', 2.2, -4.6, 0.2], ['ice-cream', 2.4, 9.0, -0.15]] },
      { key: 'rest',     zones: ['park', 'sunset'],    items: [['park-bench', 0, 0, 0], ['water-station', 0.7, 3.4, 0], ['agility-sign', 1.6, -4.0, 0], ['ice-cream', 2.2, 8.6, 0.2]] },
      { key: 'ceremony', zones: null,                  items: [['podium', 0, 0, 0], ['dog-statue', 1.8, 4.6, 0.35], ['flag-cluster', 1.6, -4.8, -0.2], ['camera-tower', 2.0, 9.8, 0.15]] },
      { key: 'entry',    zones: null,                  items: [['agility-sign', 0, 0, 0], ['flag-cluster', 1.4, 3.6, 0], ['dog-statue', 1.9, -4.4, -0.25]] },
    ];
    this.genClusters = CLUSTERS;
    this.genPropDefs = PROPS;
    this.genPropPool = {}; // имя -> [{root,yBase,busy}]
    import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const loader = new GLTFLoader();
      Object.entries(PROPS).forEach(([name, def]) => {
        loader.load(`./assets/gen/${name}.glb`, (gltf) => {
          const proto = gltf.scene;
          const box = new THREE.Box3().setFromObject(proto);
          const size = box.getSize(new THREE.Vector3());
          const k = def.h / Math.max(0.01, size.y);
          this.genPropPool[name] = [];
          for (let c = 0; c < 6; c++) { // до 3 кластеров в окне × до 2 использований типа
            const inst = proto.clone(true);
            inst.scale.setScalar(k);
            inst.visible = false;
            this.scene.add(inst);
            this.genPropPool[name].push({
              root: inst, yBase: -box.min.y * k, rot: def.rot,
              // Полуширина по X ПОСЛЕ разворота к трассе: берём максимум габаритов XZ —
              // именно свисающие части (флаги на шесте) въезжали в трибуны при капе по центру
              halfXZ: Math.max(size.x, size.z) * k / 2,
            });
          }
        }, undefined, () => { /* файл недоступен — проп не появится */ });
      });
      // Шаровая арка над трассой — «чекпойнт»-момент каждые ~240 м. Отдельный пул:
      // это НАД-трассовый декор, ему положено поперёк (наземный prop-guard её не судит).
      loader.load('./assets/gen/balloon-arch.glb', (gltf) => {
        const proto = gltf.scene;
        const box = new THREE.Box3().setFromObject(proto);
        const size = box.getSize(new THREE.Vector3());
        // Модель плоская: размах арки — БОЛЬШАЯ горизонтальная ось (у GLB это Z,
        // масштаб по X-толщине давал гиганта ×40). Центрируем в обёртке и
        // поворачиваем размахом поперёк трассы.
        const span = Math.max(size.x, size.z);
        const k = (TRACK_HALF + 1.6) * 2 / Math.max(0.01, span);
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        this.balloonArches = [];
        for (let c = 0; c < 2; c++) {
          const wrap = new THREE.Group();
          const inst = proto.clone(true);
          inst.scale.setScalar(k);
          inst.position.set(-cx * k, -box.min.y * k, -cz * k);
          wrap.add(inst);
          if (size.z > size.x) wrap.rotation.y = Math.PI / 2; // размах — поперёк трассы
          wrap.visible = false;
          this.scene.add(wrap);
          this.balloonArches.push({ root: wrap, yBase: 0 });
        }
      }, undefined, () => { /* нет файла — без арок */ });
      this._genPropsPeriodMul = D;
      this.genProps = [{ ready: true }]; // маркер «пул активен» для внешних проверок
    });
  }

  _updateGenProps(dogZ, dist) {
    if (!this.genPropPool) return;
    const D = this._genPropsPeriodMul || 1;
    const STEP = 56 * D; // слот кластера (56: плотнее — фидбек «мир пустоват»)
    // Сначала прячем все клоны, затем расставляем нужные (окно: 2-3 слота впереди)
    for (const arr of Object.values(this.genPropPool)) for (const p of arr) { p._used = false; }
    const baseSlot = Math.floor(dist / STEP);
    // Зона — функция ДИСТАНЦИИ, не текущего кадра: раскладка слота обязана быть
    // стабильной. Выбор по currentZone заставлял видимый впереди кластер
    // ПЕРЕВЫБИРАТЬСЯ при пересечении границы зоны (флаги исчезали на глазах).
    const zoneNameAt = (d) => ZONES[this.zoneAt(Math.max(0, d)).idx].name;
    // Трибуна живёт до ~170 м за/до границы зоны (рецикл шагом 28, окно 168, on
    // фиксируется по зоне В МОМЕНТ рецикла) — поэтому «есть ли трибуны у слота»
    // проверяем с буфером ±170, а не по зоне точки (скамейки въезжали в трибуны).
    const standsNear = (d) => [d - 170, d, d + 170].some((x) => {
      const n = zoneNameAt(x);
      return n === 'stadium' || n === 'night';
    });
    for (let sOff = 0; sOff < 3; sOff++) {
      const slot = baseSlot + sOff;
      const h = this._slotHash(slot * 17 + 5);
      const slotDist = slot * STEP + h * STEP * 0.35; // дистанция центра кластера
      const zone = zoneNameAt(slotDist);
      // Кластер по слоту: только подходящие зоне СЛОТА (стабильно навсегда)
      const fit = this.genClusters.filter(c => !c.zones || c.zones.includes(zone));
      if (!fit.length) continue;
      const cl = fit[Math.floor(h * fit.length) % fit.length];
      const side = (slot % 2 === 0) ? 1 : -1;
      const zBase = dogZ - (slotDist - dist);
      const rel = dogZ - zBase;
      if (rel < -40 || rel > 170) continue;
      const xBase = TRACK_HALF + 1.9 + h * 1.0;
      // Трибуны: центр на ±(TRACK_HALF+4.4), глубина 2.6 → передняя грань ≈ ±7.3.
      // В зонах с трибунами (и в буфере ±170 у границ) пропы не заходят за неё.
      const standsOn = standsNear(slotDist);
      // Юбка трибуны выступает к трассе до ~±6.9 (центр 8.6 − skirt 1.5 − толщина):
      // внешний КРАЙ пропа не дальше 6.8. Крупные пропы, не влезающие в коридор,
      // скипаются здесь автоматически (см. проверку ниже) — их место в парке/закате.
      const maxX = standsOn ? TRACK_HALF + 2.6 : TRACK_HALF + 5.5;
      const placed = []; // анти-пересечения внутри кластера: {z, r}
      for (const [name, dxOut, dz, rotAdd] of cl.items) {
        const pool = this.genPropPool[name];
        if (!pool) continue;
        const inst = pool.find(p => !p._used);
        if (!inst) continue;
        inst._used = true;
        inst.root.visible = true;
        const hw = inst.halfXZ || 1;
        // Наружная граница минус полуширина (края пропа не пересекают трибуну),
        // внутренняя — керб плюс полуширина (не нависает над трассой)
        const pxAbs = Math.max(TRACK_HALF + 0.6 + hw, Math.min(xBase + dxOut, maxX - hw));
        // Если коридор уже, чем проп (maxX-hw < керб+hw) — пропу здесь не место
        if (maxX - hw < TRACK_HALF + 0.6 + hw) { inst._used = true; inst.root.visible = false; continue; }
        const px = side * pxAbs;
        // Радиус пропа ~ треть высоты; раздвигаем по z при конфликте (до 3 шагов)
        const r = Math.max(0.8, (this.genPropDefs[name].h || 2) * 0.35);
        let pz = zBase + dz;
        for (let t = 0; t < 3; t++) {
          const clash = placed.find(q => Math.abs(q.z - pz) < (q.r + r));
          if (!clash) break;
          pz += (q => q.r + r + 0.4)(clash) * (dz >= 0 ? 1 : -1);
        }
        placed.push({ z: pz, r });
        inst.root.position.set(px, inst.yBase, pz);
        // Лицом к трассе: фронт GLB = +Z; справа −π/2, слева +π/2 + поправка модели + вариация
        inst.root.rotation.y = side * -(Math.PI / 2) + inst.rot + rotAdd + (h - 0.5) * 0.25;
      }
    }
    for (const arr of Object.values(this.genPropPool)) for (const p of arr) { if (!p._used) p.root.visible = false; }
    // Шаровые арки: слот каждые 240 м, позиция — чистая функция дистанции слота
    if (this.balloonArches && this.balloonArches.length) {
      const ASTEP = 420 * D; // реже: арка — «чекпойнт»-событие, не обои (фидбек)
      const aBase = Math.floor(dist / ASTEP);
      for (const a of this.balloonArches) a._used = false;
      for (let sOff = 0; sOff < 2; sOff++) {
        const slot = aBase + sOff;
        const aDist = slot * ASTEP + 130; // смещение — не совпадать со стартом зоны
        const az = dogZ - (aDist - dist);
        const rel = dogZ - az;
        if (rel < -30 || rel > 200) continue;
        const a = this.balloonArches[slot % this.balloonArches.length];
        if (a._used) continue;
        a._used = true;
        a.root.visible = true;
        a.root.position.set(0, a.yBase, az);
      }
      for (const a of this.balloonArches) if (!a._used) a.root.visible = false;
    }
  }


  // Juice (#27, F5): уплотнение среднего плана — recycle-пул боковых пропов
  // (соревновательные флажки + судейские стойки). Два InstancedMesh — почти
  // бесплатно по draw calls (perf-guard следит). Позиции — чистая функция слота
  // (hash), БЕЗ rng: детерминизм и rebase-независимость через дистанцию.
  _buildSideProps() {
    const flagGeo = new THREE.BufferGeometry();
    {
      // Шест + треугольный флажок одной геометрией (позиции руками — без merge-утилит)
      const pole = new THREE.BoxGeometry(0.05, 1.5, 0.05);
      pole.translate(0, 0.75, 0);
      const flag = new THREE.BufferGeometry();
      flag.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 1.5, 0, 0.5, 1.34, 0, 0, 1.18, 0,
        0, 1.5, 0, 0, 1.18, 0, 0.5, 1.34, 0, // обратная сторона
      ], 3));
      flag.computeVertexNormals();
      const merged = [pole, flag];
      // Простое склеивание атрибутов position/normal
      let total = 0;
      for (const g of merged) total += g.attributes.position.count;
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
      let o = 0;
      for (const g of merged) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
      }
      flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      flagGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    }
    const FLAGS = 40, POSTS = 14;
    // Белый флаг (был красный): UX-судья — тонкие красные вертикали у кромки путаются
    // со стойками слалома; декор держим в нейтральной палитре
    this.sideFlags = new THREE.InstancedMesh(flagGeo,
      new THREE.MeshLambertMaterial({ color: 0xf2eee2, flatShading: true }), FLAGS);
    // Высокий столб-мачта: проносится мимо камеры через верх кадра (главный speed-cue).
    // Тон приглушён относительно белых стоек снарядов (UX: не спорить с ними в дальней зоне).
    const postGeo = new THREE.BoxGeometry(0.16, 4.6, 0.16);
    postGeo.translate(0, 2.3, 0);
    this.sidePosts = new THREE.InstancedMesh(postGeo,
      new THREE.MeshLambertMaterial({ color: 0xcfc8ba, flatShading: true }), POSTS);
    // Навершие-фонарь: красный конус в палитру керба; emissive подсвечивает мачты ночью
    const capGeo = new THREE.ConeGeometry(0.22, 0.42, 6);
    capGeo.translate(0, 4.75, 0);
    this.sidePostCaps = new THREE.InstancedMesh(capGeo,
      new THREE.MeshLambertMaterial({ color: 0xd8434e, emissive: 0x7a1620, flatShading: true }), POSTS);
    this.sidePostCaps.frustumCulled = false;
    this.scene.add(this.sidePostCaps);
    this.sideFlags.frustumCulled = false; // короткая лента вдоль трассы, куллинг не окупается
    this.sidePosts.frustumCulled = false;
    this.scene.add(this.sideFlags);
    this.scene.add(this.sidePosts);
    this._propMtx = new THREE.Matrix4();
    this._propScaleV = new THREE.Vector3(); // scratch — без new каждый кадр (перф-конвенция #8)
  }

  // Детерминированный «рандом» слота: hash без состояния (никакого rng)
  _slotHash(n) {
    let h = (n | 0) * 2654435761;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 1000) / 1000;
  }

  // Позиция мачты слота — единственный источник правды (write() и гирлянды)
  _postAt(slot, dogZ, dist) {
    const POST_STEP = 13;
    const h = this._slotHash(slot * 7 + POST_STEP);
    const side = (slot % 2 === 0) ? 1 : -1;
    return {
      x: side * (TRACK_HALF + 1.35 + h * 2.2),
      z: dogZ - (slot * POST_STEP - dist),
      topY: 4.6 * (1.2 + 0.18 * h), // высота мачты с учётом вариации масштаба
      side, h,
    };
  }

  _updateSideProps(dogZ, dist) {
    const FLAG_STEP = 8, POST_STEP = 13; // 9 м стробил краем кадра ~3 раза/с (UX-аудит)
    const write = (mesh, count, step, xBase, yScaleVar) => {
      const firstSlot = Math.floor(dist / step) - 1;
      for (let i = 0; i < count; i++) {
        const slot = firstSlot + i;
        const h = this._slotHash(slot * 7 + step);
        const side = (slot % 2 === 0) ? 1 : -1;
        const x = side * (xBase + h * 2.2);
        // Мировая z из дистанции слота: rebase-безопасно (dogZ и dist двигаются синхронно)
        const z = dogZ - (slot * step - dist);
        const sc = 1.2 + yScaleVar * h;
        this._propMtx.makeRotationY(h * 6.28);
        this._propScaleV.set(1, sc, 1);
        this._propMtx.scale(this._propScaleV);
        this._propMtx.setPosition(x, 0, z);
        mesh.setMatrixAt(i, this._propMtx);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    write(this.sideFlags, 40, FLAG_STEP, TRACK_HALF + 2.4, 0.5);
    write(this.sidePosts, 14, POST_STEP, TRACK_HALF + 1.35, 0.18);
    this._updateBackdrop(dogZ, dist);
    // Навершия — те же матрицы, что у мачт
    for (let i = 0; i < 14; i++) { this.sidePosts.getMatrixAt(i, this._propMtx); this.sidePostCaps.setMatrixAt(i, this._propMtx); }
    this.sidePostCaps.instanceMatrix.needsUpdate = true;
  }

  // «Задник» (SS-принцип «непрерывные боковые стены»): плотный дальний лес в
  // парковых зонах + гирлянды флажков между мачтами. Отключается ?backdrop=off
  // (сравнение на месте); полный откат — revert коммита.
  _buildBackdrop() {
    const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
    this.backdropOn = q.get('backdrop') !== 'off';
    if (!this.backdropOn) return;
    // --- Дальний лес: один InstancedMesh, ствол+крона одной геометрией с vertex colors
    const cone = new THREE.ConeGeometry(1.15, 2.9, 6);
    cone.translate(0, 2.7, 0);
    const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 5);
    trunk.translate(0, 0.7, 0);
    const paint = (geo, hex) => {
      const c = new THREE.Color(hex);
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return geo;
    };
    paint(cone, 0x39723a); paint(trunk, 0x6d4a2c);
    const parts = [cone.toNonIndexed(), trunk.toNonIndexed()];
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    }
    const treeGeo = new THREE.BufferGeometry();
    treeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    treeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    treeGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.backTrees = new THREE.InstancedMesh(treeGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 56);
    this.backTrees.frustumCulled = false;
    this.scene.add(this.backTrees);
    // --- Гирлянды флажков между мачтами одной стороны (пролёт 26 м)
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 0.11, 0, 0, 0.055, -0.24, 0,
      0.11, 0, 0, 0, 0, 0, 0.055, -0.24, 0,
    ], 3));
    flagGeo.computeVertexNormals();
    const GAR_SPANS = 12, GAR_FLAGS = 10;
    this.garland = new THREE.InstancedMesh(flagGeo,
      new THREE.MeshLambertMaterial({ flatShading: true }), GAR_SPANS * GAR_FLAGS);
    const palette = [0xd8434e, 0xf2c531, 0x2f6fd0, 0xf5f2ea];
    for (let i = 0; i < GAR_SPANS * GAR_FLAGS; i++) this.garland.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    this.garland.instanceColor.needsUpdate = true;
    this.garland.frustumCulled = false;
    this.scene.add(this.garland);
    const lineGeo = new THREE.BufferGeometry();
    this._garlandPts = new Float32Array(GAR_SPANS * 8 * 2 * 3);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this._garlandPts, 3));
    this.garlandLine = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x3a3630 }));
    this.garlandLine.frustumCulled = false;
    this.scene.add(this.garlandLine);
    this._garSpans = GAR_SPANS; this._garFlags = GAR_FLAGS;
  }

  _updateBackdrop(dogZ, dist) {
    if (!this.backdropOn) return;
    const zoneName = (d) => ZONES[this.zoneAt(Math.max(0, d)).idx].name;
    // Лес: чистая функция слота (rebase-безопасно), слот 7 м, чередование сторон →
    // на сторону шаг 14 м + вторая глубина от хэша: сплошная стена в park/sunset
    if (this.backTrees) {
      const TSTEP = 7, N = 56;
      const first = Math.floor(dist / TSTEP) - 4;
      for (let i = 0; i < N; i++) {
        const slot = first + i;
        const h = this._slotHash(slot * 11 + 3);
        const side = (slot % 2 === 0) ? 1 : -1;
        const zn = zoneName(slot * TSTEP);
        const on = zn === 'park' || zn === 'sunset';
        const x = side * (13.5 + h * 5.5);
        const z = dogZ - (slot * TSTEP - dist);
        const sc = 1.05 + h * 0.85;
        this._propMtx.makeRotationY(h * 6.28);
        this._propScaleV.set(sc, sc * (0.9 + h * 0.3), sc);
        this._propMtx.scale(this._propScaleV);
        this._propMtx.setPosition(x, on ? 0 : -60, z);
        this.backTrees.setMatrixAt(i, this._propMtx);
      }
      this.backTrees.instanceMatrix.needsUpdate = true;
    }
    // Гирлянды: пролёты между мачтами одной стороны (slot, slot+2), провис-парабола
    if (this.garland) {
      const firstPost = Math.floor(dist / 13) - 1;
      let fi = 0, li = 0;
      const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
      for (let sp = 0; sp < this._garSpans; sp++) {
        const slot = firstPost + sp;
        const a = this._postAt(slot, dogZ, dist);
        const b = this._postAt(slot + 2, dogZ, dist); // та же сторона (чётность)
        A.set(a.x, Math.min(a.topY, b.topY) - 0.25, a.z);
        B.set(b.x, Math.min(a.topY, b.topY) - 0.25, b.z);
        const sag = 0.7;
        for (let f = 0; f < this._garFlags; f++) {
          const t = (f + 0.5) / this._garFlags;
          P.lerpVectors(A, B, t);
          P.y -= sag * Math.sin(Math.PI * t); // флажки висят на шнуре — та же кривая
          this._propMtx.makeRotationY(a.side < 0 ? Math.PI / 2 : -Math.PI / 2);
          this._propMtx.setPosition(P.x, P.y, P.z);
          this.garland.setMatrixAt(fi++, this._propMtx);
        }
        for (let sgm = 0; sgm < 8; sgm++) {
          const t0 = sgm / 8, t1 = (sgm + 1) / 8;
          P.lerpVectors(A, B, t0); P.y -= sag * Math.sin(Math.PI * t0);
          Q.lerpVectors(A, B, t1); Q.y -= sag * Math.sin(Math.PI * t1);
          this._garlandPts.set([P.x, P.y, P.z, Q.x, Q.y, Q.z], li); li += 6;
        }
      }
      this.garland.instanceMatrix.needsUpdate = true;
      this.garlandLine.geometry.attributes.position.needsUpdate = true;
    }
  }

  _bannerTexture() {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#d8434e';
    ctx.fillRect(0, 0, 512, 48);
    ctx.fillStyle = '#f5f0e6';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('AGILITY CUP', 256, 35);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _crowdTexture() {
    // Толпа: канвас-текстура из маленьких «голов и тел» рядами, как настоящие трибуны
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#6b7688');
    grad.addColorStop(1, '#525c6e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 128);
    // Палитра приглушена ~25% (сцен-эвал, все роли: пёстрая толпа = высокочастотный шум,
    // спорящий с читаемостью снарядов) — тона ближе к серому, яркость ниже
    const palette = ['#a86e6e', '#6e8aa8', '#a89a6e', '#84a86e', '#9a84a8', '#a8846e', '#b4b4b4', '#6ea89e'];
    let k = 0;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 42; col++) {
        if ((row * 31 + col * 17) % 7 === 0) continue; // пустые места
        const x = col * 12 + 6 + (row % 2) * 5, y = 120 - row * 19;
        ctx.fillStyle = palette[(row * 7 + col * 3) % palette.length];
        ctx.fillRect(x - 3, y - 6, 6, 8); // тело
        ctx.fillStyle = ['#e8c49f', '#c9986b', '#8a6b4f'][(row + col) % 3];
        ctx.beginPath(); ctx.arc(x, y - 8.5, 2.8, 0, 7); ctx.fill(); // голова
        k++;
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(2.5, 1);
    return tex;
  }

  _setBatchInstanceMatrix(mesh, index, x, y, z, rotationX = 0, rotationY = 0, rotationZ = 0) {
    const scratch = this._batchMatrixScratch;
    scratch.position.set(x, y, z);
    scratch.rotation.set(rotationX, rotationY, rotationZ);
    scratch.scale.set(1, 1, 1);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }

  _writeStandStaticMatrices(index) {
    const marker = this.stands[index];
    const { x, z } = marker.position;
    const y = marker.position.y - (marker.userData.on === 0 ? 60 : 0); // off-блок утоплен
    const side = marker.userData.side;
    const batches = this.standBatches;
    this._setBatchInstanceMatrix(batches.base, index, x, y + 1.2, z);
    this._setBatchInstanceMatrix(batches.roof, index, x, y + 3.6, z, 0, 0, -side * 0.14);
    this._setBatchInstanceMatrix(batches.skirt, index, x - side * 1.5, y + 0.45, z);
    this._setBatchInstanceMatrix(batches.columns, index * 3, x - side * 1.45, y + 1.8, z - 9);
    this._setBatchInstanceMatrix(batches.columns, index * 3 + 1, x - side * 1.45, y + 1.8, z);
    this._setBatchInstanceMatrix(batches.columns, index * 3 + 2, x - side * 1.45, y + 1.8, z + 9);
  }

  _writeStandCrowdMatrix(index) {
    const marker = this.stands[index];
    const { x, z } = marker.position;
    const y = marker.position.y - (marker.userData.on === 0 ? 60 : 0); // off-блок утоплен
    const side = marker.userData.side;
    let breathingY = y + 1.95 + Math.abs(Math.sin(this.time * 3 + index * 1.7)) * 0.06;
    if (this.cheerT > 0) {
      // Волна бежит от эпицентра: ближние трибуны прыгают первыми и выше
      const dist = Math.abs(z - this.cheerZ);
      const phase = this.time * 14 - dist * 0.22;
      breathingY += Math.max(0, Math.sin(phase)) * 0.85 * this.cheerT * Math.exp(-dist / 45);
    }
    this._setBatchInstanceMatrix(
      this.standBatches.crowd,
      index,
      x - side * 1.35,
      breathingY,
      z,
      0,
      side > 0 ? -Math.PI / 2 : Math.PI / 2
    );
  }

  _markStandStaticMatricesUpdated() {
    this.standBatches.base.instanceMatrix.needsUpdate = true;
    this.standBatches.roof.instanceMatrix.needsUpdate = true;
    this.standBatches.skirt.instanceMatrix.needsUpdate = true;
    this.standBatches.columns.instanceMatrix.needsUpdate = true;
  }

  _syncStandCrowdMatrices() {
    for (let i = 0; i < this.stands.length; i++) this._writeStandCrowdMatrix(i);
    this.standBatches.crowd.instanceMatrix.needsUpdate = true;
  }

  _updateStandBatchBounds() {
    this.standBatches.base.computeBoundingSphere();
    this.standBatches.crowd.computeBoundingSphere();
    this.standBatches.crowd.boundingSphere.radius += 0.06;
    this.standBatches.roof.computeBoundingSphere();
    this.standBatches.skirt.computeBoundingSphere();
    this.standBatches.columns.computeBoundingSphere();
  }

  _syncAllStandMatrices() {
    for (let i = 0; i < this.stands.length; i++) this._writeStandStaticMatrices(i);
    this._markStandStaticMatricesUpdated();
    this._syncStandCrowdMatrices();
    this._updateStandBatchBounds();
  }

  _writeBannerMatrices(index) {
    const marker = this.banners[index];
    const { x, y, z } = marker.position;
    this._setBatchInstanceMatrix(this.bannerBatches.beam, index, x, y + 4.4, z, 0, 0, Math.PI / 2);
    this._setBatchInstanceMatrix(this.bannerBatches.poles, index * 2, x - (TRACK_HALF + 1.8), y + 2.2, z);
    this._setBatchInstanceMatrix(this.bannerBatches.poles, index * 2 + 1, x + (TRACK_HALF + 1.8), y + 2.2, z);
    for (let flagIndex = 0; flagIndex < 11; flagIndex++) {
      const slot = this._bannerFlagSlots[index][flagIndex];
      const localX = -TRACK_HALF - 1 + flagIndex * ((TRACK_HALF * 2 + 2) / 10);
      this._setBatchInstanceMatrix(
        this.bannerBatches.flags[slot.colorIndex].mesh,
        slot.instanceIndex,
        x + localX,
        y + 4.15,
        z,
        Math.PI
      );
    }
  }

  _markBannerMatricesUpdated() {
    this.bannerBatches.beam.instanceMatrix.needsUpdate = true;
    this.bannerBatches.poles.instanceMatrix.needsUpdate = true;
    for (const descriptor of this.bannerBatches.flags) descriptor.mesh.instanceMatrix.needsUpdate = true;
  }

  _updateBannerBatchBounds() {
    this.bannerBatches.beam.computeBoundingSphere();
    this.bannerBatches.poles.computeBoundingSphere();
    for (const descriptor of this.bannerBatches.flags) descriptor.mesh.computeBoundingSphere();
  }

  _syncAllBannerMatrices() {
    for (let i = 0; i < this.banners.length; i++) this._writeBannerMatrices(i);
    this._markBannerMatricesUpdated();
    this._updateBannerBatchBounds();
  }

  _buildCrowd() {
    // Трибуны по бокам — рециклируемые блоки с текстурой толпы, чуть «дышат» (машут)
    this.crowdTex = this._crowdTexture();
    this.stands = [];
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        const marker = new THREE.Object3D();
        marker.position.set(s * (TRACK_HALF + 4.4), 0, -i * 28 + 14); // шаг 28 (было 44): дыры 22 м убивали непрерывность боковин
        marker.userData.z0 = marker.position.z;
        marker.userData.side = s;
        marker.userData.index = this.stands.length;
        this.stands.push(marker);
      }
    }
    this.standBatchRoot = new THREE.Object3D();
    this.standBatches = {
      base: new THREE.InstancedMesh(
        new THREE.BoxGeometry(2.6, 2.4, 22),
        new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 1, flatShading: true }),
        12
      ),
      crowd: new THREE.InstancedMesh(
        new THREE.PlaneGeometry(22, 2.8),
        new THREE.MeshBasicMaterial({ map: this.crowdTex, transparent: false }),
        12
      ),
      roof: new THREE.InstancedMesh(
        new THREE.BoxGeometry(3.4, 0.12, 22),
        new THREE.MeshStandardMaterial({ color: 0xe8707a, roughness: 0.8, emissive: 0x30090c }),
        12
      ),
      skirt: new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.15, 0.9, 22),
        new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 1 }),
        12
      ),
      columns: new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6),
        new THREE.MeshStandardMaterial({ color: 0xb8bfcc, roughness: 1 }),
        36
      ),
    };
    this.standBatchRoot.add(
      this.standBatches.base,
      this.standBatches.crowd,
      this.standBatches.roof,
      this.standBatches.skirt,
      this.standBatches.columns
    );
    this.scene.add(this.standBatchRoot);
    this._batchMatrixScratch = new THREE.Object3D();
    this._syncAllStandMatrices();
    // Флажки-гирлянды над трассой
    this.banners = [];
    for (let i = 0; i < 3; i++) {
      const marker = new THREE.Object3D();
      marker.position.z = -60 - i * 60; // период 60 м: overhead-структура каждые ~2.3 с на максималке
      marker.userData.z0 = marker.position.z;
      marker.userData.index = i;
      this.banners.push(marker);
    }
    const flagColors = [0xe05656, 0xf0d05a, 0x56a0e0, 0x7fe056, 0xc77fe0];
    const flagCounts = [9, 6, 6, 6, 6];
    const flagGeometry = new THREE.ConeGeometry(0.16, 0.4, 4);
    this.bannerBatchRoot = new THREE.Object3D();
    this.bannerBatches = {
      beam: new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.05, 0.05, TRACK_HALF * 2 + 4, 6),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee }),
        3
      ),
      poles: new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.07, 0.07, 4.4, 6),
        new THREE.MeshStandardMaterial({ color: 0xdddddd }),
        6
      ),
      flags: flagColors.map((color, colorIndex) => ({
        color: new THREE.Color(color),
        mesh: new THREE.InstancedMesh(
          flagGeometry,
          new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }),
          flagCounts[colorIndex]
        ),
      })),
    };
    this.bannerBatchRoot.add(
      this.bannerBatches.beam,
      this.bannerBatches.poles,
      ...this.bannerBatches.flags.map(descriptor => descriptor.mesh)
    );
    this.scene.add(this.bannerBatchRoot);
    const nextFlagSlot = [0, 0, 0, 0, 0];
    this._bannerFlagSlots = Array.from({ length: 3 }, () => Array.from({ length: 11 }));
    for (let i = 0; i < 3; i++) {
      for (let f = 0; f < 11; f++) {
        const colorIndex = f % flagColors.length;
        this._bannerFlagSlots[i][f] = { colorIndex, instanceIndex: nextFlagSlot[colorIndex]++ };
      }
    }
    this._syncAllBannerMatrices();
    // Деревья для парковых зон (рециклятся вместе с трибунами, видимость по зоне)
    this.trees = [];
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), trunkMat);
      trunk.position.y = 0.8;
      tree.add(trunk);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e9440, roughness: 1, flatShading: true });
      for (let j = 0; j < 3; j++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 - j * 0.18, 0), leafMat);
        puff.position.y = 1.8 + j * 0.6;
        puff.castShadow = true;
        tree.add(puff);
      }
      const side = i % 2 ? 1 : -1;
      tree.position.set(side * (TRACK_HALF + 2.5 + (i * 13) % 6), 0, -i * 26 + 20);
      tree.userData.baseX = tree.position.x;
      tree.userData.z0 = tree.position.z;
      this.scene.add(tree);
      this.trees.push(tree);
    }
    // Параллакс-слой: дальняя гряда фасеточных гор, движется вместе с собакой (иллюзия бесконечной дали)
    this.ridge = new THREE.Group();
    this.ridgeMat = new THREE.MeshBasicMaterial({ color: 0x8fc4b8, fog: false });
    for (let i = 0; i < 9; i++) {
      const h = 26 + (i * 23) % 30;
      const geo = new THREE.ConeGeometry(30 + (i * 13) % 26, h, 5);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const hh = Math.sin(v * 57.7 + i * 91.3) * 43758.5453;
        const r = (hh - Math.floor(hh)) - 0.5;
        pos.setX(v, pos.getX(v) + r * 7);
        pos.setZ(v, pos.getZ(v) + r * 7);
      }
      geo.computeVertexNormals();
      const mtn = new THREE.Mesh(geo, this.ridgeMat);
      const side = i % 2 ? 1 : -1;
      mtn.position.set(side * (30 + (i * 41) % 130) - 20 + i * 6, h * 0.32, -230 - (i * 31) % 60);
      this.ridge.add(mtn);
    }
    this.scene.add(this.ridge);

    // Дальний план: фасеточные холмы-полиэдры кольцом
    this.hills = [];
    this.hillMat = new THREE.MeshStandardMaterial({ color: 0x7fae8e, roughness: 1, flatShading: true, fog: true });
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      const rad = 18 + (i * 17) % 14;
      const geo = new THREE.IcosahedronGeometry(rad, 1);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const h = Math.sin(v * 91.7 + i * 217.3) * 43758.5453;
        const r = (h - Math.floor(h)) - 0.5;
        pos.setXYZ(v, pos.getX(v) + r * rad * 0.22, pos.getY(v) + r * rad * 0.18, pos.getZ(v) + r * rad * 0.22);
      }
      geo.computeVertexNormals();
      const hill = new THREE.Mesh(geo, this.hillMat);
      hill.scale.set(1.6, 0.34, 1);
      hill.position.set(side * (72 + (i * 29) % 45), -6, -i * 60 + 30);
      hill.userData.z0 = hill.position.z;
      this.scene.add(hill);
      this.hills.push(hill);
    }

    // Тенты-шатры на обочинах (видны в парке и на закате)
    this.tents = [];
    const tentCols = [0xd8434e, 0x56a0e0, 0xf0d05a, 0x7fe056];
    for (let i = 0; i < 6; i++) {
      const tent = new THREE.Group();
      const col = tentCols[i % tentCols.length];
      const baseT = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 2.2),
        new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 1, flatShading: true }));
      baseT.position.y = 0.55;
      baseT.castShadow = true;
      tent.add(baseT);
      const roofT = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.2, 4),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, flatShading: true }));
      roofT.position.y = 1.7;
      roofT.rotation.y = Math.PI / 4;
      roofT.castShadow = true;
      tent.add(roofT);
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4),
        new THREE.MeshStandardMaterial({ color: 0xf5f0e6 }));
      flag.position.y = 2.5;
      tent.add(flag);
      const side = i % 2 ? 1 : -1;
      tent.position.set(side * (TRACK_HALF + 4.2 + (i * 7) % 3), 0, -i * 52 + 20);
      tent.userData.z0 = tent.position.z;
      this.scene.add(tent);
      this.tents.push(tent);
    }

    // Прожекторы для ночной зоны
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 1 : -1;
      const mast = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x556075 }));
      pole.position.y = 4;
      mast.add(pole);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff8d0 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.3), lampMat);
      head.position.set(-s * 0.5, 8, 0);
      head.rotation.z = -s * 0.35; // панель наклонена К трассе (знак был от неё)
      mast.add(head);
      // Световой конус (аддитивный) и пятно на трассе
      // Длина оси = дистанция лампа(−0.5s,8) → пятно(−4.6s,0) ≈ 9.0: короче — обод
      // повисает над полом («конус не доведён до пола»); 9.2 слегка топит обод в землю
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(3.2, 9.2, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
      );
      // Вершина конуса обязана совпадать с лампой (−0.5s, 8), основание — с пятном
      // на трассе (−4.6s, 0): наклон −0.47s. Прежний +0.42s вершил конус в воздухе
      // в 4 м от фонаря («свет идёт не от фонаря»).
      cone.position.set(-s * 2.55, 4.0, 0);
      cone.rotation.z = -s * 0.47;
      mast.add(cone);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(3.4, 20),
        new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(-s * 4.6, 0.02, 0);
      mast.add(pool);
      mast.position.set(s * (TRACK_HALF + 5.5), 0, -i * 90 - 20);
      mast.visible = false; // ночной реквизит: до первого рецикла не торчит днём
      mast.userData.z0 = mast.position.z;
      this.scene.add(mast);
      this.floodlights.push(mast);
    }
  }

  zoneAt(dist) {
    const idx = Math.floor(dist / ZONE_LEN) % ZONES.length;
    const frac = (dist % ZONE_LEN) / ZONE_LEN;
    return { idx, frac };
  }

  _applyZone(za, zb, t) {
    // Мутируем существующие Color'ы через scratch (_zc*), без аллокаций каждый кадр (GC-нагрев).
    // li(dst,a,b): dst = lerp(a,b,t) — результат идентичен прежнему new Color(a).lerp(new Color(b),t).
    const li = (dst, a, b) => { dst.set(a).lerp(_zc2.set(b), t); };
    li(this.skyMat.uniforms.topColor.value, za.sky, zb.sky);
    li(this.skyMat.uniforms.bottomColor.value, za.horizon, zb.horizon);
    li(this.sun.color, za.sun, zb.sun);
    this.sun.intensity = za.sunInt + (zb.sunInt - za.sunInt) * t;
    li(this.amb.color, za.amb, zb.amb);
    this.amb.intensity = za.ambInt + (zb.ambInt - za.ambInt) * t;
    li(this.scene.fog.color, za.fog, zb.fog);
    li(this.grassMat.color, za.grass, zb.grass);
    li(this.trackMatA.color, za.trackA, zb.trackA);
    li(this.trackMatB.color, za.trackB, zb.trackB);
    li(this.sunDisc.material.color, za.sun, zb.sun);
    this.rim.intensity = za.rim + (zb.rim - za.rim) * t;
    this.cloudMat.opacity = za.cloudOp + (zb.cloudOp - za.cloudOp) * t;
    li(this.cloudMat.color, za.cloud, zb.cloud);
    if (this.hillMat) {
      // Дальние холмы дополнительно уводим к тону тумана — плоский задник обретает глубину
      li(this.hillMat.color, za.hill, zb.hill);
      _zc0.set(za.fog).lerp(_zc2.set(zb.fog), t);
      this.hillMat.color.lerp(_zc0, 0.3);
    }
    if (this.ridgeMat) {
      // Хребет чуть светлее тумана — читается как дальний план
      _zc0.set(za.fog).lerp(_zc2.set(zb.fog), t); // fogC
      _zc1.set(za.sky).lerp(_zc2.set(zb.sky), t); // skyC
      this.ridgeMat.color.copy(_zc0).lerp(_zc1, 0.7).multiplyScalar(0.82);
    }
    if (this.renderer) this.renderer.toneMappingExposure = za.expo + (zb.expo - za.expo) * t;
  }

  // Толпа ликует: волна подпрыгивания расходится от эпицентра (позиция собаки).
  // Презентация: не трогает RNG/логику, затухает сама.
  cheer(z, strength = 1) {
    this.cheerT = Math.max(this.cheerT, 1.1 * strength);
    this.cheerZ = z;
  }

  update(dt, dogZ, dist, speed = 0) {
    this.time += dt;
    if (this.cheerT > 0) this.cheerT -= dt;
    this._updateSideProps(dogZ, dist);
    this._updateGenProps(dogZ, dist);
    // Поперечные полосы проявляются с разгоном: 0 до 8 м/с → 0.34 к 22 м/с
    if (this.crossMat) this.crossMat.opacity = 0.34 * Math.max(0, Math.min(1, (speed - 8) / 14));
    // Плавный переход зон в последние 12% зоны
    const { idx, frac } = this.zoneAt(dist);
    const za = ZONES[idx], zb = ZONES[(idx + 1) % ZONES.length];
    const t = frac > 0.88 ? (frac - 0.88) / 0.12 : 0;
    this._applyZone(za, zb, t);
    this.currentZone = za.name;

    // Солнце и небо следуют за собакой
    this.ridge.position.z = dogZ;
    this.sun.position.set(dogZ * 0 - 8, 14, dogZ - 6);
    this.sun.target.position.set(0, 0, dogZ - 14);
    this.rim.position.set(2, 5, dogZ + 10);
    this.rim.target.position.set(0, 0.5, dogZ);
    this.sky.position.z = dogZ;
    this.sunDisc.position.z = dogZ - 320;
    this.clouds.position.z = dogZ * 0.85; // лёгкий параллакс

    // Рецикл сегментов земли
    for (const seg of this.groundSegs) {
      if (seg.position.z > dogZ + this.segLen * 1.5) seg.position.z -= this.segLen * this.groundSegs.length;
    }
    // Рецикл трибун / деревьев / гирлянд / прожекторов
    let standRecycled = false;
    for (let i = 0; i < this.stands.length; i++) {
      const marker = this.stands[i];
      if (marker.position.z > dogZ + 30) {
        marker.position.z -= 28 * 6;
        marker.userData.on = (this.currentZone === 'stadium' || this.currentZone === 'night') ? 1 : 0;
        this._writeStandStaticMatrices(marker.userData.index);
        this._writeStandStaticMatrices(i);
        standRecycled = true;
      }
    }
    // Плавный переход зон: трибуны не выключаем разом — блок гаснет только когда
    // рециклится за спиной (утапливаем матрицу), новые в чужой зоне не появляются.
    this.standBatchRoot.visible = true;
    if (standRecycled) this._markStandStaticMatricesUpdated();
    this._syncStandCrowdMatrices();
    if (standRecycled) this._updateStandBatchBounds();
    for (const tr of this.trees) {
      if (tr.position.z > dogZ + 26) {
        tr.position.z -= 26 * 14;
        tr.visible = (this.currentZone === 'park' || this.currentZone === 'sunset');
      }
      // лёгкое покачивание кроны
      tr.rotation.z = Math.sin(this.time * 1.3 + tr.position.z) * 0.02;
    }
    let bannerRecycled = false;
    for (let i = 0; i < this.banners.length; i++) {
      const marker = this.banners[i];
      if (marker.position.z > dogZ + 20) {
        marker.position.z -= 60 * 3; // цикл = 3 маркера × период 60 м
        this._writeBannerMatrices(i);
        bannerRecycled = true;
      }
    }
    if (bannerRecycled) {
      this._markBannerMatricesUpdated();
      this._updateBannerBatchBounds();
    }
    for (const f of this.floodlights) {
      if (f.position.z > dogZ + 30) {
        f.position.z -= 90 * 4;
        f.visible = this.currentZone === 'night';
      }
    }
    for (const h of this.hills) {
      if (h.position.z > dogZ + 60) h.position.z -= 60 * 10;
    }
    for (const t of this.tents) {
      if (t.position.z > dogZ + 26) {
        t.position.z -= 52 * 6;
        t.visible = (this.currentZone === 'park' || this.currentZone === 'sunset');
      }
    }
    // Арки-ворота
    for (const a of this.arches) {
      if (a.position.z > dogZ + 20) a.position.z -= 240 * 2;
    }
    // Птицы: летят клином впереди, машут крыльями
    this.birds.position.z = dogZ - 75 + Math.sin(this.time * 0.12) * 18;
    this.birds.position.x = Math.sin(this.time * 0.07) * 16;
    for (let i = 0; i < this.birds.children.length; i++) {
      const bird = this.birds.children[i];
      const flap = Math.sin(this.time * 7 + i * 1.3) * 0.7;
      for (const wing of bird.children) wing.rotation.z = wing.userData.side * flap;
    }
    this.birds.visible = this.currentZone !== 'night';
    // Бабочки: порхают у травы в парке и на закате
    for (let i = 0; i < this.butterflies.length; i++) {
      const b = this.butterflies[i];
      if (b.position.z > dogZ + 15) b.position.z -= 33 * 4;
      b.position.y = 0.55 + Math.sin(this.time * 2.2 + i * 2) * 0.25;
      b.position.x += Math.sin(this.time * 1.4 + i * 3) * 0.01;
      const flap = Math.abs(Math.sin(this.time * 11 + i * 1.7)) * 1.1;
      for (const wing of b.children) wing.rotation.y = wing.userData.side * flap;
      b.visible = this.currentZone === 'park' || this.currentZone === 'sunset';
    }
  }

  // Сдвиг всего мира на +dz для сохранения точности float (rebase)
  rebase(dz) {
    for (const seg of this.groundSegs) seg.position.z += dz;
    for (const st of this.stands) st.position.z += dz;
    for (const tr of this.trees) tr.position.z += dz;
    for (const b of this.banners) b.position.z += dz;
    for (const f of this.floodlights) f.position.z += dz;
    for (const h of this.hills) h.position.z += dz;
    for (const a of this.arches) a.position.z += dz;
    for (const b of this.butterflies) b.position.z += dz;
    for (const t of this.tents) t.position.z += dz;
    this.birds.position.z += dz;
    this._syncAllStandMatrices();
    this._syncAllBannerMatrices();
  }

  // Полный сброс мира к старту нового забега: все рециклируемые объекты — на исходные позиции
  reset() {
    const all = [
      ...this.groundSegs, ...this.stands, ...this.trees, ...this.banners,
      ...this.floodlights, ...this.hills, ...this.arches, ...this.butterflies,
      ...this.tents,
    ];
    for (const o of all) {
      if (o.userData.z0 != null) o.position.z = o.userData.z0;
    }
    this.birds.position.set(8, 0, -70);
    this.sky.position.z = 0;
    this.clouds.position.z = 0;
    this._syncAllStandMatrices();
    this._syncAllBannerMatrices();
  }
}
