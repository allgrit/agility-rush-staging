// Метапрогрессия: валюта, собаки, миссии, розетки-титулы, косметика. Персист в localStorage.

import { priceOf, itemOf, NECKS } from './cosmetics.js';
import { ACHIEVEMENTS, ACH_REWARDS, progressOf, statOf } from './achievements.js';

// Награды недельного стрика заходов (день 1..7); день 7 — сундук (косточки + шанс косметики)
export const WEEK_REWARDS = [50, 80, 120, 180, 250, 350, 500];

const KEY = 'agility-rush-save-v1';

export const DOG_SHOP = [
  { key: 'border', name: 'Бордер-колли', cost: 0, perk: 'Классика аджилити' },
  { key: 'aussie', name: 'Аусси', cost: 800, perk: '+15% печенек' },
  { key: 'poodle', name: 'Той-пудель', cost: 2000, perk: 'Меньше хитбокс' },
];

// Расходники «на забег» (тратятся). Цена ~1 медианный забег (аналитика: медиана 120🦴/забег),
// пачка ×5 со скидкой ~15%. secs — длительность эффекта. Активация по ходу (иконка на HUD).
export const CONSUMABLES = {
  tug: { name: 'Пуллер', emoji: '🟣', price: 150, pack5: 640, secs: 22,
    desc: 'Кольцо-игрушка тянет вперёд: защита от краша + буст + магнит на косточки' },
};

// 20 разнообразных титулов — путь от новичка до бессмертной легенды аджилити. После
// последнего звания рост продолжается звёздами (см. title()), чтобы топам было куда расти.
// Счёт v2 (F4): титул отражает МАСТЕРСТВО — привязан к bestScore (лучший забег), а не к
// накопленному стажу. Пороги под новую шкалу: хороший забег ≈ 30–80к, топ-марафон 300к+.
export const TITLES = [
  { name: 'Щенок-новичок',        gen: 'Щенка-новичка',        need: 0,      color: '#c9a06a' },
  { name: 'Юниор',                gen: 'Юниора',               need: 1500,   color: '#b8d8a8' },
  { name: 'Открытый класс',       gen: 'Открытого класса',     need: 4000,   color: '#9adcff' },
  { name: 'Дебютант ринга',       gen: 'Дебютанта ринга',      need: 8000,   color: '#8fd0e8' },
  { name: 'Ловкая лапа',          gen: 'Ловкой лапы',          need: 14000,  color: '#7fe056' },
  { name: 'Мастер трассы',        gen: 'Мастера трассы',       need: 22000,  color: '#66d67a' },
  { name: 'Гроза барьеров',       gen: 'Грозы барьеров',       need: 32000,  color: '#7fb0e0' },
  { name: 'Король слалома',       gen: 'Короля слалома',       need: 45000,  color: '#a77fe0' },
  { name: 'Ас тоннелей',          gen: 'Аса тоннелей',         need: 60000,  color: '#c77fe0' },
  { name: 'Виртуоз аджилити',     gen: 'Виртуоза аджилити',    need: 80000,  color: '#e07fd0' },
  { name: 'Чемпион двора',        gen: 'Чемпиона двора',       need: 105000, color: '#ffb347' },
  { name: 'Чемпион города',       gen: 'Чемпиона города',      need: 135000, color: '#ffa733' },
  { name: 'Чемпион области',      gen: 'Чемпиона области',     need: 170000, color: '#ff9422' },
  { name: 'Чемпион страны',       gen: 'Чемпиона страны',      need: 215000, color: '#ff7e3a' },
  { name: 'Международный мастер', gen: 'Международного мастера', need: 270000, color: '#ff6b5e' },
  { name: 'Гранд-чемпион',        gen: 'Гранд-чемпиона',       need: 340000, color: '#ff5e7a' },
  { name: 'Легенда ринга',        gen: 'Легенды ринга',        need: 430000, color: '#ff5ea8' },
  { name: 'Живая легенда',        gen: 'Живой легенды',        need: 550000, color: '#f05ed0' },
  { name: 'Легенда легенд',       gen: 'Легенды легенд',       need: 700000, color: '#d75eff' },
  { name: 'Бессмертный чемпион',  gen: 'Бессмертного чемпиона', need: 900000, color: '#ffd75a' },
];

// Русская плюрализация: plural(4, ['снаряд', 'снаряда', 'снарядов'])
export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Типы миссий для БЕСКОНЕЧНОЙ генерации: из каждого типа делаем миссии, наращивая цель и
// награду по кругам (tier). Игрок никогда не остаётся без миссий — крючок удержания.
const MISSION_TYPES = [
  { key: 'cleanHurdles',    base: 8,    step: 4,   text: (t) => `${t} барьеров чисто за забег`,      rw: (t) => 100 + t * 8 },
  { key: 'perfectWeaves',   base: 2,    step: 2,   text: (t) => `${t} слалома идеально за забег`,    rw: (t) => 140 + t * 25 },
  { key: 'cookies',         base: 120,  step: 60,  text: (t) => `${t} печенек за забег`,             rw: (t) => 100 + Math.floor(t / 2) },
  { key: 'maxCombo',        base: 10,   step: 4,   text: (t) => `Комбо ×${t}`,                       rw: (t) => 120 + t * 8 },
  { key: 'distance',        base: 1200, step: 600, text: (t) => `Пробеги ${t} м`,                    rw: (t) => 120 + Math.floor(t / 10) },
  { key: 'perfects',        base: 6,    step: 3,   text: (t) => `${t} идеальных снарядов за забег`,  rw: (t) => 150 + t * 12 },
  { key: 'tunnels',         base: 3,    step: 2,   text: (t) => `${t} тоннеля за забег`,             rw: (t) => 100 + t * 10 },
  { key: 'tables',          base: 2,    step: 1,   text: (t) => `${t} стола за забег`,               rw: (t) => 140 + t * 20 },
  { key: 'cleanStreakDist', base: 700,  step: 300, text: (t) => `${t} м без фолтов`,                 rw: (t) => 160 + Math.floor(t / 10) },
  { key: 'powerups',        base: 3,    step: 2,   text: (t) => `${t} пауэрапа за забег`,            rw: (t) => 120 + t * 10 },
];

// Миссия по порядковому номеру: типы циклятся, цель растёт с каждым полным кругом.
function genMission(seq) {
  const ty = MISSION_TYPES[((seq % MISSION_TYPES.length) + MISSION_TYPES.length) % MISSION_TYPES.length];
  const tier = Math.floor(seq / MISSION_TYPES.length);
  const target = ty.base + ty.step * tier;
  return { id: `${ty.key}_${target}`, stat: ty.key, target, text: ty.text(target), reward: ty.rw(target), done: false };
}

export class Meta {
  constructor() {
    this.data = this._load();
    this.recovered = this._recoverLiveRun(); // {cookies, score, distance} или null
  }

  // Если прошлый забег не был корректно завершён (краш/обновление вкладки) —
  // докатываем его результат в прогресс, чтобы игрок ничего не потерял.
  _recoverLiveRun() {
    const lr = this.data.liveRun;
    this.data.liveRun = null;
    if (!lr || (lr.cookies | 0) === 0 && (lr.score | 0) === 0) { this.save(); return null; }
    this.data.cookies += (lr.cookies | 0);
    this.data.totalScore += (lr.score | 0);
    this.data.bestScore = Math.max(this.data.bestScore, lr.score | 0);
    this.data.bestDistance = Math.max(this.data.bestDistance, Math.floor(lr.distance || 0));
    this.save();
    return { cookies: lr.cookies | 0, score: lr.score | 0, distance: Math.floor(lr.distance || 0) };
  }

  // Периодический автосейв текущего забега (вызывается ~раз в 3 с из game.js)
  saveLiveRun(stats) {
    this.data.liveRun = {
      cookies: Math.round(stats.cookies || 0),
      score: Math.floor(stats.score || 0),
      distance: Math.floor(stats.distance || 0),
    };
    this.save();
  }

  clearLiveRun() {
    if (this.data.liveRun) { this.data.liveRun = null; this.save(); }
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return this._migrate(JSON.parse(raw));
    } catch (e) { /* приватный режим и т.п. */ }
    return {
      cookies: 0,
      totalScore: 0,
      bestScore: 0,
      bestDistance: 0,
      runs: 0,
      unlocked: ['border'],
      selectedDog: 'border',
      missions: [genMission(0), genMission(1), genMission(2)],
      missionSeq: 3, // сколько миссий уже выдано (для бесконечной генерации следующих)
      missionsCompleted: 0,
      missionBest: {},
      completedIds: [],
      dailyMissions: null, // { date, targets:[...], done:[bool,bool] }
      scoreMult: 1,
      tokens: 0,
      lastGiftTs: 0,
      daily: null,
      liveRun: null,
      playerName: '',
      recordSubmitted: false,
      cosmeticsOwned: {}, // { 'coat:gold': 1, 'neck:red': 1 } — купленная косметика
      cosmeticsEquip: {}, // { coat: 'gold', neck: 'red' } — надетое сейчас
      achCounters: {},    // накопительные счётчики ачивок (perf_hurdle, totalDist, …)
      achClaimed: {},     // { achId: сколько ярусов забрано (0..3) }
      week: { streak: 0, lastDay: null, claimedDay: null, freezeWeek: null }, // недельный стрик заходов
      scoreV: 2,          // версия шкалы счёта (сезон 2)
      seenSeason2: false, // разовый диалог о старте Сезона 2
      seenS2Warn: false,  // разовое предупреждение «завтра сброс» (до старта)
      consumables: { tug: 0 }, // расходники «на забег» (тратятся): тягач-игрушка
      tugUsed: false, // хоть раз активировал пуллер (гасит подсказку «тап сюда»)
    };
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  // Миграция старых сохранений на бесконечные миссии (раньше был конечный пул из 10).
  _migrate(d) {
    // Устойчивость к частичным/битым сейвам: базовые поля добираем дефолтами,
    // иначе повреждённый localStorage кладёт игру на старте (crash в showMenu).
    d.cookies = d.cookies || 0;
    d.totalScore = d.totalScore || 0;
    d.bestScore = d.bestScore || 0;
    d.bestDistance = d.bestDistance || 0;
    d.runs = d.runs || 0;
    d.tokens = d.tokens || 0;
    d.missionsCompleted = d.missionsCompleted || 0;
    d.lastGiftTs = d.lastGiftTs || 0;
    if (!Array.isArray(d.unlocked) || !d.unlocked.length) d.unlocked = ['border'];
    if (!d.selectedDog || !d.unlocked.includes(d.selectedDog)) d.selectedDog = d.unlocked[0];
    if (d.playerName == null) d.playerName = '';
    if (d.scoreMult == null) d.scoreMult = 1;
    if (d.missionSeq == null || (d.missions && d.missions[0] && d.missions[0].stat === undefined)) {
      const seq = d.missionsCompleted || 0;
      d.missions = [genMission(seq), genMission(seq + 1), genMission(seq + 2)];
      d.missionSeq = seq + 3;
    }
    if (d.dailyMissions === undefined) d.dailyMissions = null;
    if (!d.cosmeticsOwned) d.cosmeticsOwned = {};
    if (!d.cosmeticsEquip) d.cosmeticsEquip = {};
    // ---- Миграция на счёт v2 (Сезон 2): множители капнуты, рекорды пересчитываются ----
    // Старый scoreMult (целый, до ×30) был главным инфлятором — делим личные рекорды на него,
    // чтобы титул/рекорд остались сопоставимы с новой шкалой. Компенсация: +50🦴 за уровень.
    if (!d.scoreV || d.scoreV < 2) {
      try { localStorage.setItem(KEY + '-backup', JSON.stringify(d)); } catch { /* ignore */ }
      const k = Math.max(1, Math.min(30, Math.round(d.scoreMult || 1)));
      if (k > 1) {
        d.bestScore = Math.floor((d.bestScore || 0) / k);
        d.totalScore = Math.floor((d.totalScore || 0) / k);
        d.cookies = (d.cookies || 0) + (k - 1) * 50;
        d.s2comp = (k - 1) * 50; // показать компенсацию в диалоге сезона
      }
      if (d.liveRun && d.liveRun.score) d.liveRun.score = Math.floor(d.liveRun.score / k);
      d.scoreMult = Math.min(2, +(1 + Math.floor((d.missionsCompleted || 0) / 3) * 0.05).toFixed(2));
      d.scoreV = 2;
    }
    if (d.seenSeason2 === undefined) d.seenSeason2 = false;
    if (d.seenS2Warn === undefined) d.seenS2Warn = false;
    // Ретеншн-пакет: счётчики ачивок, клеймы, недельный стрик
    if (!d.achCounters) d.achCounters = {};
    if (!d.achClaimed) d.achClaimed = {};
    if (!d.week) d.week = { streak: 0, lastDay: null, claimedDay: null, freezeWeek: null };
    if (!d.consumables || typeof d.consumables !== 'object') d.consumables = { tug: 0 };
    if (d.consumables.tug == null) d.consumables.tug = 0;
    if (d.tugUsed == null) d.tugUsed = false;
    return d;
  }

  // ---------- Косметика (sink для косточек) ----------
  ownsCosmetic(slot, id) { return !!this.data.cosmeticsOwned[`${slot}:${id}`]; }

  buyCosmetic(slot, id) {
    if (!itemOf(slot, id) || this.ownsCosmetic(slot, id)) return false;
    const price = priceOf(slot, id);
    if (price <= 0) return false; // эксклюзивы не продаются — только за ачивку
    if ((this.data.cookies || 0) < price) return false;
    this.data.cookies -= price;
    this.data.achCounters.spent = (this.data.achCounters.spent || 0) + price; // ачивка «Щедрая лапа»
    this.data.cosmeticsOwned[`${slot}:${id}`] = 1;
    this.data.cosmeticsEquip[slot] = id; // купил — сразу надел
    this.save();
    return true;
  }

  // Надеть/снять: повторный тап по надетому — снимает слот.
  toggleCosmetic(slot, id) {
    if (id && !this.ownsCosmetic(slot, id)) return;
    this.data.cosmeticsEquip[slot] = (this.data.cosmeticsEquip[slot] === id) ? null : id;
    this.save();
  }

  cosmeticEquip() { return { ...this.data.cosmeticsEquip }; }

  // ---------- Расходники (тратятся за забег) ----------
  consumableCount(key) { return (this.data.consumables && this.data.consumables[key]) || 0; }

  // Покупка пачкой: qty=1 — по цене price, qty=5 — по цене pack5 (со скидкой).
  buyConsumable(key, qty = 1) {
    const c = CONSUMABLES[key];
    if (!c) return false;
    const cost = qty === 5 ? c.pack5 : c.price * qty;
    if ((this.data.cookies || 0) < cost) return false;
    this.data.cookies -= cost;
    if (!this.data.consumables) this.data.consumables = {};
    this.data.consumables[key] = (this.data.consumables[key] || 0) + qty;
    this.data.achCounters.spent = (this.data.achCounters.spent || 0) + cost;
    this.save();
    return true;
  }

  // Списать 1 при активации в забеге; false если нет в наличии.
  useConsumable(key) {
    if (this.consumableCount(key) <= 0) return false;
    this.data.consumables[key]--;
    this.save();
    return true;
  }

  title() {
    // F4: титул — от лучшего забега (мастерство), а не от накопленного totalScore («стажа»)
    const ts = this.data.bestScore;
    const last = TITLES[TITLES.length - 1];
    // После последнего фиксированного титула — бесконечные уровни «Легенды», чтобы
    // топ-игрокам всегда было куда расти (порог растёт с уровнем — дальше дороже).
    if (ts >= last.need) {
      const STEP0 = 150000, GROW = 50000; // звезда N стоит STEP0 + (N-1)*GROW сверху
      let lvl = 0, floor = last.need, cost = STEP0;
      while (ts >= floor + cost) { floor += cost; lvl++; cost += GROW; }
      const deco = (n) => n <= 0 ? '' : ' ' + '★'.repeat(Math.min(5, n)) + (n > 5 ? '×' + n : '');
      const current = { name: last.name + deco(lvl), gen: last.gen + deco(lvl), need: floor, color: last.color, legend: lvl };
      const next = { name: last.name + deco(lvl + 1), gen: last.gen + deco(lvl + 1), need: floor + cost, color: last.color };
      return { current, next, progress: (ts - floor) / cost, legend: lvl };
    }
    let t = TITLES[0], next = null;
    for (const ti of TITLES) {
      if (ts >= ti.need) t = ti;
      else { next = ti; break; }
    }
    return { current: t, next, progress: next ? (ts - t.need) / (next.need - t.need) : 1 };
  }

  activeMissions() {
    // Миссия хранит свой def (бесконечная генерация), find по пулу больше не нужен.
    return this.data.missions.map(m => ({
      ...m,
      best: (this.data.missionBest || {})[m.id] || 0,
    }));
  }

  // Дневные миссии (2 шт) — детерминированы датой (как слово дня): у всех игроков одинаковы,
  // сбрасываются ежедневно, награда ×2. Связка со «словом дня» в едином дневном блоке.
  dailyMissionDefs() {
    const days = Math.floor(Date.now() / 86400000);
    const n = MISSION_TYPES.length;
    const mk = (off) => {
      const ty = MISSION_TYPES[(((days * 3 + off * 7) % n) + n) % n];
      const tier = (days + off) % 4; // сложность циклится, но у всех одинаковая в этот день
      const target = ty.base + ty.step * tier;
      // Множитель дневных ×1.4 — премия за ежедневность, но не джекпот (был ×2 ≈ цена собаки/день).
      return { id: `d${days}_${off}`, stat: ty.key, target, text: ty.text(target), reward: Math.round(ty.rw(target) * 1.4) };
    };
    return [mk(0), mk(1)];
  }

  activeDailyMissions() {
    const today = this._todayKey();
    if (!this.data.dailyMissions || this.data.dailyMissions.date !== today) {
      this.data.dailyMissions = { date: today, done: [false, false] };
      this.save();
    }
    return this.dailyMissionDefs().map((d, i) => ({ ...d, done: this.data.dailyMissions.done[i] }));
  }

  checkDailyMissions(runStats) {
    const today = this._todayKey();
    if (!this.data.dailyMissions || this.data.dailyMissions.date !== today) {
      this.data.dailyMissions = { date: today, done: [false, false] };
    }
    const completed = [];
    this.dailyMissionDefs().forEach((d, i) => {
      if (!this.data.dailyMissions.done[i] && (runStats[d.stat] || 0) >= d.target) {
        this.data.dailyMissions.done[i] = true;
        this.data.cookies += d.reward;
        completed.push(d);
      }
    });
    return completed;
  }

  // Проверка миссий по статистике забега; возвращает список выполненных сейчас
  checkMissions(runStats) {
    const completed = [];
    for (const m of this.data.missions) {
      if (m.done) continue;
      if ((runStats[m.stat] || 0) >= m.target) {
        m.done = true;
        this.data.cookies += m.reward;
        this.data.missionsCompleted++;
        // Каждые 3 выполненные миссии — перманентный множитель очков (крючок SS).
        // Счёт v2: аддитивный +5% за уровень, кап ×2 — прогресс чувствуется,
        // но не раздувает очки в 30 раз (аудит #6, F3).
        this.data.scoreMult = Math.min(2, +(1 + Math.floor(this.data.missionsCompleted / 3) * 0.05).toFixed(2));
        // Каждые 2 миссии — золотой жетон судьи (revive-валюта)
        if (this.data.missionsCompleted % 2 === 0) this.data.tokens = (this.data.tokens || 0) + 1;
        completed.push(m);
      }
    }
    // Ничего не выполнено — не пересобираем массив и не пишем в localStorage (лишний JSON.stringify).
    if (!completed.length) return completed;
    // Выполненную заменяем СЛЕДУЮЩЕЙ по бесконечной генерации — миссии никогда не кончаются.
    if (this.data.missionSeq == null) this.data.missionSeq = this.data.missions.length;
    this.data.missions = this.data.missions.map(m => m.done ? genMission(this.data.missionSeq++) : m);
    this.save();
    return completed;
  }

  finishRun(runStats, obstacleStats) {
    this.data.runs++;
    if (!this.data.missionBest) this.data.missionBest = {};
    for (const m of this.data.missions) {
      this.data.missionBest[m.id] = Math.max(this.data.missionBest[m.id] || 0, Math.floor(runStats[m.stat] || 0));
    }
    const dailyDone = this.checkDailyMissions(runStats).map(m => ({ ...m, daily: true }));
    this.data.cookies += runStats.cookies;
    this.data.totalScore += runStats.score;
    this.data.bestScore = Math.max(this.data.bestScore, runStats.score);
    this.data.bestDistance = Math.max(this.data.bestDistance, Math.floor(runStats.distance));
    this._accrueAchievements(runStats, obstacleStats);
    const completed = this.checkMissions(runStats);
    this.data.liveRun = null; // забег закрыт штатно — снимаем страховку
    this.save();
    return [...completed, ...dailyDone];
  }

  // ---------- Ачивки: накопление и клеймы ----------
  _accrueAchievements(rs, obstacleStats) {
    const c = this.data.achCounters;
    const add = (k, v) => { if (v) c[k] = (c[k] || 0) + v; };
    const best = (k, v) => { if (v > (c[k] || 0)) c[k] = v; };
    for (const [kind, s] of Object.entries(obstacleStats || {})) add('perf_' + kind, s.perfect | 0);
    add('totalDist', Math.floor(rs.distance || 0));
    add('nearMiss', rs.nearMiss | 0);
    add('flights', rs.flights | 0);
    add('judgeEscapes', rs.judgeEscapes | 0);
    add('revives', rs.revives | 0);
    add('nightRuns', rs.nightReached | 0);
    best('bestRunDist', Math.floor(rs.distance || 0));
    best('bestCombo', rs.maxCombo | 0);
    best('bestCleanDist', Math.floor(rs.cleanStreakDist || 0));
    // Дни игры: считаем уникальные дни по последнему сыгранному
    const today = this._todayKey();
    if (c.lastPlayDay !== today) { c.lastPlayDay = today; add('daysPlayed', 1); }
  }

  // Список ачивок с прогрессом и невыбранными наградами (для UI)
  achievements() {
    return ACHIEVEMENTS.map(def => {
      const p = progressOf(this, def);
      const claimed = this.data.achClaimed[def.id] || 0;
      return { def, ...p, claimed, claimable: p.tier > claimed };
    });
  }

  achClaimableCount() {
    return this.achievements().filter(a => a.claimable).length;
  }

  // Забрать все достигнутые, но не выданные ярусы одной ачивки; вернёт сумму косточек
  claimAchievement(id) {
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return 0;
    const p = progressOf(this, def);
    const claimed = this.data.achClaimed[id] || 0;
    let total = 0;
    for (let t = claimed; t < p.tier; t++) total += ACH_REWARDS[t];
    if (!total) return 0;
    this.data.achClaimed[id] = p.tier;
    this.data.cookies += total;
    // Эксклюзив за золото (вне магазина): выдаём предмет, если определён
    if (p.tier === 3 && def.excl && !this.ownsCosmetic('neck', def.excl)) {
      this.data.cosmeticsOwned['neck:' + def.excl] = 1;
    }
    this.save();
    return total;
  }

  // ---------- Недельный стрик заходов ----------
  _weekKey() { // ISO-неделя не нужна: округляем к понедельнику локально
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // пн=0
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    return mon.getFullYear() + '-' + (mon.getMonth() + 1) + '-' + mon.getDate();
  }

  // Состояние стрика на сегодня: продлеваем/замораживаем/сбрасываем по факту захода
  weekState() {
    const w = this.data.week;
    const today = this._todayKey();
    if (w.lastDay !== today) {
      const yesterday = new Date(Date.now() - 86400000);
      const yKey = yesterday.getFullYear() + '-' + (yesterday.getMonth() + 1) + '-' + yesterday.getDate();
      if (w.lastDay === yKey) {
        w.streak = (w.streak || 0) + 1; // пришёл на следующий день — серия растёт
        w.frozen = false; // серия продолжена честно — значок заморозки снимаем
      } else if (w.lastDay) {
        // Пропуск. Одна «заморозка» в неделю спасает серию (не бесим игрока).
        const wk = this._weekKey();
        if (w.freezeWeek !== wk && w.streak > 0) { w.freezeWeek = wk; w.streak = (w.streak || 0) + 1; w.frozen = true; }
        else { w.streak = 1; w.frozen = false; }
      } else {
        w.streak = 1; // первый заход вообще
      }
      w.lastDay = today;
      // Лучший стрик — в счётчик ачивки «Огонёк»
      const c = this.data.achCounters;
      if ((w.streak || 0) > (c.bestStreak || 0)) c.bestStreak = w.streak;
      this.save();
    }
    const dayIdx = Math.min(7, ((w.streak - 1) % 7) + 1); // 1..7 внутри недельного цикла
    return {
      streak: w.streak, dayIdx,
      reward: WEEK_REWARDS[dayIdx - 1],
      claimed: w.claimedDay === today,
      freezeLeft: w.freezeWeek !== this._weekKey(),
      frozen: !!w.frozen,
    };
  }

  // Забрать награду дня; день 7 — сундук: косточки + шанс некупленной банданы
  claimWeek() {
    const st = this.weekState();
    if (st.claimed) return null;
    this.data.week.claimedDay = this._todayKey();
    let amount = st.reward, bonusItem = null;
    if (st.dayIdx === 7) {
      // Сундук: 30% — случайная некупленная common/rare бандана, иначе +200 косточек
      const candidates = Object.entries(NECKS)
        .filter(([id, n]) => (n.rarity === 'common' || n.rarity === 'rare') && !this.ownsCosmetic('neck', id) && n.price > 0);
      if (candidates.length && Math.random() < 0.3) {
        const [id] = candidates[Math.floor(Math.random() * candidates.length)];
        this.data.cosmeticsOwned['neck:' + id] = 1;
        bonusItem = { slot: 'neck', id };
      } else {
        amount += 200;
      }
    }
    this.data.cookies += amount;
    this.save();
    return { amount, bonusItem, dayIdx: st.dayIdx };
  }

  // ---------- Слово дня из костей-букв ----------
  static WORDS = ['АДЖИЛИТИ', 'АПОРТ', 'БАРЬЕР', 'СЛАЛОМ', 'ЧЕМПИОН', 'ХВОСТИК', 'ЛАПА', 'КОМАНДА',
    'ПОВОДОК', 'ВЫСТАВКА', 'МЕДАЛЬ', 'ТОННЕЛЬ', 'КАЧЕЛИ', 'ПЬЕДЕСТАЛ', 'ПОБЕДА', 'РЕКОРД',
    'ТРЕНЕР', 'СВИСТОК', 'ГАЗОН', 'СТАДИОН'];

  _todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  daily() {
    const today = this._todayKey();
    if (!this.data.daily || this.data.daily.date !== today) {
      // Слово выбирается детерминированно от даты
      const days = Math.floor(Date.now() / 86400000);
      const word = Meta.WORDS[days % Meta.WORDS.length];
      const prevStreak = this.data.daily ? this.data.daily.streak : 0;
      const prevDone = this.data.daily && this.data.daily.completeDate;
      // Стрик живёт, если вчера слово было собрано
      const yesterday = new Date(Date.now() - 86400000);
      const yKey = yesterday.getFullYear() + '-' + (yesterday.getMonth() + 1) + '-' + yesterday.getDate();
      const streak = (prevDone === yKey) ? prevStreak : 0;
      this.data.daily = { date: today, word, collected: 0, streak, completeDate: null };
      this.save();
    }
    return this.data.daily;
  }

  // Собрана буква; возвращает { letter, done, reward } или null
  collectLetter() {
    const d = this.daily();
    if (d.collected >= d.word.length) return null;
    const letter = d.word[d.collected];
    d.collected++;
    let done = false, reward = 0;
    if (d.collected >= d.word.length) {
      done = true;
      d.streak = (d.streak || 0) + 1;
      d.completeDate = d.date;
      reward = 100 * Math.min(5, d.streak);
      this.data.cookies += reward;
      this.data.achCounters.words = (this.data.achCounters.words || 0) + 1; // ачивка «Словарный запас»
    }
    this.save();
    return { letter, done, reward, streak: d.streak };
  }

  nextLetter() {
    const d = this.daily();
    return d.collected < d.word.length ? d.word[d.collected] : null;
  }

  // ---------- Боты-соперники (локальный «лидерборд») ----------
  rivals() {
    const base = Math.max(1500, this.data.bestScore);
    const defs = [
      { name: 'Тузик', k: 0.45 }, { name: 'Альма', k: 0.7 }, { name: 'Рекс', k: 0.9 },
      { name: 'Джесси', k: 1.15 }, { name: 'Бим', k: 1.45 }, { name: 'Лайма', k: 1.9 },
    ];
    return defs.map(d => ({ name: d.name, score: Math.round(base * d.k / 10) * 10 }));
  }

  // ---------- Подарок по таймеру («миска корма») ----------
  giftReady() {
    return Date.now() - (this.data.lastGiftTs || 0) > 3 * 3600 * 1000;
  }

  giftCountdown() {
    const left = 3 * 3600 * 1000 - (Date.now() - (this.data.lastGiftTs || 0));
    if (left <= 0) return null;
    const h = Math.floor(left / 3600000), mn = Math.floor((left % 3600000) / 60000);
    return h > 0 ? `${h} ч ${mn} мин` : `${mn} мин`;
  }

  claimGift() {
    if (!this.giftReady()) return 0;
    const r = Math.random();
    let amount;
    if (r < 0.01) amount = 1000;
    else if (r < 0.06) amount = 500;
    else if (r < 0.3) amount = 100 + Math.floor(Math.random() * 100);
    else amount = 20 + Math.floor(Math.random() * 60);
    this.data.cookies += amount;
    this.data.lastGiftTs = Date.now();
    this.save();
    return amount;
  }

  buyDog(key) {
    const dog = DOG_SHOP.find(d => d.key === key);
    if (!dog || this.data.unlocked.includes(key) || this.data.cookies < dog.cost) return false;
    this.data.cookies -= dog.cost;
    this.data.achCounters.spent = (this.data.achCounters.spent || 0) + dog.cost;
    this.data.unlocked.push(key);
    this.data.selectedDog = key;
    this.save();
    return true;
  }

  setPlayerName(name) {
    this.data.playerName = String(name || '').slice(0, 24).trim();
    this.save();
  }

  selectDog(key) {
    if (this.data.unlocked.includes(key)) {
      this.data.selectedDog = key;
      this.save();
      return true;
    }
    return false;
  }
}
