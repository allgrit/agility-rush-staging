// Диагностика проблем лидерборда/рендера — игрок жмёт кнопку, мы получаем на сервер
// исчерпывающий срез, чтобы не переспрашивать. Собирает: окружение, WebCrypto, сетевые
// тесты (доступность /top, реальность подписи), состояние клиента, историю WebGL-сбоев.

import { track, sessionId } from './analytics.js';
import { APP_VERSION } from './version.js';

const API = 'https://tribe.tsdpu.org/lb';
const GAME = 'agility-rush';
const SECRET = 'a45652a4af5b603f00f3dc8d9346135cc2fb73a3da209686';
const SAVE_KEY = 'agility-rush-save-v1';

// Последняя ошибка клиента лидерборда (проставляется из leaderboard.js) — чтобы видеть
// реальную причину, а не просто «null».
export const lbStatus = { lastSubmit: null, lastTop: null };

async function testFetchTop() {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/top?game=${GAME}&period=all&limit=1`, { cache: 'no-store' });
    const ms = Date.now() - t0;
    let count = null;
    try { count = ((await res.json()).top || []).length; } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, ms, count };
  } catch (e) { return { ok: false, err: String(e).slice(0, 120), ms: Date.now() - t0 }; }
}

async function testHmac() {
  try {
    if (!(window.crypto && crypto.subtle)) return { ok: false, err: 'crypto.subtle недоступен (не secure context?)' };
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode('test'));
    return { ok: sig.byteLength === 32 };
  } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
}

function readSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return {
      hasName: !!d.playerName, nameLen: (d.playerName || '').length,
      bestScore: d.bestScore || 0, bestDistance: d.bestDistance || 0,
      recordSubmitted: !!d.recordSubmitted,
    };
  } catch (e) { return { err: String(e).slice(0, 80) }; }
}

// Полный срез для диагностики. force network-тесты можно отключить (fast=true).
export async function collectDiagnostics() {
  const ua = navigator.userAgent;
  const d = {
    ver: APP_VERSION,
    // окружение
    ua: ua.slice(0, 200),
    secure: window.isSecureContext,
    protocol: location.protocol,
    online: navigator.onLine,
    lang: navigator.language,
    tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    conn: navigator.connection ? navigator.connection.effectiveType : null,
    dpr: window.devicePixelRatio,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    // среда запуска: VK-webview и PWA-режим часто ломают сеть/secure-context
    vk: /VKAndroidApp|VKClient|com\.vk|OK\b/i.test(ua) || location.search.includes('vk'),
    standalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    cryptoSubtle: !!(window.crypto && crypto.subtle),
    // клиент
    save: readSave(),
    // WebGL — GPU и число потерь контекста (проставляет main.js)
    webgl: (window.__diag && window.__diag.webgl) || null,
    glLostCount: (window.__diag && window.__diag.glLostCount) || 0,
    // последние статусы клиента лидерборда
    lbStatus: { lastSubmit: lbStatus.lastSubmit, lastTop: lbStatus.lastTop },
  };
  // активные сетевые тесты (главное — почему лидерборд не работает)
  d.testTop = await testFetchTop();
  d.testHmac = await testHmac();
  return d;
}

// Собрать и отправить на сервер (как событие diagnostic — уходит через тот же /events).
// Возвращает краткий вердикт для показа игроку.
export async function sendDiagnostics() {
  const d = await collectDiagnostics();
  track('diagnostic', { sid: sessionId(), ...flatten(d) });
  // Вердикт для игрока/нас: что вероятно сломано
  const problems = [];
  if (!d.secure || !d.cryptoSubtle) problems.push('нет безопасного контекста (подпись рекордов не работает)');
  if (d.testTop && !d.testTop.ok) problems.push('сервер топа недоступен (сеть/VPN)');
  if (d.testHmac && !d.testHmac.ok) problems.push('подпись рекорда не считается');
  if (!d.online) problems.push('нет интернета');
  return { sent: true, problems, diag: d };
}

// Уплощаем вложенность — сервер хранит params как JSON, но плоские поля удобнее для дашборда.
function flatten(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object') out[k] = JSON.stringify(v).slice(0, 300);
    else out[k] = v;
  }
  return out;
}
