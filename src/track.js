import {
  buildHurdle, buildTire, buildTunnel, buildWeave, buildAFrame,
  buildDogwalk, buildSeesaw, buildTable, buildCart, buildHay, buildFence,
  buildCone, buildPuddle, buildSprinkler, buildCookie, initCookieBatch, buildPowerup,
  buildPodium, buildRecordFlag, buildToken, buildLetter, makeChainMarker,
} from './obstacles.js';

// Генератор трассы: паттерны спавнятся чанками впереди собаки.
// Сложность растёт с дистанцией: плотнее помехи, длиннее связки.
// Вся случайность — через seeded rng (детерминизм для харнесса).

const CHUNK = 34; // метров на чанк

// Освобождение GPU-ресурсов снаряда при рециклинге. Каждый снаряд билдится с уникальными
// geometry/material (см. obstacles.js), поэтому dispose безопасен и обязателен — иначе на
// долгом забеге GPU-память течёт и WebGL-контекст теряется («чёрный экран»).
function disposeGroup(group) {
  if (!group) return;
  group.traverse((o) => {
    // ВАЖНО: общие (shared) ресурсы НЕ диспозим — их переиспользуют другие сущности.
    // Напр. _glintTex, слитая геометрия/материал косточки (модульные синглтоны) — их dispose
    // сломал бы все последующие косточки (перф-churn + визбаг). Помечаем shared через userData.
    // !o.isSprite — у всех THREE.Sprite общая модульная геометрия, её диспозить нельзя (churn/поломка)
    if (o.geometry && !o.geometry.userData.shared && !o.isSprite) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m && m.map && !m.map.userData.shared) m.map.dispose(); if (m && !m.userData.shared) m.dispose(); }
    }
  });
}

export class Track {
  constructor(scene, rng) {
    this.scene = scene;
    initCookieBatch(scene); // батч печенек живёт на сцене, слоты выдаёт buildCookie
    this.rng = rng;
    this.entities = [];
    this.nextSpawnZ = -30; // следующий чанк начинается тут (собака бежит в -Z)
    this.chunkIndex = 0;
    this.lastSeen = {};
    this.sincePowerup = 0;
  }

  reset() {
    for (const e of this.entities) { if (e.releaseSlot) e.releaseSlot(); this.scene.remove(e.group); disposeGroup(e.group); }
    this.entities = [];
    this.nextSpawnZ = -30;
    this.chunkIndex = 0;
    this.lastSeen = {}; // kind -> chunkIndex последнего спавна (гарантия ротации)
    this.sincePowerup = 0; // метров с последнего пауэрапа (pity-таймер)
    this.recordFlagSpawned = false;
    this.tokenSpawned = false; // жетон судьи — максимум 1 за забег
    this.sinceLetter = 0; // pity-счётчик кости-буквы
    this.nextLetterFn = null; // колбэк: какую букву спавнить (из meta)
    this.chainSeq = 0; // детерминированный ID «Связки» (НЕ Date/random — воспроизводимо по сиду)
  }

  _add(rec) {
    this.scene.add(rec.group);
    this.entities.push(rec);
    return rec;
  }

  _cookieLine(lane, z, n = 5, step = 1.6) {
    // После километра часть дорожек — золотые (×2): трасса «дорожает» с дистанцией
    const gold = this.chunkIndex * 34 > 1000 && this.rng.chance(0.3);
    for (let i = 0; i < n; i++) this._add(buildCookie(lane, z - i * step, 0.5, 0, gold));
  }

  _cookieArc(lane, z) {
    // Дуга над барьером: подсказка «прыгай и собирай»
    const ys = [0.5, 0.95, 1.25, 0.95, 0.5];
    for (let i = 0; i < ys.length; i++) this._add(buildCookie(lane, z + 3.2 - i * 1.6, ys[i]));
  }

  _spawnChunk() {
    const z = this.nextSpawnZ; // начало чанка (ближний к собаке край)
    const rng = this.rng;
    const idx = this.chunkIndex++;
    const diff = Math.min(1, idx / 40); // 0..1 рост сложности (упирается в потолок на ~1360 м)
    // Вторая ось сложности: продолжает расти ПОСЛЕ потолка первой (idx>40), мягко насыщаясь.
    // Даёт «ещё один забег»: чанки плотнее, чаще связки снаряд→снаряд, больше вторичных помех.
    // Скорость НЕ трогаем (остаётся честный потолок 26 м/с) — растёт только плотность/связность.
    const hard = 1 - Math.exp(-Math.max(0, idx - 40) / 80); // 0..~1, ~0.5 к idx≈95 (~3.2 км)
    // «Плавный старт»: в первых ~12 чанках (≈400 м) шанс летальных помех (тележка/забор)
    // вдвое ниже — 39% игроков умирали до 500 м. Зависит только от idx → детерминизм по сиду.
    const ease = idx < 12 ? 0.5 : 1;
    // Плотность: после потолка чанк сжимается до ~26% (нижний предел gap честный для реакции на 26 м/с).
    // advance — реальная длина чанка в метрах; ВСЕ pity-счётчики считают именно её, иначе после
    // сжатия пауэрапы/буквы спавнились бы чаще задуманного (подрыв дефицита).
    const advance = CHUNK * (1 - 0.26 * hard);
    this.nextSpawnZ -= advance;
    this.sincePowerup += advance;

    const lanes = [0, 1, 2];
    const mainLane = rng.int(0, 2);
    const estSpeed = Math.min(26, 12 + idx * CHUNK * 0.012);

    // Транспарант «ТВОЙ РЕКОРД» на дистанции лучшего забега
    if (this.recordDist > 60 && !this.recordFlagSpawned) {
      const flagZ = -this.recordDist; // дистанция == -z (до rebase)
      if (flagZ <= z && flagZ > this.nextSpawnZ - CHUNK) {
        this._add(buildRecordFlag(flagZ));
        this.recordFlagSpawned = true;
      }
    }

    if (idx < 2) {
      // Стартовые чанки: мягкий разгон — барьер и печеньки
      this._add(buildHurdle(1, z - 14));
      this._cookieArc(1, z - 14);
      this._cookieLine(rng.int(0, 2), z - 24, 5);
      this.lastSeen.hurdle = idx;
      return;
    }

    // --- Паттерны (каждый возвращает список задействованных типов снарядов) ---
    const patterns = {
      hurdle: () => {
        // Связка барьеров: интервал больше дальности прыжка на текущей скорости
        const gap = Math.max(12, estSpeed * 1.05);
        let lane = mainLane;
        const n = 2 + (rng.chance(diff) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          this._add(buildHurdle(lane, z - 6 - i * gap));
          if (rng.chance(0.7)) this._cookieArc(lane, z - 6 - i * gap);
          if (rng.chance(0.5)) lane = Math.max(0, Math.min(2, lane + rng.pick([-1, 1])));
        }
        if (rng.chance(diff * 0.8)) this._add(buildCone((mainLane + 1) % 3, z - 17));
        // Связка может быть длиннее чанка — сдвигаем следующий спавн
        this.nextSpawnZ = Math.min(this.nextSpawnZ, z - (6 + (n - 1) * gap + 12));
      },
      tunnel: () => {
        this._add(buildTunnel(mainLane, z - 15));
        // Breadcrumbs: низкая дорожка косточек внутри тоннеля — «пригнись и держи полосу»
        for (let c = 0; c < 4; c++) this._add(buildCookie(mainLane, z - 13 - c * 1.4, 0.32));
        const other = (mainLane + rng.pick([1, 2])) % 3;
        if (rng.chance((0.4 + diff * 0.4) * ease)) this._add(rng.chance(0.35) ? buildHay(other, z - 15) : buildCart(other, z - 15));
        this._cookieLine(mainLane, z - 22, 5);
      },
      weave: () => {
        this._add(buildWeave(mainLane, z - 8));
        // Breadcrumbs: зигзаг косточек по стойкам — читается траектория змейки
        for (let c = 0; c < 6; c++) {
          this._add(buildCookie(mainLane, z - 8 - c * 1.5, 0.55, (c % 2 ? -0.4 : 0.4)));
        }
        this._cookieLine((mainLane + 1) % 3, z - 8, 6);
        if (rng.chance(diff)) this._add(buildPuddle((mainLane + 2) % 3, z - 12));
      },
      aframe: () => {
        this._add(buildAFrame(mainLane, z - 12));
        this._cookieLine(mainLane, z - 20, 4);
        if (rng.chance(0.5 * ease)) this._add(buildFence([(mainLane + 1) % 3], z - 12));
      },
      dogwalk: () => {
        this._add(buildDogwalk(mainLane, z - 14));
        if (rng.chance(0.6)) this._add(buildCone((mainLane + 1) % 3, z - 10, rng.float(-0.3, 0.3)));
        this._cookieLine((mainLane + 2) % 3, z - 12, 5);
      },
      seesaw: () => {
        this._add(buildSeesaw(mainLane, z - 10));
        this._cookieLine((mainLane + 2) % 3, z - 10, 5);
      },
      tire: () => {
        this._add(buildTire(mainLane, z - 10));
        this._cookieArc(mainLane, z - 10);
        if (rng.chance(diff * 0.9 * ease)) this._add(rng.chance(0.35) ? buildHay((mainLane + 1) % 3, z - 10) : buildCart((mainLane + 1) % 3, z - 10));
      },
      table: () => {
        this._add(buildTable(mainLane, z - 10));
        this._cookieLine(mainLane, z - 16, 5);
      },
      wall: () => {
        // Полоса помех: стена с одним безопасным проходом
        const safe = rng.int(0, 2);
        for (const l of lanes) {
          if (l === safe) continue;
          if (rng.chance(0.75 * ease)) this._add(rng.chance(0.5) ? (rng.chance(0.3) ? buildHay(l, z - 12) : buildCart(l, z - 12)) : buildFence([l], z - 12));
        }
        if (rng.chance(0.6)) {
          this._add(buildHurdle(safe, z - 12));
          this._cookieArc(safe, z - 12);
          this.lastSeen.hurdle = idx;
        } else {
          this._cookieLine(safe, z - 10, 5);
        }
        if (rng.chance(diff * 0.7)) this._add(buildSprinkler(rng.int(0, 2), z - 26));
      },
      podium: () => {
        // «Второй этаж»: эстакада с печеньками наверху; рядом на земле — помехи
        const len = 24 + Math.floor(rng.float(0, 2)) * 8;
        const pod = this._add(buildPodium(mainLane, z - 6 - len / 2, len));
        // Дорожка печенек по верху
        for (let c = 0; c < Math.floor(len / 2.2) - 2; c++) {
          this._add(buildCookie(mainLane, pod.entry - 5 - c * 2.2, pod.h + 0.5, 0, true));
        }
        // Иногда второй подиум в соседней полосе — прыжок «крыша-крыша»
        if (rng.chance(0.4)) {
          const other = mainLane === 2 ? 1 : mainLane + 1;
          const pod2 = this._add(buildPodium(other, z - 14 - len / 2, len));
          for (let c = 0; c < 5; c++) this._add(buildCookie(other, pod2.entry - 6 - c * 2.2, pod2.h + 0.5, 0, true));
        } else if (rng.chance(0.6)) {
          // Помеха на земле в соседней полосе — стимул подняться наверх
          const other = (mainLane + 1) % 3;
          if (rng.chance(ease)) this._add(buildCart(other, z - 10 - len / 2));
        }
        // Пауэрап на верхотуре — награда за высоту
        if (rng.chance(0.35)) {
          const types = ['magnet', 'shield', 'rocket', 'multi'];
          const p = this._add(buildPowerup(rng.pick(types), mainLane, pod.exit + 4));
          p.group.position.y = pod.h + 0.75;
          p.y = pod.h + 0.75;
        }
        this.nextSpawnZ = Math.min(this.nextSpawnZ, z - 6 - len - 10);
      },
      breather: () => {
        // Дыхание: печеньки и мелкие помехи
        this._cookieLine(rng.int(0, 2), z - 8, 7);
        if (rng.chance(0.5)) this._add(buildPuddle(rng.int(0, 2), z - 16));
        if (rng.chance(diff * 0.6)) this._add(buildSprinkler(rng.int(0, 2), z - 24));
      },
    };

    // --- Директор: гарантия ротации снарядов ---
    const APPARATUS = ['hurdle', 'tunnel', 'weave', 'aframe', 'dogwalk', 'seesaw', 'tire', 'table'];
    let picked = null;
    let staleAge = 0;
    for (const k of APPARATUS) {
      const age = idx - (this.lastSeen[k] ?? (k === 'table' ? idx - 8 : 0));
      if (age > 15 && age > staleAge) { staleAge = age; picked = k; }
    }
    if (!picked) {
      const roll = rng.next();
      if (roll < 0.17) picked = 'hurdle';
      else if (roll < 0.3) picked = 'tunnel';
      else if (roll < 0.41) picked = 'weave';
      else if (roll < 0.51) picked = 'aframe';
      else if (roll < 0.6) picked = 'dogwalk';
      else if (roll < 0.68) picked = 'seesaw';
      else if (roll < 0.76) picked = 'tire';
      else if (roll < 0.81 && idx > 6) picked = 'table';
      else if (roll < 0.88 && idx > 4) picked = 'podium';
      else if (roll < 0.95) picked = 'wall';
      else picked = 'breather';
    }
    patterns[picked]();
    if (APPARATUS.includes(picked)) this.lastSeen[picked] = idx;

    // Вторая ось (F2), теперь ВИДИМАЯ — явная «Связка»: цепочка снарядов подряд без передышки,
    // помеченная chainId. Появляется с ранне-средней игры (idx>8, ~270 м), чаще и длиннее с
    // дистанцией (diff→hard). Скорость НЕ трогаем — растёт только плотность/связность.
    // Полное чистое прохождение связки награждается бонусом (game.js) — «комбо-последовательность».
    const pChain = Math.min(0.5, 0.10 + diff * 0.18 + hard * 0.25);
    if (APPARATUS.includes(picked) && idx > 8 && rng.chance(pChain)) {
      const len = 2 + (rng.chance(diff) ? 1 : 0) + (rng.chance(hard) ? 1 : 0); // 2..4
      const cid = ++this.chainSeq;
      const gap = Math.max(12, estSpeed * 1.05); // ≥ дальности прыжка — честно для реакции на 26 м/с
      let lz = this.nextSpawnZ - 6; // впереди всего, что уже заспавнено в чанке
      let lane = rng.int(0, 2);
      const TOP_Y = { hurdle: 1.0, tire: 2.15, tunnel: 1.95 }; // верх снаряда — флажок ставим НАД ним
      for (let i = 0; i < len; i++) {
        const k = rng.pick(['hurdle', 'tire', 'tunnel']);
        let rec;
        if (k === 'tunnel') rec = this._add(buildTunnel(lane, lz));
        else if (k === 'tire') { rec = this._add(buildTire(lane, lz)); this._cookieArc(lane, lz); }
        else { rec = this._add(buildHurdle(lane, lz)); this._cookieArc(lane, lz); }
        // Метки связки: game.js трекает прогресс и выдаёт бонус за полное прохождение.
        rec.chainId = cid; rec.chainIndex = i; rec.chainLen = len;
        // Видимый флажок СБОКУ от снаряда с номером позиции (1,2,3…) — понятно, что снаряды
        // связаны, но сам снаряд не загорожен. Крайняя правая полоса → флажок влево (к центру).
        rec.group.add(makeChainMarker(i + 1, TOP_Y[k], lane === 2 ? -0.9 : 0.9));
        lz -= gap;
        if (rng.chance(0.4)) lane = Math.max(0, Math.min(2, lane + rng.pick([-1, 1])));
      }
      this.nextSpawnZ = Math.min(this.nextSpawnZ, lz - 12);
    }

    // --- Жетон судьи: один за забег, после ~450 м ---
    if (!this.tokenSpawned && idx * CHUNK > 450 && rng.chance(0.25)) {
      this._add(buildToken(rng.int(0, 2), z - CHUNK + 8));
      this.tokenSpawned = true;
    }

    // --- Кость-буква слова дня: примерно раз в 300 м ---
    this.sinceLetter += advance;
    if (this.sinceLetter > 300 && this.nextLetterFn) {
      const letter = this.nextLetterFn();
      if (letter) {
        this._add(buildLetter(rng.int(0, 2), z - CHUNK + 14, letter));
        this.sinceLetter = 0;
      }
    }

    // --- Pity-таймер пауэрапов: гарантированно каждые ~220 м ---
    if (this.sincePowerup > 220 || (this.sincePowerup > 120 && rng.chance(0.25))) {
      const types = ['magnet', 'shield', 'rocket', 'multi'];
      this._add(buildPowerup(rng.pick(types), rng.int(0, 2), this.nextSpawnZ + 6));
      this.sincePowerup = 0;
    }

    // --- Плотность: вторичный элемент в свободной полосе (усиливается второй осью hard) ---
    if (picked !== 'wall' && picked !== 'breather' && rng.chance(0.35 + diff * 0.3 + hard * 0.2)) {
      const freeLane = (mainLane + 2) % 3;
      if (rng.chance(0.5)) this._add(buildHurdle(freeLane, z - CHUNK + 6));
      else this._cookieLine(freeLane, z - CHUNK + 8, 4);
    }
    if (diff > 0.5 && rng.chance(0.3 + hard * 0.3)) {
      this._add(buildCone(rng.int(0, 2), z - CHUNK + 4, rng.float(-0.3, 0.3)));
    }
  }

  // Прямой спавн для лабораторного режима харнесса
  spawnOne(kind, lane, z) {
    const builders = {
      hurdle: buildHurdle, tire: buildTire, tunnel: buildTunnel, weave: buildWeave,
      aframe: buildAFrame, dogwalk: buildDogwalk, seesaw: buildSeesaw, table: buildTable,
      cart: buildCart, hay: buildHay, cone: buildCone, puddle: buildPuddle, sprinkler: buildSprinkler, podium: buildPodium, token: buildToken,
    };
    if (kind === 'fence') return this._add(buildFence([lane], z));
    if (kind === 'cookie') return this._add(buildCookie(lane, z));
    if (kind.startsWith('powerup:')) return this._add(buildPowerup(kind.split(':')[1], lane, z));
    return this._add(builders[kind](lane, z));
  }

  // Дуга косточек на высоте полёта фрисби: «собери красиво в воздухе», как в SS.
  // Детерминизм: позиции задаёт траектория; rng — только лёгкая фаза свупа (вне score-ветки).
  // Баланс: ОБЫЧНЫЕ косточки и cap 32 — иначе одна ракета (+128 при золоте×64) удваивала
  // заработок забега и убивала дефицит магазина (#22) и миссию «120 печенек».
  spawnFlightTrail(lane, startZ, length, rng) {
    const step = 1.7;
    const n = Math.min(32, Math.max(6, Math.floor(length / step)));
    const phase = rng ? rng.float(0, Math.PI * 2) : 0;
    for (let i = 0; i < n; i++) {
      const z = startZ - 6 - i * step;
      const y = 2.55 + 0.5 * Math.sin(phase + i * 0.45); // мягкая волна на высоте диска
      this._add(buildCookie(lane, z, y, 0));
    }
  }

  update(dt, dogZ) {
    // Спавн вперёд на 160 м
    while (!this.disabled && this.nextSpawnZ > dogZ - 170) this._spawnChunk();
    // Удаление позади
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.z > dogZ + 18 || (e.exit != null && e.exit > dogZ + 18)) {
        if (e.releaseSlot) e.releaseSlot();
        this.scene.remove(e.group);
        disposeGroup(e.group); // освобождаем GPU-память — иначе на долгом забеге контекст теряется
        this.entities.splice(i, 1);
      }
    }
    for (const e of this.entities) e.update(dt, dogZ);
  }

  rebase(dz) {
    this.nextSpawnZ += dz;
    for (const e of this.entities) {
      e.z += dz;
      e.group.position.z += dz;
      if (e.entry != null) e.entry += dz;
      if (e.exit != null) e.exit += dz;
      if (e.plankStart != null) { e.plankStart += dz; e.plankEnd += dz; }
      if (e.contactStart != null) { e.contactStart += dz; e.contactEnd += dz; }
    }
  }
}
