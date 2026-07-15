// Service Worker: офлайн-игра + бесшовные апдейты.
// Стратегия: прекэш ядра при install; cache-first в рантайме (vendor подтягивается
// по мере запроса). Новая версия НЕ применяется на лету — старые вкладки доигрывают
// на своём коде, обновление активируется контролируемо по клику игрока (skipWaiting).

const VERSION = 'agility-staging-v38';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js', './src/game.js', './src/world.js', './src/track.js',
  './src/obstacles.js', './src/dog.js', './src/fx.js', './src/camera_rig.js',
  './src/audio.js', './src/ui.js', './src/meta.js', './src/rng.js', './src/leaderboard.js', './src/version.js', './src/analytics.js',
  './src/cosmetics.js', './src/rigged_host.js', './src/rigged_dog.js',
  './src/achievements.js', './src/diag.js',
  './assets/hero.webp', './assets/dog-border.png', './assets/dog-aussie.png', './assets/dog-poodle.png',
  './assets/icon-180.png', './assets/icon-512.png',
  './assets/models/border-collie-test.glb',
  // Three.js и bloom-цепочка — чтобы игра открывалась офлайн с первого захода
  './vendor/three/build/three.module.js',
  './vendor/three/examples/jsm/postprocessing/EffectComposer.js',
  './vendor/three/examples/jsm/postprocessing/RenderPass.js',
  './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js',
  './vendor/three/examples/jsm/postprocessing/OutputPass.js',
  './vendor/three/examples/jsm/postprocessing/Pass.js',
  './vendor/three/examples/jsm/postprocessing/MaskPass.js',
  './vendor/three/examples/jsm/postprocessing/ShaderPass.js',
  './vendor/three/examples/jsm/shaders/CopyShader.js',
  './vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js',
  './vendor/three/examples/jsm/shaders/OutputShader.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
];

self.addEventListener('install', (e) => {
  // Новый SW берёт управление сразу (вытесняет залипший старый). Перезагрузку
  // страницы контролирует клиент: откладывает до конца забега, прогресс — в автосейве.
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// network-first: свежая версия онлайн, из кэша только офлайн (собственный код игры)
function networkFirst(req) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')));
}

// cache-first: неизменная статика (vendor three.js, картинки)
function cacheFirst(req) {
  return caches.match(req).then((cached) => cached || fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => cached));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // сторонние (лидерборд-API) — мимо SW

  const p = url.pathname;
  // Свой код (навигация, HTML, src/*.js, manifest) — network-first, чтобы апдейт
  // применялся сразу при следующем онлайн-заходе, а не залипал в старом кэше.
  const isOwnCode = req.mode === 'navigate' || p.endsWith('.html') || p.endsWith('/')
    || p.includes('/src/') || p.endsWith('.webmanifest');
  e.respondWith(isOwnCode ? networkFirst(req) : cacheFirst(req));
});
// v20: сезоны лидерборда, счёт v2, ретеншн-пакет (стрик/ачивки/плавный старт), магазин legendary.
