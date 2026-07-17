import { DOG_SHOP, TITLES, plural, WEEK_REWARDS, CONSUMABLES } from './meta.js';
import { fetchTop, submitScore } from './leaderboard.js';
import { track } from './analytics.js';
import { APP_VERSION } from './version.js';
import { catalog, RARITY, priceOf, itemOf } from './cosmetics.js';
import { ACH_SECTIONS, ACH_REWARDS, fmtVal } from './achievements.js';
import { IS_VK, shareScore, addToFavorites, recommendApp, homeScreenSupported, addToHomeScreen } from './platform.js';

// Весь HUD и меню — DOM поверх канваса: чётче текст, дешевле анимации (CSS).

const PW_KEYS = ['magnet', 'shield', 'rocket', 'multi']; // порядок пауэрапов в HUD (как в powerups)
// Таймеры бустов в HUD (слева вверху): пауэрапы + тягач + буст стола. Показываем только активные.
const BOOST_KEYS = ['magnet', 'shield', 'rocket', 'multi', 'tug', 'table'];

// Цветная SVG-розетка (эмодзи 🏵 в headless/тёмной теме читается плохо)
function rosetteSVG(color = '#f0c531', size = 34) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 48">
    <path d="M17 28 L14 46 L20 41 L26 46 L23 28 Z" fill="${color}" opacity="0.85"/>
    <circle cx="20" cy="17" r="14" fill="${color}"/>
    <circle cx="20" cy="17" r="9" fill="#fff" opacity="0.25"/>
    <circle cx="20" cy="17" r="5.5" fill="#fffbe8"/>
  </svg>`;
}

export class UI {
  constructor(meta) {
    this.meta = meta;
    this.root = document.getElementById('ui');
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.cookieEl = document.getElementById('cookies');
    this.comboEl = document.getElementById('combo');
    this.comboFill = document.getElementById('combo-fill');
    this.chainEl = document.getElementById('chain');
    this.chainTxt = document.getElementById('chain-txt');
    this.powerupsEl = document.getElementById('powerups');
    this.menuEl = document.getElementById('menu');
    this.overEl = document.getElementById('gameover');
    this.countdownEl = document.getElementById('countdown');
    this.missionToast = document.getElementById('mission-toast');
    this.vignette = document.getElementById('vignette');
    this.speedlines = document.getElementById('speedlines');
    this.flashEl = document.getElementById('flash');
    this._displayScore = 0;
  }

  showMenu(onStart, onSelectDog, onFtue) {
    this.hud.style.display = 'none';
    this.overEl.style.display = 'none';
    this.menuEl.style.display = 'flex';
    const d = this.meta.data;
    // Разовое уведомление о восстановленном забеге (после краша/обновления)
    const rec = this.meta.recovered;
    this.meta.recovered = null;
    const title = this.meta.title();
    // Номер уровня (чиселка «какой это уровень»): индекс титула в TITLES, для легенды — 20+звезда
    const lvlIdx = TITLES.findIndex(t => t.name === title.current.name);
    const lvl = title.legend != null ? TITLES.length + title.legend : (lvlIdx >= 0 ? lvlIdx + 1 : 1);
    const missions = this.meta.activeMissions();
    // Бейдж на вкладке «Задания» — сколько дневных заданий ещё не выполнено сегодня
    const dailyLeft = this.meta.activeDailyMissions().filter(m => !m.done).length;
    const week = this.meta.weekState();
    const achClaimable = this.meta.achClaimableCount();
    this.menuEl.innerHTML = `
      <div class="menu-card">
        <div class="hero tappable" id="hero-play">
          <img src="./assets/hero.webp" alt="">
          <div class="hero-title"><h1>AGILITY<span> RUSH</span></h1>
          <div class="subtitle">Бесконечный чемпионат по аджилити</div></div>
          <div class="tap-hint">👆 Коснись — бежать</div>
        </div>
        <div class="title-row">
          <span class="rosette">${rosetteSVG(title.current.color, 34)}</span>
          <div>
            <div class="title-name">${title.current.name} <span class="title-lvl">Ур. ${lvl}</span></div>
            <div class="title-bar"><i style="width:${Math.floor(title.progress * 100)}%"></i></div>
            ${title.next
              ? `<div class="title-next">🏆 рекорд ${d.bestScore.toLocaleString('ru')} / ${title.next.need.toLocaleString('ru')} · до «${title.next.gen}» ещё ${(title.next.need - d.bestScore).toLocaleString('ru')}</div>`
              : `<div class="title-next">🏆 рекорд ${d.bestScore.toLocaleString('ru')} · максимальный уровень!</div>`}
          </div>
        </div>
        ${rec ? `<div class="recovered-row">💾 Прерванный забег не пропал: <b>+${rec.cookies}🦴</b> и ${rec.distance} м зачтены в прогресс</div>` : ''}
        <div class="dogs-row">
          ${DOG_SHOP.map(dog => {
            const owned = d.unlocked.includes(dog.key);
            const sel = d.selectedDog === dog.key;
            const canBuy = !owned && d.cookies >= dog.cost;
            return `<button class="dog-card ${sel ? 'sel' : ''} ${owned ? '' : 'locked'}" data-dog="${dog.key}">
              <div class="dog-emoji"><img src="./assets/dog-${dog.key}.png" alt=""></div>
              <div class="dog-name">${dog.name}</div>
              <div class="dog-perk">${dog.perk}</div>
              ${owned ? '' : `<div class="dog-price ${canBuy ? 'can' : ''}">🔒 Купить: 🦴 ${dog.cost}</div>`}
            </button>`;
          }).join('')}
        </div>
        <button class="start-btn" id="start-btn">СТАРТ</button>
        <div class="controls-hint">← → полосы · ↑ прыжок · ↓ подкат
          <button class="ftue-menu-btn" id="ftue-menu-btn">🎓 обучение</button></div>
        ${IS_VK ? `<div class="vk-grow">
          <button id="vk-fav">⭐ В избранное</button>
          <button id="vk-rec">📣 Порекомендовать</button>
          <button id="vk-home" style="display:none">📲 На экран</button>
        </div>` : ''}
        <div class="meta-scroll">
        <!-- Панель «Задания»: миссии + слово дня + дейлики -->
        <div class="meta-panel on" data-panel="quests">
          <div class="missions">
            ${missions.map(m => {
              const best = Math.min(m.best, m.target);
              const pc = Math.floor(best / m.target * 100);
              return `<div class="mission ${m.done ? 'done' : ''}">
                <div class="mission-line">🎯 ${m.text} <span>+${m.reward}🦴</span></div>
                <div class="mission-bar"><i style="width:${pc}%"></i></div>
                <div class="mission-best">лучшее: ${best} / ${m.target}</div>
              </div>`;
            }).join('')}
          </div>
          ${(() => {
            const daily = this.meta.daily();
            const prog = daily.word.split('').map((ch, i) => i < daily.collected ? ch : '·').join(' ');
            const doneCls = daily.collected >= daily.word.length ? 'done' : '';
            return `<div class="daily-row ${doneCls}">
              <span>🔤 Слово дня: <b>${prog}</b></span>
              <span>${daily.streak > 0 ? '🔥 ' + daily.streak : ''}</span>
            </div>`;
          })()}
          ${(() => {
            const dm = this.meta.activeDailyMissions();
            return `<div class="daily-missions">${dm.map(m =>
              `<div class="dmission ${m.done ? 'done' : ''}">⭐ ${m.text}<span>+${m.reward}🦴${m.done ? ' ✓' : ''}</span></div>`
            ).join('')}</div>`;
          })()}
        </div>
        <!-- Панель «Награды»: недельный стрик + подарок-миска + статистика -->
        <div class="meta-panel" data-panel="rewards">
          ${this._weekWidgetHtml(week)}
          <div class="gift-row" id="gift-row">
            ${this.meta.giftReady()
              ? '<button class="gift-btn" id="gift-btn">🎁 Миска корма — забрать!</button>'
              : `<span class="gift-wait">🎁 Подарок через ${this.meta.giftCountdown()}</span>`}
          </div>
          <div class="stats-row">
            <span>🦴 ${d.cookies.toLocaleString('ru')}<label>печеньки</label></span>
            <span>🏵 ${d.tokens || 0}<label>жетоны</label></span>
            <span>🏆 ${d.bestScore.toLocaleString('ru')}<label>рекорд</label></span>
            <span>📏 ${d.bestDistance.toLocaleString('ru')} м<label>дистанция</label></span>
          </div>
          <a class="diary-link" href="https://vk.com/chloe.myaussie" target="_blank" rel="noopener">🐾 Дневник Хлои <span class="vk">ВКонтакте ›</span></a>
        </div>
        <!-- Панель «Ачивки»: накопительные цели за карьеру, клейм наград -->
        <div class="meta-panel" data-panel="ach">${this._achPanelHtml()}</div>
        <!-- Панель «Топ»: онлайн-лидерборд + ник + соперники -->
        <div class="meta-panel" data-panel="top">
          <div id="season-banner" class="season-banner" style="display:none"></div>
          <div class="rivals" id="rivals">
            <div class="rivals-head"><button class="lb-open" id="lb-open">🏅 Онлайн-топ ›</button> <button class="name-btn ${!d.playerName && d.bestScore > 0 ? 'call' : ''}" id="name-btn">${d.playerName ? '✎ ' + d.playerName : (d.bestScore > 0 ? '🏆 в топ!' : '＋ имя')}</button></div>
            <div id="rivals-list">${this._rivalsPlaceholder(d)}</div>
          </div>
          <a class="diary-link" href="https://vk.com/chloe.myaussie" target="_blank" rel="noopener">🐾 Дневник Хлои <span class="vk">ВКонтакте ›</span></a>
        </div>
        </div><!-- /meta-scroll -->
        <!-- Нижняя навигация с бейджами -->
        <div class="menu-nav" id="menu-nav">
          <button data-nav="quests" class="on"><span class="nic">🎯</span><span class="nlb">Задания</span>${dailyLeft > 0 ? `<span class="nbadge">${dailyLeft}</span>` : ''}</button>
          <button data-nav="ach"><span class="nic">🏆</span><span class="nlb">Ачивки</span>${achClaimable > 0 ? `<span class="nbadge">${achClaimable}</span>` : ''}</button>
          <button data-nav="rewards"><span class="nic">🎁</span><span class="nlb">Награды</span>${(!week.claimed || this.meta.giftReady()) ? '<span class="nbadge">!</span>' : ''}</button>
          <button data-nav="top"><span class="nic">🏅</span><span class="nlb">Топ</span>${(!d.playerName && d.bestScore > 0) ? '<span class="nbadge">!</span>' : ''}</button>
          <button data-nav="shop" id="shop-open"><span class="nic">🛍</span><span class="nlb">Магазин</span></button>
        </div>
      </div>`;
    this._showVersion();
    track('menu_shown', {});
    // Колбэки сохраняем ДО регистрации обработчиков — внутренние вызовы showMenu
    // (gift/ник/собака) переоткрывают меню через this._onStart/_onSelectDog.
    this._onStart = onStart;
    this._onSelectDog = onSelectDog;
    this._onFtue = onFtue || this._onFtue;
    this.menuEl.querySelector('#start-btn').addEventListener('click', onStart);
    const ftueBtn = this.menuEl.querySelector('#ftue-menu-btn');
    if (ftueBtn) ftueBtn.addEventListener('click', () => { track('ftue_menu_click', {}); this._onFtue && this._onFtue(); });
    // VK: кнопки роста (избранное/рекомендация/иконка на экран — Android)
    if (IS_VK) {
      const fav = this.menuEl.querySelector('#vk-fav');
      const rec = this.menuEl.querySelector('#vk-rec');
      const home = this.menuEl.querySelector('#vk-home');
      if (fav) fav.addEventListener('click', async () => { track('vk_fav', {}); if (await addToFavorites()) fav.textContent = '⭐ В избранном!'; });
      if (rec) rec.addEventListener('click', async () => { track('vk_recommend', {}); if (await recommendApp()) rec.textContent = '📣 Спасибо!'; });
      // Поддержку «на экран» спрашиваем один раз и кэшируем: меню перерисовывается
      // innerHTML-ом, и промис легко резолвится в уже отсоединённый элемент
      if (home) {
        if (this._homeScreenOk === undefined) {
          this._homeScreenOk = null; // «запрошено»
          homeScreenSupported().then((ok) => {
            this._homeScreenOk = ok;
            const el = this.menuEl.querySelector('#vk-home');
            if (ok && el) el.style.display = '';
          });
        } else if (this._homeScreenOk) home.style.display = '';
        home.addEventListener('click', async () => { track('vk_homescreen', {}); if (await addToHomeScreen()) home.textContent = '📲 Готово!'; });
      }
    }
    this.menuEl.querySelectorAll('.diary-link').forEach(el => el.addEventListener('click', () => track('diary_click', { from: 'menu' })));
    // Tap-to-play (парадигма SS): клик по баннеру = старт забега
    const heroPlay = this.menuEl.querySelector('#hero-play');
    if (heroPlay) heroPlay.addEventListener('click', onStart);
    // Нижняя навигация: переключение панелей меты (кнопка «Магазин» открывает оверлей отдельно)
    const navBtns = this.menuEl.querySelectorAll('.menu-nav button[data-nav]:not(#shop-open)');
    const setTab = (tab) => {
      navBtns.forEach(b => b.classList.toggle('on', b.dataset.nav === tab));
      this.menuEl.querySelectorAll('.meta-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === tab));
    };
    navBtns.forEach(btn => btn.addEventListener('click', () => {
      this._activeTab = btn.dataset.nav; // запоминаем: перерисовки меню возвращают сюда же
      setTab(this._activeTab);
      track('menu_tab', { tab: this._activeTab });
    }));
    // Перерисовка (клейм подарка/недели/ачивки, покупка) НЕ выбрасывает в «Задания»:
    // восстанавливаем таб, где был игрок.
    if (this._activeTab && this._activeTab !== 'shop') setTab(this._activeTab);
    // Высота карточки НЕ пляшет по табам: скролл-зона резервирует высоту самой
    // высокой панели (в пределах max-height карточки — излишек срезаем ниже).
    const ms = this.menuEl.querySelector('.meta-scroll');
    if (ms) {
      let maxH = 0;
      for (const p of ms.querySelectorAll('.meta-panel')) {
        const wasOn = p.classList.contains('on');
        p.classList.add('on');
        maxH = Math.max(maxH, p.offsetHeight);
        if (!wasOn) p.classList.remove('on');
      }
      const card = this.menuEl.querySelector('.menu-card');
      const clamp = () => {
        if (this.menuEl.style.display === 'none') return;
        ms.style.minHeight = maxH + 'px';
        const over = card.scrollHeight - card.clientHeight;
        if (over > 0) ms.style.minHeight = Math.max(40, maxH - over) + 'px';
      };
      clamp();
      // Пересчёт при смене вьюпорта: скрытие/показ адресной строки мобильного браузера
      // меняет доступную высоту — без ре-клампа табы выталкивало за экран.
      if (this._menuResize) removeEventListener('resize', this._menuResize);
      this._menuResize = clamp;
      addEventListener('resize', this._menuResize);
    }
    // Кнопка имени игрока
    const nameBtn = this.menuEl.querySelector('#name-btn');
    if (nameBtn) nameBtn.addEventListener('click', async () => {
      const cur = this.meta.data.playerName || '';
      const hadName = !!cur;
      const name = (window.prompt('Ник для онлайн-лидерборда (до 24 симв.):', cur) || '').slice(0, 24).trim();
      if (!name) return;
      this.meta.setPlayerName(name);
      // Перенос накопленного рекорда в глобальный топ (при первом вводе ника)
      const best = this.meta.data.bestScore || 0;
      if (best > 0 && (!hadName || !this.meta.data.recordSubmitted)) {
        const r = await submitScore(name, best, this.meta.data.bestDistance || 0);
        if (r && r.rank) {
          this.meta.data.recordSubmitted = true; this.meta.save();
          this.showOnlineRank(r.rank);
        }
      }
      this.showMenu(this._onStart, this._onSelectDog, this._onFtue);
    });
    // Асинхронно подгружаем реальный онлайн-топ (fallback — локальные боты уже показаны)
    this._loadOnlineTop();
    const lbOpen = this.menuEl.querySelector('#lb-open');
    if (lbOpen) lbOpen.addEventListener('click', () => this.showFullLeaderboard('all'));
    const shopOpen = this.menuEl.querySelector('#shop-open');
    // При изменении косметики пересобираем меню (обновить баланс/превью собаки в фоне).
    if (shopOpen) shopOpen.addEventListener('click', () => this.showShop(() => {
      onSelectDog(this.meta.data.selectedDog); // пересоздать собаку с новой косметикой
      this.showMenu(onStart, onSelectDog);
    }));
    const giftBtn = this.menuEl.querySelector('#gift-btn');
    if (giftBtn) {
      giftBtn.addEventListener('click', () => {
        const amount = this.meta.claimGift();
        if (amount > 0) {
          const row = this.menuEl.querySelector('#gift-row');
          row.innerHTML = `<span class="gift-won">🎉 +${amount} 🦴!</span>`;
          // Обновляем счётчик печенек в статистике
          setTimeout(() => this.showMenu(this._onStart, this._onSelectDog, this._onFtue), 1400);
        }
      });
    }
    // Клейм недельного стрика
    const weekBtn = this.menuEl.querySelector('#week-claim');
    if (weekBtn) {
      weekBtn.addEventListener('click', () => {
        const r = this.meta.claimWeek();
        if (!r) return;
        track('week_claim', { day: r.dayIdx, amount: r.amount, item: r.bonusItem ? r.bonusItem.id : '' });
        const itemName = r.bonusItem ? (itemOf(r.bonusItem.slot, r.bonusItem.id) || {}).name : null;
        weekBtn.outerHTML = `<div class="week-done">🎉 +${r.amount} 🦴${itemName ? ` + бандана «${itemName}»!` : '!'}</div>`;
        setTimeout(() => this.showMenu(this._onStart, this._onSelectDog, this._onFtue), 1600); // таб восстановится сам
      });
    }
    // Клеймы ачивок (кнопки в панели «Ачивки»)
    this.menuEl.querySelectorAll('.ach-claim[data-claim]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.claim;
        const amount = this.meta.claimAchievement(id);
        if (!amount) return;
        track('achievement_claim', { ach: id, amount });
        btn.outerHTML = `<div class="week-done">🎉 +${amount} 🦴</div>`;
        setTimeout(() => this.showMenu(this._onStart, this._onSelectDog), 1200); // таб восстановится сам
      });
    });
    for (const card of this.menuEl.querySelectorAll('.dog-card')) {
      card.addEventListener('click', () => {
        onSelectDog(card.dataset.dog);
        this.showMenu(onStart, onSelectDog); // перерисовать
      });
    }
  }

  // Первичный контент онлайн-секции до ответа сервера: честный «загрузка» + свой рекорд.
  // НЕ показываем локальных ботов — раньше они (score = мой_рекорд × k) всегда «обгоняли»
  // игрока и у каждого клиента были свои, из-за чего топ выглядел рассинхронным.
  _rivalsPlaceholder(d) {
    const me = this._esc(d.playerName || 'ТЫ');
    const mine = d.bestScore > 0
      ? `<div class="rival me"><span>🐕 ${me}</span><span>${d.bestScore.toLocaleString('ru')}</span></div>` : '';
    return `<div class="rival loading"><span>⏳ Загрузка топа…</span><span></span></div>${mine}`;
  }

  async _loadOnlineTop(attempt = 0) {
    // Поколение: отбрасываем устаревшие ответы, если меню за время fetch перерисовалось.
    const gen = (this._topGen = (this._topGen || 0) + 1);
    const resp = await fetchTop('all', 8, null, true);
    const top = resp ? (resp.top || []) : null;
    if (gen !== this._topGen) return; // меню пересоздано/закрыто — этот ответ уже неактуален
    // Сезоны: активный сезон знает сервер. До старта — предупреждаем; после — разовый диалог.
    if (resp && resp.activeSeason != null) {
      this._season = { act: resp.activeSeason, startsAt: resp.season2Start };
      const sb = document.getElementById('season-banner');
      if (sb && resp.activeSeason === 1) {
        sb.style.display = 'block';
        sb.innerHTML = '⏳ Завтра — старт <b>Сезона 2</b>! Рейтинг начнётся заново, а этот топ навсегда останется в «Зале славы».';
      }
      // Предупреждение при ВХОДЕ (не только в табе «Топ»): игрок должен узнать о сбросе заранее
      if (resp.activeSeason === 1 && !this.meta.data.seenS2Warn) {
        this.meta.data.seenS2Warn = true; this.meta.save();
        this.showSeasonWarnDialog();
      }
      if (resp.activeSeason === 2 && !this.meta.data.seenSeason2) {
        this.meta.data.seenSeason2 = true; this.meta.save();
        this.showSeasonDialog();
      }
    }
    const list = document.getElementById('rivals-list');
    if (!list) return; // игрок ушёл из меню — прекращаем
    const me = this.meta.data.playerName;
    if (!top || !top.length) {
      // Офлайн/пусто — честно, без фейковых ботов. Показываем только свой рекорд.
      // Частая причина недоступности — заграничный VPN (сервер в РФ): трафик режется.
      let html = '<div class="rival offline"><span>⚠ Топ недоступен (VPN/нет связи)</span><span></span></div>';
      if (this.meta.data.bestScore > 0) {
        html += `<div class="rival me"><span>🐕 ${this._esc(me || 'ТЫ')}</span><span>${this.meta.data.bestScore.toLocaleString('ru')}</span></div>`;
      }
      list.innerHTML = html;
      // Авто-ретрай, пока игрок в меню: несколько попыток + мгновенно при возврате сети.
      // Так реальный топ подтянется сам, когда интернет/VPN «отпустит», без перезахода.
      if (attempt < 4) {
        clearTimeout(this._topRetryT);
        this._topRetryT = setTimeout(() => this._loadOnlineTop(attempt + 1), 4000 + attempt * 4000);
      }
      if (!this._onlineHandler) {
        this._onlineHandler = () => this._loadOnlineTop(0);
        window.addEventListener('online', this._onlineHandler);
      }
      return;
    }
    clearTimeout(this._topRetryT); // успех — гасим отложенные ретраи
    const withMe = top.some(r => r.name === me);
    const rows = top.slice(0, withMe ? 8 : 7);
    let html = rows.map((r, i) =>
      `<div class="rival ${r.name === me ? 'me' : ''}"><span>${i + 1}. ${r.name === me ? '🐕 ' : '🐶 '}${this._esc(r.name)}</span><span>${(r.score || 0).toLocaleString('ru')}</span></div>`).join('');
    if (!withMe && this.meta.data.bestScore > 0) {
      html += `<div class="rival me"><span>🐕 ${this._esc(me || 'ТЫ')}</span><span>${this.meta.data.bestScore.toLocaleString('ru')}</span></div>`;
    }
    list.innerHTML = html; // list уже получена и проверена выше
  }

  async showFullLeaderboard(period = 'all', season = null) {
    const el = document.getElementById('leaderboard');
    el.style.display = 'flex';
    const me = this.meta.data.playerName;
    const act = this._season ? this._season.act : 2;
    const cur = season || act; // какой сезон смотрим
    const hall = cur === 1 && act === 2; // режим «Зал славы»
    const tabs = [['all', 'Всё время'], ['week', 'Неделя'], ['day', 'Сегодня']];
    // Вкладки сезонов показываем только после старта Сезона 2 (до — существует лишь один борд)
    const seasonTabs = act === 2
      ? `<div class="lb-tabs lb-seasons">
           <button class="lb-tab ${cur === 2 ? 'on' : ''}" data-s="2">Сезон 2</button>
           <button class="lb-tab ${cur === 1 ? 'on' : ''}" data-s="1">🏆 Зал славы</button>
         </div>` : '';
    el.innerHTML = `
      <div class="lb-card">
        <div class="lb-title">${hall ? '🏆 Зал славы · Сезон 1' : '🏅 Онлайн-лидерборд'}</div>
        ${seasonTabs}
        ${hall ? '<div class="lb-hall-note">Легенды старого счёта — навсегда в истории</div>'
               : `<div class="lb-tabs">${tabs.map(([p, t]) => `<button class="lb-tab ${p === period ? 'on' : ''}" data-p="${p}">${t}</button>`).join('')}</div>`}
        <div class="lb-list" id="lb-list"><div class="lb-loading">Загрузка…</div></div>
        <button class="menu-btn" id="lb-close">Закрыть</button>
      </div>`;
    el.querySelector('#lb-close').addEventListener('click', () => { el.style.display = 'none'; el.innerHTML = ''; });
    for (const b of el.querySelectorAll('.lb-tab[data-p]')) b.addEventListener('click', () => this.showFullLeaderboard(b.dataset.p, cur));
    for (const b of el.querySelectorAll('.lb-tab[data-s]')) b.addEventListener('click', () => this.showFullLeaderboard('all', parseInt(b.dataset.s)));
    const top = await fetchTop(hall ? 'all' : period, 100, cur);
    const list = document.getElementById('lb-list');
    if (!list) return;
    if (!top || !top.length) { list.innerHTML = '<div class="lb-loading">Пока пусто — стань первым!</div>'; return; }
    const myIdx = top.findIndex(r => r.name === me);
    list.innerHTML = top.map((r, i) => `
      <div class="lb-row ${r.name === me ? 'me' : ''} ${i < 3 ? 'medal' : ''}">
        <span class="lb-rank">${['🥇','🥈','🥉'][i] || (i + 1)}</span>
        <span class="lb-name">${r.name === me ? '🐕 ' : ''}${this._esc(r.name)}</span>
        <span class="lb-score">${(r.score || 0).toLocaleString('ru')}</span>
        <span class="lb-dist">${(r.distance || 0).toLocaleString('ru')} м</span>
      </div>`).join('') +
      (myIdx < 0 && this.meta.data.bestScore > 0 ? `<div class="lb-row me"><span class="lb-rank">—</span><span class="lb-name">🐕 ${this._esc(me || 'ТЫ')}</span><span class="lb-score">${this.meta.data.bestScore.toLocaleString('ru')}</span><span class="lb-dist">${(this.meta.data.bestDistance||0).toLocaleString('ru')} м</span></div>` : '');
  }

  _esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

  // Мини-лоадер «собака выходит на старт» — пока догружается rigged-GLB (обычно <1 с)
  showDogLoading() {
    let el = document.getElementById('dog-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dog-loading';
      el.innerHTML = '<div class="dogload-card"><span class="dogload-paw">🐕</span> Собака выходит на старт…</div>';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  }

  hideDogLoading() {
    const el = document.getElementById('dog-loading');
    if (el) el.style.display = 'none';
  }

  // Предсезонное предупреждение (показывается при входе, один раз, пока идёт Сезон 1):
  // игрок узнаёт о завтрашнем сбросе рейтинга ДО того, как увидит пустой топ.
  showSeasonWarnDialog() {
    const el = document.createElement('div');
    el.id = 'season-dialog';
    el.innerHTML = `<div class="season-card">
      <div class="season-head">⏳ Завтра — Сезон 2!</div>
      <div class="season-body">
        <p>С полуночи стартует <b>новый сезон</b>: счёт станет честнее, а рейтинг <b>начнётся заново у всех</b>.</p>
        <p>Нынешний топ не пропадёт — он навсегда сохранится в <b>🏆 Зале славы</b> (вкладка «Топ»).</p>
        <p>Успей поставить рекорд Сезона 1 — сегодня последний день!</p>
      </div>
      <button class="menu-btn" id="season-ok">Понятно, бегу!</button>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('#season-ok').addEventListener('click', () => el.remove());
    track('season2_warn', {});
  }

  // Разовый диалог о старте Сезона 2: объясняет пустой рейтинг, Зал славы и компенсацию —
  // гасит негатив «куда делся мой топ». Показывается один раз (флаг seenSeason2).
  showSeasonDialog() {
    const comp = this.meta.data.s2comp || 0;
    const el = document.createElement('div');
    el.id = 'season-dialog';
    el.innerHTML = `<div class="season-card">
      <div class="season-head">🏁 Начался Сезон 2!</div>
      <div class="season-body">
        <p>Счёт стал <b>честнее</b>: множители подкручены, очки больше не раздуваются в сотни раз.</p>
        <p>Рейтинг начался заново — <b>у всех равный старт</b>. Твой личный рекорд пересчитан под новую шкалу.</p>
        <p>Топ Сезона 1 никуда не делся: он навсегда в <b>🏆 Зале славы</b> (вкладка «Топ»).</p>
        ${comp ? `<p class="season-comp">🎁 Компенсация за прокачанный множитель: <b>+${comp}🦴</b></p>` : ''}
      </div>
      <button class="menu-btn" id="season-ok">Вперёд, к новым рекордам!</button>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('#season-ok').addEventListener('click', () => el.remove());
    track('season2_dialog', { comp });
  }

  // Магазин косметики (sink для косточек). onChange — применить/обновить (пересоздать собаку).
  // Виджет недельного стрика заходов (loss-aversion крючок, панель «Задания»)
  _weekWidgetHtml(week) {
    const days = WEEK_REWARDS.map((rw, i) => {
      const idx = i + 1;
      const got = idx < week.dayIdx || (idx === week.dayIdx && week.claimed);
      const today = idx === week.dayIdx && !week.claimed;
      return `<div class="wday ${got ? 'got' : ''} ${today ? 'today' : ''}">
        <div class="wc">${idx === 7 ? '<span class="wbig">🎁</span>' : ''}<span class="wrw">${rw}</span>${idx === 7 ? '' : '🦴'}</div>
        <div class="wdl">${today ? 'сегодня' : 'д. ' + idx}</div>
      </div>`;
    }).join('');
    return `<div class="week-card">
      <div class="week-head">
        <span class="week-title">🔥 Серия заходов: ${week.streak} ${plural(week.streak, ['день', 'дня', 'дней'])}${week.frozen ? ' ❄' : ''}</span>
        <span class="wfreeze" title="Заморозка спасает серию при пропуске дня">❄ ${week.freezeLeft ? '1' : '0'}</span>
      </div>
      <div class="wdays">${days}</div>
      ${week.claimed
        ? '<div class="week-done">✓ Награда дня получена</div>'
        : `<button class="week-claim" id="week-claim">Забрать ${week.reward} 🦴</button>`}
    </div>`;
  }

  // Панель «Ачивки»: секции → карточки с ярусами/прогрессом/клеймом
  _achPanelHtml() {
    const list = this.meta.achievements();
    const card = (a) => {
      const d = a.def;
      const revealed = !d.hidden || a.tier > 0 || a.claimed > 0;
      const tierDots = [0, 1, 2].map(t =>
        `<span class="atier ${t < a.tier ? (t === 2 ? 'gold' : t === 1 ? 'silver' : 'bronze') : ''}"></span>`).join('');
      if (!revealed) {
        return `<div class="ach hidden-ach">
          <img src="./assets/ach/${d.icon}-t.webp" alt="" loading="lazy">
          <div class="ach-name">? ? ?</div>
          <div class="tiers">${tierDots}</div>
          <div class="ach-meta">${d.hint || 'Продолжай играть…'}</div>
        </div>`;
      }
      const unclaimed = a.claimable ? ACH_REWARDS.slice(a.claimed, a.tier).reduce((s, x) => s + x, 0) : 0;
      const excl = d.excl ? '<span class="ach-excl">эксклюзив</span>' : '';
      return `<div class="ach ${a.tier >= 3 ? 'done' : ''}" data-ach="${d.id}">
        ${excl}
        <img src="./assets/ach/${d.icon}-t.webp" alt="" loading="lazy">
        <div class="ach-name">${d.name}</div>
        <div class="tiers">${tierDots}</div>
        ${a.next != null
          ? `<div class="abar"><i style="width:${Math.floor(a.frac * 100)}%"></i></div>
             <div class="ach-meta">${fmtVal(d, a.value)} / ${fmtVal(d, a.next)} · +${ACH_REWARDS[a.tier]}🦴</div>`
          : `<div class="ach-meta gold-txt">${fmtVal(d, a.value)} · ЗОЛОТО</div>`}
        ${unclaimed ? `<button class="ach-claim" data-claim="${d.id}">Забрать ${unclaimed}🦴</button>` : ''}
      </div>`;
    };
    const total = list.length, goldDone = list.filter(a => a.tier >= 3).length;
    const stars = list.reduce((s, a) => s + a.tier, 0);
    return `<div class="ach-head-row">
        <span class="ach-count">🏆 ${goldDone} / ${total} · ★${stars}/${total * 3}</span>
      </div>
      ${ACH_SECTIONS.map(sec => {
        const items = list.filter(a => a.def.sec === sec.key);
        if (!items.length) return '';
        return `<div class="ach-sec">${sec.name}</div><div class="ach-grid">${items.map(card).join('')}</div>`;
      }).join('')}`;
  }

  showShop(onChange) {
    const el = document.getElementById('shop');
    if (!el) return;
    el.style.display = 'flex';
    track('shop_open', {});
    const swatch = (it) => '#' + (it.body != null ? it.body : it.color).toString(16).padStart(6, '0');
    const render = () => {
      const cat = catalog(), bal = this.meta.data.cookies || 0;
      const equip = this.meta.data.cosmeticsEquip || {};
      const itemHtml = (it) => {
        const owned = this.meta.ownsCosmetic(it.slot, it.id);
        const equipped = equip[it.slot] === it.id;
        const afford = bal >= it.price;
        const cls = equipped ? 'equipped' : (!owned && (it.excl || !afford) ? 'locked' : '');
        const status = equipped ? '✓ надето' : owned ? 'надеть'
          : it.excl ? '🏆 за ачивку' : `${it.price.toLocaleString('ru')} 🦴`;
        const col = equipped ? '#7fe056' : owned ? '#9adcff' : (afford ? RARITY[it.rarity].color : '#8a6a6a');
        // Ярлык редкости (кроме обычных) — чтобы ярусы читались, а легендарки манили.
        const rar = it.rarity !== 'common'
          ? `<span class="shop-rar" style="color:${RARITY[it.rarity].color}">${RARITY[it.rarity].name}</span>` : '';
        return `<div class="shop-item ${cls}" data-slot="${it.slot}" data-id="${it.id}">
          <div class="shop-sw" style="background:${swatch(it)}"></div>
          <div class="shop-info"><div class="shop-name">${this._esc(it.name)} ${rar}</div><div class="shop-meta" style="color:${col}">${status}</div></div>
        </div>`;
      };
      const coats = cat.filter(i => i.slot === 'coat'), necks = cat.filter(i => i.slot === 'neck');
      // Расходники: карточка на каждый CONSUMABLE с покупкой ×1/×5 (пачка со скидкой).
      const consHtml = Object.entries(CONSUMABLES).map(([key, c]) => {
        const own = this.meta.consumableCount(key);
        const b1 = bal >= c.price, b5 = bal >= c.pack5;
        return `<div class="cons-item">
          <div class="cons-ic">${c.emoji}</div>
          <div class="cons-info"><div class="shop-name">${this._esc(c.name)} <span class="cons-own">×${own}</span></div>
            <div class="cons-desc">${this._esc(c.desc)}</div></div>
          <div class="cons-buy">
            <button class="cons-b ${b1 ? '' : 'locked'}" data-cons="${key}" data-qty="1">×1 · <b>${c.price} 🦴</b></button>
            <button class="cons-b ${b5 ? '' : 'locked'}" data-cons="${key}" data-qty="5">×5 · <b>${c.pack5} 🦴</b></button>
          </div>
        </div>`;
      }).join('');
      el.innerHTML = `<div class="shop-card">
        <div class="shop-head"><span class="shop-title">🛍 Магазин</span><span class="shop-bal">🦴 ${bal.toLocaleString('ru')}</span></div>
        <div class="shop-body">
          <div class="shop-sec">🎒 Расходники</div><div class="shop-cons">${consHtml}</div>
          <div class="shop-sec">🎨 Окрасы</div><div class="shop-grid">${coats.map(itemHtml).join('')}</div>
          <div class="shop-sec">🧣 Банданы</div><div class="shop-grid">${necks.map(itemHtml).join('')}</div>
        </div>
        <button class="menu-btn shop-close" id="shop-close">Закрыть</button>
      </div>`;
      for (const btn of el.querySelectorAll('.cons-b')) {
        btn.addEventListener('click', () => {
          const qty = +btn.dataset.qty;
          if (this.meta.buyConsumable(btn.dataset.cons, qty)) {
            track('consumable_buy', { item: btn.dataset.cons, qty });
            if (onChange) onChange();
            render();
          } else {
            btn.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 });
          }
        });
      }
      for (const node of el.querySelectorAll('.shop-item')) {
        node.addEventListener('click', () => {
          const { slot, id } = node.dataset;
          if (this.meta.ownsCosmetic(slot, id)) {
            this.meta.toggleCosmetic(slot, id);
          } else if (this.meta.buyCosmetic(slot, id)) {
            track('cosmetic_buy', { item: `${slot}:${id}`, price: priceOf(slot, id) });
          } else {
            node.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 });
            return; // не хватает косточек
          }
          if (onChange) onChange();
          render();
        });
      }
      el.querySelector('#shop-close').addEventListener('click', () => {
        el.style.display = 'none'; el.innerHTML = '';
        if (onChange) onChange();
      });
    };
    render();
  }

  showOnlineRank(rank) {
    // Короткий тост о месте в мировом топе
    while (this.missionToast.children.length >= 2) this.missionToast.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'mission-complete';
    el.innerHTML = `🏅 Твоё место в онлайн-топе: <b>#${rank}</b>`;
    this.missionToast.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // Результат не засчитан онлайн-топом — раньше это было молчаливо, игрок не понимал причину.
  showSubmitNote(reason) {
    const RU = {
      'bad distance': 'слишком длинный забег (чиним) — обнови игру',
      'implausible score': 'счёт не прошёл проверку',
      'stale ts': 'сбились часы устройства',
      'bad sig': 'ошибка подписи результата',
      'slow down': 'слишком часто — попробуй позже',
      'bad score': 'некорректный счёт',
    };
    const msg = RU[reason] || 'не удалось отправить результат';
    while (this.missionToast.children.length >= 2) this.missionToast.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'mission-complete';
    el.innerHTML = `⚠️ Результат не засчитан: ${msg}`;
    this.missionToast.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  hideMenu() {
    this.menuEl.style.display = 'none';
    this.hud.style.display = 'block';
    // Сброс HUD на новый забег: иначе тикающий счёт «стекает» с прошлого значения к 0,
    // а кэш диффинга держит старые значения (пере-запишутся, но счёт мигал бы).
    this._displayScore = 0;
    this._hud = {};
    // Гасим отложенные ретраи онлайн-топа и снимаем слушатель сети — иначе утекают
    // и пишут в уже несуществующий DOM, а поколение (_topGen) отбрасывает поздние ответы.
    this._topGen = (this._topGen || 0) + 1;
    clearTimeout(this._topRetryT);
    this._topRetryT = null;
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler);
      this._onlineHandler = null;
    }
  }

  _showVersion() {
    const el = document.getElementById('version-badge');
    if (!el) return;
    el.innerHTML = `<span>${APP_VERSION}</span> <button id="force-update" title="Сбросить кэш и загрузить свежую версию">⟳ обновить</button> <button id="diag-btn" title="Отправить диагностику, если лидерборд или игра барахлят">🩺</button>`;
    const btn = document.getElementById('force-update');
    if (btn) btn.onclick = async () => {
      btn.textContent = '⟳ …';
      try {
        if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
        if (navigator.serviceWorker) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); }
      } catch (e) {}
      // Уходим на URL с параметром — обходит HTTP-кэш index.html
      location.href = location.pathname + '?fresh=' + Date.now();
    };
    const diag = document.getElementById('diag-btn');
    if (diag) diag.onclick = async () => {
      diag.textContent = '🩺 …';
      try {
        const { sendDiagnostics } = await import('./diag.js');
        const r = await sendDiagnostics();
        const verdict = r.problems.length ? 'Вероятная причина: ' + r.problems.join('; ') : 'Явных проблем не видно';
        diag.textContent = '✓ отправлено';
        window.alert('Спасибо! Диагностика отправлена нам на сервер.\n\n' + verdict);
      } catch (e) {
        diag.textContent = '🩺';
        window.alert('Не удалось отправить диагностику: ' + String(e).slice(0, 80));
      }
    };
  }

  showPause(onResume, onQuit) {
    const el = document.getElementById('pause');
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="pause-card">
        <div class="pause-head">ПАУЗА</div>
        <button class="start-btn" id="pause-resume">ПРОДОЛЖИТЬ</button>
        <button class="menu-btn" id="pause-quit">В МЕНЮ</button>
      </div>`;
    el.querySelector('#pause-resume').addEventListener('click', onResume);
    el.querySelector('#pause-quit').addEventListener('click', onQuit);
  }

  hidePause() {
    const el = document.getElementById('pause');
    el.style.display = 'none';
    el.innerHTML = '';
  }

  async countdown() {
    this.countdownEl.style.display = 'flex';
    for (const t of ['3', '2', '1', 'ГОУ!']) {
      this.countdownEl.innerHTML = `<div class="count-num">${t}</div>`;
      await new Promise(r => setTimeout(r, t === 'ГОУ!' ? 500 : 650));
    }
    this.countdownEl.style.display = 'none';
  }

  // Мгновенный вариант для харнесса
  countdownInstant() { this.countdownEl.style.display = 'none'; }

  // «Судья прощает?» — оффер revive с тающим таймером
  showRevive(price, tokens, onAccept, onDecline) {
    const el = document.getElementById('revive');
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="revive-card">
        <div class="revive-head">Судья готов простить фолт</div>
        <div class="revive-timer"><i id="revive-fill"></i></div>
        <button class="start-btn" id="revive-yes">ПРОДОЛЖИТЬ — ${price} 🏵</button>
        <div class="revive-tokens">у тебя: ${tokens} 🏵</div>
        <button class="menu-btn" id="revive-no">Сдаться</button>
      </div>`;
    el.querySelector('#revive-yes').addEventListener('click', onAccept);
    el.querySelector('#revive-no').addEventListener('click', onDecline);
  }

  updateReviveTimer(k) {
    const f = document.getElementById('revive-fill');
    if (f) f.style.width = Math.round(k * 100) + '%';
  }

  hideRevive() {
    const el = document.getElementById('revive');
    el.style.display = 'none';
    el.innerHTML = '';
  }

  // Обучение «за руку» (первая сессия): при подходе к новому снаряду игра замедляется,
  // а поверх экрана большая белая полупрозрачная ЛАПА делает жест (dir: up|down|side|tap) —
  // как ghost-hand в Subway Surfers, без текста. На десктопе — капсула нужной клавиши.
  showTutHint(name, dir, label, isTouch) {
    const el = document.getElementById('tut-hint');
    if (!el) return;
    // Лапа + ТЕКСТ ЖЕСТА всегда (FTUE-аудит: жест без слов новичок трактует неверно)
    el.innerHTML = isTouch
      ? `<img class="th-paw th-${dir}" src="./assets/paw-hint.png" alt=""><div class="th-label">${this._esc(label)}</div>`
      : `<div class="th-keys th-${dir}">${this._esc(label)}</div>`;
    el.style.display = 'flex';
  }

  // Баннер блокирующего обучения: крупный заголовок шага + подсказка, вверху экрана
  showFtueBanner(title, sub) {
    let el = document.getElementById('ftue-banner');
    if (!el) return;
    el.innerHTML = `<div class="fb-title">${this._esc(title)}</div><div class="fb-sub">${this._esc(sub)}</div>`;
    el.style.display = 'flex';
  }

  hideFtueBanner() {
    const el = document.getElementById('ftue-banner');
    if (el) el.style.display = 'none';
  }

  // Кнопка «Пропустить обучение»: видна весь тутор, обработчик задаёт game
  showFtueSkip(onSkip) {
    const el = document.getElementById('ftue-skip');
    if (!el) return;
    el.style.display = 'block';
    el.onclick = () => { onSkip && onSkip(); };
  }

  // Плашка судьи: игроки не понимали механику проигрыша («жизней» нет — есть судья)
  setJudgeWarn(judgeT) {
    const el = document.getElementById('judge-warn');
    if (!el) return;
    const on = judgeT > 0;
    if (on !== this._judgeOn) {
      this._judgeOn = on;
      el.style.display = on ? 'flex' : 'none';
      if (!on) el.classList.remove('rule');
    }
    if (on) {
      const secs = Math.ceil(judgeT);
      if (secs !== this._judgeSecs) {
        this._judgeSecs = secs;
        el.querySelector('.jw-t').textContent = `⚠ СУДЬЯ СЛЕДИТ — без ошибок ${secs} с`;
      }
    }
  }

  // Первый фолт: расширенное правило (текст, без паузы — решение владельца)
  showJudgeRule() {
    const el = document.getElementById('judge-warn');
    if (!el) return;
    el.classList.add('rule');
    const r = el.querySelector('.jw-rule');
    if (r) r.textContent = 'ФОЛТ! За ошибку выбегает судья. Ещё одна ошибка, пока он рядом, — дисквалификация!';
    setTimeout(() => el.classList.remove('rule'), 6000);
  }

  hideFtueSkip() {
    const el = document.getElementById('ftue-skip');
    if (el) { el.style.display = 'none'; el.onclick = null; }
  }

  hideTutHint() {
    const el = document.getElementById('tut-hint');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  setRecordMode(on) {
    this.scoreEl.classList.toggle('gold', !!on);
  }

  updateHUD(state) {
    // HUD-диффинг: обновляем DOM только при смене значения (updateHUD зовётся 60×/с) —
    // раньше каждый кадр перезаписывались textContent/стили и innerHTML пауэрапов (jank).
    const h = this._hud || (this._hud = {});
    // Счёт тикает к фактическому — textContent только при смене целого
    this._displayScore += (state.score - this._displayScore) * 0.2;
    if (Math.abs(state.score - this._displayScore) < 2) this._displayScore = state.score;
    const sc = Math.floor(this._displayScore);
    if (sc !== h.score) {
      h.score = sc;
      const txt = sc.toLocaleString('ru');
      this.scoreEl.textContent = txt;
      // Авто-сжатие: 8+ цифр (10 млн+) не влезают в ряд с бейджем ×N и комбо слева
      const size = txt.length > 11 ? 'xl' : txt.length > 9 ? 'lg' : '';
      if (size !== h.scoreSize) { h.scoreSize = size; this.scoreEl.classList.toggle('lg', size === 'lg'); this.scoreEl.classList.toggle('xl', size === 'xl'); }
    }
    if (state.cookies !== h.cookies) { h.cookies = state.cookies; this.cookieEl.textContent = '🦴 ' + state.cookies; }
    const tokEl = this._tokEl || (this._tokEl = document.getElementById('tokens'));
    if (tokEl && state.tokens !== h.tokens) {
      h.tokens = state.tokens;
      tokEl.style.display = state.tokens > 0 ? 'block' : 'none';
      tokEl.textContent = '🏵 ' + state.tokens;
    }
    const multEl = this._multEl || (this._multEl = document.getElementById('mult'));
    if (multEl && state.metaMult !== h.mult) {
      h.mult = state.metaMult;
      multEl.style.display = state.metaMult > 1 ? 'block' : 'none';
      multEl.textContent = '×' + state.metaMult;
    }
    // Комбо: видимость/число/hot — диффим; полоска прогресса меняется каждый кадр (её оставляем)
    const comboVis = state.combo > 1;
    if (comboVis !== !!h.comboVis) { h.comboVis = comboVis; this.comboEl.style.display = comboVis ? 'block' : 'none'; }
    if (comboVis) {
      if (state.combo !== h.combo) { h.combo = state.combo; this.comboEl.querySelector('.combo-num').textContent = '×' + state.combo; }
      this.comboFill.style.width = Math.min(100, state.comboFresh * 100) + '%';
      const hot = state.combo >= 10;
      if (hot !== h.comboHot) { h.comboHot = hot; this.comboEl.classList.toggle('hot', hot); }
    }
    // «Связка» (F2): пилюля прогресса n/len, пока игрок внутри активной связки (диффим)
    const chainVis = state.chainN > 0;
    if (chainVis !== !!h.chainVis) { h.chainVis = chainVis; this.chainEl.style.display = chainVis ? 'block' : 'none'; }
    if (chainVis) {
      const ct = state.chainN + '/' + state.chainLen;
      if (ct !== h.chainTxt) { h.chainTxt = ct; this.chainTxt.textContent = '🔗 СВЯЗКА ' + ct; }
    }
    // Пауэрапы: ПОСТОЯННЫЕ узлы (создаём один раз), меняем только видимость и ширину полоски —
    // без пересборки innerHTML каждый кадр.
    if (!this._pwNodes) {
      this._pwNodes = {};
      const icons = { magnet: '🧲', shield: '🛡', rocket: '🥏', multi: '✨', tug: '🟣', table: '⚡' };
      for (const k of BOOST_KEYS) {
        const div = document.createElement('div'); div.className = 'pw' + (k === 'tug' ? ' pw-tug' : ''); div.style.display = 'none';
        div.innerHTML = `<span>${icons[k]}</span><i></i><em></em>`;
        this._pwNodes[k] = { div, bar: div.querySelector('i'), sec: div.querySelector('em'), shown: false, secTxt: '' };
        this.powerupsEl.appendChild(div);
      }
    }
    // Значения бустов: пауэрапы из powerups[], тягач/стол — из своих таймеров.
    const bv = (k) => k === 'tug' ? [state.tugT || 0, state.tugMax || 1]
      : k === 'table' ? [state.tableBoostT || 0, state.tableBoostMax || 1]
        : [state.powerups[k], state.powerupMax[k]];
    for (const k of BOOST_KEYS) {
      const [v, max] = bv(k), node = this._pwNodes[k];
      const show = v > 0;
      if (show !== node.shown) { node.shown = show; node.div.style.display = show ? '' : 'none'; }
      if (show) {
        node.bar.style.width = Math.min(100, v / max * 100) + '%';
        const secTxt = max > 1.5 ? Math.ceil(v) + 'с' : ''; // отсчёт секунд рядом с иконкой (щит — мгновенный)
        if (secTxt !== node.secTxt) { node.secTxt = secTxt; node.sec.textContent = secTxt; }
      }
    }
    // Кнопка активации тягача: показываем когда есть в наличии ИЛИ активен; класс on (активен)/off (нет заряда).
    const tugBox = this._tugBox || (this._tugBox = document.getElementById('tug-box'));
    const tugBtn = this._tugBtn || (this._tugBtn = document.getElementById('tug-btn'));
    if (tugBox && tugBtn) {
      const cnt = state.tugCount || 0, active = (state.tugT || 0) > 0;
      const vis = cnt > 0 || active;
      if (vis !== h.tugVis) { h.tugVis = vis; tugBox.style.display = vis ? 'flex' : 'none'; }
      if (vis) {
        // Кнопка показывает ЧИСЛО пуллеров (не время — время только у иконки эффекта слева вверху).
        const label = String(cnt);
        if (label !== h.tugLbl) { h.tugLbl = label; tugBtn.querySelector('b').textContent = label; }
        if (active !== h.tugOn) { h.tugOn = active; tugBtn.classList.toggle('on', active); }
        const off = cnt <= 0 && !active;
        if (off !== h.tugOff) { h.tugOff = off; tugBtn.classList.toggle('off', off); }
        // Подсказка новичку: купил, ни разу не активировал → «тап сюда» (палец + кольцо).
        const hint = !!state.tugHint && !active;
        if (hint !== h.tugHint) { h.tugHint = hint; tugBox.classList.toggle('hint', hint); }
      }
    }
    // Виньетка/спидлайны — диффим
    const dOp = state.danger ? 0.5 : 0;
    if (dOp !== h.danger) { h.danger = dOp; this.vignette.style.opacity = dOp; }
    // Спидлайны только на бусте: статичный градиент не кодирует скорость (feel-ревью);
    // ощущение скорости дают near-field объекты и поперечный ритм пола.
    const sOp = state.boost ? 0.6 : 0;
    if (sOp !== h.boost) { h.boost = sOp; this.speedlines.style.opacity = sOp; }
  }

  // Летящая к счётчику косточка + панч счётчика
  flyCookie(from) {
    // Троттлинг: при магните/пуллере печеньки сыпятся 10+/с — каждый вызов делал
    // create DOM + getBoundingClientRect + форс-reflow → фризы «будто 15 fps» на
    // телефоне (жалоба). Летящую косточку рисуем не чаще раза в 130 мс, цель кэшируем.
    const now = performance.now();
    if (this._flyLast && now - this._flyLast < 130) return;
    this._flyLast = now;
    if (!this._flyTarget || now - (this._flyTargetAt || 0) > 1500) {
      this._flyTarget = this.cookieEl.getBoundingClientRect();
      this._flyTargetAt = now;
    }
    const target = this._flyTarget;
    const el = document.createElement('div');
    el.className = 'fly-bone';
    el.textContent = '🦴';
    el.style.left = from.x + '%';
    el.style.top = from.y + '%';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.left = (target.left + target.width * 0.2) + 'px';
      el.style.top = target.top + 'px';
      el.style.opacity = '0.15';
      el.style.transform = 'scale(0.5)';
    });
    setTimeout(() => {
      el.remove();
      // Пунч счётчика без форс-reflow (offsetWidth дёргал layout на каждую косточку)
      if (!this.cookieEl.classList.contains('punch')) this.cookieEl.classList.add('punch');
      else {
        this.cookieEl.style.animation = 'none';
        requestAnimationFrame(() => { this.cookieEl.style.animation = ''; });
      }
    }, 380);
  }

  scorePunch() {
    this.scoreEl.classList.remove('punch');
    void this.scoreEl.offsetWidth;
    this.scoreEl.classList.add('punch');
  }

  flash(color = 'rgba(255,255,255,0.5)') {
    // Вход 30 мс / уход 180 мс. Раньше единый transition 0.25s не успевал разогнать
    // opacity за 60 мс до снятия — «вспышка» достигала ~12% яркости и не существовала.
    this.flashEl.style.transition = 'opacity 0.03s';
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = 1;
    setTimeout(() => {
      this.flashEl.style.transition = 'opacity 0.18s';
      this.flashEl.style.opacity = 0;
    }, 70);
  }

  missionComplete(def) {
    // Не больше двух плашек одновременно — старые убираем
    while (this.missionToast.children.length >= 2) this.missionToast.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'mission-complete';
    // Одна строка и короткий показ: плашка не должна долго висеть над трассой
    el.innerHTML = `🎯 ${def.text} <b>+${def.reward}🦴</b>`;
    this.missionToast.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  rewardFlight(count, fromEl) {
    // Облако DOM-косточек рассыпается у карточки и летит к счётчику баланса
    const target = fromEl || this.overEl.querySelector('.over-head');
    if (!target) return;
    const tr = target.getBoundingClientRect();
    const n = Math.min(18, Math.max(6, Math.round(count / 20)));
    const cx = tr.left + tr.width / 2, cy = tr.top + tr.height + 20;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'fly-bone';
      el.textContent = '🦴';
      (this._flyBones = this._flyBones || []).push(el);
      const ang = (i / n) * Math.PI * 2, r = 30 + Math.random() * 40;
      el.style.left = (cx + Math.cos(ang) * r) + 'px';
      el.style.top = (cy + Math.sin(ang) * r * 0.6) + 'px';
      document.body.appendChild(el);
      // Пауза-зависание, потом полёт к цели со стаггером
      setTimeout(() => {
        const bal = this.overEl.querySelector('.reward-target');
        const bt = bal ? bal.getBoundingClientRect() : { left: cx, top: cy };
        el.style.left = bt.left + 'px';
        el.style.top = bt.top + 'px';
        el.style.opacity = '0.1';
        el.style.transform = 'scale(0.4)';
      }, 250 + i * 35);
      setTimeout(() => { el.remove(); const k = this._flyBones?.indexOf(el); if (k >= 0) this._flyBones.splice(k, 1); }, 250 + i * 35 + 450);
    }
  }

  showGameOver(runStats, completedMissions, meta, onRestart, onMenu) {
    this.hud.style.display = 'none';
    this.hidePause();
    this.overEl.style.display = 'flex';
    const title = meta.title();
    const isRecord = runStats.score >= meta.data.bestScore && runStats.score > 0;
    const missions = meta.activeMissions();
    const missionRows = missions.map(m => {
      const cur = Math.min(Math.floor(runStats[m.stat] || 0), m.target);
      const doneNow = completedMissions.some(c => c.id === m.id);
      const pc = doneNow ? 100 : Math.floor(cur / m.target * 100);
      return `<div class="over-mission-row ${doneNow ? 'done' : ''}">
        <div class="mission-line">${doneNow ? '✅' : '🎯'} ${m.text} <span>${doneNow ? `+${m.reward}🦴` : `${cur} / ${m.target}`}</span></div>
        <div class="mission-bar"><i style="width:${pc}%"></i></div>
      </div>`;
    }).join('');
    const doneRows = completedMissions
      .filter(c => !missions.some(m => m.id === c.id))
      .map(c => `<div class="over-mission-row done"><div class="mission-line">✅ ${c.text} <span>+${c.reward}🦴</span></div></div>`)
      .join('');
    this.overEl.innerHTML = `
      <div class="over-card">
        <div class="over-head">${isRecord ? '🏆 НОВЫЙ РЕКОРД!' : 'ФИНИШ'}</div>
        <div class="rosette-big">${rosetteSVG(title.current.color, 62)}</div>
        <div class="over-score">${runStats.score.toLocaleString('ru')}</div>
        <div class="over-grid">
          <div><b>${Math.floor(runStats.distance)}</b> м</div>
          <div><b>×${runStats.maxCombo}</b> макс. комбо</div>
          <div><b>${runStats.perfects}</b> ${plural(runStats.perfects, ['перфект', 'перфекта', 'перфектов'])}</div>
          <div><b>${runStats.cleanObstacles}</b> ${plural(runStats.cleanObstacles, ['снаряд', 'снаряда', 'снарядов'])}</div>
          <div><b>${runStats.faults}</b> ${plural(runStats.faults, ['фолт', 'фолта', 'фолтов'])}</div>
          <div class="reward-target"><b>+${runStats.cookies}</b> 🦴 в копилку</div>
        </div>
        ${(!isRecord && meta.data.bestDistance > 0 && runStats.distance < meta.data.bestDistance)
          ? `<div class="near-miss">До рекорда дистанции не хватило <b>${Math.ceil(meta.data.bestDistance - runStats.distance)} м</b>
             <div class="mission-bar"><i style="width:${Math.floor(runStats.distance / meta.data.bestDistance * 100)}%"></i></div></div>`
          : ''}
        <div class="over-missions">${doneRows}${missionRows}</div>
        <div class="title-row">
          <span class="rosette">${rosetteSVG(title.current.color, 34)}</span>
          <div>
            <div class="title-name">${title.current.name}</div>
            <div class="title-bar"><i style="width:${Math.floor(title.progress * 100)}%"></i></div>
            ${title.next
              ? `<div class="title-next">${meta.data.bestScore.toLocaleString('ru')} / ${title.next.need.toLocaleString('ru')} · до «${title.next.gen}» осталось ${(title.next.need - meta.data.bestScore).toLocaleString('ru')}</div>`
              : '<div class="title-next">Максимальный титул!</div>'}
          </div>
        </div>
        <div class="over-btns">
          <button class="start-btn" id="again-btn">ЕЩЁ ЗАБЕГ</button>
          <button class="menu-btn" id="menu-btn">МЕНЮ</button>
        </div>
        ${IS_VK ? '<button class="menu-btn share-vk" id="share-vk-btn">📢 Поделиться результатом</button>' : ''}
        <a class="diary-link" id="diary-link" href="https://vk.com/chloe.myaussie" target="_blank" rel="noopener">🐾 Понравилось? Хлоя ведёт дневник <span class="vk">ВКонтакте ›</span></a>
      </div>`;
    this.overEl.querySelector('#again-btn').addEventListener('click', onRestart);
    this.overEl.querySelector('#menu-btn').addEventListener('click', onMenu);
    this.overEl.querySelector('#diary-link').addEventListener('click', () => track('diary_click', { from: 'gameover' }));
    const shareBtn = this.overEl.querySelector('#share-vk-btn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      track('vk_share', { from: 'gameover' });
      shareScore(Math.round(runStats.distance || 0), Math.round(runStats.score || 0));
    });
    if (runStats.cookies > 0) setTimeout(() => this.rewardFlight(runStats.cookies), 500);
  }

  hideGameOver() {
    this.overEl.style.display = 'none';
    for (const el of (this._flyBones || [])) el.remove();
    this._flyBones = [];
  }
}
