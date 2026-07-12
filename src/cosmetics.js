// Косметика собак — sink для косточек (см. экономику #3). Чистая визуалка, на геймплей
// и детерминизм НЕ влияет. Два слота: coat (окрас тела) и neck (бандана/платок на шее).
// Окрас переопределяет базовый цвет породы, сохраняя силуэт; бандана — low-poly меш.

export const RARITY = {
  common: { name: 'обычный', color: '#9db4d4' },
  rare:   { name: 'редкий',  color: '#9adcff' },
  epic:   { name: 'эпик',    color: '#c77fe0' },
};

// Реальные окрасы аусси и бордер-колли. Параметры: body — основной цвет, accent — рыжий
// подпал (tan), white — светлые зоны, merle+patch — мраморные пятна (рендерятся в dog.js).
export const COATS = {
  'black-tri':  { name: 'Чёрный триколор',  rarity: 'common', price: 400,  body: 0x24242c, accent: 0xb0703a, white: 0xf5f1e8 },
  'red-white':  { name: 'Рыже-белый',       rarity: 'common', price: 400,  body: 0xb5651d, accent: 0xd08a45, white: 0xf5f1e8 },
  chocolate:    { name: 'Шоколадный',       rarity: 'common', price: 450,  body: 0x5a3826, accent: 0x8a6040, white: 0xf2ead8 },
  'blue-merle': { name: 'Блю-мерль',        rarity: 'rare',   price: 1100, body: 0x8590a0, accent: 0xb0703a, white: 0xf2efe6, merle: true, patch: 0x353b47 },
  'red-merle':  { name: 'Ред-мерль',        rarity: 'rare',   price: 1100, body: 0xd9b48a, accent: 0xb0703a, white: 0xf5efe2, merle: true, patch: 0xa35f36 },
  sable:        { name: 'Соболиный',        rarity: 'rare',   price: 1000, body: 0xc0925a, accent: 0x8a5a2e, merle: true, patch: 0x6b4a2a },
  lilac:        { name: 'Лиловый',          rarity: 'epic',   price: 2200, body: 0xa89a9c, accent: 0x8a7a7c, white: 0xefe8ea },
  slate:        { name: 'Сланцевый',        rarity: 'epic',   price: 2400, body: 0x6d7885, accent: 0x9aa6b4, white: 0xeef1f5, merle: true, patch: 0x4a5158 },
};

// Банданы/платки на шею: color — цвет ткани, tip — цвет каймы (опц.).
export const NECKS = {
  red:    { name: 'Красный платок', rarity: 'common', price: 200, color: 0xd94040 },
  blue:   { name: 'Синий платок',   rarity: 'common', price: 200, color: 0x4a7fd9 },
  green:  { name: 'Зелёный платок',  rarity: 'common', price: 250, color: 0x5fbf5f },
  sun:    { name: 'Солнечный',       rarity: 'rare',   price: 600, color: 0xf0b429, tip: 0xffe08a },
  royal:  { name: 'Королевский',     rarity: 'rare',   price: 800, color: 0x7a3fd9, tip: 0xe0c060 },
  rainbow:{ name: 'Радужный',        rarity: 'epic',   price: 1800, color: 0xff5e7a, tip: 0x9adcff },
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
