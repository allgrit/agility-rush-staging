import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Game, FIXED_DT } from './game.js';
import { shouldUseRiggedDog } from './rigged_host.js';

// Bootstrap: рендерер, цикл с аккумулятором, ввод, харнесс для покадровой съёмки.

const params = new URLSearchParams(location.search);
const HARNESS = params.has('harness');

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true,
  // preserveDrawingBuffer нужен только харнессу (toDataURL). В проде он удваивает буфер и
  // лишне грузит память мобильного GPU — включаем ТОЛЬКО в харнессе.
  preserveDrawingBuffer: HARNESS,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);

// Постобработка: MSAA-таргет + мягкий bloom для искр/прожекторов/заката
const rtSize = new THREE.Vector2(window.innerWidth, window.innerHeight);
const renderTarget = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { samples: 2 });
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(rtSize.clone(), 0.3, 0.5, 0.9);
if (!new URLSearchParams(location.search).has('nobloom')) composer.addPass(bloomPass);
composer.addPass(new OutputPass());
function renderFrame() { composer.render(); }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Диагностика GPU: какой рендерер и сколько раз терялся контекст (главная гипотеза
// «чёрного экрана» при долгом забеге — iOS убивает WebGL по памяти).
window.__diag = { glLostCount: 0, webgl: (() => {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? { vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) } : { renderer: 'n/a' };
  } catch { return null; }
})() };

// После staging-приёмки rigged Border является штатной моделью и на production Pages.
// На localhost он по-прежнему включается явным флагом; неизвестные hosts используют fallback.
const wantsRiggedDog = shouldUseRiggedDog(location, params);

let dogFactory = null;
if (wantsRiggedDog) {
  try {
    const { loadRiggedDogFactory } = await import('./rigged_dog.js');
    dogFactory = await loadRiggedDogFactory('./assets/models/border-collie-test.glb');
  } catch (error) {
    window.__diag.riggedDogError = String(error?.message || error);
  }
}
window.__diag.riggedDogEnabled = !!dogFactory;

// Баннер «графика перезапустилась» — вместо тихого чёрного экрана даём игроку выход.
function showGlLostBanner() {
  let b = document.getElementById('gl-lost');
  if (!b) {
    b = document.createElement('div');
    b.id = 'gl-lost';
    b.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(8,12,24,0.92);color:#eaf4ff;font-family:Segoe UI,sans-serif;text-align:center;padding:24px';
    b.innerHTML = '<div><div style="font-size:38px">🐕‍🦺</div><div style="font-size:18px;font-weight:800;margin:12px 0 6px">Графика перезапускается…</div><div style="font-size:13px;color:#9db4d4;max-width:280px">Если экран остаётся чёрным — нажми «Перезагрузить». Твой прогресс сохранён.</div><button id="gl-reload" style="margin-top:16px;background:linear-gradient(180deg,#ffb347,#f0902c);border:none;border-radius:12px;color:#2a1800;font-size:15px;font-weight:800;padding:11px 22px;cursor:pointer">↻ Перезагрузить</button></div>';
    document.body.appendChild(b);
    b.querySelector('#gl-reload').onclick = () => location.reload();
  }
  b.style.display = 'flex';
}
function hideGlLostBanner() { const b = document.getElementById('gl-lost'); if (b) b.style.display = 'none'; }

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // обязательно — иначе контекст не восстановится
  window.__diag.glLostCount++;
  if (game && game.state === 'running') { try { game.togglePause(); } catch { /* ignore */ } }
  showGlLostBanner();
  if (!HARNESS) import('./analytics.js').then(({ track }) => track('webgl_context_lost', {
    distance_m: Math.floor((game && game.distance) || 0),
    score: Math.floor((game && game.score) || 0),
    state: game && game.state, count: window.__diag.glLostCount,
    runtime_s: Math.round(performance.now() / 1000),
    mem_mb: (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null),
  })).catch(() => {});
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  resize(); // пересоздаём размеры буферов; three сам восстановит текстуры/материалы
  hideGlLostBanner();
  if (!HARNESS) import('./analytics.js').then(({ track }) => track('webgl_context_restored', { count: window.__diag.glLostCount })).catch(() => {});
}, false);

const game = new Game(renderer, scene, camera, { dogFactory });

// Аналитика: загрузка игры (device, время до готовности)
if (!new URLSearchParams(location.search).has('harness')) {
  import('./analytics.js').then(({ track }) => {
    const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    track('game_loaded', { device, ttfi_ms: Math.round(performance.now()) });
  }).catch(() => {});
}

// Кнопка паузы в HUD
document.getElementById('pause-btn').addEventListener('click', () => game.togglePause());

// Service Worker: офлайн + бесшовные апдейты (не в харнессе — детерминизм)
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('harness')) {
  const registerServiceWorker = () => {
    // updateViaCache:'none' — sw.js всегда качается свежим, минуя HTTP-кэш (важно для Pages)
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {}); // форсим проверку новой версии при заходе
      setInterval(() => reg.update().catch(() => {}), 60000); // и раз в минуту
    }).catch(() => {});
    // Новый SW активируется сразу (skipWaiting) и берёт управление → controllerchange.
    // Перезагрузку откладываем до конца забега, чтобы не прервать игру (прогресс — в автосейве).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      const doReload = () => location.reload();
      if (game.state === 'running' || game.state === 'paused' || game.state === 'revive') {
        game.pendingReload = doReload; // применится при возврате в меню / после смерти
        const banner = document.getElementById('update-banner');
        if (banner) { banner.textContent = 'Обновление применится после забега'; banner.style.display = 'block'; }
      } else {
        doReload();
      }
    });
  };
  // Rigged GLB загружается через top-level await. Если он завершился уже после
  // window.load, регистрируем SW сразу, иначе одноразово ждём обычный load.
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}

// --- Ввод: клавиатура ---
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', Space: 'up',
  ArrowDown: 'down', KeyS: 'down',
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); game.togglePause(); return; }
  const a = KEYMAP[e.code];
  if (a) {
    e.preventDefault();
    game.audio.init(); game.audio.resume();
    game.input(a);
  }
});

// --- Ввод: свайпы ---
let touchStart = null;
window.addEventListener('touchstart', (e) => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  game.audio.init(); game.audio.resume();
  const adx = Math.abs(dx), ady = Math.abs(dy);
  // Порог свайпа маленький (14px) и направление важнее величины — короткие свайпы
  // вниз/вверх должны срабатывать как подкат/прыжок, а не превращаться в тап.
  if (adx < 14 && ady < 14) {
    game.input('tap'); // короткое касание — ритм слалома / прыжок
    return;
  }
  if (ady > adx) game.input(dy > 0 ? 'down' : 'up');
  else game.input(dx > 0 ? 'right' : 'left');
}, { passive: true });

// --- Основной цикл ---
// Debug: ?warp=<метры> — старт забега сразу в плотной зоне второй оси сложности (для просмотра).
// ТОЛЬКО на localhost: в проде это чит-вектор (накрутка дистанции/лидерборда), поэтому отключено.
const WARP = parseInt(params.get('warp') || '0', 10);
if (WARP > 0 && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) game._warpDist = WARP;
// Кап частоты РЕНДЕРА до 60fps. Логика (update) всё равно фиксированная 60 Гц, а на дисплеях
// 90/120/144 Гц рендер без капа молотит в 1.5-2.4 раза чаще → GPU перегревается. Кап убирает
// лишние кадры без потери плавности (60fps достаточно) и заметно снижает нагрев.
// Через АККУМУЛЯТОР (не порог): усредняет ровно 60 на ЛЮБОЙ частоте экрана без квантования
// (порог давал 144/3=48fps из-за пропуска «через один»). Update-цикл не трогаем.
const RENDER_DT_MS = 1000 / 60;
let accumulator = 0;
let lastT = performance.now();
let renderAccum = RENDER_DT_MS; // первый кадр рисуем сразу
let running = true;

// Оверлей производительности (?perf): реальный FPS/ms на устройстве. Presentation-only,
// вне игрового цикла — детерминизм не затрагивается.
const PERF = params.has('perf');
let perfEl = null, perfFrames = 0, perfWinStart = 0, perfRenderAcc = 0;
if (PERF) {
  perfEl = document.createElement('div');
  perfEl.id = 'perf-overlay';
  perfEl.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:70;font:11px/1.35 monospace;color:#9adcff;background:rgba(8,12,24,0.62);padding:3px 8px;border-radius:7px;pointer-events:none;white-space:nowrap;';
  document.body.appendChild(perfEl);
}

function frame(now) {
  if (!HARNESS) {
    const elapsedMs = Math.min(100, now - lastT);
    lastT = now;
    accumulator += elapsedMs / 1000;
    while (accumulator >= FIXED_DT) {
      game.update();
      accumulator -= FIXED_DT;
    }
    // Кап рендера 60fps через аккумулятор: копим реальное время, рисуем при наборе 1/60 с,
    // остаток переносим → средняя частота ровно 60 на любом экране. При лаге (возврат вкладки)
    // не копим пачку кадров.
    renderAccum += elapsedMs;
    if (renderAccum >= RENDER_DT_MS) {
      renderAccum = renderAccum > RENDER_DT_MS * 2 ? 0 : renderAccum - RENDER_DT_MS;
      const r0 = PERF ? performance.now() : 0;
      renderFrame();
      if (PERF) {
        perfRenderAcc += performance.now() - r0;
        perfFrames++;
        if (perfWinStart === 0) perfWinStart = now;
        else if (now - perfWinStart >= 500) {
          const fps = perfFrames * 1000 / (now - perfWinStart);
          const mem = renderer.info.memory;
          perfEl.textContent = `${fps.toFixed(0)} fps · ${(perfRenderAcc / perfFrames).toFixed(1)}ms · geo ${mem.geometries} · tex ${mem.textures} · dpr ${renderer.getPixelRatio()}`;
          perfFrames = 0; perfRenderAcc = 0; perfWinStart = now;
        }
      }
    }
  }
  if (running) requestAnimationFrame(frame);
}

if (!HARNESS) {
  game.showMenu();
  requestAnimationFrame(frame);
} else {
  // В харнессе кадры двигаются только вручную через __harness.step()
  document.body.classList.add('harness');
}

// --- Харнесс: детерминированное покадровое управление для Playwright ---
let closeup = null; // {mode:'side'|'three'|'front'|'back', dist}
function applyCloseup() {
  if (!closeup) return;
  const d = game.dog;
  const p = new THREE.Vector3(d.x, d.y + 0.45, d.z);
  const dist = closeup.dist || 1.9;
  const offsets = {
    side: new THREE.Vector3(dist, 0.15, 0),
    three: new THREE.Vector3(dist * 0.75, 0.35, dist * 0.75),
    front: new THREE.Vector3(0, 0.2, -dist),
    back: new THREE.Vector3(0, 0.35, dist),
  };
  camera.position.copy(p).add(offsets[closeup.mode] || offsets.side);
  camera.lookAt(p);
  camera.fov = 45;
  camera.updateProjectionMatrix();
}

window.__game = game; // debug-доступ для харнесса
window.__harness = {
  ready: true,
  // Камера-инспектор для анализа анимаций: mode side|three|front|back, null — выключить
  setCloseup(mode, dist) { closeup = mode ? { mode, dist } : null; },
  // Запуск забега с сидом; мгновенно, без countdown
  boot(seed = 42, breed = 'border') {
    game.meta.data.unlocked = ['border', 'aussie', 'poodle'];
    game.meta.data.selectedDog = breed;
    game._setDog(breed);
    game.audio.enabled = false;
    game.ui.hideMenu();
    game.track.disabled = false;
    game.startRun(seed, true);
    renderFrame();
    return game.state;
  },
  // Лаборатория: пустая трасса + один снаряд впереди (для прицельной съёмки механик)
  lab(kind, lane = 1, dist = 14, seed = 42, breed = 'border') {
    this.boot(seed, breed);
    game.track.disabled = true;
    game.track.reset();
    game.track.disabled = true;
    game.track.spawnOne(kind, lane, game.dog.z - dist);
    renderFrame();
    return game.state;
  },
  // Прогнать n кадров; actions: { frameIndex: 'left'|'right'|'up'|'down' }
  step(n = 1, actions = {}) {
    for (let i = 0; i < n; i++) {
      const a = actions[i];
      if (a) game.input(a);
      game.update();
    }
    applyCloseup();
    renderFrame();
    return this.state();
  },
  // Снимок текущего кадра
  shot() { return renderer.domElement.toDataURL('image/png'); },
  // Киноплёнка: прогоняет кадры, снимает каждый every-й в сетку cols×rows с подписями
  filmstrip(totalFrames, every, cols, rows, actions = {}, scale = 0.32) {
    const w = renderer.domElement.width * scale;
    const h = renderer.domElement.height * scale;
    const cv = document.createElement('canvas');
    cv.width = w * cols; cv.height = h * rows;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cv.width, cv.height);
    let cell = 0;
    for (let i = 0; i < totalFrames && cell < cols * rows; i++) {
      const a = actions[i];
      if (a) game.input(a);
      game.update();
      if (i % every === 0) {
        applyCloseup();
        renderFrame();
        const cx = (cell % cols) * w, cy = Math.floor(cell / cols) * h;
        ctx.drawImage(renderer.domElement, cx, cy, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx, cy, 74, 18);
        ctx.fillStyle = '#ffe08a';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('f' + i, cx + 4, cy + 13);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(cx, cy, w, h);
        cell++;
      }
    }
    applyCloseup();
    renderFrame();
    return cv.toDataURL('image/png');
  },
  // Состояние для ассертов
  state() {
    const d = game.dog;
    return {
      state: game.state,
      dog: { lane: d.lane, x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(2), vy: +d.vy.toFixed(2), speed: +d.speed.toFixed(2), airborne: d.airborne, slideT: +d.slideT.toFixed(2), stunT: +d.stunT.toFixed(2) },
      score: Math.floor(game.score),
      combo: game.combo,
      distance: Math.floor(game.distance),
      cookies: game.runStats.cookies,
      faults: game.runStats.faults,
      perfects: game.runStats.perfects,
      cleanObstacles: game.runStats.cleanObstacles,
      weave: game.weave ? {
        hits: game.weave.hits,
        tapIdx: game.weave._tapIdx ?? -1,
        windowOpen: (game.weave._tapWindow || 0) > 0,
        tapped: !!game.weave._tapped,
        expected: ((game.weave._tapIdx ?? 0) % 2) ? 'left' : 'right',
      } : null,
      apparatus: game.onApparatus ? game.onApparatus.kind : null,
      apparatusDetail: game.onApparatus ? {
        kind: game.onApparatus.kind,
        contactReady: game.onApparatus.kind === 'aframe'
          ? (d.z <= game.onApparatus.contactStart && d.z >= game.onApparatus.contactEnd - 0.2)
          : undefined,
        bangWindow: game.apparatusState ? (game.apparatusState.bangWindow > 0) : false,
        balance: game.apparatusState ? +((game.apparatusState.balance || 0).toFixed(2)) : 0,
      } : null,
      judgeT: +game.judgeT.toFixed(1),
      powerups: { ...game.powerups },
      tutorial: {
        active: game.tutorial.active,
        curType: game.tutorial.curType,
        learned: { ...game.tutorial.learned },
        count: { ...game.tutorial.count },
        hintVisible: (() => { const el = document.getElementById('tut-hint'); return !!el && getComputedStyle(el).display !== 'none'; })(),
      },
      zone: game.world.currentZone,
      groundNear: Math.min(...game.world.groundSegs.map(s2 => Math.abs(s2.position.z - d.z))),
      // Ближайшие сущности впереди — чтобы планировать входы
      ahead: game.track.entities
        .filter(e => !e.resolved && (e.entry ?? e.z) < d.z + 2 && (e.entry ?? e.z) > d.z - 60)
        .sort((a, b) => (b.entry ?? b.z) - (a.entry ?? a.z))
        .slice(0, 6)
        .map(e => ({ kind: e.kind, lane: e.lane, z: +((e.entry ?? e.z)).toFixed(1), rel: +(d.z - (e.entry ?? e.z)).toFixed(1) })),
    };
  },
  // Показать меню/гейовер для съёмки UI
  menu() { game.showMenu(); renderFrame(); },
  render() { applyCloseup(); renderFrame(); },
};
