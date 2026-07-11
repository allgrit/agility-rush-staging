// Метапрогрессия: валюта, собаки, миссии, розетки-титулы. Персист в localStorage.

const KEY = 'agility-rush-save-v1';

export const DOG_SHOP = [
  { key: 'border', name: 'Бордер-колли', cost: 0, perk: 'Классика аджилити' },
  { key: 'aussie', name: 'Аусси', cost: 800, perk: '+15% печенек' },
  { key: 'poodle', name: 'Той-пудель', cost: 2000, perk: 'Меньше хитбокс' },
];

export const TITLES = [
  { name: 'Новичок', gen: 'Новичка', need: 0, color: '#c9a06a' },
  { name: 'Юниор', gen: 'Юниора', need: 3000, color: '#9adcff' },
  { name: 'Открытый класс', gen: 'Открытого класса', need: 12000, color: '#7fe056' },
  { name: 'Мастер', gen: 'Мастера', need: 35000, color: '#c77fe0' },
  { name: 'Чемпион', gen: 'Чемпиона', need: 90000, color: '#ffb347' },
  { name: 'Гранд-чемпион', gen: 'Гранд-чемпиона', need: 200000, color: '#ff5e7a' },
];

// Русская плюрализация: plural(4, ['снаряд', 'снаряда', 'снарядов'])
export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const MISSION_POOL = [
  { id: 'hurdles10', text: '10 барьеров чисто за забег', stat: 'cleanHurdles', target: 10, reward: 150 },
  { id: 'weave3', text: '3 полных слалома за забег', stat: 'perfectWeaves', target: 3, reward: 200 },
  { id: 'cookies200', text: '150 печенек за забег', stat: 'cookies', target: 150, reward: 150 },
  { id: 'combo12', text: 'Комбо ×12', stat: 'maxCombo', target: 12, reward: 200 },
  { id: 'dist1500', text: 'Пробеги 1500 м', stat: 'distance', target: 1500, reward: 150 },
  { id: 'perfect8', text: '8 идеальных снарядов за забег', stat: 'perfects', target: 8, reward: 250 },
  { id: 'tunnel4', text: '4 тоннеля за забег', stat: 'tunnels', target: 4, reward: 120 },
  { id: 'table2', text: '2 стола за забег', stat: 'tables', target: 2, reward: 180 },
  { id: 'noFault800', text: '800 м без фолтов', stat: 'cleanStreakDist', target: 800, reward: 220 },
  { id: 'powerups3', text: '3 пауэрапа за забег', stat: 'powerups', target: 3, reward: 130 },
];

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
      if (raw) return JSON.parse(raw);
    } catch (e) { /* приватный режим и т.п. */ }
    return {
      cookies: 0,
      totalScore: 0,
      bestScore: 0,
      bestDistance: 0,
      runs: 0,
      unlocked: ['border'],
      selectedDog: 'border',
      missions: MISSION_POOL.slice(0, 3).map(m => ({ id: m.id, done: false })),
      missionsCompleted: 0,
      missionBest: {},
      completedIds: [],
      scoreMult: 1,
      tokens: 0,
      lastGiftTs: 0,
      daily: null,
      liveRun: null,
      playerName: '',
      recordSubmitted: false,
    };
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  title() {
    let t = TITLES[0], next = null;
    for (const ti of TITLES) {
      if (this.data.totalScore >= ti.need) t = ti;
      else { next = ti; break; }
    }
    return { current: t, next, progress: next ? (this.data.totalScore - t.need) / (next.need - t.need) : 1 };
  }

  activeMissions() {
    return this.data.missions.map(m => ({
      ...MISSION_POOL.find(p => p.id === m.id),
      done: m.done,
      best: (this.data.missionBest || {})[m.id] || 0,
    }));
  }

  // Проверка миссий по статистике забега; возвращает список выполненных сейчас
  checkMissions(runStats) {
    const completed = [];
    for (const m of this.data.missions) {
      if (m.done) continue;
      const def = MISSION_POOL.find(p => p.id === m.id);
      if ((runStats[def.stat] || 0) >= def.target) {
        m.done = true;
        this.data.cookies += def.reward;
        this.data.missionsCompleted++;
        // Каждые 3 выполненные миссии — перманентный множитель очков (крючок SS)
        this.data.scoreMult = Math.min(30, 1 + Math.floor(this.data.missionsCompleted / 3));
        // Каждые 2 миссии — золотой жетон судьи (revive-валюта)
        if (this.data.missionsCompleted % 2 === 0) this.data.tokens = (this.data.tokens || 0) + 1;
        completed.push(def);
      }
    }
    // Заменяем выполненные новыми; выполненные — в чёрный список навсегда
    const doneIds = this.data.missions.filter(m => m.done).map(m => m.id);
    if (doneIds.length) {
      if (!this.data.completedIds) this.data.completedIds = [];
      this.data.completedIds.push(...doneIds.filter(id => !this.data.completedIds.includes(id)));
      const usedIds = [...this.data.missions.map(m => m.id), ...this.data.completedIds];
      const fresh = MISSION_POOL.filter(p => !usedIds.includes(p.id));
      this.data.missions = this.data.missions.map(m => {
        if (!m.done) return m;
        const nf = fresh.shift();
        return nf ? { id: nf.id, done: false } : m;
      });
    }
    this.save();
    return completed;
  }

  finishRun(runStats) {
    this.data.runs++;
    if (!this.data.missionBest) this.data.missionBest = {};
    for (const m of this.data.missions) {
      const def = MISSION_POOL.find(p => p.id === m.id);
      if (def) this.data.missionBest[m.id] = Math.max(this.data.missionBest[m.id] || 0, Math.floor(runStats[def.stat] || 0));
    }
    this.data.cookies += runStats.cookies;
    this.data.totalScore += runStats.score;
    this.data.bestScore = Math.max(this.data.bestScore, runStats.score);
    this.data.bestDistance = Math.max(this.data.bestDistance, Math.floor(runStats.distance));
    const completed = this.checkMissions(runStats);
    this.data.liveRun = null; // забег закрыт штатно — снимаем страховку
    this.save();
    return completed;
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
