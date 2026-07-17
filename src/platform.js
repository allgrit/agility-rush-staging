// Платформенный адаптер: web (PWA на Pages) | vk (VK Mini App на vk.com/ok.ru).
// Один код на все площадки — рантайм-детект хоста, специфика площадки за единым API.
// VK Mini App: игра крутится в iframe на VK, платформа передаёт launch-параметры в URL
// (vk_app_id, vk_user_id, sign, …); общение с VK — через VK Bridge (self-host в vendor/).

const params = new URLSearchParams(location.search);

// VK передаёт vk_app_id в launch-URL iframe — надёжный признак запуска ВНУТРИ VK/OK.
export const IS_VK = params.has('vk_app_id');
export const VK_APP_ID = 54680489; // наш Mini App (dev.vk.com)
export const PLATFORM = IS_VK ? 'vk' : 'web';

// В VK-iframe Service Worker/PWA бесполезны и мешают; уводящие внешние ссылки запрещены
// правилами площадок (VK/OK) — прячем их. На web (Pages) всё как раньше.
export const useServiceWorker = !IS_VK;
export const allowExternalLinks = !IS_VK;

let vkBridge = null;

// Подгружаем VK Bridge из НАШЕГО origin (не внешний CDN — надёжнее и для модерации VK).
function loadVKBridge() {
  if (window.vkBridge) return Promise.resolve(window.vkBridge);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = './vendor/vk-bridge.min.js';
    s.onload = () => resolve(window.vkBridge || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

// Инициализация площадки. Для VK — VKWebAppInit ОБЯЗАТЕЛЕН в первые 30с после загрузки,
// иначе VK не покажет приложение. Возвращает bridge (или null на web/ошибке).
export async function initPlatform() {
  if (!IS_VK) return null;
  try {
    vkBridge = await loadVKBridge();
    if (vkBridge) {
      await vkBridge.send('VKWebAppInit');
      // Статус-бар/шапка VK под тёмную палитру игры (не белая полоса сверху).
      vkBridge.send('VKWebAppSetViewSettings', { status_bar_style: 'light', action_bar_color: '#0d1522' }).catch(() => {});
      // iOS-клиент VK: системный edge-свайп «назад» закрывал приложение вместо
      // игрового свайпа влево — отключаем (метод создан именно для игр).
      // На Android/десктопе метод не поддержан — реджект глотаем.
      vkBridge.send('VKWebAppSetSwipeSettings', { history: false }).catch(() => {});
    }
  } catch { /* не критично — игра работает и без bridge */ }
  return vkBridge;
}

// Имя игрока для онлайн-топа: в VK берём из профиля (если игрок ещё не задал имя вручную).
export async function resolveVKName() {
  if (!IS_VK || !vkBridge) return null;
  try {
    const u = await vkBridge.send('VKWebAppGetUserInfo');
    const nm = `${u.first_name || ''} ${u.last_name || ''}`.trim().slice(0, 24);
    return nm || null;
  } catch { return null; }
}

// Надёжный сигнал «приложение свёрнуто/развёрнуто» в VK: iframe-visibilitychange на
// мобильном VK срабатывает не всегда, а VKWebAppViewHide/Restore — гарантированно.
export function watchVKView(onHide, onShow) {
  if (!IS_VK || !vkBridge || typeof vkBridge.subscribe !== 'function') return;
  vkBridge.subscribe((e) => {
    const t = e && e.detail && e.detail.type;
    if (t === 'VKWebAppViewHide') onHide();
    else if (t === 'VKWebAppViewRestore') onShow();
  });
}

// Поделиться результатом в VK: открывает нативный компоузер поста на стену с текстом +
// ссылкой на приложение (виральный цикл). На web — no-op.
// Вибро-отклик (Taptic Engine, iOS-клиент VK; Android игнорирует тихо).
// style: 'light' | 'medium' | 'heavy'. Джус для перфектов/крашей/пуллера.
export function haptic(style = 'medium') {
  if (!IS_VK || !vkBridge) return;
  vkBridge.send('VKWebAppTapticImpactOccurred', { style }).catch(() => {});
}

// ---- Облачный сейв (VKWebAppStorage): критичный прогресс переживает смену
// устройства/очистку браузера. Лимит значения ~4КБ — храним компактное ядро,
// полный сейв остаётся в localStorage.
const CLOUD_KEY = 'save_core_v1';
const CORE_FIELDS = ['cookies', 'bestScore', 'bestDistance', 'runs', 'tokens',
  'unlocked', 'selectedDog', 'ftueDone', 'consumables', 'playerName', 'missionsCompleted', 'totalScore'];

export async function cloudBackup(meta) {
  if (!IS_VK || !vkBridge || !meta) return;
  try {
    const core = {};
    for (const k of CORE_FIELDS) if (meta.data[k] !== undefined) core[k] = meta.data[k];
    const value = JSON.stringify(core);
    if (value.length > 4096) return; // лимит VKWebAppStorage — молча не влезем, не шлём мусор
    await vkBridge.send('VKWebAppStorageSet', { key: CLOUD_KEY, value });
  } catch { /* не критично */ }
}

// Восстановление на «пустом» устройстве: если локального прогресса нет, а в облаке
// есть — тихо применяем (игрок продолжает с того же места на новом телефоне).
// canApply — предикат последнего момента (например «игра всё ещё в меню»):
// bridge-ответ может прийти через секунды, когда игрок уже начал забег
export async function cloudRestore(meta, canApply) {
  if (!IS_VK || !vkBridge || !meta) return false;
  try {
    const res = await vkBridge.send('VKWebAppStorageGet', { keys: [CLOUD_KEY] });
    const entry = res && res.keys && res.keys.find((k) => k.key === CLOUD_KEY);
    const raw = entry && entry.value;
    if (!raw) return false;
    const core = JSON.parse(raw);
    const localFresh = (meta.data.runs || 0) === 0 && (meta.data.cookies || 0) === 0;
    const cloudHasProgress = (core.runs || 0) > 0 || (core.cookies || 0) > 0;
    if (!localFresh || !cloudHasProgress) return false;
    if (canApply && !canApply()) return false;
    for (const k of CORE_FIELDS) if (core[k] !== undefined) meta.data[k] = core[k];
    meta.save();
    return true;
  } catch { return false; }
}

// ---- Кнопки роста (меню, только VK) ----
export function addToFavorites() {
  if (!IS_VK || !vkBridge) return Promise.resolve(false);
  return vkBridge.send('VKWebAppAddToFavorites').then(() => true).catch(() => false);
}

export function recommendApp() {
  if (!IS_VK || !vkBridge) return Promise.resolve(false);
  return vkBridge.send('VKWebAppRecommend').then(() => true).catch(() => false);
}

// Иконка на рабочий стол — только Android-клиент VK; поддержку спрашиваем заранее
export async function homeScreenSupported() {
  if (!IS_VK || !vkBridge) return false;
  try {
    const r = await vkBridge.send('VKWebAppAddToHomeScreenInfo');
    return !!(r && (r.is_feature_supported || r.is_added_to_home_screen === false));
  } catch { return false; }
}

export function addToHomeScreen() {
  if (!IS_VK || !vkBridge) return Promise.resolve(false);
  return vkBridge.send('VKWebAppAddToHomeScreen').then(() => true).catch(() => false);
}

export async function shareScore(distance, score) {
  if (!IS_VK || !vkBridge) return false;
  const msg = `🐕 Пробежал ${distance} м и набрал ${score} очков в Agility Rush! Обгонишь?`;
  try {
    await vkBridge.send('VKWebAppShowWallPostBox', { message: msg, attachments: `https://vk.com/app${VK_APP_ID}` });
    return true;
  } catch { return false; }
}
