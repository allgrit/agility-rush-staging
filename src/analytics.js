// Аналитика игроков: анонимный сбор событий на наш сервер (server-side, cookieless).
// visitor_id — случайный GUID в localStorage (не ПД), app_version в каждом батче —
// чтобы видеть распределение игроков по версиям и работу автообновления.
// Не влияет на детерминизм: буфер флашится по времени/выходу, не в игровом цикле.

import { APP_VERSION } from './version.js';

const ENDPOINT = 'https://tribe.tsdpu.org/lb/events';
const GAME = 'agility-rush';

// Отключение аналитики (тесты/харнесс). Проверяется динамически: URL-флаг теряется
// при bootstrap-reload на ?fresh, поэтому надёжнее держать метку в localStorage.
if (new URLSearchParams(location.search).has('noanalytics')) {
  try { localStorage.setItem('__noanalytics', '1'); } catch { /* ignore */ }
}
function isDisabled() {
  try {
    if (new URLSearchParams(location.search).has('harness')) return true;
    if (localStorage.getItem('__noanalytics')) return true;
  } catch { /* ignore */ }
  return false;
}
const DISABLED = isDisabled();

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxxyxxx4xxxyxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function visitorId() {
  try {
    let v = localStorage.getItem('__vid');
    if (!v) { v = uuid(); localStorage.setItem('__vid', v); localStorage.setItem('__vfirst', new Date().toISOString().slice(0, 10)); }
    return v;
  } catch { return 'anon'; }
}

const VISITOR = visitorId();
const SESSION = uuid().slice(0, 8);
let buffer = [];
let flushTimer = null;

function send(payload, useBeacon) {
  try {
    const body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* аналитика не должна ронять игру */ }
}

function flush(useBeacon = false) {
  if (!buffer.length) return;
  const events = buffer;
  buffer = [];
  send({ game: GAME, visitor: VISITOR, ver: APP_VERSION, events }, useBeacon);
}

// Публичный API: track('run_death', { distance_m, obstacle_type })
export function track(name, params = {}) {
  if (DISABLED || isDisabled()) return;
  buffer.push({ name, ts: Date.now(), params });
  if (buffer.length >= 20) return flush();
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 5000);
}

export function sessionId() { return SESSION; }
export function firstSeen() { try { return localStorage.getItem('__vfirst'); } catch { return null; } }

// Гарантированная отправка при уходе со страницы (sendBeacon переживает закрытие)
if (!DISABLED && typeof window !== 'undefined') {
  const onLeave = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } flush(true); };
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onLeave(); });
}
