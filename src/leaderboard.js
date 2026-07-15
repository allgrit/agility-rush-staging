// Клиент онлайн-лидерборда (общий сервис на tribe.tsdpu.org).
// Подпись результата HMAC-SHA256 через WebCrypto. Все запросы устойчивы к офлайну.

import { lbStatus } from './diag.js';

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

// Счёт v2 (Сезон 2): подпись включает версию шкалы — сервер валидирует и кладёт в активный сезон
const SCORE_V = 2;

export async function submitScore(name, score, distance) {
  try {
    const nm = String(name || 'Аноним').slice(0, 24);
    const sc = Math.floor(score);
    const ts = Date.now();
    const sig = await hmac(`${GAME}|${nm}|${sc}|${ts}|${SCORE_V}`); // v2: game|name|score|ts|sv
    const res = await fetch(`${API}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: GAME, name: nm, score: sc, distance: Math.floor(distance || 0), ts, sv: SCORE_V, sig }),
    });
    if (!res.ok) {
      // Раньше провал глотался (return null) — игрок не понимал, почему его нет в топе.
      // Достаём причину отказа сервера и отдаём наверх, чтобы показать игроку и в 🩺.
      let error = 'http ' + res.status;
      try { const b = await res.json(); if (b && b.error) error = b.error; } catch { /* нет тела */ }
      lbStatus.lastSubmit = { ok: false, status: res.status, error, at: ts };
      return { ok: false, status: res.status, error };
    }
    const body = await res.json(); // { ok, rank, season }
    lbStatus.lastSubmit = { ok: true, status: res.status, rank: body && body.rank, at: ts };
    return body;
  } catch (e) { const error = String(e).slice(0, 100); lbStatus.lastSubmit = { ok: false, error, at: Date.now() }; return { ok: false, error }; }
}

// season: null — активный сезон сервера; 1 — Зал славы. meta=true вернёт весь ответ
// (activeSeason/season2Start — для баннера «завтра старт Сезона 2»).
export async function fetchTop(period = 'all', limit = 10, season = null, meta = false) {
  try {
    const s = season ? `&season=${season}` : '';
    const res = await fetch(`${API}/top?game=${GAME}&period=${period}&limit=${limit}${s}`, { cache: 'no-store' });
    lbStatus.lastTop = { ok: res.ok, status: res.status, at: Date.now() };
    if (!res.ok) return null;
    const d = await res.json();
    return meta ? d : (d.top || []);
  } catch (e) { lbStatus.lastTop = { ok: false, err: String(e).slice(0, 100), at: Date.now() }; return null; }
}
