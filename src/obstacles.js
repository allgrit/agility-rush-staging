import * as THREE from 'three';
import { LANE_X } from './world.js';

// Снаряды аджилити (обязательные к прохождению), помехи (избегать) и пикапы.
// Каждый билдер возвращает объект-запись: { kind, lane, z, group, ...геометрия механики }.
// Косметическая анимация (падение планки, волна тоннеля, наклон качели) — в update() записи;
// решения по механике принимает game.js.

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...opts });
const CONTACT_YELLOW = 0xf2c531;
const AGILITY_BLUE = 0x2f6fd0;
const POLE_WHITE = 0xf5f2ea;
const STRIPE_RED = 0xd8434e;

function stripedBar(len, r, colA = STRIPE_RED, colB = POLE_WHITE, segs = 5) {
  const bar = new THREE.Group();
  const segLen = len / segs;
  for (let i = 0; i < segs; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, segLen, 8), std(i % 2 ? colB : colA));
    m.rotation.z = Math.PI / 2;
    m.position.x = -len / 2 + segLen * (i + 0.5);
    m.castShadow = true;
    bar.add(m);
  }
  return bar;
}

// ---------- СНАРЯДЫ ----------

export function buildHurdle(lane, z) {
  const g = new THREE.Group();
  const wingMat = std(AGILITY_BLUE);
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), wingMat);
    post.position.y = 0.5;
    post.castShadow = true;
    wing.add(post);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.05), std(0x4a86e0));
    panel.position.set(-s * 0.24, 0.28, 0);
    panel.castShadow = true;
    wing.add(panel);
    wing.position.x = s * 0.85;
    g.add(wing);
  }
  const bar = stripedBar(1.6, 0.045);
  bar.position.y = 0.58;
  g.add(bar);
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'hurdle', lane, z, group: g, barHeight: 0.58, resolved: false,
    bar, knocked: false, knockVel: 0, knockRot: 0,
    update(dt) {
      if (this.knocked && this.bar.position.y > 0.05) {
        this.knockVel -= 9.8 * dt;
        this.bar.position.y = Math.max(0.05, this.bar.position.y + this.knockVel * dt);
        this.bar.rotation.x += 4 * dt;
        this.bar.position.z += 0.8 * dt;
      }
    },
    knock() { if (!this.knocked) { this.knocked = true; this.knockVel = 1.2; } },
  };
  return rec;
}

export function buildTire(lane, z) {
  const g = new THREE.Group();
  const frameMat = std(0x8a68c8);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), frameMat);
  frame.position.y = 1.85;
  g.add(frame);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 0.08), frameMat);
    post.position.set(s * 0.85, 0.92, 0);
    post.castShadow = true;
    g.add(post);
  }
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 10, 24), std(0xe0603a));
  tire.position.y = 0.95;
  tire.castShadow = true;
  g.add(tire);
  // Стяжки
  for (const [x, y] of [[-0.6, 1.5], [0.6, 1.5]]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), std(0x555555));
    rope.position.set(x * 0.7, y, 0);
    rope.rotation.z = x < 0 ? -0.5 : 0.5;
    g.add(rope);
  }
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'tire', lane, z, group: g, centerY: 0.95, resolved: false, flashT: 0,
    tire,
    update(dt) {
      if (this.flashT > 0) {
        this.flashT -= dt;
        const k = 1 + Math.sin(this.flashT * 30) * 0.06;
        this.tire.scale.setScalar(k);
        this.tire.material.emissive.setHex(0xff8844).multiplyScalar(Math.max(0, this.flashT));
      }
    },
    flash() { this.flashT = 1; },
  };
  return rec;
}

export function buildTunnel(lane, z, length = 6) {
  const g = new THREE.Group();
  const R = 0.55;
  const tunnelMat = std(0xd8434e, { side: THREE.DoubleSide });
  const rings = [];
  const nRings = Math.floor(length / 0.5);
  for (let i = 0; i <= nRings; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 6, 20), i % 2 ? tunnelMat : std(0xf0e6d8, { side: THREE.DoubleSide }));
    ring.position.set(0, R * 0.9, -length / 2 + (i / nRings) * length);
    ring.castShadow = true;
    rings.push(ring);
    g.add(ring);
  }
  // Ткань между кольцами
  const cloth = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, length, 16, 6, true),
    std(0xc23b46, { side: THREE.BackSide })
  );
  cloth.rotation.x = Math.PI / 2;
  cloth.position.y = R * 0.9;
  g.add(cloth);
  const clothOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.01, R + 0.01, length, 16, 6, true),
    std(0xd8434e, { side: THREE.FrontSide })
  );
  clothOuter.rotation.x = Math.PI / 2;
  clothOuter.position.y = R * 0.9;
  clothOuter.castShadow = true;
  g.add(clothOuter);
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'tunnel', lane, z, group: g, length, entry: z + length / 2, exit: z - length / 2,
    resolved: false, occupied: false, time: 0, rings, cloth, clothOuter,
    update(dt) {
      this.time += dt;
      // Ткань «дышит», сильнее — когда собака внутри
      const amp = this.occupied ? 0.05 : 0.012;
      for (let i = 0; i < this.rings.length; i++) {
        const k = 1 + Math.sin(this.time * (this.occupied ? 18 : 4) + i * 1.1) * amp;
        this.rings[i].scale.set(k, k, 1);
      }
      const ck = 1 + Math.sin(this.time * (this.occupied ? 16 : 3.5)) * amp * 0.7;
      this.cloth.scale.set(ck, 1, ck);
      this.clothOuter.scale.set(ck, 1, ck);
    },
  };
  return rec;
}

export function buildWeave(lane, z, count = 6) {
  const g = new THREE.Group();
  const spacing = 1.5;
  const poles = [];
  for (let i = 0; i < count; i++) {
    const pole = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 8), std(i % 2 ? STRIPE_RED : POLE_WHITE));
    mesh.position.y = 0.5;
    mesh.castShadow = true;
    pole.add(mesh);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.18, 8), std(i % 2 ? POLE_WHITE : STRIPE_RED));
    stripe.position.y = 0.85;
    pole.add(stripe);
    pole.position.set(0, 0, -i * spacing);
    g.add(pole);
    poles.push({ pivot: pole, bendT: 0, side: i % 2 ? -1 : 1 });
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, count * spacing), std(0x777777));
  base.position.set(0, 0.02, -(count - 1) * spacing / 2);
  g.add(base);
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'weave', lane, z, group: g, count, spacing,
    entry: z, poles, resolved: false, hits: 0, taps: 0,
    // ВАЖНО: именно this.z (обновляется при rebase), а не замыкание z —
    // иначе после сдвига мира финиш слалома никогда не наступает
    poleZ(i) { return this.z - i * this.spacing; },
    update(dt) {
      for (const p of this.poles) {
        if (p.bendT > 0) {
          p.bendT = Math.max(0, p.bendT - dt * 2.2);
          p.pivot.rotation.z = Math.sin(p.bendT * Math.PI) * 0.35 * p.side;
        }
      }
    },
    bend(i, side) { const p = this.poles[i]; if (p) { p.bendT = 1; p.side = side; } },
  };
  return rec;
}

export function buildAFrame(lane, z) {
  const g = new THREE.Group();
  const rampLen = 3.2, peakH = 1.6, width = 1.5, boardThickness = 0.1;
  const rampGeo = new THREE.BoxGeometry(width, boardThickness, Math.hypot(rampLen, peakH));
  const upMat = std(AGILITY_BLUE);
  const up = new THREE.Mesh(rampGeo, upMat);
  const ang = Math.atan2(peakH, rampLen);
  // rotation.x = +ang поднимает −z конец бокса (пик в центре снаряда)
  up.rotation.x = ang;
  up.position.set(0, peakH / 2, rampLen / 2);
  up.castShadow = true; up.receiveShadow = true;
  g.add(up);
  const down = new THREE.Mesh(rampGeo.clone(), upMat);
  down.rotation.x = -ang;
  down.position.set(0, peakH / 2, -rampLen / 2);
  down.castShadow = true; down.receiveShadow = true;
  g.add(down);
  // Жёлтые контактные зоны
  const czGeo = new THREE.BoxGeometry(width + 0.02, 0.11, 1.0);
  const czMat = std(CONTACT_YELLOW, { emissive: 0x332800 });
  const czUp = new THREE.Mesh(czGeo, czMat);
  czUp.rotation.x = ang;
  const t0 = 0.86; // доля вдоль рампы
  czUp.position.set(0, peakH * (1 - t0) / 1 * 0.5 + 0.02, rampLen * (0.5 + t0 * 0.5) - rampLen * 0.06);
  czUp.position.y = (1 - t0) * peakH + 0.28; czUp.position.z = rampLen - t0 * rampLen + 1.65;
  // проще: пересчитаем по параметру вдоль рампы
  const placeOnRamp = (mesh, frac, isUp) => {
    // frac: 0 у земли, 1 на вершине
    const zPos = isUp ? rampLen * (1 - frac) : -rampLen * (1 - frac);
    // Цветной слой и рёбра центрируются по той же плоскости, что и основная доска.
    // Их чуть большая толщина уже устраняет z-fighting; дополнительный +0.06 поднимал
    // всю контактную геометрию над настилом и создавал ложное проникновение лап.
    mesh.position.set(0, peakH * frac, zPos);
  };
  placeOnRamp(czUp, 0.16, true);
  g.add(czUp);
  const czDown = new THREE.Mesh(czGeo, czMat.clone());
  czDown.rotation.x = -ang;
  placeOnRamp(czDown, 0.16, false);
  g.add(czDown);
  // Рёбра-перекладины (антискольжение)
  for (let i = 1; i < 6; i++) {
    for (const dir of [1, -1]) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.05), std(0xf0e8d8));
      slat.rotation.x = dir > 0 ? ang : -ang;
      placeOnRamp(slat, i / 6, dir > 0);
      slat.position.y += 0.045;
      g.add(slat);
    }
  }
  // Белые борта — читаемость силуэта горки
  for (const s of [-1, 1]) {
    for (const dir of [1, -1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.14, Math.hypot(rampLen, peakH)),
        std(0xf5f2ea)
      );
      rail.rotation.x = dir > 0 ? ang : -ang;
      rail.position.set(s * (width / 2 + 0.02), peakH / 2 + 0.07, dir * rampLen / 2);
      g.add(rail);
    }
  }
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'aframe', lane, z, group: g,
    rampLen, peakH, width, boardThickness, ang,
    entry: z + rampLen, exit: z - rampLen,
    // Контактная зона на спуске: последние 25% спуска
    contactStart: z - rampLen * 0.45, contactEnd: z - rampLen,
    czDown, resolved: false, occupied: false, glowT: 0,
    surfacePoseAt(dogZ) {
      const rel = dogZ - this.z; // + до вершины (подъём), − после
      if (rel > this.rampLen || rel < -this.rampLen) return null;
      const topOffset = this.boardThickness * 0.5 / Math.cos(this.ang);
      const topY = this.peakH * (1 - Math.abs(rel) / this.rampLen) + topOffset;
      return {
        topY,
        pitch: rel > 0 ? this.ang : rel < 0 ? -this.ang : 0,
        segment: rel > 0 ? 'up' : rel < 0 ? 'down' : 'peak',
      };
    },
    surfaceBreakpoints() { return [this.entry, this.z, this.exit]; },
    heightAt(dogZ) {
      return this.surfacePoseAt(dogZ)?.topY ?? 0;
    },
    pulseT: 0,
    update(dt) {
      this.pulseT += dt;
      if (this.glowT > 0) {
        this.glowT -= dt;
        this.czDown.material.emissive.setHex(CONTACT_YELLOW).multiplyScalar(Math.max(0, this.glowT) * 0.8);
      } else if (this.occupied) {
        // Подсветить контактную зону, когда собака на снаряде — подсказка игроку
        const pulse = 0.25 + Math.sin(this.pulseT * 20) * 0.15;
        this.czDown.material.emissive.setHex(CONTACT_YELLOW).multiplyScalar(pulse);
      } else {
        this.czDown.material.emissive.setHex(0x332800);
      }
    },
    glow() { this.glowT = 1.2; },
  };
  return rec;
}

export function buildDogwalk(lane, z) {
  const g = new THREE.Group();
  const plankLen = 6, h = 1.1, rampLen = 2.2, width = 0.45, boardThickness = 0.08;
  const mat = std(AGILITY_BLUE);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(width, boardThickness, plankLen), mat);
  plank.position.y = h;
  plank.castShadow = true; plank.receiveShadow = true;
  g.add(plank);
  const rampGeo = new THREE.BoxGeometry(width, boardThickness, Math.hypot(rampLen, h));
  const ang = Math.atan2(h, rampLen);
  const rampUp = new THREE.Mesh(rampGeo, mat);
  rampUp.rotation.x = ang;
  rampUp.position.set(0, h / 2, plankLen / 2 + rampLen / 2);
  rampUp.castShadow = true;
  g.add(rampUp);
  const rampDown = new THREE.Mesh(rampGeo.clone(), mat);
  rampDown.rotation.x = -ang;
  rampDown.position.set(0, h / 2, -plankLen / 2 - rampLen / 2);
  rampDown.castShadow = true;
  g.add(rampDown);
  // Контактные зоны
  const czMat = std(CONTACT_YELLOW);
  for (const dir of [1, -1]) {
    const cz = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.09, 0.9), czMat);
    cz.rotation.x = dir > 0 ? ang : -ang;
    cz.position.set(0, 0.22, dir * (plankLen / 2 + rampLen * 0.8));
    g.add(cz);
  }
  // Опоры
  for (const zz of [-plankLen / 2 + 0.4, plankLen / 2 - 0.4]) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), std(0x666666));
      leg.position.set(s * width * 0.35, h / 2, zz);
      g.add(leg);
    }
  }
  g.position.set(LANE_X[lane], 0, z);
  const totalHalf = plankLen / 2 + rampLen;
  const rec = {
    kind: 'dogwalk', lane, z, group: g, width, plankLen, rampLen, boardThickness, ang, totalHalf,
    entry: z + totalHalf, exit: z - totalHalf,
    plankStart: z + plankLen / 2, plankEnd: z - plankLen / 2,
    h, resolved: false, occupied: false,
    surfacePoseAt(dogZ) {
      const rel = dogZ - this.z;
      const a = Math.abs(rel);
      if (a > this.totalHalf) return null;
      if (a < this.plankLen / 2) {
        return { topY: this.h + this.boardThickness * 0.5, pitch: 0, segment: 'deck' };
      }
      const centerY = this.h * (1 - (a - this.plankLen / 2) / this.rampLen);
      const rampTop = centerY + this.boardThickness * 0.5 / Math.cos(this.ang);
      if (a === this.plankLen / 2) {
        return {
          topY: Math.max(this.h + this.boardThickness * 0.5, rampTop),
          pitch: 0,
          segment: 'joint',
        };
      }
      return {
        topY: rampTop,
        pitch: rel > 0 ? this.ang : -this.ang,
        segment: rel > 0 ? 'up' : 'down',
      };
    },
    surfaceBreakpoints() { return [this.entry, this.plankStart, this.plankEnd, this.exit]; },
    heightAt(dogZ) {
      return this.surfacePoseAt(dogZ)?.topY ?? 0;
    },
    update() {},
  };
  return rec;
}

export function buildSeesaw(lane, z) {
  const g = new THREE.Group();
  const plankLen = 3.8, pivotH = 0.55, width = 0.5, boardThickness = 0.07;
  const pivot = new THREE.Group();
  pivot.position.y = pivotH;
  g.add(pivot);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(width, boardThickness, plankLen), std(0xe0603a));
  plank.castShadow = true; plank.receiveShadow = true;
  pivot.add(plank);
  const czMat = std(CONTACT_YELLOW);
  for (const dir of [1, -1]) {
    const cz = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.075, 0.7), czMat);
    cz.position.z = dir * (plankLen / 2 - 0.35);
    plank.add ? plank.parent : null;
    pivot.add(cz);
    cz.position.y = 0.001;
  }
  const base = new THREE.Mesh(new THREE.ConeGeometry(0.35, pivotH, 4), std(0x666666));
  base.position.y = pivotH / 2;
  base.rotation.y = Math.PI / 4;
  g.add(base);
  g.position.set(LANE_X[lane], 0, z);
  const maxTilt = Math.atan2(pivotH, plankLen / 2) * 0.9;
  pivot.rotation.x = maxTilt; // ближний конец опущен (вход со стороны +z)
  const rec = {
    kind: 'seesaw', lane, z, group: g, pivot, plankLen, pivotH, maxTilt, width, boardThickness,
    entry: z + plankLen / 2, exit: z - plankLen / 2,
    resolved: false, occupied: false, tilt: -maxTilt, tiltVel: 0, banged: false,
    _surfacePrepared: false,
    surfacePoseAt(dogZ) {
      const rel = dogZ - this.z;
      if (Math.abs(rel) > this.plankLen / 2) return null;
      const pitch = -this.tilt;
      return {
        topY: Math.max(0, this.pivotH + Math.tan(this.tilt) * rel
          + this.boardThickness * 0.5 / Math.cos(pitch)),
        pitch,
        segment: 'plank',
      };
    },
    surfaceBreakpoints() { return [this.entry, this.exit]; },
    heightAt(dogZ) {
      return this.surfacePoseAt(dogZ)?.topY ?? 0;
    },
    advanceSurface(dt, dogZ) {
      if (this.occupied && dogZ != null) {
        // Наклон следует за позицией собаки
        const rel = this.z - dogZ;
        const target = rel > -0.2 ? this.maxTilt : -this.maxTilt;
        this.tiltVel += (target - this.tilt) * 26 * dt;
        this.tiltVel *= 0.86;
        this.tilt += this.tiltVel * dt * 4;
      } else if (!this.occupied && this.resolved) {
        // После схода качель возвращается со стуком
        this.tiltVel += (this.maxTilt - this.tilt) * 8 * dt;
        this.tiltVel *= 0.92;
        this.tilt += this.tiltVel * dt * 3;
      }
      this.tilt = Math.max(-this.maxTilt, Math.min(this.maxTilt, this.tilt));
      this.pivot.rotation.x = -this.tilt; // игровая конвенция: tilt<0 = ближний конец внизу
    },
    prepareSurface(dt, dogZ) {
      this.advanceSurface(dt, dogZ);
      this._surfacePrepared = true;
    },
    update(dt, dogZ) {
      if (this._surfacePrepared) {
        this._surfacePrepared = false;
        return;
      }
      this.advanceSurface(dt, dogZ);
    },
  };
  return rec;
}

export function buildTable(lane, z) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), std(CONTACT_YELLOW));
  top.position.y = 0.55;
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  for (const [x, zz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), std(0x444a55));
    leg.position.set(x, 0.25, zz);
    g.add(leg);
  }
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'table', lane, z, group: g, h: 0.61, resolved: false, glowT: 0, top,
    update(dt) {
      if (this.glowT > 0) {
        this.glowT -= dt;
        this.top.material.emissive.setHex(0xffdd44).multiplyScalar(Math.max(0, this.glowT) * 0.6);
      }
    },
    glow() { this.glowT = 1.5; },
  };
  return rec;
}

export function buildPodium(lane, z, length = 26) {
  // «Второй этаж»: эстакада с рампой-подъёмом, беговым верхом и обрывом в конце.
  const g = new THREE.Group();
  const H = 1.5, rampL = 4, width = 2.0;
  const sideMat = std(0x3a6fc4, { flatShading: true });
  const deckMat = std(0x5cb84a, { flatShading: true });
  const trimMat = std(CONTACT_YELLOW);
  // Корпус (после рампы)
  const bodyLen = length - rampL;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, H, bodyLen), sideMat);
  body.position.set(0, H / 2, -(length / 2) + bodyLen / 2);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // Верхняя дека — газон
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, bodyLen), deckMat);
  deck.position.set(0, H + 0.04, -(length / 2) + bodyLen / 2);
  deck.receiveShadow = true;
  g.add(deck);
  // Жёлтая окантовка деки
  for (const sd of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, bodyLen), trimMat);
    trim.position.set(sd * (width / 2 - 0.04), H + 0.06, -(length / 2) + bodyLen / 2);
    g.add(trim);
  }
  // Рампа-клин на входе (+z конец)
  const rampGeo = new THREE.BoxGeometry(width, 0.14, Math.hypot(rampL, H));
  const ramp = new THREE.Mesh(rampGeo, std(0x4a86e0, { flatShading: true }));
  const ang = Math.atan2(H, rampL);
  ramp.rotation.x = ang;
  ramp.position.set(0, H / 2, length / 2 - rampL / 2);
  ramp.castShadow = true; ramp.receiveShadow = true;
  g.add(ramp);
  // Белые шевроны на рампе
  for (let c = 0; c < 3; c++) {
    const chev = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.03, 0.22), std(0xf5f0e6));
    chev.rotation.x = ang;
    const t = 0.25 + c * 0.25;
    chev.position.set(0, H * t + 0.1, length / 2 - rampL * t);
    g.add(chev);
  }
  // Полосатые баннеры на боках
  for (const sd of [-1, 1]) {
    for (let b = 0; b < Math.floor(bodyLen / 3); b++) {
      const ban = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, H * 0.5, 1.4),
        std(b % 2 ? 0xf5f0e6 : 0xd8434e)
      );
      ban.position.set(sd * (width / 2 + 0.02), H * 0.5, -(length / 2) + 1.2 + b * 3);
      g.add(ban);
    }
  }
  g.position.set(LANE_X[lane], 0, z);
  const rec = {
    kind: 'podium', lane, z, group: g, h: H, width,
    entry: z + length / 2, exit: z - length / 2, length,
    resolved: false, mounted: false,
    heightAt(dogZ) {
      const rel = this.entry - dogZ; // 0 на входе рампы, length в конце
      if (rel < 0 || rel > this.length) return 0;
      if (rel < 4) return this.h * (rel / 4);
      return this.h;
    },
    update() {},
  };
  return rec;
}

// ---------- ПОМЕХИ ----------

export function buildCart(lane, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.0), std(0x9aa3b0, { emissive: 0x10141c }));
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);
  // Сигнальные полосы — читаемость помехи ночью
  for (const [y, col] of [[0.55, 0xf07030], [0.42, 0xf5f0e6]]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.12, 1.02), std(col, { emissive: col, emissiveIntensity: 0.25 }));
    stripe.position.y = y;
    g.add(stripe);
  }
  // Груз: свёрнутый тоннель и планки
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.14, 8, 16), std(0xd8434e));
  roll.position.set(-0.3, 1.5, 0);
  roll.rotation.y = Math.PI / 2;
  g.add(roll);
  const bars = stripedBar(1.3, 0.04);
  bars.position.set(0.35, 1.42, 0);
  bars.rotation.y = 0.2;
  g.add(bars);
  for (const [x, zz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 10), std(0x30343c));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.18, zz);
    g.add(wheel);
  }
  g.position.set(LANE_X[lane], 0, z);
  return { kind: 'cart', hazard: true, lethal: true, lane, z, group: g, halfW: 0.8, halfD: 0.55, height: 1.9, resolved: false, update() {} };
}

export function buildFence(lanes, z) {
  // Ограждение на 1–2 полосы
  const g = new THREE.Group();
  const xs = lanes.map(l => LANE_X[l]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const w = Math.max(...xs) - Math.min(...xs) + 1.9;
  const mat = std(0xe8e2d4);
  for (let i = 0; i < 3; i++) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.06), mat);
    rail.position.y = 0.35 + i * 0.35;
    rail.castShadow = true;
    g.add(rail);
  }
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 2) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.09), mat);
    post.position.set(x, 0.57, 0);
    g.add(post);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), std(0xd8434e, { side: THREE.DoubleSide }));
  sign.position.set(0, 0.75, 0.05);
  g.add(sign);
  g.position.set(cx, 0, z);
  return { kind: 'fence', hazard: true, lethal: true, lanes, lane: lanes[0], z, group: g, halfW: w / 2, halfD: 0.15, height: 1.2, resolved: false, update() {} };
}

export function buildCone(lane, z, dx = 0) {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 10), std(0xf07030));
  cone.position.y = 0.27;
  cone.castShadow = true;
  g.add(cone);
  const stripe = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.18, 10), std(0xf5f0e6));
  stripe.position.y = 0.38;
  g.add(stripe);
  g.position.set(LANE_X[lane] + dx, 0, z);
  return { kind: 'cone', hazard: true, lethal: false, lane, z, group: g, dx, halfW: 0.22, halfD: 0.22, height: 0.55, resolved: false, hit: false, vel: null,
    update(dt) {
      if (this.hit && this.vel) {
        this.group.position.x += this.vel.x * dt;
        this.group.position.y = Math.max(0, this.group.position.y + this.vel.y * dt);
        this.group.position.z += this.vel.z * dt;
        this.vel.y -= 9.8 * dt;
        this.group.rotation.x += 6 * dt;
      }
    } };
}

export function buildPuddle(lane, z) {
  const g = new THREE.Group();
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 16),
    new THREE.MeshStandardMaterial({ color: 0x5a7a9a, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 })
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.015;
  puddle.scale.x = 1.3;
  g.add(puddle);
  g.position.set(LANE_X[lane], 0, z);
  return { kind: 'puddle', hazard: true, lethal: false, lane, z, group: g, halfW: 0.85, halfD: 0.7, height: 0, resolved: false, update() {} };
}

export function buildSprinkler(lane, z) {
  // Поливалка: струя воды ходит по дуге; попадание = спотыкание
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 10), std(0x3a7a3a));
  base.position.y = 0.12;
  g.add(base);
  const arm = new THREE.Group();
  arm.position.y = 0.28;
  g.add(arm);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), std(0x88bb88));
  nozzle.rotation.x = Math.PI / 4;
  nozzle.position.set(0, 0.08, -0.12);
  arm.add(nozzle);
  // Струя — конус из полупрозрачных сфер
  const jet = new THREE.Group();
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 7; i++) {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.05 + i * 0.03, 6, 5), dropMat);
    drop.position.set(0, 0.28 + i * 0.16 - i * i * 0.012, -0.2 - i * 0.28);
    jet.add(drop);
  }
  arm.add(jet);
  g.position.set(LANE_X[lane], 0, z);
  return { kind: 'sprinkler', hazard: true, lethal: false, lane, z, group: g, arm, phase: 0,
    halfW: 0.5, halfD: 0.5, height: 0.6, resolved: false,
    jetOn() { return Math.sin(this.phase) > -0.2; },
    update(dt) {
      this.phase += dt * 2.4;
      this.arm.rotation.y = Math.sin(this.phase) * 0.9;
      this.arm.visible = true;
      this.arm.children[1].visible = this.jetOn();
    } };
}

// ---------- ПИКАПЫ ----------

let _glintTex = null;
function glintTexture() {
  if (_glintTex) return _glintTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,240,180,0.55)');
  grd.addColorStop(1, 'rgba(255,240,180,0)');
  // 4-лучевая звезда: два перекрещенных «лепестка»
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(32, 0); ctx.quadraticCurveTo(36, 28, 64, 32); ctx.quadraticCurveTo(36, 36, 32, 64); ctx.quadraticCurveTo(28, 36, 0, 32); ctx.quadraticCurveTo(28, 28, 32, 0);
  ctx.fill();
  ctx.beginPath(); ctx.arc(32, 32, 7, 0, 7); ctx.fill();
  _glintTex = new THREE.CanvasTexture(cv);
  _glintTex.userData.shared = true; // общий синглтон — disposeGroup не должен его уничтожать
  return _glintTex;
}

// Тело косточки (цилиндр + 4 шарика) слито в ОДНУ общую геометрию: 5 мешей → 1 draw на косточку.
// Геометрия и материалы общие (userData.shared) — строятся раз, disposeGroup их не трогает.
function mergeParts(geos) {
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.array.length;
  const pos = new Float32Array(total), norm = new Float32Array(total);
  let off = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, off); norm.set(g.attributes.normal.array, off); off += g.attributes.position.array.length; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return m;
}
let _cookieGeo = null, _cookieMat = null, _cookieMatGold = null;
function cookieShared() {
  if (_cookieGeo) return;
  const cyl = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8); cyl.rotateZ(Math.PI / 2);
  const parts = [cyl];
  for (const [x, yy] of [[-0.09, 0.045], [-0.09, -0.045], [0.09, 0.045], [0.09, -0.045]]) {
    const s = new THREE.SphereGeometry(0.055, 8, 6); s.translate(x, yy, 0); parts.push(s);
  }
  _cookieGeo = mergeParts(parts); _cookieGeo.computeBoundingSphere(); _cookieGeo.userData.shared = true;
  _cookieMat = std(0xe8b355, { roughness: 0.45, emissive: 0x3a2708 }); _cookieMat.userData.shared = true;
  _cookieMatGold = std(0xffc93d, { roughness: 0.3, emissive: 0x8a5c08 }); _cookieMatGold.userData.shared = true;
}

export function buildCookie(lane, z, y = 0.5, dx = 0, gold = false) {
  cookieShared();
  const g = new THREE.Group();
  if (gold) g.scale.setScalar(1.22);
  // Косточка: одно слитое тело (общая геометрия/материал)
  g.add(new THREE.Mesh(_cookieGeo, gold ? _cookieMatGold : _cookieMat));
  // Глинт-звёздочка: периодическая вспышка, чтобы косточку хотелось взять
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glintTexture(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glint.position.set(0.07, 0.06, 0);
  g.add(glint);
  g.position.set(LANE_X[lane] + dx, y, z);
  return { kind: 'cookie', pickup: true, lane, z, y, group: g, resolved: false, t: Math.abs(z) % 6.28, glint, value: gold ? 2 : 1,
    update(dt) {
      this.t += dt;
      this.group.rotation.y = this.t * 3;
      this.group.position.y = this.y + Math.sin(this.t * 4) * 0.05;
      // Вспышка ~раз в 2.4 с, у каждой косточки своя фаза
      const ph = this.t % 2.4;
      if (ph < 0.35) {
        const k = Math.sin((ph / 0.35) * Math.PI);
        this.glint.material.opacity = k * 0.95;
        this.glint.scale.setScalar(0.12 + k * 0.3);
        this.glint.material.rotation = this.t * 2;
      } else {
        this.glint.material.opacity = 0;
      }
    } };
}

const POWERUP_DEFS = {
  magnet: { color: 0xd84a4a, build(g) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.07, 8, 16, Math.PI), std(0xd84a4a));
    m.rotation.z = Math.PI;
    g.add(m);
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), std(0xeeeeee));
      tip.position.set(s * 0.18, 0.12, 0);
      g.add(tip);
    }
  } },
  shield: { color: 0x4a9ad8, build(g) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4a9ad8, transparent: true, opacity: 0.5 }));
    g.add(m);
    const heart = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), std(0xf0f0f0));
    heart.rotation.z = Math.PI / 4;
    g.add(heart);
  } },
  rocket: { color: 0xf0a030, build(g) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.06, 16), std(0xf0a030));
    g.add(disc);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xffe0a0));
    dot.position.y = 0.05;
    g.add(dot);
  } },
  multi: { color: 0xf0d040, build(g) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), std(0xf0d040));
    const b = a.clone(); b.rotation.z = Math.PI / 3;
    const c = a.clone(); c.rotation.z = -Math.PI / 3;
    g.add(a, b, c);
  } },
};

export function buildPowerup(type, lane, z) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  POWERUP_DEFS[type].build(inner);
  inner.position.y = 0;
  g.add(inner);
  // Светящийся ореол
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 10),
    new THREE.MeshBasicMaterial({ color: POWERUP_DEFS[type].color, transparent: true, opacity: 0.18 })
  );
  g.add(halo);
  g.position.set(LANE_X[lane], 0.75, z);
  return { kind: 'powerup', ptype: type, pickup: true, lane, z, y: 0.75, group: g, resolved: false, t: 0, halo, inner,
    update(dt) {
      this.t += dt;
      this.inner.rotation.y = this.t * 2.2;
      this.group.position.y = this.y + Math.sin(this.t * 3) * 0.08;
      this.halo.scale.setScalar(1 + Math.sin(this.t * 5) * 0.12);
    } };
}

// Золотой жетон судьи — revive-валюта (редкий, парит и сияет)
export function buildToken(lane, z) {
  const g = new THREE.Group();
  const rosette = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10),
    std(0xf2c531, { roughness: 0.25, emissive: 0x8a5c08 })
  );
  rosette.rotation.x = Math.PI / 2;
  g.add(rosette);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10), std(0xfff2c8, { emissive: 0x6a5210 }));
  core.rotation.x = Math.PI / 2;
  g.add(core);
  for (const s of [-1, 1]) {
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.03), std(0xd8434e));
    ribbon.position.set(s * 0.1, -0.32, 0);
    ribbon.rotation.z = s * 0.2;
    g.add(ribbon);
  }
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd75a, transparent: true, opacity: 0.16 })
  );
  g.add(halo);
  g.position.set(LANE_X[lane], 0.85, z);
  return { kind: 'token', pickup: true, lane, z, y: 0.85, group: g, resolved: false, t: 0, halo,
    update(dt) {
      this.t += dt;
      this.group.rotation.y = this.t * 2.4;
      this.group.position.y = this.y + Math.sin(this.t * 2.6) * 0.09;
      this.halo.scale.setScalar(1 + Math.sin(this.t * 4.5) * 0.15);
    } };
}

// Кость-буква для «слова дня»
export function buildLetter(lane, z, letter) {
  const g = new THREE.Group();
  const mat = std(0x9adcff, { roughness: 0.3, emissive: 0x1a4a66 });
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), mat);
  mid.rotation.z = Math.PI / 2;
  g.add(mid);
  for (const [x, yy] of [[-0.12, 0.06], [-0.12, -0.06], [0.12, 0.06], [0.12, -0.06]]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat);
    ball.position.set(x, yy, 0);
    g.add(ball);
  }
  // Буква — спрайт с канвас-текстурой (всегда лицом к камере)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 46px Arial';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#1a4a66';
  ctx.lineWidth = 6;
  ctx.strokeText(letter, 32, 48);
  ctx.fillText(letter, 32, 48);
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(0.42);
  sprite.position.y = 0.32;
  g.add(sprite);
  g.position.set(LANE_X[lane], 0.7, z);
  return { kind: 'letter', pickup: true, letter, lane, z, y: 0.7, group: g, resolved: false, t: 0,
    update(dt) {
      this.t += dt;
      this.group.rotation.y = this.t * 2;
      this.group.position.y = this.y + Math.sin(this.t * 3.4) * 0.07;
    } };
}

// Транспарант «ТВОЙ РЕКОРД» поперёк трассы — диегетический флажок дистанции
export function buildRecordFlag(z) {
  const g = new THREE.Group();
  const gold = std(0xf2c531, { emissive: 0x6a4c08 });
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.2, 8), gold);
    pole.position.set(s * (LANE_X[2] + 1.4), 1.6, 0);
    pole.castShadow = true;
    g.add(pole);
  }
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f2c531';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#5a3c08';
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('★ ТВОЙ РЕКОРД ★', 256, 46);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry((LANE_X[2] + 1.4) * 2, 0.7, 0.08),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0x332200 })
  );
  banner.position.y = 2.75;
  banner.castShadow = true;
  g.add(banner);
  g.position.set(0, 0, z);
  return { kind: 'recordflag', lane: 1, z, group: g, resolved: false, update() {} };
}

// Судья-преследователь (появляется после спотыкания)
export function buildJudge() {
  const g = new THREE.Group();
  const coat = std(0x35415c);
  const skin = std(0xe0b088);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 10), coat);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skin);
  head.position.y = 1.55;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10), std(0xd8434e));
  cap.position.y = 1.68;
  g.add(cap);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 6), std(0x2a3348));
    leg.position.set(s * 0.12, 0.35, 0);
    g.add(leg);
    legs.push(leg);
  }
  const arm = new THREE.Group();
  arm.position.set(0.3, 1.3, 0);
  const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 6), coat);
  armMesh.position.y = 0.2;
  arm.add(armMesh);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), std(0xf0d040, { side: THREE.DoubleSide }));
  flag.position.set(0.1, 0.5, 0);
  arm.add(flag);
  arm.rotation.z = -0.6;
  g.add(arm);
  g.userData = { legs, arm };
  return g;
}
