import * as THREE from 'three';
import { Dog } from './dog.js';
import { World, LANE_X } from './world.js';
import { Track } from './track.js';
import { Fx, Popups } from './fx.js';
import { CameraRig } from './camera_rig.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Meta } from './meta.js';
import { Rng } from './rng.js';
import { buildJudge } from './obstacles.js';
import { submitScore } from './leaderboard.js';
import { track, sessionId } from './analytics.js';

export const FIXED_DT = 1 / 60;
const JUMP_V = 5.4, GRAVITY = 15, FAST_FALL = -11;
const BASE_SPEED = 12, MAX_SPEED = 26;

// Обучение «за руку» (первая сессия): нужный жест по типу снаряда. При подходе к новому
// снаряду игра замедляется и показывается визуальный жест (анимированный «ghost hand»
// в направлении dir) + короткая подпись. dir: up|down|side|tap. text — touch/key адаптивно.
const TUT_GESTURE = {
  hurdle:  { name: 'БАРЬЕР',  dir: 'up',   touch: 'СВАЙП ВВЕРХ',  key: '↑ или ПРОБЕЛ' },
  tire:    { name: 'ШИНА',    dir: 'up',   touch: 'СВАЙП ВВЕРХ',  key: '↑ ПРЫЖОК' },
  tunnel:  { name: 'ТОННЕЛЬ', dir: 'down', touch: 'СВАЙП ВНИЗ',   key: '↓ ПОДКАТ' },
  weave:   { name: 'СЛАЛОМ',  dir: 'tap',  touch: 'ТАПАЙ В РИТМ', key: 'ЖМИ В РИТМ' },
  aframe:  { name: 'ГОРКА',   dir: 'down', touch: 'ВНИЗ В ЗОНЕ',  key: '↓ В ЗОНЕ' },
  seesaw:  { name: 'КАЧЕЛИ',  dir: 'down', touch: 'ВНИЗ, КОГДА ЛЯЖЕТ', key: '↓ КОГДА ЛЯЖЕТ' },
  dogwalk: { name: 'БУМ',     dir: 'side', touch: 'НАКЛОНЯЙ ← →', key: '← → БАЛАНС' },
  table:   { name: 'СТОЛ',    dir: 'up',   touch: 'ЗАСКОЧИ',      key: 'ЗАСКОЧИ' },
};
// Дистанция (м), на которой всплывает подсказка у ПРЫЖКОВЫХ/подката — чтобы игрок успел
// среагировать и прыгнуть/присесть вовремя. Контактные и слалом показываются по факту
// нахождения на них (см. _updateTutorial), поэтому здесь их нет.
const TUT_RANGE = { hurdle: 6, tire: 6, tunnel: 6, table: 5 };
const TUT_MAX_SHOWS = 5; // сколько раз максимум показать подсказку типа (если игрок не освоил)

// Очки
const SCORE_CLEAN = 100, SCORE_PERFECT_MULT = 2, SCORE_TABLE = 300, SCORE_COOKIE = 10;

export class Game {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.meta = new Meta();
    this.ui = new UI(this.meta);
    this.audio = new Audio();
    this.rig = new CameraRig(camera);
    this.popups = new Popups(document.getElementById('popups'));
    this.state = 'menu';
    this.rng = new Rng(1);
    this.world = new World(scene, this.rng, renderer);
    this.track = new Track(scene, this.rng);
    this.fx = new Fx(scene);
    this.dogModel = null;
    this.judge = buildJudge();
    this.judge.visible = false;
    scene.add(this.judge);
    // Мягкий свет над собакой — читаемость персонажа в тёмных зонах
    this.dogLight = new THREE.PointLight(0xfff0dd, 6, 5, 2);
    this.dogLight.position.set(0, 1.6, 0.4);
    scene.add(this.dogLight);
    this.inputQueue = [];
    // Тип управления — для вида подсказок обучения (не влияет на физику/детерминизм).
    // ?touch форсит жесты-лапы даже на десктопе (для проверки), ?tut держит обучение
    // активным каждый забег (не выключается после первого) — удобно тестировать все снаряды.
    const _q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
    this.isTouch = _q.has('touch')
      || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
      || (typeof window !== 'undefined' && 'ontouchstart' in window);
    this.forceTut = _q.has('tut');
    // Обучение: показываем подсказку по типу снаряда, пока игрок не пройдёт его ЧИСТО
    // (learned — помним между сессиями), но не более TUT_MAX_SHOWS раз (count) — чтобы не надоедало.
    let _learned = {};
    try { _learned = JSON.parse(localStorage.getItem('agility_tut_learned') || '{}'); } catch { _learned = {}; }
    this.tutorial = { active: false, count: {}, learned: _learned, curType: null, curTarget: null };
    this.timeScale = 1;
    this.slowmoT = 0;
    this._resetRunState();
    this._setDog(this.meta.data.selectedDog);
  }

  _setDog(breed) {
    if (this.dogModel) {
      this.scene.remove(this.dogModel.root);
      this.dogModel.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => x && x.dispose()); } });
    }
    this.dogModel = new Dog(breed, this.meta.cosmeticEquip());
    this.scene.add(this.dogModel.root);
    this.breed = breed;
  }

  _resetRunState() {
    this.dog = {
      lane: 1, x: 0, y: 0, vy: 0, z: 0,
      airborne: false, jumpStart: 0, jumpElapsed: 0,
      slideT: 0, speed: 0, gallopPhase: 0, footPhase: 0,
      stumbleInvulnT: 0, stunT: 0, launchedT: 0, launchSpin: 0, landT: 0, coyoteT: 0, jumpBufferT: 0,
      deadT: 0, mode: 'idle', shakeT: 999,
    };
    this._judgeAnimT = 0;
    this._pendingSpawns = [];
    this.onApparatus = null; // текущий контактный снаряд (aframe/dogwalk/seesaw)
    this.apparatusState = null;
    this.weave = null;
    this.tableT = 0;
    this.flyT = 0;
    this.speedModT = 0; this.speedMod = 1;
    this.boostT = 0;
    this.judgeT = 0;
    this.timeScale = 1;
    this.slowmoT = 0;
    this.distance = 0;
    this.score = 0;
    this.combo = 0;
    this.cookieStreak = 0; this.cookieStreakT = 0;
    this.powerups = { magnet: 0, shield: 0, rocket: 0, multi: 0 };
    this.powerupMax = { magnet: 8, shield: 1, rocket: 4.5, multi: 10 };
    this.runStats = {
      score: 0, distance: 0, cookies: 0, maxCombo: 0, perfects: 0, faults: 0,
      cleanObstacles: 0, cleanHurdles: 0, perfectWeaves: 0, tunnels: 0, tables: 0,
      powerups: 0, cleanStreakDist: 0, _streakStart: 0,
    };
    // Аналитика чистоты по типам снарядов: сколько раз тип встречен и как пройден
    // (perfect/clean/fault/death) — чтобы видеть честный fail-rate и где игроки «стоят».
    this.obstacleStats = {};
    this.milestones = [5, 10, 20, 30, 50];
  }

  // ---------- Публичное API ----------

  showMenu() {
    if (this.pendingReload) return this.pendingReload(); // применить отложенное обновление
    this.state = 'menu';
    this.audio.stopMusic();
    this.rig.reset();
    this.ui.showMenu(
      () => this.startRun(),
      (key) => {
        const d = this.meta.data;
        if (d.unlocked.includes(key)) this.meta.selectDog(key);
        else this.meta.buyDog(key);
        this._setDog(this.meta.data.selectedDog);
      }
    );
    this._placeDogAtStart();
  }

  _placeDogAtStart() {
    this._clearRun();
    this.dog.mode = 'idle';
    this.dogModel.root.position.set(0, 0, 0);
    this.dogModel.root.rotation.y = Math.PI; // мордой к камере в меню
  }

  _clearRun() {
    if (this._gameOverTimer) { clearTimeout(this._gameOverTimer); this._gameOverTimer = null; }
    this.track.reset();
    this.world.reset();
    this._removeFrisbee();
    this._resetRunState();
    this.track.recordDist = this.meta.data.bestDistance || 0;
    this.metaMult = this.meta.data.scoreMult || 1;
    this.recordBeaten = false;
    this.hitstopT = 0;
    this.reviveCount = 0;
    this.reviveT = 0;
    this.pendingDeath = null;
    this.rivalIdx = 0;
    this.rivals = this.meta.rivals();
    this.track.nextLetterFn = () => this.meta.nextLetter();
    this.autosaveT = 0;
  }

  async startRun(seed = null, instant = false) {
    this.audio.init();
    this.audio.resume();
    this._clearRun();
    const s = seed ?? ((Math.random() * 1e9) | 0);
    this.rng = new Rng(s);
    this.track.rng = this.rng;
    this.world.rng = this.rng;
    this.seed = s;
    this.ui.hideMenu();
    this.ui.hideGameOver();
    this.dogModel.root.rotation.y = 0;
    this.dog.mode = 'idle';
    this.dog.shakeT = 0; // встряхивание на старте
    this.state = 'countdown';
    if (instant) {
      this.ui.countdownInstant();
      this.state = 'running';
      this.audio.whistle();
    } else {
      await this.ui.countdown();
      if (this.state !== 'countdown') return; // прервали
      this.audio.whistle();
      this.audio.bark();
      this.state = 'running';
    }
    this.audio.startMusic();
    // Аналитика: старт забега
    this._runId = (Math.random().toString(36).slice(2, 10));
    this._runIndex = (this._runIndex || 0) + 1;
    this._zoneSeen = new Set();
    this._msSeen = new Set();
    this._runStartMs = Date.now();
    track('run_start', { run_id: this._runId, run_index: this._runIndex, dog: this.breed, seed: this.seed, ver: this.metaMult });
    // Обучение «за руку» — в живой игре (не в харнессе instant, где детерминизм). Показ
    // фильтруется по learned/count в _updateTutorial. Тест-режим ?tut сбрасывает прогресс.
    this.tutorial.active = !instant;
    if (this.forceTut) { this.tutorial.count = {}; this.tutorial.learned = {}; }
    this.tutorial.curType = null;
    this.tutorial.curTarget = null;
    this.ui.hideTutHint();
  }

  input(action) {
    if (this.state === 'running') this.inputQueue.push(action);
  }

  togglePause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.audio.stopMusic();
      this.ui.showPause(() => this.togglePause(), () => { this.state = 'running'; this.showMenu(); });
    } else if (this.state === 'paused') {
      this.state = 'running';
      this.ui.hidePause();
      this.audio.startMusic();
    }
  }

  // ---------- Основной фиксированный шаг ----------

  update() {
    const dtRaw = FIXED_DT;
    if (this.state === 'paused') return; // мир заморожен, таймеры не трогаем
    // slow-mo и hitstop: детерминированный масштаб времени
    if (this.slowmoT > 0) {
      this.slowmoT -= dtRaw;
      this.timeScale = this.slowmoT > 0 ? 0.35 : 1;
    }
    if (this.hitstopT > 0) {
      this.hitstopT -= dtRaw;
      this.timeScale = 0.05; // стоп-кадр: «это имело значение»
      if (this.hitstopT <= 0) this.timeScale = this.slowmoT > 0 ? 0.35 : 1;
    }
    // Обучение: пока висит подсказка к снаряду — мягко замедляем, чтобы игрок успел
    // прочитать жест и попасть в момент. Снимается вместе с подсказкой (не залипает).
    if (this.tutorial.active && this.tutorial.curType) this.timeScale = Math.min(this.timeScale, 0.55);
    const dt = dtRaw * this.timeScale;
    this.popups.update(dtRaw);

    if (this.state === 'menu' || this.state === 'countdown') {
      const d = this.dog;
      d.shakeT += dtRaw;
      this.dogModel.update(dtRaw, { mode: 'idle', speed: 0, shakeT: d.shakeT, lean: 0 });
      this.world.update(dtRaw, 0, 0);
      this.rig.update(dtRaw, { x: 0, y: 0, z: -1.5, gallopPhase: 0 }, 4, 0);
      this.fx.update(dtRaw);
      return;
    }

    if (this.state === 'revive') {
      // Пауза «судья прощает?»: мир замер, таймер тикает
      this.reviveT -= dtRaw;
      this.ui.updateReviveTimer(Math.max(0, this.reviveT / 5));
      const d = this.dog;
      this.dogModel.update(dtRaw, { mode: 'idle', speed: 0, shakeT: 999, lean: 0 });
      this.dogModel.root.position.set(d.x, d.y, d.z);
      this.fx.update(dtRaw * 0.2);
      if (this.reviveT <= 0) this.declineRevive();
      return;
    }

    if (this.state === 'dead') {
      const d = this.dog;
      d.deadT += dtRaw;
      this.dogModel.update(dtRaw, { mode: 'dead', deadT: d.deadT * 2, speed: 0, lean: 0 });
      this.dogModel.root.position.set(d.x, d.y, d.z);
      this.fx.update(dtRaw);
      this.world.update(dtRaw, d.z, this.distance);
      this.rig.update(dtRaw, d, 0, 0);
      this.track.update(dtRaw, d.z);
      return;
    }

    // === RUNNING ===
    const d = this.dog;

    // Скорость: база растёт с дистанцией, множители снарядов/бустов
    let target = Math.min(MAX_SPEED, BASE_SPEED + this.distance * 0.012);
    if (this.speedModT > 0) { this.speedModT -= dt; target *= this.speedMod; }
    if (this.boostT > 0) { this.boostT -= dt; target *= 1.25; }
    if (this.flyT > 0) target *= 1.3;
    if (this.weave) target *= 0.62;
    if (this.onApparatus) {
      if (this.onApparatus.kind === 'aframe') target *= 0.5;
      else target *= 0.5; // бум и качели требуют аккуратности
    }
    if (d.stunT > 0) { d.stunT -= dt; target *= 0.35; }
    const accel = d.speed < target ? 8 : 20;
    d.speed += (target - d.speed) * Math.min(1, accel * dt);

    // Ввод
    this._processInput(dt);

    // Продвижение
    d.z -= d.speed * dt;
    this.distance += d.speed * dt;
    this._trackProgress();
    this.score += d.speed * dt * (this.powerups.multi > 0 ? 2 : 1) * (this.tableBoostT > 0 ? 2 : 1) * (this.metaMult || 1);

    // Полосы / горизонтальное движение
    let targetX = LANE_X[d.lane];
    if (this.weave) {
      // Змейка слалома: максимальное боковое смещение в момент прохода каждой стойки
      const w = this.weave;
      const prog = (w.entry - d.z) / w.spacing;
      targetX = LANE_X[w.lane] + Math.cos(prog * Math.PI) * 0.4;
    } else if (this.onApparatus && this.onApparatus.kind === 'dogwalk') {
      targetX = LANE_X[this.onApparatus.lane] + (this.apparatusState.balance || 0) * 0.2;
    } else if (this.onApparatus) {
      targetX = LANE_X[this.onApparatus.lane];
    }
    const dx = targetX - d.x;
    d.x += dx * Math.min(1, 11 * dt);
    const lean = THREE.MathUtils.clamp(dx * 0.35, -0.45, 0.45);

    // Вертикаль
    this._updateVertical(dt);

    // Таймеры
    if (d.stumbleInvulnT > 0) d.stumbleInvulnT -= dt;
    if (d.landT > 0) d.landT -= dt;
    if (d.coyoteT > 0) d.coyoteT -= dt;
    if (d.jumpBufferT > 0) d.jumpBufferT -= dt;
    if (this.inputRecentSlide > 0) this.inputRecentSlide -= dt;
    if (d.slideT > 0) d.slideT -= dt;
    if (this.tableBoostT > 0) this.tableBoostT -= dt;
    if (this.cookieStreakT > 0) { this.cookieStreakT -= dt; } else this.cookieStreak = 0;
    for (const k of Object.keys(this.powerups)) {
      if (k === 'shield') continue;
      if (this.powerups[k] > 0) this.powerups[k] -= dt;
    }
    if (this.judgeT > 0) this.judgeT -= dt;

    // Галоп
    const stride = this.dogModel.cfg.stride || 2.6;
    if (!d.airborne && !d.slideT && this.flyT <= 0) {
      const prev = d.gallopPhase;
      d.gallopPhase += (d.speed / stride) * dt * Math.PI * 2 / 2;
      // Шаги: звук + пыль + следы дважды за цикл
      if (Math.floor(d.gallopPhase / Math.PI) > Math.floor(prev / Math.PI)) {
        this.audio.footstep(d.speed);
        if (d.speed > 6) {
          this.fx.dust(new THREE.Vector3(d.x + this.rng.float(-0.1, 0.1), 0.06, d.z + 0.3), Math.min(2, d.speed / 12));
          this.fx.pawPrint(d.x + (Math.floor(d.gallopPhase / Math.PI) % 2 ? 0.12 : -0.12), d.z + 0.2);
        }
      }
    }

    // Механики снарядов и коллизии
    this._updateApparatus(dt);
    this._updateWeave(dt);
    this._collisions(dt);
    if (this.tutorial.active) this._updateTutorial();
    if (this._pendingSpawns && this._pendingSpawns.length) {
      for (const fn of this._pendingSpawns) fn();
      this._pendingSpawns.length = 0;
    }

    // Ракета-фрисби: полёт за диском
    if (this.flyT > 0) {
      this.flyT -= dt;
      if (this.flyT <= 0) { d.vy = 0; d.airborne = true; }
    }
    this._updateFrisbee(dt);

    // Судья-преследователь
    this._updateJudge(dt);

    // Боты-соперники: «Ты обогнал Рекса!»
    while (this.rivalIdx < this.rivals.length && this.score >= this.rivals[this.rivalIdx].score) {
      const r = this.rivals[this.rivalIdx++];
      this.popups.custom(`Обогнал: ${r.name}! 🐾`, 'combo', 50, 28);
      this.audio.crowdExcite(0.16);
    }

    // Автосейв забега: раз в 3 с пишем косточки/счёт/дистанцию (страховка от краша)
    this.autosaveT = (this.autosaveT || 0) + dtRaw;
    if (this.autosaveT > 3) {
      this.autosaveT = 0;
      this.meta.saveLiveRun({ cookies: this.runStats.cookies, score: this.score, distance: this.distance });
    }

    // Миссии проверяются прямо в забеге — тост в момент выполнения
    this.missionCheckT = (this.missionCheckT || 0) + dt;
    if (this.missionCheckT > 1) {
      this.missionCheckT = 0;
      const z = this.world.currentZone;
      this.audio.setCrowdBase(z === 'stadium' || z === 'night' ? 0.085 : 0.028);
      const rs = { ...this.runStats, score: Math.floor(this.score), distance: this.distance };
      const completed = this.meta.checkMissions(rs);
      for (const m of completed) {
        this.ui.missionComplete(m);
        this.audio.applause();
        this.fx.confetti(new THREE.Vector3(d.x, 1.6, d.z - 2));
        track('mission_complete', { mission_id: m.id, reward: m.reward });
      }
    }

    // Комбо-след
    if (this.combo >= 10 && d.speed > 5) {
      this.fx.trail(new THREE.Vector3(d.x, d.y + 0.35, d.z + 0.5), this.combo, dt);
    }

    // Rebase для точности float
    if (d.z < -500) {
      const dz = 500;
      d.z += dz;
      this.track.rebase(dz);
      this.world.rebase(dz);
      this.fx.rebase(dz);
      this.rig.rebase(dz);
      this.judge.position.z += dz;
      if (this.frisbee) this.frisbee.position.z += dz;
      // distance не трогаем — зона считается по ней
    }

    // Модель
    const pose = this._dogPose();
    this.dogModel.update(dt, pose);
    this.dogModel.root.position.set(d.x, d.y, d.z);
    this.dogLight.position.set(d.x, d.y + 1.6, d.z + 0.4);
    this.dogModel.root.rotation.y = 0;

    // Системы
    this.world.update(dt, d.z, this.distance);
    this.track.update(dt, d.z);
    this.fx.update(dt);
    this.fx.updateMotes(d.z);
    this.rig.update(dtRaw, { x: d.x, y: d.y, z: d.z, gallopPhase: d.gallopPhase }, d.speed, lean, { crouch: !!this.tunnelIn || d.slideT > 0.15, fly: this.flyT > 0, elevated: d.y > 0.9 && !d.airborne && !this.onApparatus });

    // HUD
    this.runStats.cleanStreakDist = Math.max(this.runStats.cleanStreakDist, this.distance - this.runStats._streakStart);
    this.ui.updateHUD({
      score: Math.floor(this.score),
      cookies: this.runStats.cookies,
      combo: this.combo,
      comboFresh: this._comboProgress(),
      powerups: this.powerups,
      powerupMax: this.powerupMax,
      danger: this.judgeT > 0,
      boost: this.boostT > 0 || this.flyT > 0 || this.tableBoostT > 0,
      metaMult: this.metaMult || 1,
      tokens: this.meta.data.tokens || 0,
    });
  }

  // Вехи дистанции и вход в зону — для drop-off воронки и «доля доживших до ночи»
  _trackProgress() {
    if (!this._msSeen) return;
    const dm = Math.floor(this.distance);
    for (const m of [100, 250, 500, 1000, 2000, 3500, 5000]) {
      if (dm >= m && !this._msSeen.has(m)) {
        this._msSeen.add(m);
        track('distance_milestone', { run_id: this._runId, milestone: m, zone: this.world.currentZone });
      }
    }
    const z = this.world.currentZone;
    if (z && this._zoneSeen && !this._zoneSeen.has(z)) {
      this._zoneSeen.add(z);
      track('zone_enter', { run_id: this._runId, zone: z, distance_m: dm });
    }
  }

  _comboProgress() {
    const next = this.milestones.find(m => m > this.combo);
    if (!next) return 1;
    const prev = this.milestones.filter(m => m <= this.combo).pop() || 0;
    return (this.combo - prev) / (next - prev);
  }

  _dogPose() {
    const d = this.dog;
    let mode = 'run';
    if (this.flyT > 0) mode = 'fly';
    else if (d.launchedT > 0) mode = 'launched';
    else if (this.tableT > 0) mode = 'sit';
    else if (d.airborne) mode = 'jump';
    else if (d.slideT > 0 || (this.tunnelIn)) mode = 'slide';
    else if (this.weave) mode = 'weave';
    else if (this.onApparatus && (this.onApparatus.kind === 'dogwalk' || this.onApparatus.kind === 'seesaw')) mode = 'balance';
    const jumpDur = 2 * JUMP_V / GRAVITY;
    return {
      mode,
      phase: d.gallopPhase,
      speed: d.speed,
      jumpT: d.airborne ? Math.min(1, d.jumpElapsed / jumpDur) : 0,
      vy: d.vy,
      lean: THREE.MathUtils.clamp((LANE_X[d.lane] - d.x) * 0.4, -0.5, 0.5),
      weaveLean: this.weave ? -Math.sin((this.weave.entry - d.z) / this.weave.spacing * Math.PI) * 0.42 : 0,
      landT: d.landT,
      balance: this.apparatusState ? (this.apparatusState.balance || 0) : 0,
      spin: d.launchSpin,
      shakeT: d.shakeT,
      deadT: d.deadT,
    };
  }

  _processInput(dt) {
    const d = this.dog;
    while (this.inputQueue.length) {
      const a = this.inputQueue.shift();
      if (d.launchedT > 0 || this.tableT > 0) continue; // управление потеряно
      if (this.weave) {
        // Слалом = ритм-тапы: любое касание/стрелка в открытом окне засчитывается
        // (точный свайп в такт на мобиле невозможен — сложность в тайминге, не в направлении)
        this._weaveTap(a);
        continue;
      }
      if (this.onApparatus) {
        const k = this.onApparatus.kind;
        if (k === 'dogwalk' && (a === 'left' || a === 'right')) {
          this.apparatusState.balance += a === 'left' ? -0.34 : 0.34;
          this.audio.laneSwitch();
        } else if (a === 'down') {
          this._apparatusDown();
        }
        continue;
      }
      if (a === 'tap') { this._jump(); continue; }
      if (a === 'left' && d.lane > 0) {
        if (this._podiumBlocked(d.lane - 1)) { this.audio.stumble(); this.rig.shake(0.03); }
        else { d.lane--; this.audio.laneSwitch(); this.dogModel.tailImpulse(2); }
      }
      else if (a === 'right' && d.lane < 2) {
        if (this._podiumBlocked(d.lane + 1)) { this.audio.stumble(); this.rig.shake(0.03); }
        else { d.lane++; this.audio.laneSwitch(); this.dogModel.tailImpulse(-2); }
      }
      else if (a === 'up') this._jump();
      else if (a === 'down') {
        this.inputRecentSlide = 0.2;
        if (d.airborne) { d.vy = FAST_FALL; } // фаст-фолл
        else { d.slideT = 0.62; this.audio.slide(); this.fx.dust(new THREE.Vector3(d.x, 0.1, d.z), 2); }
      }
    }
  }

  // Нельзя перестроиться в бок эстакады с земли (если собака ниже деки)
  _podiumBlocked(lane) {
    const d = this.dog;
    const h = this._podiumHeightRaw(LANE_X[lane], d.z - 0.5);
    return h > 0.8 && d.y < h - 0.55;
  }

  _podiumHeightRaw(x, z) {
    let h = 0;
    for (const e of this.track.entities) {
      if (e.kind !== 'podium') continue;
      if (Math.abs(x - LANE_X[e.lane]) > e.width / 2 + 0.15) continue;
      const hh = e.heightAt(z);
      if (hh > h) h = hh;
    }
    return h;
  }

  _jump() {
    const d = this.dog;
    if (this.flyT > 0) return;
    if (d.airborne) {
      // Coyote time: только что сошёл с кромки — прыжок честно засчитываем
      if (d.coyoteT > 0 && d.vy <= 0.5) { d.coyoteT = 0; }
      else { d.jumpBufferT = 0.14; return; } // буфер: сработает при приземлении
    }
    d.airborne = true;
    d.vy = JUMP_V;
    d.jumpElapsed = 0;
    d.slideT = 0;
    this.audio.jump();
    this.fx.bigDust(new THREE.Vector3(d.x, 0.05, d.z + 0.2));
    this.dogModel.earImpulse(-1.2);
    this.dogModel.tailImpulse(2.5);
  }

  _updateVertical(dt) {
    const d = this.dog;
    if (this.flyT > 0) {
      // Полёт на фрисби
      d.y += (2.7 - d.y) * Math.min(1, 5 * dt);
      d.airborne = false;
      return;
    }
    if (this.tableT > 0) {
      this.tableT -= dt;
      if (this.tableT <= 0) {
        // Рывок со стола
        this.tableBoostT = 10;
        this.boostT = 1.2;
        d.airborne = true; d.vy = 3.5;
        this.audio.boost();
        this.popups.custom('×2 ОЧКИ!', 'combo', 50, 34);
      }
      return;
    }
    // Высота поверхности под собакой (снаряды с профилем + подиумы)
    let groundY = 0;
    if (this.onApparatus && this.onApparatus.heightAt) {
      groundY = this.onApparatus.heightAt(d.z);
    }
    groundY = Math.max(groundY, this._podiumHeight(d.x, d.z));
    if (d.airborne) {
      d.jumpElapsed += dt;
      d.vy -= GRAVITY * dt;
      d.y += d.vy * dt;
      if (d.y <= groundY && d.vy < 0) {
        d.y = groundY;
        d.airborne = false;
        d.vy = 0;
        d.landT = 0.18;
        this.rig.dip(0.7);
        // Буферизованный прыжок: игрок нажал чуть раньше приземления
        if (d.jumpBufferT > 0) { d.jumpBufferT = 0; this._jump(); }
        this.audio.land();
        this.fx.bigDust(new THREE.Vector3(d.x, groundY + 0.05, d.z));
        this.dogModel.earImpulse(1.5);
        this.dogModel.tailImpulse(-3);
        this.rig.shake(0.02);
      }
    } else if (d.launchedT > 0) {
      d.launchedT -= dt;
      d.vy -= GRAVITY * dt;
      d.y += d.vy * dt;
      d.launchSpin += dt * 9;
      if (d.y <= groundY && d.vy < 0) {
        d.y = groundY; d.launchedT = 0; d.launchSpin = 0;
        this.audio.land();
        this.fx.bigDust(new THREE.Vector3(d.x, 0.05, d.z));
        this.rig.shake(0.05);
      }
    } else if (groundY < d.y - 0.4) {
      // Сошёл с края подиума — честное падение + окно coyote
      d.airborne = true;
      d.vy = 0;
      d.coyoteT = 0.12;
      d.jumpElapsed = 2 * JUMP_V / GRAVITY * 0.55; // поза «снижение»
    } else {
      d.y += (groundY - d.y) * Math.min(1, 18 * dt);
    }
  }

  // Высота подиума под точкой (x, z); 0 — если подиума нет
  _podiumHeight(x, z) {
    let h = 0;
    for (const e of this.track.entities) {
      if (e.kind !== 'podium') continue;
      if (Math.abs(x - LANE_X[e.lane]) > e.width / 2 + 0.15) continue;
      const hh = e.heightAt(z);
      if (hh > h) h = hh;
      // Бонус за подъём наверх
      if (hh >= e.h && !e.mounted && this.state === 'running') {
        e.mounted = true;
        this.score += 50 * Math.max(1, this.combo);
        this.popups.custom('+ВЫСОТА', 'clean', 50, 44);
        this.audio.clean();
        this.fx.dust(new THREE.Vector3(x, hh + 0.1, z), 2);
      }
    }
    return h;
  }

  // ---------- Снаряды с профилем (горка/бум/качели) ----------

  _updateApparatus(dt) {
    const d = this.dog;
    if (!this.onApparatus) return;
    const e = this.onApparatus;
    const st = this.apparatusState;

    if (e.kind === 'aframe') {
      // Вершина: панч камеры
      if (!st.peaked && d.z < e.z) {
        st.peaked = true;
        this.rig.punch(1.2);
        this.audio.bark();
      }
      // Контактная зона на спуске подсвечивается (glow в obstacle.update по occupied)
      if (d.z <= e.exit + 0.1) {
        // Сход
        e.occupied = false; e.resolved = true;
        if (st.contactHit) this._obstacleClean(e, 'perfect', 'ГОРКА');
        else if (st.contactEarly) this._obstacleClean(e, 'clean', 'ГОРКА');
        else this._fault(e, 'МИМО ЗОНЫ');
        this.onApparatus = null; this.apparatusState = null;
      }
    } else if (e.kind === 'dogwalk') {
      // Баланс: детерминированный снос
      st.driftT -= dt;
      if (st.driftT <= 0) { st.driftT = 0.5; st.drift = this.rng.float(-1, 1) * 1.1; }
      st.balance += st.drift * dt;
      st.balance *= 1 - 0.4 * dt;
      st.maxBal = Math.max(st.maxBal, Math.abs(st.balance));
      if (Math.abs(st.balance) > 1) {
        // Падение с бума
        e.occupied = false; e.resolved = true;
        this.onApparatus = null; this.apparatusState = null;
        d.y = 0; d.airborne = true; d.vy = 0.5;
        this._fault(e, 'УПАЛ С БУМА');
        this._stumble(false);
        return;
      }
      if (d.z <= e.exit + 0.1) {
        e.occupied = false; e.resolved = true;
        if (st.maxBal < 0.45) this._obstacleClean(e, 'perfect', 'БУМ');
        else this._obstacleClean(e, 'clean', 'БУМ');
        this.onApparatus = null; this.apparatusState = null;
      }
    } else if (e.kind === 'seesaw') {
      // Окно «прижаться» когда качель коснулась земли
      if (!st.bangWindow && e.tilt > e.maxTilt * 0.82) {
        st.bangWindow = 0.5;
        this.audio.seesawBang();
        this.fx.bigDust(new THREE.Vector3(d.x, 0.1, e.exit));
        this.rig.shake(0.03);
      }
      if (st.bangWindow > 0) st.bangWindow -= dt;
      if (d.z <= e.exit + 0.05) {
        e.occupied = false; e.resolved = true;
        this.onApparatus = null;
        if (st.pressed) this._obstacleClean(e, 'perfect', 'КАЧЕЛИ');
        else if (st.bangWindow != null && e.tilt > e.maxTilt * 0.6) this._obstacleClean(e, 'clean', 'КАЧЕЛИ');
        else {
          // Спрыгнул раньше времени — подброс
          this._fault(e, 'РАНО!');
          d.launchedT = 0.7; d.vy = 5; d.airborne = false;
        }
        this.apparatusState = null;
      }
    }
  }

  _apparatusDown() {
    const e = this.onApparatus, st = this.apparatusState, d = this.dog;
    if (!e) return;
    if (e.kind === 'aframe') {
      const inZone = d.z <= e.contactStart && d.z >= e.contactEnd - 0.2;
      const onDescent = d.z < e.z;
      if (inZone && !st.contactHit) {
        st.contactHit = true;
        e.glow();
        this.audio.clean();
        this.fx.sparks(new THREE.Vector3(d.x, d.y + 0.2, d.z), 0xf2c531);
      } else if (onDescent) st.contactEarly = true;
    } else if (e.kind === 'seesaw') {
      if (st.bangWindow > 0 && !st.pressed) {
        st.pressed = true;
        this.audio.clean();
        this.fx.sparks(new THREE.Vector3(d.x, 0.3, d.z), 0xf2c531);
      }
    }
  }

  // ---------- Слалом ----------

  _updateWeave(dt) {
    if (!this.weave) return;
    const w = this.weave, d = this.dog;
    const lastZ = w.poleZ(w.count - 1);
    // Индекс ближайшей стойки
    const idx = Math.floor((w.entry - d.z) / w.spacing + 0.5);
    if (idx !== w._lastIdx && idx >= 0 && idx < w.count) {
      w._lastIdx = idx;
      w.bend(idx, idx % 2 ? -1 : 1);
      // Окно тапа для этой стойки
      w._tapWindow = 0.55;
      w._tapIdx = idx;
      w._tapped = false;
    }
    if (w._tapWindow > 0) {
      w._tapWindow -= dt;
      if (w._tapWindow <= 0 && !w._tapped) {
        // Пропущен ритм — стойка качается красным
        this.popups.custom('мимо ритма', 'miss', 50, 46);
      }
    }
    if (d.z < lastZ - 0.6) {
      // Финиш слалома
      const res = w.hits >= w.count ? 'perfect' : w.hits >= w.count - 2 ? 'clean' : 'fault';
      w.resolved = true;
      this.weave = null;
      if (res === 'perfect') { this._obstacleClean(w, 'perfect', 'СЛАЛОМ'); this.runStats.perfectWeaves++; }
      else if (res === 'clean') this._obstacleClean(w, 'clean', 'СЛАЛОМ');
      else this._fault(w, 'СЛАЛОМ СОРВАН');
    }
  }

  _weaveTap(dir) {
    const w = this.weave;
    if (!w || w._tapped || !(w._tapWindow > 0)) return;
    // Любой ввод в открытом окне засчитывается как тап в ритм
    w._tapped = true;
    w.hits++;
    this.audio.weaveDing(w.hits);
    const px = w.group.position.x + (w._tapIdx % 2 ? -0.2 : 0.2);
    this.fx.sparks(new THREE.Vector3(px, 0.8, w.poleZ(w._tapIdx)), 0x9adcff);
    this.score += 15 * Math.max(1, this.combo) * (this.metaMult || 1);
  }

  // ---------- Коллизии и триггеры ----------

  _collisions(dt) {
    const d = this.dog;
    for (const e of this.track.entities) {
      if (e.resolved) continue;

      // Пикапы
      if (e.pickup) {
        const magnetR = this.powerups.magnet > 0 ? 5.4 : 0.62; // магнит тянет из всех полос
        const dz = d.z - e.group.position.z;
        const ddx = d.x - e.group.position.x;
        const ddy = (d.y + 0.4) - e.group.position.y;
        const dist2 = ddx * ddx + dz * dz + ddy * ddy;
        if (this.powerups.magnet > 0 && dist2 < magnetR * magnetR && e.kind === 'cookie') {
          // Пылесос: чем ближе, тем быстрее всасывает
          const dist = Math.sqrt(dist2);
          const k = 6 + 22 * (1 - dist / magnetR);
          e.group.position.x += ddx * k * dt;
          e.group.position.z += dz * k * dt;
          e.group.position.y += ddy * k * dt;
        }
        const r = this.flyT > 0 ? 1.4 : 0.62;
        if (dist2 < r * r) {
          e.resolved = true;
          e.group.visible = false;
          if (e.kind === 'cookie') this._collectCookie(e);
          else if (e.kind === 'token') this._collectToken(e);
          else if (e.kind === 'letter') this._collectLetter(e);
          else this._collectPowerup(e);
        }
        continue;
      }

      if (this.flyT > 0) continue; // на фрисби пролетаем над всем

      // Хазарды
      if (e.hazard) {
        const ex = e.group.position.x, ez = e.group.position.z;
        const dz = Math.abs(d.z - ez);
        const ddx = Math.abs(d.x - ex);
        if (dz < (e.halfD + 0.3) && ddx < (e.halfW + 0.28)) {
          if (e.kind === 'cone') {
            if (!e.hit) {
              e.hit = true;
              e.vel = new THREE.Vector3((d.x < ex ? 1 : -1) * 3, 4, -2);
              this.audio.stumble();
              this.fx.mud(new THREE.Vector3(ex, 0.3, ez));
              this.speedMod = 0.75; this.speedModT = 0.8;
              this.rig.shake(0.03);
            }
          } else if (e.kind === 'puddle') {
            if (!e.splashed && d.y < 0.2) {
              e.splashed = true;
              this.audio.noise({ dur: 0.3, vol: 0.25, freq: 900 });
              this.fx.splash(new THREE.Vector3(d.x, 0.15, d.z));
              this.speedMod = 0.8; this.speedModT = 0.7;
            }
          } else if (e.kind === 'sprinkler') {
            if (e.jetOn() && d.y < 1 && d.stumbleInvulnT <= 0) {
              this.fx.splash(new THREE.Vector3(d.x, 0.6, d.z));
              this._stumble(true, 'ОБЛИЛО!');
              e.resolved = true;
            }
          } else if (e.lethal) {
            const over = d.y > e.height - 0.25;
            const pad = this.breed === 'poodle' ? 0.16 : 0.28;
            // Near-miss: разминулся впритык (в 0.3-0.7 м от края) — свист и бонус
            if (!e._nearMissed && !over && d.stumbleInvulnT <= 0 && ddx >= e.halfW + pad && ddx < e.halfW + pad + 0.55) {
              e._nearMissed = true;
              this.score += 30 * Math.max(1, this.combo) * (this.metaMult || 1);
              this.popups.custom('ЧУТЬ-ЧУТЬ! +30', 'clean', d.x < ex ? 38 : 62, 46);
              this.audio.noise({ dur: 0.18, vol: 0.12, freq: 2600, q: 3 });
              this.rig.shake(0.015);
            }
            if (!over && d.stumbleInvulnT <= 0 && ddx < e.halfW + pad) {
              const edge = ddx > e.halfW - 0.12;
              if (this.powerups.shield > 0) {
                this.powerups.shield = 0;
                e.resolved = true;
                this.hitstopT = 0.08;
                this.fx.poof(new THREE.Vector3(ex, 0.8, ez));
                this.fx.confetti(new THREE.Vector3(d.x, 1, d.z));
                this.fx.shockwave(new THREE.Vector3(d.x, 0.2, d.z));
                // Ударная волна сдувает помехи в 14 м впереди — передышка-шоу
                for (const h of this.track.entities) {
                  if (!h.hazard || h.resolved) continue;
                  const rel = d.z - h.z;
                  if (rel > 0 && rel < 14) {
                    h.resolved = true;
                    h.group.visible = false;
                    this.fx.poof(new THREE.Vector3(h.group.position.x, 0.8, h.group.position.z));
                  }
                }
                this.audio.boost();
                this.audio.bark();
                this.popups.custom('ЩИТ!', 'clean', 50, 40);
                d.stumbleInvulnT = 1.2;
              } else if (edge) {
                // Боковой клип: спотыкание + отброс в прежнюю полосу
                this._stumble(true);
                d.lane = d.x < ex ? Math.max(0, e.lane - 1) : Math.min(2, e.lane + 1);
              } else {
                this._death(e);
                return;
              }
            }
          }
        }
        continue;
      }

      // Транспарант рекорда: пересечение = праздник
      if (e.kind === 'recordflag') {
        if (d.z <= e.z && !e.resolved) {
          e.resolved = true;
          this.recordBeaten = true;
          this.popups.custom('РЕКОРД ПОБИТ!', 'perfect', 50, 32);
          this.audio.applause();
          this.audio.comboMilestone(20);
          this.fx.confetti(new THREE.Vector3(d.x, 1.6, d.z - 4));
          this.rig.rollPulse();
          this.ui.setRecordMode(true);
        }
        continue;
      }

      // Снаряды
      switch (e.kind) {
        case 'hurdle': this._checkHurdle(e); break;
        case 'tire': this._checkTire(e); break;
        case 'tunnel': this._checkTunnel(e, dt); break;
        case 'weave': this._checkWeaveEntry(e); break;
        case 'aframe': case 'dogwalk': case 'seesaw': this._checkContactEntry(e); break;
        case 'table': this._checkTable(e); break;
      }
    }
  }

  _laneMatch(e) { return Math.abs(this.dog.x - LANE_X[e.lane]) < 1.0; }

  _checkHurdle(e) {
    const d = this.dog;
    if (d.z > e.z + 0.15 || d.z < e.z - 1.5) return;
    if (!this._laneMatch(e)) { if (d.z < e.z - 1) e.resolved = true; return; }
    e.resolved = true;
    this.runStats; // (снаряд считается в _obstacleClean)
    if (d.y >= e.barHeight - 0.06) {
      const perfect = Math.abs(d.vy) < 1.7; // прыжок «в яблочко» — планка под апексом
      this._obstacleClean(e, perfect ? 'perfect' : 'clean', 'БАРЬЕР');
      if (perfect) this.runStats.cleanHurdles++;
      else this.runStats.cleanHurdles++;
      this.fx.sparks(new THREE.Vector3(d.x, e.barHeight + 0.1, e.z), perfect ? 0xffe08a : 0xbfe3ff);
    } else if (d.y > 0.22) {
      // Сбил планку
      e.knock();
      this.hitstopT = 0.07;
      this.audio.barKnock();
      this.audio.crowdExcite(0.09); // трибуны ахнули
      this._fault(e, 'ПЛАНКА!');
      this.rig.shake(0.03);
    } else {
      // Врезался в барьер
      this._stumble(true);
      e.knock();
      this.audio.barKnock();
    }
  }

  _checkTire(e) {
    const d = this.dog;
    if (d.z > e.z + 0.15 || d.z < e.z - 1.5) return;
    if (!this._laneMatch(e)) { if (d.z < e.z - 1) e.resolved = true; return; }
    e.resolved = true;
    const cy = d.y + 0.35; // центр корпуса
    if (cy > e.centerY - 0.42 && cy < e.centerY + 0.45) {
      const perfect = Math.abs(cy - e.centerY) < 0.2;
      e.flash();
      this._obstacleClean(e, perfect ? 'perfect' : 'clean', 'КОЛЬЦО');
      this.fx.sparks(new THREE.Vector3(e.group.position.x, e.centerY, e.z), 0xffb347);
    } else if (cy >= 0.5) {
      this._stumble(true, 'МИМО КОЛЬЦА');
    } else {
      // Пробежал под кольцом — не снаряд, просто пропуск
      this._stumble(true, 'МИМО КОЛЬЦА');
    }
  }

  _checkTunnel(e, dt) {
    const d = this.dog;
    if (!e.started) {
      if (d.z <= e.entry && d.z > e.entry - 1 && this._laneMatch(e)) {
        e.started = true;
        e.occupied = true;
        this.tunnelIn = e;
        if (d.slideT > 0 && !d.airborne) {
          e.goodEntry = true;
          e.slideAtEntry = d.slideT;
        } else {
          // Grace-окно: 0.15 с на поздний подкат, потом фолт
          e.graceT = 0.15;
        }
        d.slideT = Math.max(d.slideT, 0.4);
        d.airborne = false; d.y = 0; d.vy = 0;
      } else if (d.z < e.entry - 1) {
        e.resolved = true; // прошёл мимо
      }
      return;
    }
    if (e.occupied) {
      // Внутри: держим подкат, ткань дышит
      if (e.graceT != null && e.goodEntry == null) {
        e.graceT -= dt;
        if (this.inputRecentSlide > 0) {
          e.goodEntry = true;
          e.slideAtEntry = 0.3;
        } else if (e.graceT <= 0) {
          e.goodEntry = false;
          this._stumble(false, 'НЫРЯЙ В ТОННЕЛЬ!');
        }
      }
      d.slideT = Math.max(d.slideT, 0.15);
      if (d.z <= e.exit) {
        e.occupied = false;
        e.resolved = true;
        this.tunnelIn = null;
        this.runStats.tunnels++;
        this.fx.poof(new THREE.Vector3(d.x, 0.4, d.z));
        if (e.goodEntry) {
          const perfect = e.slideAtEntry > 0.45; // нырнул в последний момент чётко
          this._obstacleClean(e, perfect ? 'perfect' : 'clean', 'ТОННЕЛЬ');
          this.boostT = 1.4;
          this.audio.boost();
        }
      }
    }
  }

  _checkWeaveEntry(e) {
    const d = this.dog;
    if (e.started) return;
    if (d.z <= e.entry + 1.2 && d.z > e.entry - 0.5 && this._laneMatch(e) && !d.airborne) {
      e.started = true;
      e._lastIdx = -1;
      this.weave = e;
      d.lane = e.lane;
    } else if (d.z < e.entry - 1) {
      e.resolved = true;
    }
  }

  _checkContactEntry(e) {
    const d = this.dog;
    if (e.occupied) return;
    if (d.z <= e.entry + 0.6 && d.z > e.entry - 1 && this._laneMatch(e)) {
      e.occupied = true;
      this.onApparatus = e;
      this.apparatusState = { balance: 0, drift: 0, driftT: 0, maxBal: 0, peaked: false, contactHit: false, contactEarly: false, bangWindow: e.kind === 'seesaw' ? null : undefined, pressed: false };
      if (e.kind === 'seesaw') this.apparatusState.bangWindow = 0;
      d.lane = e.lane;
      d.airborne = false; d.vy = 0;
    } else if (d.z < e.entry - 1.2) {
      e.resolved = true;
    }
  }

  _checkTable(e) {
    const d = this.dog;
    if (d.z > e.z + 1.0 || d.z < e.z - 1.2) return;
    if (!this._laneMatch(e)) { if (d.z < e.z - 1) e.resolved = true; return; }
    e.resolved = true;
    e.glow();
    this.tableT = 0.55;
    this.slowmoT = 0.55;
    this.dog.y = e.h; this.dog.airborne = false; this.dog.vy = 0;
    this.audio.tableChant();
    this.runStats.tables++;
    this.fx.confetti(new THREE.Vector3(d.x, 1, e.z));
    this._obstacleClean(e, 'perfect', 'СТОЛ', SCORE_TABLE);
  }

  // ---------- Награды и наказания ----------

  _obstacleClean(e, grade, name, baseScore = SCORE_CLEAN) {
    const d = this.dog;
    this._recordObstacle(e && e.kind, grade);
    this.combo++;
    this.runStats.maxCombo = Math.max(this.runStats.maxCombo, this.combo);
    this.runStats.cleanObstacles++;
    const mult = Math.max(1, this.combo) * (this.powerups.multi > 0 ? 2 : 1) * (this.tableBoostT > 0 ? 2 : 1) * (this.metaMult || 1);
    let pts = baseScore * mult;
    if (grade === 'perfect') {
      pts *= SCORE_PERFECT_MULT;
      this.runStats.perfects++;
      this.slowmoT = Math.max(this.slowmoT, 0.16);
      this.rig.punch(1);
      this.audio.perfect();
      this.popups.perfect();
      this.fx.perfectBurst(new THREE.Vector3(d.x, d.y + 0.6, d.z));
      this.fx.shockwave(new THREE.Vector3(d.x, Math.max(0.15, d.y * 0.5), d.z));
      this.ui.flash('rgba(255,240,180,0.25)');
    } else {
      this.audio.clean();
      this.popups.clean(name);
    }
    this.score += pts;
    this.popups.custom('+' + Math.floor(pts).toLocaleString('ru'), 'scorepop', 50, grade === 'perfect' ? 42 : 45);
    this.ui.scorePunch();
    this.dogModel.tailImpulse(3);
    // Вехи комбо
    if (this.milestones.includes(this.combo)) {
      this.rig.rollPulse();
      this.audio.comboMilestone(this.combo);
      this.popups.combo(this.combo);
      this.fx.confetti(new THREE.Vector3(d.x, 1.4, d.z - 2));
      this.audio.applause();
    }
  }

  _fault(e, reason) {
    this.combo = 0;
    this.runStats.faults++;
    this.runStats._streakStart = this.distance;
    this._recordObstacle(e && e.kind, 'fault');
    this.audio.stumble();
    this.popups.fault(reason);
    this.ui.flash('rgba(220,60,60,0.18)');
  }

  // Аналитика по снарядам: тип встречен один раз и как пройден. seen = сумма исходов.
  // Честный fail-rate типа = (fault+death)/seen; чистота = perfect/seen. Не влияет на игру.
  _recordObstacle(kind, grade) {
    if (!kind) return;
    const s = this.obstacleStats[kind]
      || (this.obstacleStats[kind] = { seen: 0, perfect: 0, clean: 0, fault: 0, death: 0 });
    s.seen++;
    if (s[grade] !== undefined) s[grade]++;
    // Обучение: прошёл нормально (clean/perfect) — считаем освоенным, больше не учим этому типу.
    if (grade === 'clean' || grade === 'perfect') this._tutLearn(kind);
    // Снаряд, к которому вели, пройден (любой исход) — гасим подсказку.
    if (this.tutorial.active && this.tutorial.curType === kind) {
      this.tutorial.curType = null;
      this.tutorial.curTarget = null;
      this.ui.hideTutHint();
    }
  }

  // Обучение «за руку»: подсказка жеста включается, когда снаряд входит в зону действия
  // (дистанция подобрана по типу — чтобы жест показывался, когда пора жать, а не слишком
  // рано). Замедление держится, пока снаряд не пройден. Обучаемый снаряд «прощающий».
  _updateTutorial() {
    const d = this.dog, t = this.tutorial;
    // Страховка снятия: снаряд пройден или остался позади (в т.ч. когда прошёл мимо в
    // другой полосе — тогда _recordObstacle не вызывается). Иначе подсказка залипает.
    if (t.curType) {
      const tg = t.curTarget;
      const gone = !tg || tg.resolved || (tg.z != null && tg.z > d.z + 1.2);
      const onIt = this.weave === tg || this.onApparatus === tg;
      if (gone && !onIt) {
        if (t.curType === 'dodge') this._tutLearn('dodge'); // помеху миновали — обходу научились
        t.curType = null; t.curTarget = null; this.ui.hideTutHint();
      } else return; // подсказка ещё актуальна
    }
    // Ритмовые/контактные снаряды показываем В МОМЕНТ нахождения на них — тогда жест
    // соответствует вводу (тап-в-ритм у слалома, баланс/вниз у бумов), а не провоцирует
    // прыжок заранее. Прыжковые/подкат — по выверенной дистанции, только в своей полосе.
    if (this.weave && this._tutWant('weave')) return this._tutShow('weave', this.weave);
    if (this.onApparatus && this._tutWant(this.onApparatus.kind)) {
      // Показываем жест «вниз» только когда окно действия ОТКРЫТО (иначе игрок жмёт «рано»):
      // качели — доска легла (bangWindow), горка — в зоне контакта. Бум — баланс сразу.
      const e = this.onApparatus, st = this.apparatusState;
      const ready = e.kind === 'dogwalk' ? true
        : e.kind === 'seesaw' ? !!(st && st.bangWindow > 0)
        : e.kind === 'aframe' ? (d.z <= e.contactStart && d.z >= e.contactEnd - 0.3)
        : true;
      if (ready) return this._tutShow(e.kind, e);
    }
    // Обучение обходу: летальная помеха в нашей полосе — показываем свайп на свободную сторону.
    if (this._tutWant('dodge')) {
      const haz = this.track.entities.find(e => e && !e.resolved && (e.kind === 'cart' || e.kind === 'fence')
        && this._laneMatch(e) && (d.z - e.z) > 2 && (d.z - e.z) < 14);
      if (haz) {
        const danger = (lane) => this.track.entities.some(e => e && !e.resolved && (e.kind === 'cart' || e.kind === 'fence')
          && e.lane === lane && (d.z - e.z) > -1 && (d.z - e.z) < 16);
        const free = [d.lane - 1, d.lane + 1].filter(l => l >= 0 && l <= 2 && !danger(l));
        if (free.length) {
          const side = free[0] < d.lane ? 'left' : 'right';
          t.curType = 'dodge'; t.curTarget = haz;
          this.ui.showTutHint('ОБХОД', side,
            this.isTouch ? (side === 'left' ? 'СВАЙП ВЛЕВО' : 'СВАЙП ВПРАВО') : (side === 'left' ? '←' : '→'), this.isTouch);
          track('tutorial_hint', { obstacle: 'dodge' });
          return;
        }
      }
    }
    let best = null, bestDist = Infinity;
    for (const e of this.track.entities) {
      if (!e || e.resolved || !TUT_GESTURE[e.kind] || !this._tutWant(e.kind)) continue;
      if (e.kind === 'weave' || e.kind === 'dogwalk' || e.kind === 'seesaw' || e.kind === 'aframe') continue; // по факту нахождения
      if (!this._laneMatch(e)) continue; // не в нашей полосе — не учим на этом
      const dist = d.z - e.z;
      const maxD = TUT_RANGE[e.kind] || 7;
      if (dist > 1.5 && dist < maxD && dist < bestDist) { bestDist = dist; best = e; }
    }
    if (best) this._tutShow(best.kind, best);
  }

  // Показывать ли подсказку типа: пока не освоен (learned) и не исчерпан лимит показов.
  _tutWant(kind) { return !this.tutorial.learned[kind] && (this.tutorial.count[kind] || 0) < TUT_MAX_SHOWS; }

  // Освоено: игрок прошёл тип нормально (clean/perfect) — помним между сессиями, больше не учим.
  _tutLearn(kind) {
    if (!kind || this.tutorial.learned[kind]) return;
    this.tutorial.learned[kind] = true;
    try { localStorage.setItem('agility_tut_learned', JSON.stringify(this.tutorial.learned)); } catch { /* ignore */ }
  }

  _tutShow(kind, target) {
    this.tutorial.curType = kind;
    this.tutorial.curTarget = target;
    this.tutorial.count[kind] = (this.tutorial.count[kind] || 0) + 1;
    const g = TUT_GESTURE[kind];
    this.ui.showTutHint(g.name, g.dir, this.isTouch ? g.touch : g.key, this.isTouch);
    track('tutorial_hint', { obstacle: kind });
  }

  _stumble(withFault, reason) {
    const d = this.dog;
    if (d.stumbleInvulnT > 0) return;
    if (this.judgeT > 0) { this._death(null, true); return; } // второй фолт при судье — дисквалификация
    // Sonic-паттерн: часть косточек рассыпается вперёд — их можно переподобрать.
    // Спавн откладываем: _stumble может вызываться из for...of по track.entities
    const scatter = Math.min(10, Math.floor(this.runStats.cookies * 0.2));
    if (scatter > 0) {
      this.runStats.cookies -= scatter;
      this._pendingSpawns = this._pendingSpawns || [];
      for (let i = 0; i < scatter; i++) {
        const lane = this.rng.int(0, 2), zoff = this.rng.float(0, 9), yoff = this.rng.float(0, 0.5);
        this._pendingSpawns.push(() => {
          const c = this.track.spawnOne('cookie', lane, d.z - 5 - zoff);
          c.group.position.y = c.y = 0.5 + yoff;
        });
      }
    }
    d.stumbleInvulnT = 1.3;
    d.stunT = 0.7;
    this.judgeT = 11;
    this.rig.shake(0.09);
    this.audio.stumble();
    this.audio.whistle();
    if (withFault) this._fault(null, reason || 'СПОТКНУЛСЯ!');
    this.fx.crash(new THREE.Vector3(d.x, 0.3, d.z));
    this.judge.visible = true;
    this.judge.position.set(d.x, 0, d.z + 6);
  }

  _death(e, disqualified = false) {
    this._lastHazardKind = e && e.kind ? e.kind : (disqualified ? 'judge' : 'stumble');
    const price = Math.pow(2, this.reviveCount); // 1, 2, 4, 8...
    if ((this.meta.data.tokens || 0) >= price && this.state === 'running') {
      // Судья готов простить — пауза с оффером
      this.state = 'revive';
      this.reviveT = 5;
      this.pendingDeath = { e, disqualified };
      this.slowmoT = 0; this.timeScale = 1; this.hitstopT = 0;
      this.audio.whistle();
      this.ui.showRevive(price, this.meta.data.tokens,
        () => this.acceptRevive(price),
        () => this.declineRevive());
      return;
    }
    this._doDeath(disqualified);
  }

  acceptRevive(price) {
    if (this.state !== 'revive') return;
    this.meta.data.tokens -= price;
    this.meta.save();
    this.reviveCount++;
    this.ui.hideRevive();
    this.state = 'running';
    const d = this.dog;
    // Судья свистит и отходит, собака встряхивается, впереди чисто
    this.judgeT = 0;
    this.judge.visible = false;
    d.stumbleInvulnT = 2.5;
    d.stunT = 0.4;
    d.shakeT = 0; // встряхивание
    for (const h of this.track.entities) {
      if (!h.hazard || h.resolved) continue;
      const rel = d.z - h.z;
      if (rel > -2 && rel < 16) {
        h.resolved = true;
        h.group.visible = false;
        this.fx.poof(new THREE.Vector3(h.group.position.x, 0.8, h.group.position.z));
      }
    }
    this.audio.whistle();
    this.audio.bark();
    this.fx.shockwave(new THREE.Vector3(d.x, 0.2, d.z));
    this.popups.custom('СУДЬЯ ПРОЩАЕТ!', 'clean', 50, 36);
  }

  declineRevive() {
    if (this.state !== 'revive') return;
    this.ui.hideRevive();
    const pd = this.pendingDeath || {};
    this._doDeath(pd.disqualified);
  }

  _doDeath(disqualified = false) {
    const d = this.dog;
    this.state = 'dead';
    d.deadT = 0;
    this.ui.hideTutHint(); // обучение прервано смертью
    this.tutorial.curType = null;
    this._recordObstacle(this._lastHazardKind, 'death'); // столкновение относим к типу снаряда/помехи
    // Аналитика: смерть (где и обо что)
    track('run_death', {
      run_id: this._runId, distance_m: Math.floor(this.distance), zone: this.world.currentZone,
      obstacle_type: this._lastHazardKind || (disqualified ? 'judge' : 'unknown'),
      score: Math.floor(this.score), combo: this.combo,
    });
    this.audio.stopMusic();
    this.audio.crash();
    this.fx.crash(new THREE.Vector3(d.x, 0.5, d.z));
    this.rig.shake(0.2);
    this.rig.startOrbit();
    this.ui.flash('rgba(255,255,255,0.6)');
    this.popups.custom(disqualified ? 'ДИСКВАЛИФИКАЦИЯ' : 'СТОЛКНОВЕНИЕ', 'fault', 50, 36);
    // Экран результатов с задержкой
    this._gameOverTimer = setTimeout(() => this._finishRun(), 1600);
  }

  _finishRun() {
    const rs = this.runStats;
    // Обучение затухает само (learned/count), между забегами прогресс сохраняется — здесь
    // просто гасим подсказку. curType сбросим на следующем старте.
    this.tutorial.curType = null;
    this.ui.hideTutHint();
    // Аналитика: конец забега
    track('run_end', {
      run_id: this._runId, reason: this.reviveCount > 0 ? 'revive_declined' : 'death',
      distance_m: Math.floor(rs.distance), score: Math.floor(rs.score),
      duration_s: this._runStartMs ? Math.round((Date.now() - this._runStartMs) / 1000) : 0,
      combo_max: rs.maxCombo, coins: rs.cookies, perfects: rs.perfects, faults: rs.faults,
      clean_obstacles: rs.cleanObstacles, obstacles: this.obstacleStats,
    });
    if (this.pendingReload) { setTimeout(() => this.pendingReload(), 1500); }
    rs.score = Math.floor(this.score);
    rs.distance = this.distance;
    const completed = this.meta.finishRun(rs);
    for (const m of completed) this.ui.missionComplete(m);
    // Онлайн-лидерборд: отправляем результат (если задано имя и счёт значимый)
    if (this.meta.data.playerName && rs.score > 0) {
      submitScore(this.meta.data.playerName, rs.score, rs.distance).then((r) => {
        if (r && r.rank) this.ui.showOnlineRank(r.rank);
        track('leaderboard_submit', { nickname_set: true, rank: r && r.rank || 0, score: Math.floor(rs.score) });
      });
    }
    this.ui.showGameOver(rs, completed, this.meta,
      () => { this.rig.reset(); this.startRun(); },
      () => this.showMenu());
  }

  _collectCookie(e) {
    this.cookieStreak++;
    this.cookieStreakT = 1.2;
    const bonus = this.breed === 'aussie' ? 1.15 : 1;
    const val = e.value || 1;
    this.runStats.cookies += Math.round(val * bonus);
    this.score += SCORE_COOKIE * val * (this.powerups.multi > 0 ? 2 : 1) * (this.metaMult || 1);
    this.audio.cookie(this.cookieStreak, val > 1);
    // Микро-squash: контакт чувствуется телом собаки
    this.dog.landT = Math.max(this.dog.landT, 0.07);
    if (val > 1) this.popups.custom('+' + val + '🦴', 'scorepop', 58, 48);
    this.fx.sparks(e.group.position.clone(), 0xffd587);
    // Косточка летит в счётчик HUD (как монеты в Subway Surfers)
    this.ui.flyCookie(this._toScreen(e.group.position));
  }

  // Мировая точка -> экранные проценты (для DOM-эффектов)
  _toScreen(pos) {
    const v = pos.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 };
  }

  _collectToken(e) {
    this.meta.data.tokens = (this.meta.data.tokens || 0) + 1;
    this.meta.save();
    this.audio.perfect();
    this.fx.confetti(e.group.position.clone());
    this.fx.shockwave(e.group.position.clone());
    this.popups.custom('ЖЕТОН СУДЬИ! 🏵', 'perfect', 50, 36);
    this.slowmoT = Math.max(this.slowmoT, 0.15);
  }

  _collectLetter(e) {
    const res = this.meta.collectLetter();
    if (!res) return;
    this.audio.weaveDing(4);
    this.fx.sparks(e.group.position.clone(), 0x9adcff);
    const d = this.meta.daily();
    const progress = d.word.split('').map((ch, i) => i < d.collected ? ch : '·').join(' ');
    if (res.done) {
      this.popups.custom(`СЛОВО ДНЯ: ${d.word}! +${res.reward}🦴`, 'perfect', 50, 34);
      this.audio.applause();
      this.fx.confetti(e.group.position.clone());
    } else {
      this.popups.custom(progress, 'clean', 50, 44);
    }
  }

  _collectPowerup(e) {
    const t = e.ptype;
    this.runStats.powerups++;
    this.audio.powerup();
    this.fx.confetti(e.group.position.clone());
    if (t === 'magnet') this.powerups.magnet = this.powerupMax.magnet;
    else if (t === 'shield') this.powerups.shield = 1;
    else if (t === 'rocket') {
      this.powerups.rocket = this.powerupMax.rocket;
      this.flyT = this.powerupMax.rocket;
      this.dog.airborne = false;
      this.audio.boost();
      this.audio.bark();
      this.popups.custom('ЛОВИ ФРИСБИ!', 'combo', 50, 34);
      this._spawnFrisbee();
    }
    else if (t === 'multi') this.powerups.multi = this.powerupMax.multi;
    const names = { magnet: 'МАГНИТ', shield: 'ЩИТ', rocket: '', multi: '×2 ОЧКИ' };
    if (names[t]) this.popups.custom(names[t], 'clean', 50, 40);
  }

  // Летящий диск: собака гонится за ним весь полёт и ловит в конце
  _spawnFrisbee() {
    this._removeFrisbee();
    const d = this.dog;
    const fr = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.07, 18),
      new THREE.MeshStandardMaterial({ color: 0xff8a2e, roughness: 0.4, emissive: 0x8a3c08 })
    );
    fr.add(disc);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.065, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff2d8, roughness: 0.5 }));
    fr.add(dot);
    fr.position.set(d.x, d.y + 1.2, d.z - 3);
    this.scene.add(fr);
    this.frisbee = fr;
  }

  _removeFrisbee() {
    if (this.frisbee) { this.scene.remove(this.frisbee); this.frisbee = null; }
  }

  _updateFrisbee(dt) {
    if (!this.frisbee) return;
    const d = this.dog;
    const fr = this.frisbee;
    fr.rotation.y += 16 * dt; // вращение диска
    fr.rotation.z = Math.sin(this.flyT * 5) * 0.08; // покачивание
    if (this.flyT > 0.7) {
      // Диск летит впереди, чуть выше — собака гонится
      const tx = d.x, ty = 2.75 + Math.sin(this.flyT * 3) * 0.25, tz = d.z - 3.8;
      fr.position.x += (tx - fr.position.x) * Math.min(1, 5 * dt);
      fr.position.y += (ty - fr.position.y) * Math.min(1, 4 * dt);
      fr.position.z = tz;
    } else if (this.flyT > 0) {
      // Финал: диск замедляется и опускается к пасти
      const k = 1 - this.flyT / 0.7;
      fr.position.x += (d.x - fr.position.x) * Math.min(1, 8 * dt);
      fr.position.y += ((d.y + 0.55) - fr.position.y) * Math.min(1, 6 * dt) * (0.5 + k);
      fr.position.z = d.z - 0.55 - (1 - k) * 2.6;
    } else {
      // ПОЙМАЛ!
      const bonus = 300 * (this.powerups.multi > 0 ? 2 : 1);
      this.score += bonus;
      this.popups.custom('ПОЙМАЛ! +' + bonus, 'perfect', 50, 38);
      this.audio.perfect();
      this.audio.bark();
      this.audio.applause();
      this.fx.confetti(new THREE.Vector3(d.x, 1.2, d.z));
      this.fx.shockwave(new THREE.Vector3(d.x, Math.max(0.15, d.y * 0.5), d.z));
      this.rig.punch(1.2);
      this.slowmoT = Math.max(this.slowmoT, 0.22);
      this.dogModel.tailImpulse(5);
      this.dogModel.earImpulse(-1.5);
      this._removeFrisbee();
    }
  }

  _updateJudge(dt) {
    const d = this.dog;
    this._judgeAnimT = (this._judgeAnimT || 0) + dt;
    if (this.judgeT > 0) {
      this.judge.visible = true;
      // Судья бежит за собакой
      const targetZ = d.z + (this.judgeT > 2 ? 3.4 : 5.5);
      this.judge.position.z += (targetZ - this.judge.position.z) * Math.min(1, 4 * dt);
      this.judge.position.x += (d.x - this.judge.position.x) * Math.min(1, 3 * dt);
      const t = this._judgeAnimT * 1.2;
      const { legs, arm } = this.judge.userData;
      legs[0].rotation.x = Math.sin(t) * 0.7;
      legs[1].rotation.x = -Math.sin(t) * 0.7;
      arm.rotation.z = -0.6 + Math.sin(t * 1.5) * 0.3;
      this.judge.position.y = Math.abs(Math.sin(t)) * 0.08;
    } else if (this.judge.visible) {
      // Отстаёт и исчезает
      this.judge.position.z += 8 * dt;
      if (this.judge.position.z > d.z + 14) this.judge.visible = false;
    }
  }
}
