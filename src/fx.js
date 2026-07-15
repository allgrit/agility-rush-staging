import * as THREE from 'three';

// Спецэффекты: пул частиц (пыль/искры/конфетти/брызги), следы лап,
// огненно-радужный след при высоком комбо, всплывающие DOM-тексты.

const MAX_PARTICLES = 600;

// Scratch для ориентации вытянутых частиц: не аллоцируем Vector3 каждый кадр (GC-нагрев)
const _Y_AXIS = new THREE.Vector3(0, 1, 0); // константа, НЕ мутировать
const _tmpDir = new THREE.Vector3();

// Локальный детерминированный PRNG для ЧАСТИЦ: глобальный рандом в update-цикле
// нарушал правило детерминизма проекта (и делал пиксель-дифф кадров невозможным).
// Частицы не влияют на геймплей; сид — константа на загрузку модуля.
let _fs = 777;
const frnd = () => { _fs = (_fs * 1664525 + 1013904223) >>> 0; return _fs / 4294967296; };

// Материал с пер-инстансовой прозрачностью: атрибут aOpacity через onBeforeCompile.
// Единственный способ держать сотни частиц с разной альфой в ОДНОМ draw call.
function instAlphaMaterial(params) {
  const m = new THREE.MeshBasicMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aOpacity;\nvarying float vAOp;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAOp = aOpacity;');
    sh.fragmentShader = 'varying float vAOp;\n' +
      sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAOp;');
  };
  return m;
}

// Батч инстансов с матрицей/цветом/альфой на слот
function mkBatch(scene, geo, cap, matParams) {
  const g = geo.clone();
  const im = new THREE.InstancedMesh(g, instAlphaMaterial(matParams), cap);
  const op = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
  op.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aOpacity', op);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < cap; i++) { im.setMatrixAt(i, zero); im.setColorAt(i, new THREE.Color(1, 1, 1)); }
  im.instanceMatrix.needsUpdate = true;
  im.instanceColor.needsUpdate = true;
  im.frustumCulled = false; // частицы вокруг собаки — почти всегда в кадре
  scene.add(im);
  const free = [];
  for (let i = cap - 1; i >= 0; i--) free.push(i); // pop() отдаёт наименьшие — слоты компактны у нуля
  im.count = 0; // рисуем только занятый префикс: иначе вся ёмкость летит в triangles
  const used = new Set();
  return {
    im, op, free, zero, used,
    acquire() {
      const slot = this.free.pop();
      if (slot === undefined) return undefined;
      this.used.add(slot);
      if (slot >= this.im.count) this.im.count = slot + 1;
      return slot;
    },
    release(slot) {
      this.used.delete(slot);
      this.free.push(slot);
      this.im.setMatrixAt(slot, this.zero);
      this.im.instanceMatrix.needsUpdate = true;
      if (slot === this.im.count - 1) {
        let c = slot;
        while (c > 0 && !this.used.has(c - 1)) c--;
        this.im.count = c;
      }
    },
  };
}
const _pM = new THREE.Matrix4(), _pQ = new THREE.Quaternion(), _pE = new THREE.Euler(), _pS = new THREE.Vector3(), _pC = new THREE.Color();

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    // 4 батча: (quad|box) × (normal|additive) — блендинг и depthWrite задаются
    // материалом батча, цвет/альфа/матрица — пер-инстанс. Было 600 Mesh в пуле.
    const geoBox = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const geoQuad = new THREE.PlaneGeometry(0.1, 0.1);
    const CAP = Math.ceil(MAX_PARTICLES / 2);
    this.pBatch = {
      quadN: mkBatch(scene, geoQuad, CAP, { color: 0xffffff, transparent: true }),
      quadA: mkBatch(scene, geoQuad, CAP, { color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      boxN: mkBatch(scene, geoBox, CAP, { color: 0xffffff, transparent: true }),
      boxA: mkBatch(scene, geoBox, CAP, { color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this._spawnN = 0;
    // Следы лап: один батч (цвет общий, альфа пер-инстанс)
    const printGeo = new THREE.CircleGeometry(0.05, 6);
    printGeo.rotateX(-Math.PI / 2);
    this.printBatch = mkBatch(scene, printGeo, 40, { color: 0x3f6e2e, transparent: true });
    this.printBatch.im.count = 40; // фиксированные слоты (квады — трисы копеечные)
    this.prints = [];
    for (let i = 0; i < 40; i++) this.prints.push({ slot: i, life: 0, x: 0, z: 0, size: 1 });
    this.printIdx = 0;
    // Радужный след: батч additive-квадов
    this.trailBatch = mkBatch(scene, new THREE.PlaneGeometry(0.5, 0.22), 24,
      { color: 0xffffff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trailBatch.im.count = 24;
    this.trailSegs = [];
    for (let i = 0; i < 24; i++) this.trailSegs.push({ slot: i, life: 0, pos: new THREE.Vector3(), scale: 1 });
    this.trailIdx = 0;
    this.trailTimer = 0;
    // Кольца-ударные волны (perfect): всего 4 и редко активны — остаются мешами
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0 });
    }
    this.ringIdx = 0;
    // Амбиентные травинки/лепестки: один батч, 2 цвета через instanceColor
    this.moteBatch = mkBatch(scene, new THREE.PlaneGeometry(0.07, 0.05), 16,
      { color: 0xffffff, transparent: true, side: THREE.DoubleSide });
    this.motes = [];
    for (let i = 0; i < 16; i++) {
      const rec = {
        slot: i, seed: i,
        pos: new THREE.Vector3((i % 2 ? 1 : -1) * (1 + (i * 1.3) % 5), 0.4 + (i * 0.37) % 1.6, -i * 4.1),
        rot: new THREE.Euler(),
      };
      this.moteBatch.im.setColorAt(i, _pC.setHex(i % 4 === 0 ? 0xfff0f4 : 0xb8d878));
      this.moteBatch.op.setX(i, 0.8);
      this.motes.push(rec);
    }
    this.moteBatch.im.count = 16;
    this.moteBatch.im.instanceColor.needsUpdate = true;
    this.moteBatch.op.needsUpdate = true;
    this.time = 0;
  }

  shockwave(pos) {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.position.y = Math.max(0.12, pos.y);
    r.life = 0.45;
  }

  _spawn(opts) {
    // каждая 3-я частица — квад (как в прежнем пуле), блендинг выбирает батч
    const isQuad = (this._spawnN++ % 3) === 0;
    const b = opts.additive ? (isQuad ? this.pBatch.quadA : this.pBatch.boxA)
      : (isQuad ? this.pBatch.quadN : this.pBatch.boxN);
    const slot = b.acquire();
    if (slot === undefined) return;
    const baseScale = new THREE.Vector3().setScalar(opts.size ?? 1);
    if (opts.stretch && opts.stretch > 1) baseScale.y *= opts.stretch;
    b.im.setColorAt(slot, _pC.set(opts.color));
    b.im.instanceColor.needsUpdate = true;
    this.active.push({
      batch: b, slot,
      pos: opts.pos.clone(),
      rot: new THREE.Euler(frnd() * 3, frnd() * 3, frnd() * 3),
      quat: null, // ставится stretchVel-ориентацией
      vel: opts.vel.clone(),
      life: opts.life ?? 0.6,
      maxLife: opts.life ?? 0.6,
      gravity: opts.gravity ?? -5,
      drag: opts.drag ?? 0.98,
      spin: opts.spin ?? 4,
      shrink: opts.shrink ?? true,
      baseOpacity: opts.opacity ?? 1,
      stretchVel: !!(opts.stretch && opts.stretch > 1),
      baseScale,
      scaleK: 1,
    });
  }

  burst(pos, { count = 10, color = 0xc9a06a, speed = 2, up = 2, life = 0.6, size = 1, additive = false, gravity = -5, spread = 1, opacity = 1, spin = 4, stretch = 1, flat = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = frnd() * Math.PI * 2;
      const r = frnd() * spread;
      this._spawn({
        pos, color, size: size * (0.6 + frnd() * 0.8), additive, opacity, spin, stretch, flat,
        vel: new THREE.Vector3(Math.cos(a) * speed * r, up * (0.4 + frnd() * 0.9), Math.sin(a) * speed * r),
        life: life * (0.6 + frnd() * 0.7), gravity,
      });
    }
  }

  dust(pos, intensity = 1) {
    this.burst(pos, { count: Math.ceil(2 * intensity), color: 0xa9c46b, speed: 0.8, up: 0.8, life: 0.45, size: 0.9, gravity: -1.5 });
  }
  bigDust(pos) { this.burst(pos, { count: 22, color: 0x9dbd62, speed: 2.5, up: 2.2, life: 0.8, size: 1.6, gravity: -2 }); }
  sparks(pos, color = 0xffc23d) {
    this.burst(pos, { count: 18, color, speed: 3.2, up: 3.2, life: 0.55, size: 0.8, additive: true, gravity: -4, stretch: 2.6 });
  }
  perfectBurst(pos) {
    this.sparks(pos, 0xffe08a);
    this.burst(pos, { count: 12, color: 0xfff4c8, speed: 1.2, up: 3.6, life: 0.8, size: 0.6, additive: true, gravity: -1 });
  }
  confetti(pos) {
    // Спавним впереди собаки и коротко: камера едет вперёд и не должна «врезаться» в квады
    const p = pos.clone(); p.z -= 5;
    for (const c of [0xe05656, 0x56a0e0, 0xf0d05a, 0x7fe056, 0xc77fe0]) {
      this.burst(p, { count: 8, color: c, speed: 2.6, up: 4.2, life: 0.85, size: 1.3, gravity: -6, spread: 1.4, spin: 9 });
    }
  }
  splash(pos) {
    this.burst(pos, { count: 18, color: 0x9accf0, speed: 2.2, up: 2.6, life: 0.5, size: 1.0, gravity: -7 });
  }
  mud(pos) {
    this.burst(pos, { count: 12, color: 0x6b4a2f, speed: 1.8, up: 2.2, life: 0.6, size: 1.1, gravity: -6 });
  }
  poof(pos) {
    this.burst(pos, { count: 20, color: 0xefe8da, speed: 2.6, up: 1.8, life: 0.42, size: 1.3, gravity: -0.3, opacity: 0.55, spread: 1.6 });
  }
  crash(pos) {
    this.burst(pos, { count: 30, color: 0xd8b58a, speed: 4, up: 4, life: 1, size: 1.8, gravity: -6, spread: 1.6 });
    this.sparks(pos, 0xffaa66);
  }

  pawPrint(x, z, size = 1) {
    const p = this.prints[this.printIdx];
    this.printIdx = (this.printIdx + 1) % this.prints.length;
    p.x = x; p.z = z; p.size = size; p.life = 1;
    _pM.makeScale(size, size, size).setPosition(x, 0.013, z);
    this.printBatch.im.setMatrixAt(p.slot, _pM);
    this.printBatch.im.instanceMatrix.needsUpdate = true;
  }

  trail(pos, comboLevel, dt) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = 0.03;
    const seg = this.trailSegs[this.trailIdx];
    this.trailIdx = (this.trailIdx + 1) % this.trailSegs.length;
    seg.pos.copy(pos);
    seg.pos.y = Math.max(0.25, pos.y);
    seg.scale = 1;
    const hue = (pos.z * 0.05) % 1;
    this.trailBatch.im.setColorAt(seg.slot, _pC.setHSL(((hue % 1) + 1) % 1, 0.9, 0.65));
    this.trailBatch.im.instanceColor.needsUpdate = true;
    seg.life = 0.5;
  }

  _writeParticle(p) {
    if (p.stretchVel && p.quat) _pQ.copy(p.quat);
    else _pQ.setFromEuler(p.rot);
    _pS.copy(p.baseScale).multiplyScalar(p.scaleK);
    _pM.compose(p.pos, _pQ, _pS);
    p.batch.im.setMatrixAt(p.slot, _pM);
  }

  update(dt) {
    const touched = new Set();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.batch.release(p.slot);
        touched.add(p.batch);
        this.active.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(p.drag);
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02 && p.gravity < -3) { p.pos.y = 0.02; p.vel.y *= -0.3; }
      if (p.stretchVel && p.vel.lengthSq() > 0.01) {
        // Ориентируем вытянутую частицу вдоль скорости
        p.quat = (p.quat || new THREE.Quaternion()).setFromUnitVectors(_Y_AXIS, _tmpDir.copy(p.vel).normalize());
      } else {
        p.rot.x += p.spin * dt;
        p.rot.y += p.spin * 0.7 * dt;
      }
      const k = p.life / p.maxLife;
      p.batch.op.setX(p.slot, Math.min(1, k * 1.6) * p.baseOpacity);
      if (p.shrink) p.scaleK = Math.max(0.05, k);
      this._writeParticle(p);
      touched.add(p.batch);
    }
    for (const b of touched) { b.im.instanceMatrix.needsUpdate = true; b.op.needsUpdate = true; }
    let printsTouched = false;
    for (const p of this.prints) {
      if (p.life > 0) {
        p.life -= dt * 0.35;
        this.printBatch.op.setX(p.slot, Math.max(0, p.life * 0.35));
        printsTouched = true;
        if (p.life <= 0) { this.printBatch.im.setMatrixAt(p.slot, this.printBatch.zero); this.printBatch.im.instanceMatrix.needsUpdate = true; }
      }
    }
    if (printsTouched) this.printBatch.op.needsUpdate = true;
    let trailTouched = false;
    for (const s of this.trailSegs) {
      if (s.life > 0) {
        s.life -= dt;
        s.scale *= (1 - dt * 1.5);
        this.trailBatch.op.setX(s.slot, Math.max(0, s.life * 1.4));
        if (s.life <= 0) _pM.copy(this.trailBatch.zero);
        else { _pS.setScalar(s.scale); _pM.compose(s.pos, _pQ.identity(), _pS); }
        this.trailBatch.im.setMatrixAt(s.slot, _pM);
        trailTouched = true;
      }
    }
    if (trailTouched) { this.trailBatch.im.instanceMatrix.needsUpdate = true; this.trailBatch.op.needsUpdate = true; }
    this.time += dt;
    for (const r of this.rings) {
      if (r.life > 0) {
        r.life -= dt;
        const k = 1 - r.life / 0.45;
        r.mesh.scale.setScalar(0.3 + k * 3.2);
        r.mesh.material.opacity = Math.max(0, (1 - k)) * 0.9;
        if (r.life <= 0) r.mesh.visible = false;
      }
    }
    for (const m of this.motes) {
      const sd = m.seed;
      m.pos.x += Math.sin(this.time * 0.7 + sd) * 0.004;
      m.pos.y += Math.cos(this.time * 0.9 + sd * 2) * 0.003;
      m.rot.x += dt * (1 + sd % 3);
      m.rot.y += dt * 1.4;
      _pQ.setFromEuler(m.rot);
      _pM.compose(m.pos, _pQ, _pS.setScalar(1));
      this.moteBatch.im.setMatrixAt(m.slot, _pM);
    }
    this.moteBatch.im.instanceMatrix.needsUpdate = true;
  }

  // Травинки дрейфуют в зоне видимости — рецикл по позиции собаки
  updateMotes(dogZ) {
    for (const m of this.motes) {
      if (m.pos.z > dogZ + 6) m.pos.z -= 70;
      if (m.pos.z < dogZ - 66) m.pos.z += 70;
    }
  }

  rebase(dz) {
    // матрицы частиц/следов/трейла перепишутся ближайшим update по своим pos
    for (const p of this.active) p.pos.z += dz;
    for (const p of this.prints) {
      p.z += dz;
      if (p.life > 0) {
        _pM.makeScale(p.size, p.size, p.size).setPosition(p.x, 0.013, p.z);
        this.printBatch.im.setMatrixAt(p.slot, _pM);
      }
    }
    this.printBatch.im.instanceMatrix.needsUpdate = true;
    for (const s of this.trailSegs) s.pos.z += dz;
    for (const r of this.rings) r.mesh.position.z += dz;
    for (const m of this.motes) m.pos.z += dz;
  }
}

// --- DOM-попапы (тексты наград) ---
// Время жизни привязано к игровым кадрам (детерминизм для харнесса), не к wall-clock.
export class Popups {
  constructor(container) {
    this.container = container;
    this.live = [];
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age > 1.4) { p.el.remove(); this.live.splice(i, 1); }
    }
  }
  show(text, cls = '', x = 50, y = 40) {
    const el = document.createElement('div');
    el.className = 'popup ' + cls;
    el.textContent = text;
    el.style.left = x + '%';
    el.style.top = y + '%';
    this.container.appendChild(el);
    this.live.push({ el, age: 0 });
  }
  perfect() { this.show('PERFECT!', 'perfect', 50, 34); }
  clean(name) { this.show(name || 'CLEAN!', 'clean', 50, 38); }
  fault(reason) { this.show(reason || 'FAULT', 'fault', 50, 38); }
  combo(n) { this.show('COMBO ×' + n, 'combo', 50, 30); }
  score(n) { this.show('+' + n, 'scorepop', 62, 42); }
  custom(t, cls, x, y) { this.show(t, cls, x, y); }
}
