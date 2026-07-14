// Косметика собак — sink для косточек (см. экономику #3). Чистая визуалка, на геймплей
// и детерминизм НЕ влияет. Два слота: coat (окрас тела) и neck (бандана/платок на шее).
// Окрас переопределяет базовый цвет породы, сохраняя силуэт; бандана — low-poly меш.

export const RARITY = {
  common:    { name: 'обычный',      color: '#9db4d4' },
  rare:      { name: 'редкий',       color: '#9adcff' },
  epic:      { name: 'эпик',         color: '#c77fe0' },
  legendary: { name: 'легендарный',  color: '#ffd75a' }, // топ-ярус: аспирационная цель
};

// Порядок ярусов для сортировки в магазине (дешёвые/частые сверху, легендарные внизу).
export const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

// Реальные окрасы аусси и бордер-колли. Параметры: body — основной цвет, accent — рыжий
// подпал (tan), white — светлые зоны, merle+patch — мраморные пятна (рендерятся в dog.js
// и rigged_dog.js). Легендарные — редчайшие реальные окрасы (мерли-разбавления, криптик).
export const COATS = {
  'black-tri':  { name: 'Чёрный триколор',   rarity: 'common', price: 400,  body: 0x24242c, accent: 0xb0703a, white: 0xf5f1e8 },
  'red-white':  { name: 'Рыже-белый',        rarity: 'common', price: 400,  body: 0xb5651d, accent: 0xd08a45, white: 0xf5f1e8 },
  chocolate:    { name: 'Шоколадный',        rarity: 'common', price: 450,  body: 0x5a3826, accent: 0x8a6040, white: 0xf2ead8 },
  'red-tri':    { name: 'Красный триколор',  rarity: 'rare',   price: 1200, body: 0x8a4b28, accent: 0xd8a45a, white: 0xf5efe2 },
  'tan-point':  { name: 'Чёрно-подпалый',    rarity: 'rare',   price: 1300, body: 0x22222a, accent: 0xc07a3a, white: 0xd8d0c2 },
  'blue-merle': { name: 'Блю-мерль',         rarity: 'rare',   price: 1100, body: 0x8590a0, accent: 0xb0703a, white: 0xf2efe6, merle: true, patch: 0x353b47 },
  'red-merle':  { name: 'Ред-мерль',         rarity: 'rare',   price: 1100, body: 0xd9b48a, accent: 0xb0703a, white: 0xf5efe2, merle: true, patch: 0xa35f36 },
  sable:        { name: 'Соболиный',         rarity: 'rare',   price: 1000, body: 0xc0925a, accent: 0x8a5a2e, merle: true, patch: 0x6b4a2a },
  lilac:        { name: 'Лиловый',           rarity: 'epic',   price: 2200, body: 0xa89a9c, accent: 0x8a7a7c, white: 0xefe8ea },
  slate:        { name: 'Сланцевый',         rarity: 'epic',   price: 2400, body: 0x6d7885, accent: 0x9aa6b4, white: 0xeef1f5, merle: true, patch: 0x4a5158 },
  'choc-merle': { name: 'Шоколадный мерль',  rarity: 'epic',   price: 2500, body: 0x7a4e30, accent: 0xb08050, white: 0xf0e6d4, merle: true, patch: 0x452a1a },
  'ee-red':     { name: 'Ирландский красный', rarity: 'epic',  price: 2700, body: 0xb35a24, accent: 0xd88a4a, white: 0xf5efe2 },
  'lilac-merle':    { name: 'Лиловый мерль',    rarity: 'legendary', price: 4500, body: 0xb0a2a4, accent: 0x8a7a7c, white: 0xefe8ea, merle: true, patch: 0x746668 },
  'ghost-merle':    { name: 'Призрачный мерль', rarity: 'legendary', price: 5500, body: 0x2a2a32, accent: 0xb0703a, white: 0xf2efe6, merle: true, patch: 0x3c3c46 },
  'slate-champion': { name: 'Сланцевый чемпион', rarity: 'legendary', price: 6000, body: 0x5a6673, accent: 0xc98f4e, white: 0xeef1f5, merle: true, patch: 0x37414c },
};

// Банданы/платки на шею: color — цвет ткани, tip — цвет каймы (опц.).
export const NECKS = {
  red:      { name: 'Красный платок', rarity: 'common', price: 200,  color: 0xd94040 },
  blue:     { name: 'Синий платок',   rarity: 'common', price: 200,  color: 0x4a7fd9 },
  green:    { name: 'Зелёный платок',  rarity: 'common', price: 250,  color: 0x5fbf5f },
  sun:      { name: 'Солнечный',       rarity: 'rare',   price: 600,  color: 0xf0b429, tip: 0xffe08a },
  royal:    { name: 'Королевский',     rarity: 'rare',   price: 800,  color: 0x7a3fd9, tip: 0xe0c060 },
  checker:  { name: 'Клетчатый',       rarity: 'rare',   price: 700,  color: 0x3a6ea5, tip: 0xf0f0f0 },
  rainbow:  { name: 'Радужный',        rarity: 'epic',   price: 1800, color: 0xff5e7a, tip: 0x9adcff },
  flame:    { name: 'Огненный',        rarity: 'epic',   price: 1400, color: 0xff6a1a, tip: 0xffd23d },
  galaxy:   { name: 'Галактика',       rarity: 'legendary', price: 2600, color: 0x5a3fb0, tip: 0x9adcff },
  champion: { name: 'Чемпионский',     rarity: 'legendary', price: 3200, color: 0xf0b429, tip: 0xffffff },
};

// Полный каталог для магазина: [{slot, id, name, rarity, price}]
export function catalog() {
  const items = [];
  for (const [id, c] of Object.entries(COATS)) items.push({ slot: 'coat', id, ...c });
  for (const [id, c] of Object.entries(NECKS)) items.push({ slot: 'neck', id, ...c });
  return items;
}

export function itemOf(slot, id) {
  if (!id) return null;
  return (slot === 'coat' ? COATS : slot === 'neck' ? NECKS : {})[id] || null;
}

export function priceOf(slot, id) { const it = itemOf(slot, id); return it ? it.price : 0; }
