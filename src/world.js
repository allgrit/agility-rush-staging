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
    this.crowdSprites = [];
    this.floodlights = [];
    this.time = 0;
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
        const h = Math.sin(v * 127.1 + seedBase * 311.7) * 43758.5453;
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
    this.scene.fog = new THREE.Fog(0xcfe8f2, 68, 195);
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
        const curbGeo = new THREE.BoxGeometry(0.28, 0.11, 1.5);
        const N = 2 * Math.ceil(SEG / 1.5);
        const mkCurb = (hex) => { const m = new THREE.InstancedMesh(curbGeo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, flatShading: true }), N); m.castShadow = true; m.receiveShadow = true; return m; };
        const curbRed = mkCurb(0xd8434e), curbWhite = mkCurb(0xf5f0e6);
        let ri = 0, wi = 0;
        for (const sd of [-1, 1]) for (let d = 0; d < SEG; d += 1.5) {
          M.makeTranslation(sd * (TRACK_HALF + 0.14), 0.005, -SEG / 2 + d + 0.75);
          if ((d / 1.5) % 2 < 1) curbRed.setMatrixAt(ri++, M); else curbWhite.setMatrixAt(wi++, M);
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
          const edge = Math.abs(vx) / 29; // 0 у трассы, 1 на краю
          // Джиттер сетки, чтобы треугольники были неровными (края фиксируем)
          const onEdgeX = Math.abs(Math.abs(vx) - 29) < 0.01;
          const onEdgeZ = Math.abs(Math.abs(vz) - SEG / 2) < 0.01;
          if (!onEdgeX) pos0.setX(v, vx + (hash(i * 3 + vx, vz) - 0.5) * 3.4);
          if (!onEdgeZ) pos0.setZ(v, vz + (hash(vx, i * 5 + vz) - 0.5) * 3.4);
          const h = hash(i * 7 + vx * 0.35, vz * 0.35);
          pos0.setY(v, (h - 0.3) * (0.2 + edge * 3.2)); // холмистее к краям
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
    const palette = ['#c96b6b', '#6b9bc9', '#c9b46b', '#8fc96b', '#b48fc9', '#c9906b', '#d8d8d8', '#6bc9bc'];
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

  _buildCrowd() {
    // Трибуны по бокам — рециклируемые блоки с текстурой толпы, чуть «дышат» (машут)
    this.crowdTex = this._crowdTexture();
    this.stands = [];
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        const stand = new THREE.Group();
        // Ступенчатая трибуна (наклонный блок), светлая
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 2.4, 22),
          new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 1, flatShading: true })
        );
        base.position.y = 1.2;
        stand.add(base);
        const crowd = new THREE.Mesh(
          new THREE.PlaneGeometry(22, 2.8),
          new THREE.MeshBasicMaterial({ map: this.crowdTex, transparent: false })
        );
        crowd.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        crowd.position.set(-s * 1.35, 1.95, 0);
        crowd.rotation.x = 0;
        stand.add(crowd);
        this.crowdSprites.push(crowd);
        // Козырёк
        const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 22),
          new THREE.MeshStandardMaterial({ color: 0xe8707a, roughness: 0.8, emissive: 0x30090c }));
        roof.position.set(0, 3.6, 0);
        roof.rotation.z = -s * 0.14;
        stand.add(roof);
        // Бортик у земли
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 22),
          new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 1 }));
        skirt.position.set(-s * 1.5, 0.45, 0);
        stand.add(skirt);
        // Колонны под козырёк — крыша не «парит»
        const colMat = new THREE.MeshStandardMaterial({ color: 0xb8bfcc, roughness: 1 });
        for (const zz of [-9, 0, 9]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6), colMat);
          col.position.set(-s * 1.45, 1.8, zz);
          stand.add(col);
        }
        stand.position.set(s * (TRACK_HALF + 4.4), 0, -i * 44 + 14);
        stand.userData.z0 = stand.position.z;
        stand.userData.side = s;
        this.scene.add(stand);
        this.stands.push(stand);
      }
    }
    // Флажки-гирлянды над трассой
    this.banners = [];
    for (let i = 0; i < 3; i++) {
      const banner = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, TRACK_HALF * 2 + 4, 6),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      beam.rotation.z = Math.PI / 2;
      beam.position.y = 4.4;
      banner.add(beam);
      const cols = [0xe05656, 0xf0d05a, 0x56a0e0, 0x7fe056, 0xc77fe0];
      for (let f = 0; f < 11; f++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 4),
          new THREE.MeshStandardMaterial({ color: cols[f % cols.length], side: THREE.DoubleSide }));
        flag.rotation.x = Math.PI;
        flag.position.set(-TRACK_HALF - 1 + f * ((TRACK_HALF * 2 + 2) / 10), 4.15, 0);
        banner.add(flag);
      }
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 6),
          new THREE.MeshStandardMaterial({ color: 0xdddddd }));
        pole.position.set(s * (TRACK_HALF + 1.8), 2.2, 0);
        banner.add(pole);
      }
      banner.position.z = -60 - i * 120;
      banner.userData.z0 = banner.position.z;
      this.scene.add(banner);
      this.banners.push(banner);
    }
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
      head.rotation.z = s * 0.5;
      mast.add(head);
      // Световой конус (аддитивный) и пятно на трассе
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(3.2, 8.5, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
      );
      cone.position.set(-s * 2.6, 4.2, 0);
      cone.rotation.z = s * 0.42;
      mast.add(cone);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(3.4, 20),
        new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(-s * 4.6, 0.02, 0);
      mast.add(pool);
      mast.position.set(s * (TRACK_HALF + 5.5), 0, -i * 90 - 20);
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
    if (this.hillMat) li(this.hillMat.color, za.hill, zb.hill);
    if (this.ridgeMat) {
      // Хребет чуть светлее тумана — читается как дальний план
      _zc0.set(za.fog).lerp(_zc2.set(zb.fog), t); // fogC
      _zc1.set(za.sky).lerp(_zc2.set(zb.sky), t); // skyC
      this.ridgeMat.color.copy(_zc0).lerp(_zc1, 0.7).multiplyScalar(0.82);
    }
    if (this.renderer) this.renderer.toneMappingExposure = za.expo + (zb.expo - za.expo) * t;
  }

  update(dt, dogZ, dist) {
    this.time += dt;
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
    for (const st of this.stands) {
      if (st.position.z > dogZ + 30) st.position.z -= 44 * 6;
      st.visible = (this.currentZone === 'stadium' || this.currentZone === 'night');
    }
    for (const tr of this.trees) {
      if (tr.position.z > dogZ + 26) tr.position.z -= 26 * 14;
      tr.visible = (this.currentZone === 'park' || this.currentZone === 'sunset');
      // лёгкое покачивание кроны
      tr.rotation.z = Math.sin(this.time * 1.3 + tr.position.z) * 0.02;
    }
    for (const b of this.banners) {
      if (b.position.z > dogZ + 20) b.position.z -= 120 * 3;
    }
    for (const f of this.floodlights) {
      if (f.position.z > dogZ + 30) f.position.z -= 90 * 4;
      f.visible = this.currentZone === 'night';
    }
    for (const h of this.hills) {
      if (h.position.z > dogZ + 60) h.position.z -= 60 * 10;
    }
    for (const t of this.tents) {
      if (t.position.z > dogZ + 26) t.position.z -= 52 * 6;
      t.visible = (this.currentZone === 'park' || this.currentZone === 'sunset');
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
    // Толпа «дышит»
    for (let i = 0; i < this.crowdSprites.length; i++) {
      const c = this.crowdSprites[i];
      c.position.y = 1.95 + Math.abs(Math.sin(this.time * 3 + i * 1.7)) * 0.06;
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
  }
}
