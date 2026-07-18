// Адаптивное качество: игра сама мерит стоимость кадра и двигает ступень качества
// под конкретное устройство. Двухуровневое применение:
//   • LIVE (в любой момент, дёшево): DPR и bloom — меняем прямо в забеге;
//   • DEFERRED (только в меню/на старте): тип теней и MSAA — их смена рекомпилирует
//     шейдеры/пересоздаёт буфер → фриз, поэтому применяем в безопасный момент.
// Ступень 0 (ultra) визуально идентична исходной картинке — сильные телефоны её и держат.

// Порядок: от максимума к минимуму. Каждый шаг ВНИЗ обязан иметь LIVE-эффект
// (DPR или bloom), чтобы просевший телефон получал облегчение сразу, не дожидаясь меню.
export const TIERS = [
  { name: 'ultra',  dprCap: 2.0, bloom: true,  shadows: true,  softShadows: true,  msaa: 2 },
  { name: 'high',   dprCap: 1.6, bloom: true,  shadows: true,  softShadows: true,  msaa: 2 },
  { name: 'medium', dprCap: 1.4, bloom: false, shadows: true,  softShadows: false, msaa: 2 },
  { name: 'low',    dprCap: 1.2, bloom: false, shadows: false, softShadows: false, msaa: 0 },
];

// Стартовая догадка до первых замеров. Мобильный старт — high (лишь DPR 1.6 вместо 2.0,
// bloom и мягкие тени на месте — почти незаметно), чтобы не терять качество зря на
// сильных телефонах, но и не ловить худший ultra→low на слабых. Дальше замер сам
// поднимет сильный телефон до ultra или уронит слабый. Десктоп — сразу ultra.
export function guessInitialTier(ua, dpr) {
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua || '');
  if (!mobile) return 0;                    // десктоп → ultra
  return (dpr && dpr < 1.5) ? 2 : 1;        // низкий DPR = бюджетный/старый телефон → medium
}

export class QualityController {
  // onLive(tier)     — применить DPR/bloom немедленно
  // onDeferred(tier) — применить тени/MSAA (вызывается в безопасный момент)
  // onPersist(idx)   — сохранить осевшую ступень в профиль
  // now()            — источник времени в мс (инъектируем для тестов)
  constructor({ initialTier = 0, onLive, onDeferred, onPersist, now }) {
    this.tier = initialTier;       // ступень, применённая ПОЛНОСТЬЮ (вкл. deferred)
    this.target = initialTier;     // целевая (live применён, deferred может ждать меню)
    this.onLive = onLive || (() => {});
    this.onDeferred = onDeferred || (() => {});
    this.onPersist = onPersist || (() => {});
    this._now = now || (() => 0);
    this.frameWin = [];            // окно интервалов кадра, мс (наземная правда «тянем ли 60»)
    this.renderWin = [];           // окно стоимости render(), мс (прокси запаса)
    this.lastEval = 0;
    this.lastChange = -1e9;
    this.headroomSince = 0;
    this.pendingDeferred = false;

    // Параметры контроллера (мс)
    this.WINDOW = 90;              // ~1.5 с при 60 fps
    this.EVAL_MS = 700;            // как часто принимаем решение
    this.COOLDOWN_MS = 2500;       // пауза после смены — измерить эффект
    this.DOWN_FRAME_MS = 22;       // кадр устойчиво >22 мс (<45 fps) → вниз на шаг
    this.DOWN_HARD_MS = 40;        // >40 мс (<25 fps) → сильная просадка: прыжок на 2 без cooldown
    this.UP_RENDER_MS = 6;         // render() дёшев → есть запас
    this.UP_FRAME_MS = 18;         // и кадр держит цель
    this.UP_CONFIRM_MS = 4000;     // запас должен продержаться дольше (вверх — осторожно)
  }

  // Каждый отрисованный кадр: интервал кадра и стоимость render().
  sample(frameMs, renderMs) {
    const t = this._now();
    // Берём всё вплоть до 15 fps и ниже (66..100 мс — это РЕАЛЬНАЯ просадка, её и лечим).
    // Отсекаем только явный мусор (>150 мс = сворачивание вкладки/столл), а разовые
    // спайки внутри окна гасит МЕДИАНА, а не абсолютный порог.
    if (frameMs > 0 && frameMs < 150) {
      this.frameWin.push(frameMs);
      if (this.frameWin.length > this.WINDOW) this.frameWin.shift();
    }
    if (renderMs >= 0) {
      this.renderWin.push(renderMs);
      if (this.renderWin.length > this.WINDOW) this.renderWin.shift();
    }
    if (t - this.lastEval < this.EVAL_MS) return;
    this.lastEval = t;
    this._evaluate(t);
  }

  _median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  _evaluate(t) {
    if (this.frameWin.length < 20) return; // минимум для устойчивой медианы (~1с при низком fps)
    const frameMed = this._median(this.frameWin);
    const renderMed = this._median(this.renderWin);
    const cooling = t - this.lastChange < this.COOLDOWN_MS;

    // ВНИЗ: устойчиво долгий кадр → роняем ступень немедленно (LIVE-часть даёт эффект сразу).
    // Сильная просадка (<25 fps) — прыжок на 2 ступени и в обход cooldown, чтобы слабый
    // телефон не лагал 7 секунд, спускаясь по одной.
    if (this.target < TIERS.length - 1) {
      const severe = frameMed > this.DOWN_HARD_MS;
      if (frameMed > this.DOWN_FRAME_MS && (!cooling || severe)) {
        this._setTarget(this.target + (severe ? 2 : 1), t);
        this.headroomSince = 0;
        return;
      }
    }

    // ВВЕРХ: render дёшев И кадр держит цель, устойчиво дольше → поднимаем ступень.
    const headroom = renderMed < this.UP_RENDER_MS && frameMed < this.UP_FRAME_MS;
    if (headroom && this.target > 0) {
      if (this.headroomSince === 0) this.headroomSince = t;
      else if (t - this.headroomSince > this.UP_CONFIRM_MS && !cooling) {
        this._setTarget(this.target - 1, t);
        this.headroomSince = 0;
      }
    } else {
      this.headroomSince = 0;
    }
  }

  _setTarget(idx, t) {
    idx = Math.max(0, Math.min(TIERS.length - 1, idx));
    if (idx === this.target) return;
    this.target = idx;
    this.lastChange = t;
    this.frameWin.length = 0;
    this.renderWin.length = 0;   // после смены мерим заново
    this.onLive(TIERS[idx]);     // DPR/bloom — сразу
    this.pendingDeferred = true; // тени/MSAA + персист — в ближайший безопасный момент
  }

  // Безопасный момент (меню/countdown/смерть): досогласуем тени/MSAA и ЗАФИКСИРУЕМ ступень
  // в профиль. Персист именно тут (а не на каждый шаг в забеге) — иначе транзиентный прыжок
  // вниз при разовом термо-спайке навсегда занизил бы стартовую ступень на следующий запуск.
  applyDeferredIfPending() {
    if (!this.pendingDeferred) return false;
    this.pendingDeferred = false;
    this.tier = this.target;
    this.onDeferred(TIERS[this.target]);
    this.onPersist(this.target);
    return true;
  }
}
