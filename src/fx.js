import * as THREE from 'three';

// Спецэффекты: пул частиц (пыль/искры/конфетти/брызги), следы лап,
// огненно-радужный след при высоком комбо, всплывающие DOM-тексты.

const MAX_PARTICLES = 600;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    const geoBox = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const geoQuad = new THREE.PlaneGeometry(0.1, 0.1);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
      const m = new THREE.Mesh(i % 3 === 0 ? geoQuad : geoBox, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
    // Следы лап — пул плоских тёмных овалов
    this.prints = [];
    const printGeo = new THREE.CircleGeometry(0.05, 6);
    for (let i = 0; i < 40; i++) {
      const p = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ color: 0x3f6e2e, transparent: true, opacity: 0 }));
      p.rotation.x = -Math.PI / 2;
      p.position.y = 0.013;
      p.visible = false;
      scene.add(p);
      this.prints.push({ mesh: p, life: 0 });
    }
    this.printIdx = 0;
    // Радужный след
    this.trailSegs = [];
    const trailGeo = new THREE.PlaneGeometry(0.5, 0.22);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      scene.add(m);
      this.trailSegs.push({ mesh: m, life: 0 });
    }
    this.trailIdx = 0;
    this.trailTimer = 0;
    // Кольца-ударные волны (perfect)
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
    // Амбиентные травинки/лепестки, дрейфующие в воздухе
    this.motes = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.07, 0.05),
        new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? 0xfff0f4 : 0xb8d878, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      m.position.set((i % 2 ? 1 : -1) * (1 + (i * 1.3) % 5), 0.4 + (i * 0.37) % 1.6, -i * 4.1);
      m.userData.seed = i;
      scene.add(m);
      this.motes.push(m);
    }
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
    const m = this.pool.pop();
    if (!m) return;
    m.visible = true;
    m.position.copy(opts.pos);
    m.material.color.set(opts.color);
    m.material.opacity = opts.opacity ?? 1;
    m.material.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.material.depthWrite = !opts.additive;
    m.scale.setScalar(opts.size ?? 1);
    if (opts.stretch && opts.stretch > 1) m.scale.y *= opts.stretch;
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.active.push({
      mesh: m,
      vel: opts.vel.clone(),
      life: opts.life ?? 0.6,
      maxLife: opts.life ?? 0.6,
      gravity: opts.gravity ?? -5,
      drag: opts.drag ?? 0.98,
      spin: opts.spin ?? 4,
      shrink: opts.shrink ?? true,
      baseOpacity: opts.opacity ?? 1,
      stretchVel: !!(opts.stretch && opts.stretch > 1),
      baseScale: m.scale.clone(),
    });
  }

  burst(pos, { count = 10, color = 0xc9a06a, speed = 2, up = 2, life = 0.6, size = 1, additive = false, gravity = -5, spread = 1, opacity = 1, spin = 4, stretch = 1, flat = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this._spawn({
        pos, color, size: size * (0.6 + Math.random() * 0.8), additive, opacity, spin, stretch, flat,
        vel: new THREE.Vector3(Math.cos(a) * speed * r, up * (0.4 + Math.random() * 0.9), Math.sin(a) * speed * r),
        life: life * (0.6 + Math.random() * 0.7), gravity,
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
    p.mesh.visible = true;
    p.mesh.position.x = x;
    p.mesh.position.z = z;
    p.mesh.scale.setScalar(size);
    p.life = 1;
  }

  trail(pos, comboLevel, dt) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = 0.03;
    const seg = this.trailSegs[this.trailIdx];
    this.trailIdx = (this.trailIdx + 1) % this.trailSegs.length;
    seg.mesh.visible = true;
    seg.mesh.position.copy(pos);
    seg.mesh.position.y = Math.max(0.25, pos.y);
    const hue = (pos.z * 0.05) % 1;
    seg.mesh.material.color.setHSL(((hue % 1) + 1) % 1, 0.9, 0.65);
    seg.life = 0.5;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.active.splice(i, 1);
        this.pool.push(p.mesh);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(p.drag);
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.02 && p.gravity < -3) { p.mesh.position.y = 0.02; p.vel.y *= -0.3; }
      if (p.stretchVel && p.vel.lengthSq() > 0.01) {
        // Ориентируем вытянутую частицу вдоль скорости
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.vel.clone().normalize());
      } else {
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.y += p.spin * 0.7 * dt;
      }
      const k = p.life / p.maxLife;
      p.mesh.material.opacity = Math.min(1, k * 1.6) * p.baseOpacity;
      if (p.shrink) p.mesh.scale.copy(p.baseScale).multiplyScalar(Math.max(0.05, k));
    }
    for (const p of this.prints) {
      if (p.life > 0) {
        p.life -= dt * 0.35;
        p.mesh.material.opacity = Math.max(0, p.life * 0.35);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    for (const s of this.trailSegs) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, s.life * 1.4);
        s.mesh.scale.multiplyScalar(1 - dt * 1.5);
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
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
      const sd = m.userData.seed;
      m.position.x += Math.sin(this.time * 0.7 + sd) * 0.004;
      m.position.y += Math.cos(this.time * 0.9 + sd * 2) * 0.003;
      m.rotation.x += dt * (1 + sd % 3);
      m.rotation.y += dt * 1.4;
    }
  }

  // Травинки дрейфуют в зоне видимости — рецикл по позиции собаки
  updateMotes(dogZ) {
    for (const m of this.motes) {
      if (m.position.z > dogZ + 6) m.position.z -= 70;
      if (m.position.z < dogZ - 66) m.position.z += 70;
    }
  }

  rebase(dz) {
    for (const p of this.active) p.mesh.position.z += dz;
    for (const p of this.prints) p.mesh.position.z += dz;
    for (const s of this.trailSegs) s.mesh.position.z += dz;
    for (const r of this.rings) r.mesh.position.z += dz;
    for (const m of this.motes) m.position.z += dz;
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
