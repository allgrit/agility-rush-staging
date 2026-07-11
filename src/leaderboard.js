// Клиент онлайн-лидерборда (общий сервис на tribe.tsdpu.org).
// Подпись результата HMAC-SHA256 через WebCrypto. Все запросы устойчивы к офлайну.

const API = 'https://tribe.tsdpu.org/lb';
const GAME = 'agility-rush';
// Клиентский секрет — подпись ЦЕЛОСТНОСТИ (виден в коде, поднимает порог для случайных читеров).
const SECRET = 'a45652a4af5b603f00f3dc8d9346135cc2fb73a3da209686';

async function hmac(msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function submitScore(name, score, distance) {
  try {
    const nm = String(name || 'Аноним').slice(0, 24);
    const sc = Math.floor(score);
    const ts = Date.now();
    const sig = await hmac(`${GAME}|${nm}|${sc}|${ts}`); // подпись строго game|name|score|ts
    const res = await fetch(`${API}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: GAME, name: nm, score: sc, distance: Math.floor(distance || 0), ts, sig }),
    });
    if (!res.ok) return null;
    return await res.json(); // { ok, rank }
  } catch (e) { return null; }
}

export async function fetchTop(period = 'all', limit = 10) {
  try {
    const res = await fetch(`${API}/top?game=${GAME}&period=${period}&limit=${limit}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const d = await res.json();
    return d.top || [];
  } catch (e) { return null; }
}
