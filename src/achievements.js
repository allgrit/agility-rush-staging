// Ачивки: 24 шт × 3 яруса (бронза/серебро/золото). Накопительные за карьеру — в отличие
// от миссий («за один забег»). Счётчики копятся в meta.data.achCounters (finishRun),
// клеймы — meta.data.achClaimed { id: сколько ярусов забрано }. Прогресс детерминирован
// статами забега; сами определения — чистые данные, без Date/random.
// СОЗНАТЕЛЬНО нет порогов по абсолютным очкам: фикс инфляции множителей (#6 F3) их не сломает.

export const ACH_REWARDS = [100, 300, 1000]; // бронза / серебро / золото

// sec: секция UI; stat: ключ в achCounters (или live-геттер, см. statOf);
// tiers: пороги ярусов; hidden: показывается «???» до первого яруса; hint — подсказка скрытой.
export const ACHIEVEMENTS = [
  // --- Мастерство снарядов (perfect суммарно) ---
  { id: 'hurdle',  sec: 'obstacles', name: 'Гроза барьеров', icon: 'ach-hurdle',  stat: 'perf_hurdle',  tiers: [50, 500, 2500] },
  { id: 'tunnel',  sec: 'obstacles', name: 'Пролаза',        icon: 'ach-tunnel',  stat: 'perf_tunnel',  tiers: [50, 500, 2000] },
  { id: 'tire',    sec: 'obstacles', name: 'Снайпер кольца', icon: 'ach-tire',    stat: 'perf_tire',    tiers: [25, 250, 1000] },
  { id: 'weave',   sec: 'obstacles', name: 'Змейка',         icon: 'ach-weave',   stat: 'perf_weave',   tiers: [10, 100, 500] },
  { id: 'aframe',  sec: 'obstacles', name: 'Король горки',   icon: 'ach-aframe',  stat: 'perf_aframe',  tiers: [25, 250, 1000] },
  { id: 'dogwalk', sec: 'obstacles', name: 'Канатоходец',    icon: 'ach-dogwalk', stat: 'perf_dogwalk', tiers: [50, 500, 2000] },
  { id: 'seesaw',  sec: 'obstacles', name: 'Мастер качелей', icon: 'ach-seesaw',  stat: 'perf_seesaw',  tiers: [10, 100, 500] },
  { id: 'table',   sec: 'obstacles', name: 'Стол-стоп',      icon: 'ach-table',   stat: 'perf_table',   tiers: [25, 250, 1000] },
  // --- Выносливость и стиль ---
  { id: 'marathon', sec: 'style', name: 'Марафонец',    icon: 'ach-marathon', stat: 'totalDist',    tiers: [10000, 100000, 1000000], fmt: 'km' },
  { id: 'sprint',   sec: 'style', name: 'Спринтер',     icon: 'ach-sprint',   stat: 'bestRunDist',  tiers: [1000, 2000, 4000], fmt: 'm' },
  { id: 'combo',    sec: 'style', name: 'Комбо-машина', icon: 'ach-combo',    stat: 'bestCombo',    tiers: [15, 40, 100], fmt: 'x' },
  { id: 'nearmiss', sec: 'style', name: 'Впритык',      icon: 'ach-nearmiss', stat: 'nearMiss',     tiers: [25, 250, 1000] },
  { id: 'clean',    sec: 'style', name: 'Чистюля',      icon: 'ach-clean',    stat: 'bestCleanDist', tiers: [500, 1500, 3000], fmt: 'm' },
  { id: 'frisbee',  sec: 'style', name: 'Ас полёта',    icon: 'ach-frisbee',  stat: 'flights',      tiers: [10, 50, 200] },
  // --- Коллекция и верность ---
  { id: 'collect', sec: 'loyal', name: 'Коллекционер',    icon: 'ach-collect', stat: 'cosmetics',  tiers: [3, 8, 16], excl: 'rosette' },
  { id: 'rich',    sec: 'loyal', name: 'Магнат',          icon: 'ach-rich',    stat: 'balance',    tiers: [5000, 20000, 60000] },
  { id: 'spender', sec: 'loyal', name: 'Щедрая лапа',     icon: 'ach-dogs',    stat: 'spent',      tiers: [2000, 10000, 40000] },
  { id: 'word',    sec: 'loyal', name: 'Словарный запас', icon: 'ach-word',    stat: 'words',      tiers: [3, 15, 50] },
  { id: 'days',    sec: 'loyal', name: 'Верный пёс',      icon: 'ach-streak',  stat: 'daysPlayed', tiers: [3, 10, 30] },
  { id: 'streak',  sec: 'loyal', name: 'Огонёк',          icon: 'ach-streak',  stat: 'bestStreak', tiers: [3, 7, 14] },
  // --- Скрытые (сюрпризы: раскрываются с первым ярусом) ---
  { id: 'judge',  sec: 'hidden', name: 'Хвост трубой',  icon: 'ach-judge',  stat: 'judgeEscapes', tiers: [10, 50, 200], hidden: true, hint: 'Что-то про судью…' },
  { id: 'revive', sec: 'hidden', name: 'Девять жизней', icon: 'ach-revive', stat: 'revives',      tiers: [5, 25, 100],  hidden: true, hint: 'Второй шанс…' },
  { id: 'night',  sec: 'hidden', name: 'Ночной бегун',  icon: 'ach-night',  stat: 'nightRuns',    tiers: [5, 25, 100],  hidden: true, hint: 'Сыграй подольше…' },
  { id: 'flock',  sec: 'hidden', name: 'Вся стая',      icon: 'ach-dogs',   stat: 'dogs',         tiers: [1, 2, 3],     hidden: true, hint: 'Собери друзей…' },
];

export const ACH_SECTIONS = [
  { key: 'obstacles', name: 'Мастерство снарядов' },
  { key: 'style',     name: 'Выносливость и стиль' },
  { key: 'loyal',     name: 'Коллекция и верность' },
  { key: 'hidden',    name: 'Скрытые' },
];

// Значение стата: счётчики из achCounters + live-величины из meta.data
export function statOf(meta, stat) {
  const c = meta.data.achCounters || {};
  switch (stat) {
    case 'balance':   return meta.data.cookies || 0;
    case 'cosmetics': return Object.keys(meta.data.cosmeticsOwned || {}).length;
    case 'dogs':      return Math.max(0, (meta.data.unlocked || []).length - 1); // без стартового бордера
    case 'bestStreak': return Math.max(c.bestStreak || 0, (meta.data.week || {}).streak || 0);
    default: return c[stat] || 0;
  }
}

// Достигнутый ярус (0..3) по значению
export function tierOf(def, value) {
  let t = 0;
  for (const need of def.tiers) if (value >= need) t++;
  return t;
}

// Прогресс к СЛЕДУЮЩЕМУ ярусу: { value, tier, next, frac }
export function progressOf(meta, def) {
  const value = statOf(meta, def.stat);
  const tier = tierOf(def, value);
  const next = tier < 3 ? def.tiers[tier] : null;
  const base = tier > 0 ? def.tiers[tier - 1] : 0;
  const frac = next ? Math.min(1, (value - base) / (next - base)) : 1;
  return { value, tier, next, frac };
}

export function fmtVal(def, v) {
  if (def.fmt === 'km') return v >= 1000 ? (v / 1000 >= 100 ? Math.round(v / 1000) : (v / 1000).toFixed(1)) + ' км' : v + ' м';
  if (def.fmt === 'm') return v + ' м';
  if (def.fmt === 'x') return '×' + v;
  return String(v);
}
