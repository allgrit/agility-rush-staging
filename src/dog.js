import * as THREE from 'three';
import { COATS, NECKS } from './cosmetics.js';

// Процедурные low-poly собаки трёх пород. Собака смотрит в -Z.
// Вся анимация процедурная: game передаёт pose (mode/phase/jumpT/lean/vy),
// модель раскладывает её по суставам. Уши и хвост — на пружинной физике (вторичная анимация).

// Константы анимации ног — вынесены из update, чтобы не аллоцировать массив/объект каждый кадр
const LEG_KEYS = ['FL', 'FR', 'RL', 'RR'];
const LEG_PHASE = { FL: 0, FR: 0.7, RR: Math.PI * 0.95, RL: Math.PI * 0.95 + 0.65 };

const BREEDS = {
  border: {
    name: 'Бордер-колли',
    scale: 1.0,
    stride: 2.6,
    body: 0x23232b, // чёрный с холодным отливом
    white: 0xf7f4ec,
    accent: 0x23232b,
    earStyle: 'semi', // полустоячие с загнутым кончиком
    tailStyle: 'fluffy',
    muzzle: 0xf7f4ec,
    legWhite: true,
  },
  aussie: {
    name: 'Аусси',
    scale: 0.96,
    stride: 2.45,
    body: 0x7d8494, // блю-мерль
    white: 0xf2efe6,
    accent: 0xb06a3b, // рыжие подпалины
    earStyle: 'fold', // висячие на хряще
    tailStyle: 'bob',
    muzzle: 0xf2efe6,
    legWhite: true,
    merle: true,
  },
  poodle: {
    name: 'Той-пудель',
    scale: 0.62,
    stride: 1.75,
    body: 0xe0a56e, // абрикос
    white: 0xe8b47f,
    accent: 0xd69a5f,
    earStyle: 'drop', // длинные висячие
    tailStyle: 'pom',
    muzzle: 0xdca367,
    legWhite: false,
    curly: true,
  },
};

function mat(color, rough = 0.92) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, flatShading: true });
}

class Spring {
  constructor(k = 90, c = 9, v0 = 0) { this.k = k; this.c = c; this.x = v0; this.v = 0; this.target = v0; }
  update(dt) {
    const f = -this.k * (this.x - this.target) - this.c * this.v;
    this.v += f * dt; this.x += this.v * dt;
    return this.x;
  }
  impulse(i) { this.v += i; }
}

export class Dog {
  constructor(breedKey = 'border', equip = {}) {
    this.breedKey = breedKey;
    this.equip = equip || {};
    // Косметический окрас переопределяет базовые цвета породы (силуэт сохраняется). Копируем
    // cfg, чтобы не мутировать общий BREEDS. Чистая визуалка — на геймплей не влияет.
    this.cfg = { ...BREEDS[breedKey] };
    const coat = this.equip.coat && COATS[this.equip.coat];
    if (coat) {
      this.cfg.body = coat.body;
      if (coat.accent != null) this.cfg.accent = coat.accent;
      if (coat.white != null) this.cfg.white = coat.white;
      // Реальные окрасы: мерль/соболь рендерятся мраморными пятнами своим цветом (patch).
      this.cfg.merle = !!coat.merle;
      this.cfg.patch = coat.patch;
    }
    this.root = new THREE.Group(); // позиционируется игрой
    this.model = new THREE.Group(); // внутренние повороты/крены
    this.root.add(this.model);
    this.parts = {};
    this.time = 0;
    this.earSpringL = new Spring(70, 6.5);
    this.earSpringR = new Spring(70, 7);
    this.tailSprings = [];
    this.blinkT = 0;
    this._build();
    this.groundSupport = this._readGroundSupport();
  }

  _readGroundSupport() {
    // Опорная база выводится из реальной геометрии передних/задних лап с учётом
    // breed scale. Это единый контракт модели, а не поправки под конкретный снаряд.
    this.root.updateWorldMatrix(true, true);
    const inverseRoot = this.root.matrixWorld.clone().invert();
    const footprintZ = keys => {
      const values = [];
      for (const key of keys) {
        const paw = this.legs?.[key]?.paw;
        const position = paw?.geometry?.attributes?.position;
        if (!paw || !position) continue;
        for (let index = 0; index < position.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(position, index)
            .applyMatrix4(paw.matrixWorld)
            .applyMatrix4(inverseRoot);
          values.push(point.z);
        }
      }
      return values;
    };
    const front = footprintZ(['FL', 'FR']);
    const rear = footprintZ(['RL', 'RR']);
    if (!front.length || !rear.length) return null;
    return { frontZ: Math.min(...front), rearZ: Math.max(...rear) };
  }

  _build() {
    const c = this.cfg;
    const g = this.model;
    g.scale.setScalar(c.scale);

    const bodyMat = mat(c.body);
    const whiteMat = mat(c.white);
    const accentMat = mat(c.accent);
    const noseMat = mat(0x18140f, 0.6);
    const eyeMat = mat(0x141210, 0.35);

    // --- Корпус ---
    const spine = new THREE.Group(); // качается в галопе
    spine.position.y = 0.42;
    g.add(spine);
    this.parts.spine = spine;

    const torsoGeo = new THREE.CapsuleGeometry(0.155, 0.42, 6, 12);
    torsoGeo.rotateX(Math.PI / 2);
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.castShadow = true;
    spine.add(torso);
    this.parts.torso = torso;

    // Грудь (белая манишка)
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), c.legWhite ? whiteMat : bodyMat);
    chest.position.set(0, -0.03, -0.2);
    chest.scale.set(0.95, 1.0, 0.9);
    chest.castShadow = true;
    spine.add(chest);

    // Круп чуть шире
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), bodyMat);
    rump.position.set(0, 0.01, 0.2);
    rump.scale.set(1.0, 0.95, 1.0);
    rump.castShadow = true;
    spine.add(rump);

    if (c.merle) {
      // Мраморные пятна мерля/соболя — цвет из окраса (patch), иначе стандартный серый.
      const patchMat = mat(c.patch != null ? c.patch : 0x4a4f5c);
      for (const [x, y, z, s] of [[0.1, 0.08, 0.05, 0.07], [-0.09, 0.1, -0.1, 0.06], [0.06, 0.05, 0.22, 0.05], [-0.1, 0.02, 0.15, 0.055], [0.08, 0.11, -0.18, 0.05], [-0.05, 0.06, 0.28, 0.045]]) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), patchMat);
        p.position.set(x, y, z); p.scale.y = 0.5;
        spine.add(p);
      }
    }
    if (c.curly) {
      // Кудрявость: бугорки по корпусу
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 6), bodyMat);
        p.position.set(Math.cos(a) * 0.13, Math.abs(Math.sin(a)) * 0.12 + 0.02, -0.18 + (i % 5) * 0.09);
        spine.add(p);
      }
    }

    // --- Шея и голова ---
    const neck = new THREE.Group();
    neck.position.set(0, 0.1, -0.26);
    spine.add(neck);
    this.parts.neck = neck;

    const neckMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 4, 8), c.legWhite ? whiteMat : bodyMat);
    neckMesh.rotation.x = -0.55;
    neckMesh.position.set(0, 0.08, -0.05);
    neckMesh.castShadow = true;
    neck.add(neckMesh);
    if (c.legWhite) {
      // Белый воротник — классика бордер-колли/аусси
      const collar = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), whiteMat);
      collar.position.set(0, 0.0, -0.03);
      collar.scale.set(1, 0.8, 0.85);
      neck.add(collar);
    }
    // Косметика: бандана/платок на шее (low-poly треугольник в стиле игры).
    const neckItem = this.equip.neck && NECKS[this.equip.neck];
    if (neckItem) {
      const band = new THREE.Group();
      band.position.set(0, 0.02, -0.02);
      const clothMat = mat(neckItem.color, 0.8);
      // Обхват шеи — сплюснутое кольцо
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.028, 6, 12), clothMat);
      ring.rotation.x = Math.PI / 2 - 0.5;
      ring.scale.set(1, 1, 0.6);
      band.add(ring);
      // Свисающий узел-треугольник спереди
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 4), neckItem.tip != null ? mat(neckItem.tip, 0.8) : clothMat);
      knot.position.set(0, -0.07, 0.06);
      knot.rotation.x = 0.3;
      band.add(knot);
      band.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      neck.add(band);
      this.parts.bandana = band;
    }

    const head = new THREE.Group();
    head.position.set(0, 0.16, -0.14);
    neck.add(head);
    this.parts.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), bodyMat);
    skull.scale.set(0.92, 0.9, 1.0);
    skull.castShadow = true;
    head.add(skull);

    if (c.curly) {
      const topknot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), bodyMat);
      topknot.position.set(0, 0.1, 0.01);
      head.add(topknot);
    }

    // Морда с белой проточиной
    const muzzle = new THREE.Mesh(new THREE.CapsuleGeometry(0.047, 0.1, 4, 8), mat(c.muzzle));
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, -0.03, -0.135);
    head.add(muzzle);
    const blaze = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), c.breedKey === 'poodle' ? bodyMat : whiteMat);
    blaze.position.set(0, 0.05, -0.095);
    blaze.scale.set(0.75, 1.1, 1.25);
    head.add(blaze);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 6), noseMat);
    nose.position.set(0, -0.015, -0.195);
    head.add(nose);

    // Язык (виден на бегу)
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.06), mat(0xd4707e, 0.7));
    tongue.position.set(0.012, -0.072, -0.14);
    tongue.rotation.x = 0.35;
    head.add(tongue);
    this.parts.tongue = tongue;

    // Глаза
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
      eye.position.set(s * 0.055, 0.02, -0.082);
      head.add(eye);
      this.parts['eye' + (s < 0 ? 'L' : 'R')] = eye;
    }
    if (c.merle) {
      // Медные подпалины аусси: брови и щёки
      for (const s of [-1, 1]) {
        const brow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), accentMat);
        brow.position.set(s * 0.05, 0.055, -0.075);
        brow.scale.set(1.2, 0.7, 0.8);
        head.add(brow);
        const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), accentMat);
        cheek.position.set(s * 0.075, -0.035, -0.06);
        head.add(cheek);
      }
    }

    // --- Уши ---
    const earGeo = c.earStyle === 'drop'
      ? new THREE.CapsuleGeometry(0.035, 0.09, 4, 8)
      : new THREE.ConeGeometry(0.052, 0.095, 6);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.065, 0.085, -0.01);
      head.add(pivot);
      const ear = new THREE.Mesh(earGeo, c.earStyle === 'drop' ? bodyMat : accentMat === bodyMat ? bodyMat : mat(this.cfg.body));
      if (c.earStyle === 'semi') { // полустоячее с заломом
        ear.position.y = 0.038;
        ear.rotation.z = s * 0.26;
        ear.rotation.x = -0.22;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.045, 6), mat(this.cfg.body));
        tip.position.set(0, 0.055, 0.016);
        tip.rotation.x = 0.95;
        ear.add(tip);
      } else if (c.earStyle === 'fold') {
        ear.position.y = 0.035;
        ear.rotation.z = s * 0.75;
        ear.rotation.x = -0.15;
        ear.scale.set(1, 0.8, 0.6);
      } else { // drop — длинные пуделиные
        ear.position.y = -0.055;
        ear.rotation.z = s * 0.28;
      }
      pivot.add(ear);
      this.parts['earPivot' + (s < 0 ? 'L' : 'R')] = pivot;
    }

    // --- Хвост ---
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.06, 0.32);
    spine.add(tailRoot);
    this.parts.tailRoot = tailRoot;
    this.tailSegs = [];
    if (c.tailStyle === 'fluffy') {
      let parent = tailRoot;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        seg.position.z = i === 0 ? 0 : 0.085;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.052 - i * 0.007, 8, 6), i >= 3 ? whiteMat : bodyMat);
        m.scale.set(0.8, 0.8, 1.5);
        m.position.z = 0.045;
        m.castShadow = true;
        seg.add(m);
        parent.add(seg);
        parent = seg;
        this.tailSegs.push(seg);
        this.tailSprings.push(new Spring(60, 5));
      }
    } else if (c.tailStyle === 'bob') {
      const nub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bodyMat);
      nub.position.z = 0.03;
      tailRoot.add(nub);
    } else { // pom
      const seg = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.07, 4, 6), bodyMat);
      stick.rotation.x = -0.9; stick.position.set(0, 0.03, 0.03);
      seg.add(stick);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bodyMat);
      pom.position.set(0, 0.085, 0.06);
      seg.add(pom);
      tailRoot.add(seg);
      this.tailSegs.push(seg);
      this.tailSprings.push(new Spring(55, 5));
    }

    // --- Ноги (2 сегмента: бедро/плечо + голень + лапа) ---
    this.legs = {};
    const legDefs = [
      ['FL', -0.1, -0.19], ['FR', 0.1, -0.19],
      ['RL', -0.1, 0.22], ['RR', 0.1, 0.22],
    ];
    const upperLen = 0.17, lowerLen = 0.17;
    for (const [key, x, z] of legDefs) {
      const isFront = key[0] === 'F';
      const hip = new THREE.Group();
      hip.position.set(x, -0.06, z);
      spine.add(hip);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, upperLen * 0.8, 4, 6), c.merle ? accentMat : bodyMat);
      upper.position.y = -upperLen / 2;
      upper.castShadow = true;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -upperLen;
      hip.add(knee);
      const lowMat = c.legWhite ? whiteMat : bodyMat;
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, lowerLen * 0.8, 4, 6), lowMat);
      lower.position.y = -lowerLen / 2;
      lower.castShadow = true;
      knee.add(lower);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), lowMat);
      paw.position.set(0, -lowerLen, -0.015);
      paw.scale.set(1, 0.7, 1.3);
      paw.castShadow = true;
      knee.add(paw);
      if (c.curly) { // помпоны на лапах пуделя
        const pom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bodyMat);
        pom.position.set(0, -lowerLen + 0.05, 0);
        knee.add(pom);
      }
      this.legs[key] = { hip, knee, paw, isFront };
    }
  }

  // pose: { mode, phase, speed, jumpT, vy, lean, slideT, balance, weaveLean, shakeT, deadT, sitT }
  update(dt, pose) {
    this.time += dt;
    const p = pose;
    // Уклон относится ко всей собаке, а не только к spine: так лапы, корпус,
    // голова и аксессуары остаются в одной системе координат поверхности.
    this.root.rotation.x = p.surfacePitch || 0;
    const spine = this.parts.spine;
    const mode = p.mode || 'run';

    // Базовые значения (сбрасываем каждый кадр, всё вычисляется заново — нет дрейфа)
    let bodyY = 0.42, bodyPitch = 0, bodyRoll = 0, bodyYaw = 0, stretch = 1;
    let headPitch = 0, headYaw = 0, neckPitch = 0;
    let earImpulseTarget = 0;
    let tailWagSpeed = 7, tailWagAmp = 0.25, tailBase = -0.3;

    const setLeg = (key, hipRot, kneeRot) => {
      this.legs[key].hip.rotation.x = hipRot;
      this.legs[key].knee.rotation.x = kneeRot;
    };

    let bodyScaleY = 1;
    if (mode === 'run' || mode === 'weave' || mode === 'balance') {
      // Ротационный галоп: перед и зад в противофазе, внутри пар — заметный сдвиг ведущей лапы
      const ph = p.phase;
      const spd = Math.min(1, p.speed / 22);
      const amp = 0.75 + spd * 0.35;

      for (const key of LEG_KEYS) {
        const s = Math.sin(ph - LEG_PHASE[key]);
        const c2 = Math.cos(ph - LEG_PHASE[key]);
        const isFront = key[0] === 'F';
        const hipRot = s * amp * (isFront ? 1 : 0.85) + (isFront ? 0.1 : -0.12);
        // Колено сгибается на проносе (когда нога идёт вперёд по воздуху)
        const bend = Math.max(0, c2) * (1.15 + spd * 0.4) + 0.25;
        setLeg(key, hipRot, isFront ? bend * 0.8 : bend);
      }
      // Подскок корпуса: одна фаза подвисания на цикл
      bodyY = 0.42 + Math.max(0, Math.sin(ph + 0.6)) * 0.05 * (0.6 + spd);
      bodyPitch = Math.sin(ph + 1.2) * 0.09 * (0.5 + spd * 0.7);
      // Растяжение-сжатие спины — главный «двигатель» галопа
      stretch = 1 + Math.sin(ph) * 0.13 * (0.5 + spd * 0.5);
      bodyScaleY = 1 - Math.sin(ph) * 0.06 * (0.5 + spd * 0.5);
      // Голова в противофазе корпусу + вытягивается вперёд на скорости
      headPitch = -bodyPitch * 0.9;
      neckPitch = Math.sin(ph + 2) * 0.07 + spd * 0.18;
      tailWagSpeed = 4 + spd * 3; tailWagAmp = 0.15;
      tailBase = -0.15 + Math.sin(ph) * 0.16;
      if (mode === 'weave') {
        bodyRoll = p.weaveLean || 0;
        bodyYaw = (p.weaveLean || 0) * 0.9;
        tailBase = -0.1; tailWagAmp = 0.3;
      }
      if (mode === 'balance') {
        bodyRoll = (p.balance || 0) * 1.05; // заметнее: игроки читали крен слишком поздно
        bodyY = 0.40;
        headPitch = 0.12; // смотрит под ноги
      }
    } else if (mode === 'jump') {
      const t = p.jumpT; // 0..1
      if (t < 0.22) { // отталкивание: зад толкает, перед тянется вперёд-вверх
        const k = t / 0.22;
        setLeg('FL', -1.6 * k + 0.4, 1.6 * k + 0.3);
        setLeg('FR', -1.5 * k + 0.3, 1.6 * k + 0.3);
        setLeg('RL', 1.4 * k - 0.1, 0.3);
        setLeg('RR', 1.35 * k - 0.15, 0.3);
        stretch = 1 + k * 0.12;
      } else if (t < 0.5) { // взлёт: группировка — передние к груди, задние назад-вверх
        const k = (t - 0.22) / 0.28;
        setLeg('FL', -1.6 + k * 0.2, 1.6 + k * 0.6);
        setLeg('FR', -1.5, 1.6 + k * 0.6);
        setLeg('RL', 1.4 + k * 0.3, 0.3 + k * 0.5);
        setLeg('RR', 1.35 + k * 0.35, 0.3 + k * 0.45);
        stretch = 1.08;
      } else if (t < 0.78) { // растяжка на снижении: передние выбрасываются вперёд-вниз
        const k = (t - 0.5) / 0.28;
        setLeg('FL', -1.4 + k * 1.5, 2.2 - k * 1.8);
        setLeg('FR', -1.5 + k * 1.5, 2.2 - k * 1.75);
        setLeg('RL', 1.7 - k * 0.5, 0.8 - k * 0.3);
        setLeg('RR', 1.7 - k * 0.45, 0.75 - k * 0.3);
        stretch = 1.16;
      } else { // приземление: перед встречает землю, зад группируется
        const k = (t - 0.78) / 0.22;
        setLeg('FL', 0.1 + k * 0.2, 0.4 + k * 0.3);
        setLeg('FR', 0.0 + k * 0.25, 0.45 + k * 0.25);
        setLeg('RL', 1.2 - k * 2.0, 0.5 + k * 1.0);
        setLeg('RR', 1.25 - k * 2.0, 0.45 + k * 1.0);
        stretch = 1.05 - k * 0.05;
      }
      bodyY = 0.42;
      // Тангаж по касательной к траектории: нос вверх на взлёте, вниз на снижении
      bodyPitch = THREE.MathUtils.clamp(-p.vy * 0.075, -0.42, 0.5);
      headPitch = -bodyPitch * 0.85;
      tailBase = 0.45 - t * 0.6; tailWagSpeed = 0;
      earImpulseTarget = -p.vy * 0.06;
    } else if (mode === 'slide') {
      // Проползание: корпус и голова прижаты, морда стелется у земли, лапы гребут часто
      const ph = this.time * 26;
      bodyY = 0.21;
      bodyPitch = 0.1;
      stretch = 1.2;
      bodyScaleY = 0.88;
      for (const key of LEG_KEYS) {
        const off = key === 'FL' ? 0 : key === 'FR' ? Math.PI : key === 'RL' ? Math.PI * 0.5 : Math.PI * 1.5;
        setLeg(key, Math.sin(ph + off) * 0.55 + (key[0] === 'F' ? 0.9 : -0.6), key[0] === 'F' ? 1.7 : 1.9);
      }
      neckPitch = 0.85; // шея стелется вперёд-вниз
      headPitch = -0.35; // морда по ходу движения
      earImpulseTarget = 0.5; // уши прижаты назад
      tailBase = 0.05; tailWagSpeed = 0;
    } else if (mode === 'idle') {
      const b = Math.sin(this.time * 2.2) * 0.01;
      bodyY = 0.42 + b;
      for (const key of LEG_KEYS) setLeg(key, key[0] === 'F' ? 0.05 : -0.05, 0.12);
      headYaw = Math.sin(this.time * 0.7) * 0.25;
      tailWagSpeed = 9; tailWagAmp = 0.5; tailBase = 0.2; // радостно виляет
      if (p.shakeT != null && p.shakeT < 1) { // встряхивание
        const sh = Math.sin(p.shakeT * 40) * (1 - p.shakeT) * 0.35;
        bodyRoll = sh;
        headYaw = sh * 1.5;
      }
    } else if (mode === 'sit') { // на столе
      bodyY = 0.36;
      bodyPitch = -0.25;
      setLeg('FL', 0.15, 0.1); setLeg('FR', 0.12, 0.1);
      setLeg('RL', -1.5, 1.9); setLeg('RR', -1.5, 1.9);
      headPitch = -0.1;
      tailWagSpeed = 12; tailWagAmp = 0.6; tailBase = 0.1;
    } else if (mode === 'launched') { // подброшен качелей
      const ph = this.time * 20;
      bodyPitch = p.spin || 0;
      for (const key of LEG_KEYS) setLeg(key, Math.sin(ph + key.charCodeAt(1)) * 0.8, 0.9);
      tailBase = 0.6;
    } else if (mode === 'dead') {
      const t = Math.min(1, p.deadT || 0);
      bodyY = 0.42 - t * 0.19;
      bodyPitch = t * 0.5;
      bodyRoll = t * 1.2;
      for (const key of LEG_KEYS) setLeg(key, 0.4, 1.2);
      headPitch = t * 0.4;
      tailBase = -0.4; tailWagSpeed = 0;
    } else if (mode === 'fly') { // ракета-фрисби
      setLeg('FL', -1.5, 0.3); setLeg('FR', -1.5, 0.3);
      setLeg('RL', 1.4, 0.4); setLeg('RR', 1.4, 0.4);
      bodyPitch = 0.1;
      stretch = 1.15;
      tailBase = 0.1;
      const ph = this.time * 6;
      bodyRoll = Math.sin(ph) * 0.08;
    }

    // Squash-амортизация приземления поверх текущего состояния
    if (p.landT > 0) {
      const k = Math.min(1, p.landT / 0.18);
      bodyY -= 0.07 * k;
      bodyScaleY *= 1 - 0.16 * k;
      stretch *= 1 + 0.12 * k;
      headPitch += 0.28 * k;
    }

    // Крен при смене полосы поверх любого состояния
    bodyRoll += (p.lean || 0);
    bodyYaw += (p.lean || 0) * 0.55;

    spine.position.y = bodyY;
    spine.rotation.set(bodyPitch, bodyYaw, bodyRoll);
    spine.scale.z = stretch;
    spine.scale.y = bodyScaleY;

    this.parts.neck.rotation.x = neckPitch;
    this.parts.head.rotation.x = headPitch;
    this.parts.head.rotation.y = headYaw + (p.lean || 0) * 0.55;

    // Язык болтается на скорости
    this.parts.tongue.visible = (p.speed || 0) > 15 || mode === 'idle' || mode === 'sit';
    this.parts.tongue.rotation.x = 0.35 + Math.sin(this.time * 14) * 0.1;

    // Уши: пружина + импульсы от вертикального ускорения
    this.earSpringL.target = earImpulseTarget;
    this.earSpringR.target = earImpulseTarget;
    const el = this.earSpringL.update(dt);
    const er = this.earSpringR.update(dt);
    if (this.parts.earPivotL) {
      this.parts.earPivotL.rotation.x = el + Math.sin(this.time * 9) * 0.08;
      this.parts.earPivotR.rotation.x = er + Math.sin(this.time * 9 + 1.3) * 0.08;
    }

    // Хвост: базовый угол + виляние + пружинный догон по сегментам
    for (let i = 0; i < this.tailSegs.length; i++) {
      const wag = tailWagSpeed > 0 ? Math.sin(this.time * tailWagSpeed - i * 0.7) * tailWagAmp : 0;
      const spring = this.tailSprings[i];
      spring.target = tailBase * (i === 0 ? 1 : 0.4) + (p.lean || 0) * 0.5;
      const sx = spring.update(dt);
      this.tailSegs[i].rotation.x = -0.12 + sx * 0.55 + Math.sin(this.time * 5 - i * 0.9) * 0.07;
      this.tailSegs[i].rotation.y = wag + (p.lean || 0) * 0.4;
    }

    // Моргание
    this.blinkT -= dt;
    if (this.blinkT < -3.2) this.blinkT = 0.12;
    const blink = this.blinkT > 0 ? 0.15 : 1;
    if (this.parts.eyeL) { this.parts.eyeL.scale.y = blink; this.parts.eyeR.scale.y = blink; }
  }

  earImpulse(v) { this.earSpringL.impulse(v); this.earSpringR.impulse(v * 1.1); }
  tailImpulse(v) { for (const s of this.tailSprings) s.impulse(v); }
}

export { BREEDS };
