/* Kardias Cunda — site davranışları.
   Tüm içerik (menü, galeri, yorumlar, etkinlikler, odalar, iletişim bilgileri, metinler) yönetim panelinden gelir:
   sunucu bu veriyi sayfaya <script id="site-data"> olarak gömer; yoksa /api/site adresinden, sunucu da yoksa
   (GitHub Pages önizlemesi) "npm run export-static" ile üretilen data/site.json dosyasından alınır. */
(() => {
  "use strict";

  const dataEl = document.getElementById("site-data");
  // no-cache: panelde yapılan değişiklik (GitHub Pages yeniden yayınlayınca) eski kopya beklenmeden görünsün
  const getJson = url => fetch(url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  if (dataEl) boot(JSON.parse(dataEl.textContent), false);
  else {
    getJson("api/site")
      .then(d => [d, false], () => getJson("data/site.json").then(d => [d, true]))
      .then(([d, isStatic]) => boot(d, isStatic))
      .catch(() => {
        const app = document.getElementById("menuApp");
        if (app) app.innerHTML = `<p class="menu-empty">${window.I18N.ui.tr.menuError}</p>`;
      });
  }

// isStatic: sunucu yok (GitHub Pages önizlemesi) — yönetim paneli bağlantısı gizlenir
function boot(SITE, isStatic) {
  /* ============ AYARLAR — yönetim panelinden ============ */
  const S = SITE.settings || {};
  const CONFIG = {
    phone: S.phone,
    whatsapp: S.whatsapp,             // WhatsApp hattı (ülke koduyla, + ve boşluk olmadan)
    instagram: S.instagram,
    openTime: S.openTime || "14:00", closeTime: S.closeTime || "00:00",
    firstBooking: S.firstBooking || "14:00", lastBooking: S.lastBooking || "23:00",   // rezervasyon saat seçenekleri
    sendWhatsapp: S.sendWhatsapp !== false
  };
  const GALLERY = SITE.gallery || [];
  const REVIEWS = SITE.reviews || [];
  const ROOMS = SITE.rooms || [];
  const TEXTS = SITE.texts || {};

  /* ============ Yardımcılar ============ */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Görsel: Unsplash kimliği (photo-...) ya da kendi dosya yolunuz (ör. img/menu/pizza.jpg)
  const img = (id, w) => /^photo-/.test(id) ? `https://images.unsplash.com/${id}?w=${w}&q=70&auto=format&fit=crop` : `${id}?w=${w}`;
  const fold = s => String(s).toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, c => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]));

  let saved = null;
  try { saved = localStorage.getItem("kardias-lang"); } catch (e) { /* storage yok */ }
  // Kayıtlı tercih yoksa: Türkçe tarayıcıya TR, diğerlerine EN
  let lang = saved || ((navigator.language || "tr").toLowerCase().startsWith("tr") ? "tr" : "en");
  const ui = () => window.I18N.ui[lang];
  const t = v => (v && typeof v === "object") ? (v[lang] ?? v.tr) : (v ?? "");

  const waLink = text => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
  const openWa = text => window.open(waLink(text), "_blank", "noopener");

  // Panel → Bölümleri göster / gizle: kapatılan bölüm görünmez olur, ona giden bağlantılar kaldırılır
  const SECTION_IDS = { showStory: "hikaye", showMenu: "menu", showEvents: "etkinlikler", showGallery: "galeri", showStay: "konaklama",
    showReviews: "yorumlar", showReservation: "rezervasyon", showContact: "iletisim" };
  Object.entries(SECTION_IDS).forEach(([key, id]) => {
    if (S[key] !== false) return;
    document.getElementById(id).hidden = true;
    $$(`a[href="#${id}"]`).forEach(a => a.remove());
  });
  $("#adminLink").hidden = !!isStatic;

  /* ============ Dil ============ */
  // Panelde düzenlenen metinler: Türkçesi sayfaya, İngilizcesi çeviri sözlüğüne yazılır
  const decodeHtml = s => { const x = document.createElement("textarea"); x.innerHTML = s; return x.value; };
  $$("[data-i18n]").forEach(el => { const v = TEXTS[el.dataset.i18n]; if (v) el.innerHTML = v.tr; });
  $$("[data-i18n-placeholder]").forEach(el => { const v = TEXTS[el.dataset.i18nPlaceholder]; if (v) el.placeholder = decodeHtml(v.tr); });
  Object.entries(TEXTS).forEach(([k, v]) => {
    if (v.en) window.I18N.en[k] = $(`[data-i18n-placeholder="${k}"]`) ? decodeHtml(v.en) : v.en;
    else delete window.I18N.en[k];
  });

  const trCache = new Map();
  $$("[data-i18n]").forEach(el => trCache.set(el, el.innerHTML));
  $$("[data-i18n-placeholder]").forEach(el => el.dataset.trPlaceholder = el.placeholder);

  function applyLang() {
    const dict = window.I18N.en;
    document.documentElement.lang = lang;
    $$("[data-i18n]").forEach(el => {
      const key = el.dataset.i18n;
      el.innerHTML = lang === "en" && dict[key] ? dict[key] : trCache.get(el);
    });
    $$("[data-i18n-placeholder]").forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      el.placeholder = lang === "en" && dict[key] ? dict[key] : el.dataset.trPlaceholder;
    });
    $$(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    try { localStorage.setItem("kardias-lang", lang); } catch (e) { /* storage yok */ }
  }

  $$(".lang button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    applyLang();
    renderMenu();
    renderSetMenu();
    renderGallery();
    renderEvents();
    renderRooms();
    renderNotice();
    fillGuestOptions();
    updateLiveInfo();
    renderRibbons();
  }));

  /* ============ Navigasyon ============ */
  const progress = $("#navProgress");
  const nav = $("#nav"), burger = $("#burger"), navMenu = $("#navMenu"), mobileBar = $(".mobile-bar");
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("is-scrolled", y > 40);
    mobileBar.classList.toggle("is-visible", y > window.innerHeight * 0.5);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const setMenuOpen = open => {
    burger.setAttribute("aria-expanded", String(open));
    navMenu.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
  };
  burger.addEventListener("click", () => setMenuOpen(burger.getAttribute("aria-expanded") !== "true"));
  $$("a", navMenu).forEach(a => a.addEventListener("click", () => setMenuOpen(false)));
  // Mobil panel açıkken karartılmış arka plana dokunmak menüyü kapatır
  nav.addEventListener("click", e => { if (e.target === nav && document.body.classList.contains("menu-open")) setMenuOpen(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") setMenuOpen(false); });

  // Aktif bölüm vurgusu
  const navLinks = $$(".nav__menu > a:not(.btn)");
  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach(a => { const s = $(a.getAttribute("href")); if (s) sectionObserver.observe(s); });

  /* ============ Kaydırınca beliren bölümler ============ */
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      el.classList.add("is-visible");
      revealObserver.unobserve(el);
      // belirme bitince gecikmeyi kaldır; yoksa hover efektleri de gecikir
      if (el.style.transitionDelay) setTimeout(() => { el.style.transitionDelay = ""; }, 1500);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  // Yan yana beliren öğeler sırayla (kademeli) gelsin
  const observeReveal = root => $$(".reveal:not(.is-visible)", root).forEach(el => {
    const sibs = [...el.parentElement.children].filter(c => c.classList.contains("reveal"));
    const i = sibs.indexOf(el);
    if (i > 0) el.style.transitionDelay = Math.min(i, 5) * 90 + "ms";
    revealObserver.observe(el);
  });

  /* ============ Menü ============
     Sayfada: Mutfak / Bar kategori kartları ve arama sonuçları.
     Bir kategoriye dokununca sağdan kayan panel (drawer) açılır; adres #menu/<id> olur,
     tarayıcının geri tuşu paneli kapatır. */
  const MENU = SITE.menu;
  const state = { q: "", diets: new Set() };
  const DIET_FILTERS = ["vejetaryen", "vegan", "glutensiz", "acili"];
  const app = $("#menuApp"), searchEl = $("#menuSearch");
  const drawer = $("#menuDrawer"), drawerPanel = $(".drawer__panel", drawer), drawerContent = $("#drawerContent");

  const priceFmt = n => new Intl.NumberFormat("tr-TR").format(n) + " " + (MENU.currency || "₺");
  // Panel → Menü ayarları → "Fiyatları göster" kapalıysa sitede hiçbir fiyat gösterilmez (fiyatlar silinmez)
  const showPrices = () => MENU.showPrices !== false;
  const catById = id => MENU.categories.find(c => c.id === id);
  const sectionOf = c => MENU.sections.find(s => s.id === c.section) || MENU.sections[0];
  const catsIn = s => MENU.categories.filter(c => c.section === s.id);
  const countLabel = n => `${n} ${n === 1 ? ui().item : ui().items}`;

  function shortPrice(it) {
    if (!showPrices()) return "";
    if (it.priceText) return t(it.priceText);
    if (it.prices) return ui().from(priceFmt(Math.min(...it.prices.map(p => p.price))));
    return it.price != null ? priceFmt(it.price) : "";
  }

  // Ürün kartı: solda fotoğraf, sağda ad / açıklama / fiyat / etiketler
  function itemHTML(it, cat) {
    const tags = (it.soldOut ? `<span class="tag tag--out">${esc(ui().soldOut)}</span>` : "") +
      (it.tags || []).map(tg => `<span class="tag tag--${tg}">${esc(ui().tags[tg] || tg)}</span>`).join("");
    const single = it.prices || !showPrices() ? "" : it.priceText ? esc(t(it.priceText)) : it.price != null ? priceFmt(it.price) : "";
    const prices = it.prices && showPrices()
      ? `<div class="item__prices">${it.prices.map(p => `<span class="item__pchip">${esc(t(p.label))}<b>${priceFmt(p.price)}</b></span>`).join("")}</div>`
      : "";
    const pic = it.image || cat.image;
    return `<article class="item${it.soldOut ? " is-out" : ""}" data-item="${cat.id}:${cat.items.indexOf(it)}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="${esc(t(it.name))}">
      <div class="item__media">
        <img src="${img(pic, 220)}&h=220" srcset="${img(pic, 220)}&h=220 1x, ${img(pic, 440)}&h=440 2x" width="110" height="110" loading="lazy" decoding="async" alt="${esc(t(it.name))}">
        ${(it.tags || []).includes("sef") ? `<span class="item__badge" title="${esc(ui().tags.sef)}">✦</span>` : ""}
      </div>
      <div class="item__body">
        <div class="item__top">
          <h4 class="item__name">${esc(t(it.name))}</h4>
          ${single ? `<span class="item__price">${single}</span>` : ""}
        </div>
        ${it.meta ? `<p class="item__meta">${esc(it.meta)}</p>` : ""}
        ${it.desc ? `<p class="item__desc">${esc(t(it.desc))}</p>` : ""}
        ${prices}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>
    </article>`;
  }

  function itemsHTML(items, cat) {
    let html = "", lastGroup = null;
    items.forEach(it => {
      const g = it.group ? t(it.group) : null;
      if (g && g !== lastGroup) { html += `<h5 class="item-group">${esc(g)}</h5>`; lastGroup = g; }
      html += itemHTML(it, cat);
    });
    return `<div class="items">${html}</div>`;
  }

  const matchesDiet = it => [...state.diets].every(d => (it.tags || []).includes(d)
    || (d === "vejetaryen" && (it.tags || []).includes("vegan")));

  function haystack(it, cat) {
    const parts = [it.name, it.desc, it.group, cat.name].flatMap(v => v && typeof v === "object" ? [v.tr, v.en] : [v]);
    parts.push(it.meta, ...(it.tags || []).flatMap(tg => [window.I18N.ui.tr.tags[tg], window.I18N.ui.en.tags[tg]]));
    return fold(parts.filter(Boolean).join(" "));
  }

  const dietChipsHTML = () => `<div class="mfilter" role="group" aria-label="${esc(ui().filter)}">
      <span class="mfilter__label">${esc(ui().filter)}</span>
      ${DIET_FILTERS.map(d => `<button type="button" class="chip" data-diet="${d}" aria-pressed="${state.diets.has(d)}">${esc(ui().tags[d])}</button>`).join("")}
    </div>`;

  /* --- Sayfadaki ana görünüm: bölümler ve kategori kartları --- */
  function homeHTML() {
    let n = 0;
    const sections = MENU.sections.map(s => {
      const cats = catsIn(s);
      const cls = `cat-grid${cats.length % 4 && cats.length % 3 === 0 ? " cat-grid--3" : ""}${cats.length % 2 ? " cat-grid--odd" : ""}`;
      return `
      <section class="mhome__section" aria-labelledby="msec-${s.id}">
        <header class="mhome__head">
          <div>
            <h3 id="msec-${s.id}">${esc(t(s.name))}</h3>
            ${t(s.desc) ? `<p>${esc(t(s.desc))}</p>` : ""}
          </div>
        </header>
        <div class="${cls}">
          ${cats.map(c => `
            <a class="cat-tile" href="#menu/${c.id}" style="--d:${(n++) * 45}ms">
              <img src="${img(c.image, 500)}&h=620" srcset="${img(c.image, 360)}&h=450 360w, ${img(c.image, 500)}&h=620 500w" sizes="(max-width: 640px) 50vw, 25vw" width="500" height="620" loading="lazy" decoding="async" alt="">
              <span class="cat-tile__body">
                <span class="cat-tile__count">${countLabel(c.items.length)}</span>
                <span class="cat-tile__name">${esc(t(c.name))}</span>
              </span>
              <span class="cat-tile__arrow" aria-hidden="true">→</span>
            </a>`).join("")}
        </div>
      </section>`;
    }).join("");

    return `<div class="mhome">${sections}</div>`;
  }

  /* --- Arama sonuçları (sayfada) --- */
  function searchHTML(q) {
    const words = q.split(/\s+/);
    let count = 0, blocks = "";
    MENU.categories.forEach(cat => {
      const items = cat.items.filter(it => matchesDiet(it) && words.every(w => haystack(it, cat).includes(w)));
      if (!items.length) return;
      count += items.length;
      blocks += `<section class="msearch__block">
        <a class="msearch__cat" href="#menu/${cat.id}">
          <img src="${img(cat.image, 120)}&h=120" width="44" height="44" alt="" loading="lazy">
          <span>${esc(t(cat.name))}</span><span aria-hidden="true">→</span>
        </a>
        ${itemsHTML(items, cat)}
      </section>`;
    });
    return `<div class="msearch">
        <div class="msearch__bar">
          <p>${ui().resultsFor(esc(state.q.trim()), count)}</p>
          <button type="button" class="btn btn--sm btn--insta" data-clear>${esc(ui().clear)}</button>
        </div>
        ${dietChipsHTML()}
        ${blocks || `<p class="menu-empty">${esc(ui().noResults)}</p>`}
      </div>`;
  }

  function renderMenu() {
    if (!MENU) return;
    const q = fold(state.q.trim());
    app.innerHTML = `<div class="mview">${q ? searchHTML(q) : homeHTML()}</div>`;
    $("#setMenu").hidden = !!q || !MENU.setMenu;
    if (drawerCat) renderDrawer(drawerCat);
  }

  function renderSetMenu() {
    if (!MENU) return;
    $("#vatNote").hidden = !showPrices();
    if (!MENU.setMenu) return;
    const s = MENU.setMenu, box = $("#setMenu");
    $("#setMenuTitle").textContent = t(s.title);
    $(".setmenu__desc", box).textContent = t(s.desc);
    $(".setmenu__desc", box).hidden = !s.desc;
    $(".setmenu__list", box).innerHTML = (s.items || []).map(i => `<li>${esc(t(i))}</li>`).join("");
    const priced = showPrices() && s.price != null;
    $(".setmenu__amount", box).textContent = priced ? priceFmt(s.price) : "";
    $(".setmenu__per", box).textContent = priced ? t(s.per) : "";
  }

  /* --- Yan panel (drawer) --- */
  let drawerCat = null, drawerPushed = false, drawerReturnFocus = null;

  function renderDrawer(id) {
    const c = catById(id);
    const all = MENU.categories, i = all.indexOf(c);
    const prev = all[i - 1], next = all[i + 1];
    const hasDiet = c.items.some(it => (it.tags || []).some(tg => DIET_FILTERS.includes(tg)));
    const items = hasDiet ? c.items.filter(matchesDiet) : c.items;
    drawerContent.innerHTML = `
      <header class="dhead">
        <div class="dhead__bar">
          <span class="dhead__brand">Kardias · ${esc(ui().menuWord)}</span>
          <button type="button" class="dhead__close" data-drawer-close aria-label="${esc(ui().close)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <nav class="dtabs" aria-label="${esc(ui().categories)}">
          ${MENU.sections.map(s => `<span class="dtabs__sep">${esc(t(s.name))}</span>` +
            catsIn(s).map(k => `<a href="#menu/${k.id}" class="dtabs__chip" data-swap${k.id === c.id ? ' aria-current="page"' : ""}>${esc(t(k.name))}</a>`).join("")
          ).join("")}
        </nav>
      </header>
      <div class="dview">
        <div class="dcover">
          <img src="${img(c.image, 1000)}&h=520" srcset="${img(c.image, 640)}&h=360 640w, ${img(c.image, 1000)}&h=520 1000w" sizes="(max-width: 640px) 100vw, 640px" alt="" decoding="async">
          <div class="dcover__body">
            <span class="dcover__section">${esc(t(sectionOf(c).name))}</span>
            <h3 class="dcover__title" id="drawerTitle">${esc(t(c.name))}</h3>
            ${c.note ? `<p class="dcover__note">${esc(t(c.note))}</p>` : ""}
            <span class="dcover__count">${countLabel(c.items.length)}</span>
          </div>
        </div>
        <div class="dbody">
          ${hasDiet ? dietChipsHTML() : ""}
          ${items.length ? itemsHTML(items, c) : `<p class="menu-empty">${esc(ui().noDiet)}</p>`}
          <p class="dnote">${esc(ui().allergen)}${showPrices() ? " " + esc(ui().vat) : ""}</p>
          <nav class="dpager" aria-label="${esc(ui().categories)}">
            ${prev ? `<a class="dpager__link" href="#menu/${prev.id}" data-swap><small>← ${esc(ui().prev)}</small><span>${esc(t(prev.name))}</span></a>` : "<span></span>"}
            ${next ? `<a class="dpager__link dpager__link--next" href="#menu/${next.id}" data-swap><small>${esc(ui().next)} →</small><span>${esc(t(next.name))}</span></a>` : "<span></span>"}
          </nav>
        </div>
      </div>
      <footer class="dfoot">
        <a href="#rezervasyon" class="btn btn--sunset" data-drawer-book>${esc(ui().bookTable)}</a>
        <a href="#" class="btn btn--wa" data-drawer-wa><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa"/></svg>WhatsApp</a>
      </footer>`;

    centerActiveTab();
  }

  function centerActiveTab() {
    const active = $(".dtabs__chip[aria-current]", drawerContent), track = $(".dtabs", drawerContent);
    if (active && track) track.scrollLeft = active.offsetLeft - track.clientWidth / 2 + active.offsetWidth / 2;
  }

  function openDrawer(id, { pushed }) {
    const wasOpen = !!drawerCat;
    drawerCat = id;
    renderDrawer(id);
    drawerPanel.scrollTop = 0;
    if (wasOpen) return;
    drawerPushed = pushed;
    drawerReturnFocus = document.activeElement;
    drawer.hidden = false;
    centerActiveTab(); // panel görünür olunca ölçülebilir
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add("is-open")));
    setTimeout(() => { const x = $(".dhead__close", drawer); if (x) x.focus({ preventScroll: true }); }, 60);
  }

  function closeDrawerUI() {
    if (!drawerCat) return;
    drawerCat = null;
    drawer.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    setTimeout(() => { if (!drawerCat) drawer.hidden = true; }, 420);
    if (drawerReturnFocus && document.contains(drawerReturnFocus)) drawerReturnFocus.focus({ preventScroll: true });
  }

  // Kullanıcı kapattığında: panel bir tıklamayla açıldıysa geri git (geçmiş temiz kalsın), yoksa adresi düzelt
  function requestCloseDrawer() {
    const closeHere = () => { history.replaceState(null, "", location.pathname + location.search + "#menu"); closeDrawerUI(); };
    if (!drawerPushed) { closeHere(); return; }
    history.back();
    setTimeout(() => { if (drawerCat) closeHere(); }, 300); // geri adım işe yaramazsa yine de kapat
  }

  function route(fromHashChange) {
    const m = location.hash.match(/^#menu\/([\w-]+)$/);
    if (m && MENU && catById(m[1])) openDrawer(m[1], { pushed: fromHashChange });
    else closeDrawerUI();
  }
  window.addEventListener("hashchange", () => route(true));


  /* --- Ürün detayı (sheet) --- */
  const sheet = $("#itemSheet"), sheetPanel = $(".sheet__panel", sheet), sheetContent = $("#sheetContent");
  let sheetReturnFocus = null, sheetOpen = false;

  function sheetHTML(cat, it) {
    const pic = it.image || cat.image;
    const tags = (it.tags || []).map(tg => `<span class="tag tag--${tg}">${esc(ui().tags[tg] || tg)}</span>`).join("");
    const priceBlock = !showPrices() ? ""
      : it.prices
      ? `<div class="sheet__prices">${it.prices.map(p => `<div class="sheet__pr"><span>${esc(t(p.label))}</span><b>${priceFmt(p.price)}</b></div>`).join("")}</div>`
      : `<p class="sheet__price">${esc(shortPrice(it))}</p>`;
    const pc = cat.pair && catById(cat.pair);
    let pairHTML = "";
    if (pc) {
      const ranked = [...pc.items].sort((a, b) => {
        const score = x => ((x.tags || []).includes("sef") ? 2 : 0) + ((x.tags || []).includes("favori") ? 1 : 0);
        return score(b) - score(a);
      }).slice(0, 3);
      pairHTML = `<section class="pair">
        <div class="pair__head"><h4>${esc(ui().pairWith)}</h4><a href="#menu/${pc.id}" data-pair-cat>${esc(t(pc.name))} →</a></div>
        <div class="pair__list">
          ${ranked.map(x => `<button type="button" class="pair__item" data-item="${pc.id}:${pc.items.indexOf(x)}">
            <img src="${img(x.image || pc.image, 160)}&h=160" width="64" height="64" alt="" loading="lazy">
            <span><strong>${esc(t(x.name))}</strong><small>${esc(shortPrice(x))}</small></span>
          </button>`).join("")}
        </div>
      </section>`;
    }
    return `
      <div class="sheet__media">
        <img src="${img(pic, 900)}&h=675" srcset="${img(pic, 600)}&h=450 600w, ${img(pic, 900)}&h=675 900w" sizes="(max-width: 640px) 100vw, 560px" alt="${esc(t(it.name))}" decoding="async">
        <span class="sheet__cat">${esc(t(cat.name))}</span>
      </div>
      <div class="sheet__body">
        <h3 class="sheet__title" id="sheetTitle">${esc(t(it.name))}</h3>
        ${it.meta ? `<p class="sheet__meta">${esc(it.meta)}</p>` : ""}
        ${it.desc ? `<p class="sheet__desc">${esc(t(it.desc))}</p>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${priceBlock}
        <div class="sheet__actions">
          <a href="#rezervasyon" class="btn btn--sunset" data-sheet-book>${esc(ui().bookTable)}</a>
          <button type="button" class="btn btn--wa" data-sheet-ask><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa"/></svg>${esc(ui().askAbout)}</button>
        </div>
        ${pairHTML}
      </div>`;
  }

  let sheetItem = null;
  function openSheet(key) {
    const [cid, idx] = key.split(":");
    const cat = catById(cid), it = cat && cat.items[+idx];
    if (!it) return;
    sheetItem = { cat, it };
    sheetContent.innerHTML = sheetHTML(cat, it);
    sheetPanel.scrollTop = 0;
    if (sheetOpen) return;
    sheetOpen = true;
    sheetReturnFocus = document.activeElement;
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("is-open")));
    setTimeout(() => $(".sheet__close", sheet).focus({ preventScroll: true }), 60);
  }
  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove("is-open");
    document.body.classList.remove("sheet-open");
    setTimeout(() => { if (!sheetOpen) sheet.hidden = true; }, 380);
    if (sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus({ preventScroll: true });
  }

  sheet.addEventListener("click", e => {
    if (e.target.closest("[data-sheet-close]")) { closeSheet(); return; }
    const other = e.target.closest(".pair__item[data-item]");
    if (other) { openSheet(other.dataset.item); return; }
    const pairCat = e.target.closest("[data-pair-cat]");
    if (pairCat) {
      e.preventDefault();
      closeSheet();
      const href = pairCat.getAttribute("href");
      drawerCat ? location.replace(href) : (location.hash = href.slice(1));
      return;
    }
    if (e.target.closest("[data-sheet-ask]")) {
      openWa(`${ui().waHello} ${ui().waInfo(t(sheetItem.it.name))}`);
      return;
    }
    if (e.target.closest("[data-sheet-book]")) {
      e.preventDefault();
      closeSheet();
      if (drawerCat) requestCloseDrawer();
      setTimeout(() => $("#rezervasyon").scrollIntoView(), drawerCat ? 450 : 50);
    }
  });
  sheet.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.stopPropagation(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = $$('a[href], button:not([disabled])', sheetPanel).filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Ürün kartları (panelde ve arama sonuçlarında)
  const onItemActivate = e => {
    const card = e.target.closest(".item[data-item]");
    if (!card) return false;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return false;
    e.preventDefault();
    openSheet(card.dataset.item);
    return true;
  };
  [drawer, app].forEach(root => root.addEventListener("keydown", onItemActivate));

  drawer.addEventListener("click", e => {
    if (onItemActivate(e)) return;
    if (e.target.closest("[data-drawer-close]")) { requestCloseDrawer(); return; }
    const swap = e.target.closest("a[data-swap]");
    if (swap) { e.preventDefault(); location.replace(swap.getAttribute("href")); return; } // geçmişi şişirmeden kategori değiştir
    const chip = e.target.closest("[data-diet]");
    if (chip) {
      const d = chip.dataset.diet;
      state.diets.has(d) ? state.diets.delete(d) : state.diets.add(d);
      const y = drawerPanel.scrollTop;
      renderDrawer(drawerCat);
      drawerPanel.scrollTop = y;
      return;
    }
    if (e.target.closest("[data-drawer-wa]")) {
      e.preventDefault();
      openWa(`${ui().waHello} ${ui().waGeneral}`);
      return;
    }
    if (e.target.closest("[data-drawer-book]")) {
      e.preventDefault();
      requestCloseDrawer();
      setTimeout(() => $("#rezervasyon").scrollIntoView(), 450);
    }
  });

  drawer.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.stopPropagation(); requestCloseDrawer(); return; }
    if (e.key !== "Tab") return;
    // Odak panelin içinde kalsın
    const f = $$('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', drawerPanel).filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Sayfadaki menü: filtre ve arama temizleme
  app.addEventListener("click", e => {
    if (onItemActivate(e)) return;
    const chip = e.target.closest("[data-diet]");
    if (chip) {
      const d = chip.dataset.diet;
      state.diets.has(d) ? state.diets.delete(d) : state.diets.add(d);
      renderMenu();
      return;
    }
    if (e.target.closest("[data-clear]")) {
      state.q = ""; searchEl.value = "";
      renderMenu();
    }
  });

  let searchTimer;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = searchEl.value; renderMenu(); }, 150);
  });
  searchEl.addEventListener("keydown", e => {
    if (e.key === "Escape") { searchEl.value = ""; state.q = ""; renderMenu(); }
  });

  renderSetMenu();
  renderMenu();
  route(false);

  /* ============ Galeri + Lightbox (fotoğraf ve video) ============ */
  const galleryEl = $("#gallery"), lb = $("#lightbox"), lbImg = $("img", lb), lbVideo = $("video", lb), lbCap = $("figcaption", lb);
  let lbIndex = 0, lastFocus = null, lbList = [];
  const ratioOf = g => { const m = /^(\d+):(\d+)$/.exec(g.ratio || ""); return m ? [+m[1], +m[2]] : [4, 3]; };

  function renderGallery() {
    $("#galeri").hidden = !GALLERY.length || S.showGallery === false;
    galleryEl.innerHTML = GALLERY.map((g, i) => {
      const cap = t(g.caption) || "";
      const [rw, rh] = ratioOf(g), w = 600, h = Math.round(w * rh / rw);
      const media = g.kind === "video"
        ? `<video src="${esc(g.src)}#t=0.1"${g.poster ? ` poster="${esc(img(g.poster, w))}"` : ""} muted playsinline preload="metadata" width="${w}" height="${h}"></video>
           <span class="masonry__play" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-play"/></svg></span>`
        : `<img src="${img(g.src, w)}&h=${h}" srcset="${img(g.src, 400)}&h=${Math.round(400 * rh / rw)} 400w, ${img(g.src, w)}&h=${h} 600w"
             sizes="(max-width: 640px) 100vw, 33vw" width="${w}" height="${h}" loading="lazy" decoding="async" alt="${esc(cap)}">`;
      const label = g.kind === "video" ? ui().playVideo + (cap ? ": " + cap : "") : cap;
      return `<button type="button" class="masonry__item reveal${g.kind === "video" ? " masonry__item--video" : ""}" data-index="${i}" data-caption="${esc(cap)}" aria-label="${esc(label)}">
        ${media}
      </button>`;
    }).join("");
    observeReveal(galleryEl);
  }

  function showLightbox(i) {
    lbIndex = (i + lbList.length) % lbList.length;
    const g = lbList[lbIndex], cap = t(g.caption) || "";
    const video = g.kind === "video";
    lbVideo.pause();
    lbImg.hidden = video;
    lbVideo.hidden = !video;
    if (video) {
      lbImg.removeAttribute("src");
      lbVideo.poster = g.poster ? img(g.poster, 1600) : "";
      lbVideo.src = g.src;
      lbVideo.play().catch(() => { /* otomatik oynatma engellendi: kullanıcı oynatır */ });
    } else {
      lbVideo.removeAttribute("src");
      lbVideo.load();
      lbImg.src = img(g.src, 1600);
      lbImg.alt = cap;
    }
    lbCap.textContent = cap;
    $$(".lightbox__arrow", lb).forEach(a => { a.hidden = lbList.length < 2; });
  }
  function openLightbox(list, i) {
    lbList = list;
    lastFocus = document.activeElement;
    showLightbox(i);
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    $(".lightbox__close", lb).focus();
  }
  function closeLightbox() {
    lb.hidden = true;
    lbVideo.pause();
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  galleryEl.addEventListener("click", e => {
    const b = e.target.closest(".masonry__item");
    if (b) openLightbox(GALLERY, +b.dataset.index);
  });
  $(".lightbox__close", lb).addEventListener("click", closeLightbox);
  $(".lightbox__arrow--prev", lb).addEventListener("click", () => showLightbox(lbIndex - 1));
  $(".lightbox__arrow--next", lb).addEventListener("click", () => showLightbox(lbIndex + 1));
  lb.addEventListener("click", e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showLightbox(lbIndex - 1);
    if (e.key === "ArrowRight") showLightbox(lbIndex + 1);
  });
  let touchX = null;
  lb.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) showLightbox(lbIndex + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  /* ============ Duyuru şeridi (panel → Duyuru şeridi) ============ */
  function renderNotice() {
    let el = $("#siteNotice");
    const text = S.noticeOn ? t(S.noticeText) : "";
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement(S.noticeLink ? "a" : "p");
      el.id = "siteNotice";
      el.className = "notice";
      if (S.noticeLink) {
        el.href = S.noticeLink;
        if (/^https?:/.test(S.noticeLink)) { el.target = "_blank"; el.rel = "noopener"; }
      }
      $(".hero__copy").prepend(el);
    }
    el.textContent = text;
  }

  /* ============ Etkinlikler ============ */
  function renderEvents() {
    const el = $("#events"), list = SITE.events || [];
    $("#etkinlikler").hidden = !list.length || S.showEvents === false;
    el.innerHTML = list.map(ev => `<article class="event reveal">
        <div class="event__media"><img src="${img(ev.image, 700)}" loading="lazy" decoding="async" alt="" width="700" height="460"></div>
        <div class="event__body">
          ${ev.when ? `<span class="event__when">${esc(t(ev.when))}</span>` : ""}
          <h3>${esc(t(ev.title))}</h3>
          ${ev.desc ? `<p>${esc(t(ev.desc))}</p>` : "<p></p>"}
          <button type="button" class="btn btn--outline-light btn--sm js-info">${esc(ui().info)}</button>
        </div>
      </article>`).join("");
    observeReveal(el);
  }

  /* ============ Fotoğraf künyesi ============ */
  function renderCredits() {
    const list = SITE.credits || [];
    $(".credits").hidden = !list.length;
    $("#credits").innerHTML = list.map(c => {
      const by = [c.author, c.license].filter(Boolean).join(" · ");
      return `<li>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}${by ? " — " + esc(by) : ""}</li>`;
    }).join("");
  }

  /* ============ Yorumlar: tek büyük alıntı, kişi seçici, otomatik ilerleme ============ */
  const revStage = $("#reviews"), revPeople = $("#revPeople"), revBar = $("#revBar"), testi = $(".testi");
  let revIndex = 0, revTimer = null;
  const REV_MS = 7000;

  // Puan kutusu (panel → Yorum puanı)
  const score = Number(S.ratingScore);
  $("#ratingBox").hidden = S.showRating === false || !Number.isFinite(score);
  $("#ratingSample").hidden = !S.showSampleNote;
  if (Number.isFinite(score)) {
    $(".rating__score").textContent = String(score);
    $("#ratingStars").setAttribute("aria-label", `5 üzerinden ${score}`);
    $("#ratingStars > span").style.setProperty("--r", score);
  }
  testi.hidden = !REVIEWS.length;
  if (!REVIEWS.length && $("#ratingBox").hidden) $("#yorumlar").hidden = true;
  if (REVIEWS.length) {
  revPeople.innerHTML = REVIEWS.map((r, i) =>
    `<button type="button" class="testi__person" data-rev="${i}" aria-label="${esc(r.name)}" aria-pressed="false">${esc(r.name[0])}</button>`).join("");

  // Yorum tarihi ay ve yıl olarak: "Kasım 2025" / "November 2025"
  const revDate = v => v ? new Date(v + "T00:00").toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", { month: "long", year: "numeric" }) : "";
  function showReview(i) {
    revIndex = (i + REVIEWS.length) % REVIEWS.length;
    const r = REVIEWS[revIndex];
    revStage.innerHTML = `<figure class="testi__slide">
        <span class="stars" aria-label="${r.rating}/5"><span style="--r:${r.rating}"></span></span>
        <blockquote>${esc(r.text)}</blockquote>
        <figcaption><strong>${esc(r.name)}</strong>${[r.src, revDate(r.date)].filter(Boolean).map(x => " · " + esc(x)).join("")}</figcaption>
      </figure>`;
    $$(".testi__person", revPeople).forEach((b, k) => b.setAttribute("aria-pressed", String(k === revIndex)));
    revBar.style.animation = "none"; void revBar.offsetWidth; revBar.style.animation = "";
  }
  function startRev() { stopRev(); testi.classList.add("is-playing"); revTimer = setInterval(() => showReview(revIndex + 1), REV_MS); }
  function stopRev() { clearInterval(revTimer); revTimer = null; testi.classList.remove("is-playing"); }
  showReview(0);
  // Dil değişince tarih de yeni dilde görünsün
  $$(".lang button").forEach(b => b.addEventListener("click", () => showReview(revIndex)));
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) startRev();
  revPeople.addEventListener("click", e => { const b = e.target.closest("[data-rev]"); if (b) { showReview(+b.dataset.rev); startRev(); } });
  $("#revPrev").addEventListener("click", () => { showReview(revIndex - 1); startRev(); });
  $("#revNext").addEventListener("click", () => { showReview(revIndex + 1); startRev(); });
  testi.addEventListener("mouseenter", stopRev);
  testi.addEventListener("mouseleave", () => { if (!matchMedia("(prefers-reduced-motion: reduce)").matches) startRev(); });
  let touchRevX = null;
  revStage.addEventListener("touchstart", e => { touchRevX = e.touches[0].clientX; }, { passive: true });
  revStage.addEventListener("touchend", e => {
    if (touchRevX == null) return;
    const dx = e.changedTouches[0].clientX - touchRevX;
    if (Math.abs(dx) > 50) { showReview(revIndex + (dx < 0 ? 1 : -1)); startRev(); }
    touchRevX = null;
  });
  revBar.style.setProperty("--dur", REV_MS + "ms");
  }

  /* ============ Rezervasyon ============
     İki form: Rezervasyon bölümünde masa formu (sokak / teras), Konaklama bölümünde odaların yanındaki konaklama formu.
     Talep önce veritabanına kaydedilir (panel → Rezervasyonlar); ayara göre WhatsApp mesajı da açılır. */
  const form = $("#reserveForm"), stayForm = $("#stayForm");
  const TYPE_ON = { sokak: S.typeStreet !== false, teras: S.typeTerrace !== false, konaklama: S.typeStay !== false };
  $$('input[name="rtype"]', form).forEach(r => { r.closest("label").hidden = !TYPE_ON[r.value]; });
  form.hidden = !TYPE_ON.sokak && !TYPE_ON.teras;
  $("#odarezervasyon").hidden = $("#stayLink").hidden = !TYPE_ON.konaklama;
  const dateInput = form.elements.date, timeSel = form.elements.time;
  const checkin = stayForm.elements.checkin, checkout = stayForm.elements.checkout;

  const today = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrowIso = iso(new Date(today.getTime() + 864e5));
  dateInput.min = checkin.min = iso(today);
  dateInput.value = checkin.value = iso(today);
  checkout.min = checkout.value = tomorrowIso;
  checkin.addEventListener("change", () => {
    const next = iso(new Date(new Date(checkin.value + "T00:00").getTime() + 864e5));
    checkout.min = next;
    if (checkout.value < next) checkout.value = next;
    updateStay();
  });
  checkout.addEventListener("change", () => updateStay());

  const rtype = () => form.elements.rtype.value;
  function setRtype(v) {
    if (!TYPE_ON[v]) return;
    form.elements.rtype.value = v;
    $(".form__error", form).hidden = true;
  }
  if (!TYPE_ON[rtype()]) setRtype(TYPE_ON.sokak ? "sokak" : "teras");

  // Saat seçenekleri: panel → Çalışma saatleri → ilk / son rezervasyon saati, yarım saat arayla
  const toMin = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
  const fromMin = n => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const slots = [];
  for (let m = toMin(CONFIG.firstBooking); m <= toMin(CONFIG.lastBooking); m += 30) slots.push(fromMin(m));
  slots.forEach(v => timeSel.add(new Option(v, v, false, v === (slots.includes("19:30") ? "19:30" : slots[0]))));

  // Kişi sayısı: seçilen odanın kapasitesini aşamaz
  const GUESTS = [..."123456789".split(""), "10", "10+"];
  const guestNum = g => (g === "10+" ? 11 : Number(g));
  const roomById = id => ROOMS.find(r => String(r.id) === String(id));
  const selectedRoom = () => roomById(stayForm.elements.room.value);
  function fillGuests(sel, max) {
    const current = sel.value || "2";
    const opts = max ? GUESTS.filter(n => guestNum(n) <= max) : GUESTS;
    const pick = opts.includes(current) ? current : opts[opts.length - 1];
    sel.innerHTML = "";
    opts.forEach(n => sel.add(new Option(ui().guests(n), n, false, n === pick)));
  }
  function fillRoomOptions() {
    const sel = stayForm.elements.room, current = sel.value;
    sel.innerHTML = "";
    sel.add(new Option(ui().anyRoom, ""));
    ROOMS.forEach(r => sel.add(new Option(t(r.name) + (r.capacity ? " · " + ui().roomCap(r.capacity) : ""), String(r.id), false, String(r.id) === current)));
    $("[data-room-field]", stayForm).hidden = !ROOMS.length;
  }
  function fillGuestOptions() {
    fillGuests(form.elements.guests);
    fillRoomOptions();
    fillGuests(stayForm.elements.guests, (selectedRoom() || {}).capacity);
    updateStay();
  }

  // Seçili odayı kartlarda işaretle; gece sayısını (ve fiyatlar açıksa toplamı) göster
  const nightsBetween = (a, b) => (a && b ? Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5) : 0);
  function updateStay() {
    const room = selectedRoom();
    $$(".room", $("#rooms")).forEach(card => {
      const on = !!room && card.dataset.room === String(room.id);
      card.classList.toggle("is-selected", on);
      const b = $("[data-pick-room]", card);
      if (b) { b.setAttribute("aria-pressed", String(on)); b.textContent = on ? ui().roomSelected : ui().selectRoom; }
    });
    const n = nightsBetween(checkin.value, checkout.value);
    let txt = n > 0 ? ui().nights(n) : "";
    if (n > 0 && room && room.price != null) txt += " · " + ui().total(priceFmt(room.price * n));
    $("#stayNights").textContent = txt;
  }
  stayForm.elements.room.addEventListener("change", () => {
    fillGuests(stayForm.elements.guests, (selectedRoom() || {}).capacity);
    updateStay();
  });
  function selectRoom(id) {
    stayForm.elements.room.value = String(id);
    stayForm.elements.room.dispatchEvent(new Event("change"));
    // Form ekranda değilse (mobilde odaların altında) forma kaydır
    const top = stayForm.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) stayForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* --- Oda kartları: fotoğraf kaydırıcısı, kapasite, özellikler, "Bu odayı seç" --- */
  function renderRooms() {
    $("#roomsWrap").hidden = !ROOMS.length;
    $("#stayBook").classList.toggle("stay-book--solo", !ROOMS.length);
    $("#rooms").innerHTML = ROOMS.map(r => {
      const name = t(r.name), many = r.images.length > 1;
      const facts = [r.size, t(r.view)].filter(Boolean);
      const priced = r.price != null;
      return `<article class="room reveal" data-room="${r.id}">
        <div class="room__media">
          <div class="room__slides" data-slides>
            ${r.images.map((src, i) => `<button type="button" class="room__slide" data-room-photo="${r.id}:${i}" aria-label="${esc(ui().roomPhotos)}: ${esc(name)}${many ? ` (${i + 1}/${r.images.length})` : ""}">
              <img src="${img(src, 720)}&h=540" srcset="${img(src, 720)}&h=540 1x, ${img(src, 1440)}&h=1080 2x" width="720" height="540" loading="lazy" decoding="async" alt="${esc(name)}">
            </button>`).join("")}
          </div>
          ${r.capacity ? `<span class="room__cap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 13.3A5 5 0 0 1 21 18"/></svg>${esc(ui().roomCap(r.capacity))}</span>` : ""}
          ${many ? `<button type="button" class="room__arrow room__arrow--prev" data-slide="-1" aria-label="${esc(ui().prevPhoto)}">‹</button>
          <button type="button" class="room__arrow room__arrow--next" data-slide="1" aria-label="${esc(ui().nextPhoto)}">›</button>
          <span class="room__dots" aria-hidden="true">${r.images.map((_, i) => `<i${i ? "" : ' class="is-on"'}></i>`).join("")}</span>` : ""}
        </div>
        <div class="room__body">
          <h4 class="room__name">${esc(name)}</h4>
          ${facts.length ? `<p class="room__facts">${facts.map(x => `<span>${esc(x)}</span>`).join("")}</p>` : ""}
          ${r.desc ? `<p class="room__desc">${esc(t(r.desc))}</p>` : ""}
          ${r.features && r.features.length ? `<ul class="room__features">${r.features.map(x => `<li>${esc(t(x))}</li>`).join("")}</ul>` : ""}
          <div class="room__foot">
            ${priced ? `<span class="room__price">${priceFmt(r.price)}${r.priceNote ? ` <small>${esc(t(r.priceNote))}</small>` : ""}</span>` : "<span></span>"}
            ${TYPE_ON.konaklama ? `<button type="button" class="btn btn--navy btn--sm" data-pick-room="${r.id}" aria-pressed="false">${esc(ui().selectRoom)}</button>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
    $$("[data-slides]", $("#rooms")).forEach(track => track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      $$(".room__dots i", track.parentElement).forEach((d, k) => d.classList.toggle("is-on", k === i));
    }, { passive: true }));
    observeReveal($("#rooms"));
    updateStay();
  }
  $("#rooms").addEventListener("click", e => {
    const arrow = e.target.closest("[data-slide]");
    if (arrow) {
      const track = $("[data-slides]", arrow.closest(".room__media")), count = track.children.length;
      const i = Math.round(track.scrollLeft / track.clientWidth);
      track.scrollTo({ left: ((i + Number(arrow.dataset.slide) + count) % count) * track.clientWidth, behavior: "smooth" });
      return;
    }
    const photo = e.target.closest("[data-room-photo]");
    if (photo) {
      const [id, i] = photo.dataset.roomPhoto.split(":"), r = roomById(id);
      openLightbox(r.images.map(src => ({ src, kind: "image", caption: r.name })), +i);
      return;
    }
    const pick = e.target.closest("[data-pick-room]");
    if (pick) selectRoom(pick.dataset.pickRoom);
  });

  // WhatsApp kapalıysa gönder düğmeleri "Rezervasyon Talebi Gönder" olur
  $$(".js-wa-icon, .js-submit-wa").forEach(el => { el.hidden = !CONFIG.sendWhatsapp; });
  $$(".js-submit-plain").forEach(el => { el.hidden = CONFIG.sendWhatsapp; });

  function saveReservation(payload) {
    return fetch("api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw { ...d, status: r.status }; // sunucunun yanıtı (status var); bağlantı hatasında TypeError gelir
      return d;
    });
  }

  // Boş zorunlu alanları işaretler; hepsi doluysa true
  function checkRequired(els) {
    let ok = true;
    els.forEach(el => {
      const bad = !el.value.trim();
      el.classList.toggle("is-invalid", bad);
      if (bad) ok = false;
    });
    return ok;
  }
  function showFormError(f, msg, el) {
    const err = $(".form__error", f);
    err.textContent = msg;
    err.hidden = false;
    $(".form__ok", f).hidden = true;
    if (el) el.focus();
  }

  // Talebi kaydeder; WhatsApp açıksa hazır mesajı da açar. fieldEls: sunucunun hata verdiği alanları işaretlemek için
  function sendRequest(f, payload, waLines, fieldEls) {
    const err = $(".form__error", f), okEl = $(".form__ok", f), u = ui(), btn = $('button[type="submit"]', f);
    if (btn.disabled) return; // gönderim sürerken ikinci tıklama yok sayılır
    err.hidden = okEl.hidden = true;
    const showOk = msg => { okEl.textContent = msg; okEl.hidden = false; };
    const showFail = d => {
      showFormError(f, (lang === "tr" && d && d.error) || u.formFail);
      Object.keys((d && d.fields) || {}).forEach(k => { if (fieldEls[k]) fieldEls[k].classList.add("is-invalid"); });
    };
    const text = waLines.join("\n");
    // Sunucu yok (GitHub Pages kopyası): talep yalnızca WhatsApp ile gider
    if (isStatic) { openWa(text); showOk(u.formSentWaOnly); return; }
    btn.disabled = true;
    const done = () => { btn.disabled = false; };
    if (!CONFIG.sendWhatsapp) {
      saveReservation(payload)
        .then(() => { showOk(u.formSent); f.elements.note.value = ""; })
        .catch(showFail)
        .finally(done);
      return;
    }
    // Pencere tıklama anında açılır (açılır pencere engelleyicisine takılmasın); WhatsApp adresi kayıt bitince verilir
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    const goWa = () => { if (win && !win.closed) win.location.href = waLink(text); else openWa(text); };
    saveReservation(payload)
      .then(() => { goWa(); showOk(u.formSentWa); })
      .catch(d => {
        if (d && d.status) { if (win) win.close(); showFail(d); } // sunucu reddetti: hatayı göster, WhatsApp açılmaz
        else { goWa(); showOk(u.formSentWaOnly); }                // bağlantı yok: talep yine WhatsApp ile ulaşır
      })
      .finally(done);
  }
  const fmtDay = v => new Date(v + "T00:00").toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Masa formu (sokak / teras)
  form.addEventListener("submit", e => {
    e.preventDefault();
    const f = form.elements, type = rtype(), u = ui();
    const required = [f.name, f.phone, f.date, f.time, f.guests];
    if (!checkRequired(required)) { showFormError(form, u.formError, required.find(el => el.classList.contains("is-invalid"))); return; }
    const payload = { type, name: f.name.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim(), lang, website: f.website.value,
      date: f.date.value, time: f.time.value, guests: f.guests.value };
    const lines = [u.waHello, u.waReserve[type], "", `• ${u.waName}: ${payload.name}`, `• ${u.waPhone}: ${payload.phone}`,
      `• ${u.waDate}: ${fmtDay(payload.date)}`, `• ${u.waTime}: ${payload.time}`, `• ${u.waGuests}: ${u.guests(payload.guests)}`];
    if (payload.note) lines.push(`• ${u.waNote}: ${payload.note}`);
    sendRequest(form, payload, lines, { name: f.name, phone: f.phone, date: f.date, time: f.time, guests: f.guests, note: f.note });
  });

  // Konaklama formu (odaların yanında)
  stayForm.addEventListener("submit", e => {
    e.preventDefault();
    const f = stayForm.elements, u = ui();
    const required = [f.name, f.phone, f.checkin, f.checkout, f.guests];
    if (!checkRequired(required)) { showFormError(stayForm, u.formErrorStay, required.find(el => el.classList.contains("is-invalid"))); return; }
    if (f.checkout.value <= f.checkin.value) { f.checkout.classList.add("is-invalid"); showFormError(stayForm, u.formErrorRange, f.checkout); return; }
    const room = selectedRoom();
    const payload = { type: "konaklama", name: f.name.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim(), lang, website: f.website.value,
      checkin: f.checkin.value, checkout: f.checkout.value, guests: f.guests.value, breakfast: f.breakfast.checked, room: f.room.value };
    const lines = [u.waHello, u.waReserve.konaklama, "", `• ${u.waName}: ${payload.name}`, `• ${u.waPhone}: ${payload.phone}`];
    if (room) lines.push(`• ${u.waRoom}: ${t(room.name)}`);
    lines.push(
      `• ${u.waCheckin}: ${fmtDay(payload.checkin)}`,
      `• ${u.waCheckout}: ${fmtDay(payload.checkout)} (${u.nights(nightsBetween(payload.checkin, payload.checkout))})`,
      `• ${u.waGuests}: ${u.guests(payload.guests)}`,
      `• ${u.waBreakfast}: ${payload.breakfast ? u.waYes : u.waNoThanks}`
    );
    if (payload.note) lines.push(`• ${u.waNote}: ${payload.note}`);
    sendRequest(stayForm, payload, lines, { name: f.name, phone: f.phone, checkin: f.checkin, checkout: f.checkout, guests: f.guests, room: f.room, note: f.note });
  });
  [form, stayForm].forEach(fm => $$("input, select", fm).forEach(el => el.addEventListener("input", () => el.classList.remove("is-invalid"))));
  fillGuestOptions();

  /* ============ Hikâyemiz fotoğrafları: oklar, noktalar ve parmakla kaydırma ============ */
  const storySlider = $("#storySlider");
  if (storySlider) {
    const slides = $$(".story__slide", storySlider), dots = $(".story__dots", storySlider);
    let storyIndex = 0;
    dots.innerHTML = slides.map((_, i) => `<button type="button" aria-label="${i + 1}. fotoğraf"></button>`).join("");
    const showStory = i => {
      storyIndex = (i + slides.length) % slides.length;
      slides.forEach((s, k) => { s.classList.toggle("is-active", k === storyIndex); s.setAttribute("aria-hidden", String(k !== storyIndex)); });
      $$("button", dots).forEach((b, k) => b.setAttribute("aria-current", String(k === storyIndex)));
    };
    showStory(0);
    $(".story__arrow--prev", storySlider).addEventListener("click", () => showStory(storyIndex - 1));
    $(".story__arrow--next", storySlider).addEventListener("click", () => showStory(storyIndex + 1));
    dots.addEventListener("click", e => { const b = e.target.closest("button"); if (b) showStory($$("button", dots).indexOf(b)); });
    let touchStoryX = null;
    storySlider.addEventListener("touchstart", e => { touchStoryX = e.touches[0].clientX; }, { passive: true });
    storySlider.addEventListener("touchend", e => {
      if (touchStoryX == null) return;
      const dx = e.changedTouches[0].clientX - touchStoryX;
      touchStoryX = null;
      if (Math.abs(dx) > 40) showStory(storyIndex + (dx < 0 ? 1 : -1));
    });
  }

  /* ============ İletişim bilgileri ve bağlantılar (panel → İletişim, Adres, Sosyal medya) ============ */
  const mapsQ = encodeURIComponent(S.mapsQuery || "Kardias Cunda Ayvalık");
  const setHref = (el, url) => { if (el.getAttribute("href") !== url) el.setAttribute("href", url); };
  $$("[data-bind]").forEach(el => {
    const v = { phoneDisplay: S.phoneDisplay, phone2Display: S.phone2Display, addressStreet: S.addressStreet, addressCity: S.addressCity,
      addressFull: [S.addressStreet, S.addressCity].filter(Boolean).join(", "), hoursRange: `${CONFIG.openTime} – ${CONFIG.closeTime}` }[el.dataset.bind];
    if (v) el.textContent = v;
  });
  if (CONFIG.phone) $$(".js-tel").forEach(a => setHref(a, "tel:" + CONFIG.phone));
  $$(".js-tel2").forEach(a => { a.hidden = !S.phone2; if (S.phone2) setHref(a, "tel:" + S.phone2); });
  $$(".js-dir").forEach(a => setHref(a, `https://www.google.com/maps/dir/?api=1&destination=${mapsQ}`));
  const mapFrame = $("#mapFrame"), mapSrc = `https://www.google.com/maps?q=${mapsQ}&z=16&output=embed`;
  if (mapFrame.getAttribute("src") !== mapSrc) mapFrame.setAttribute("src", mapSrc);
  if (S.email) {
    $("#emailRow").hidden = false;
    $("#emailLink").href = "mailto:" + S.email;
    $("#emailLink").textContent = S.email;
  }

  const SOCIAL = [["instagram", "i-ig", "Instagram"], ["facebook", "i-fb", "Facebook"], ["tiktok", "i-tt", "TikTok"], ["youtube", "i-yt", "YouTube"], ["tripadvisor", "i-ta", "Tripadvisor"]];
  $("#social").innerHTML = SOCIAL.filter(([k]) => S[k]).map(([k, icon, label]) =>
    `<a href="${esc(S[k])}" target="_blank" rel="noopener" aria-label="${label}"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></a>`).join("") +
    `<a href="#" class="js-wa" aria-label="WhatsApp"><svg viewBox="0 0 24 24"><use href="#i-wa"/></svg></a>` +
    `<a href="#" class="js-gmaps" target="_blank" rel="noopener" aria-label="Google Maps"><svg viewBox="0 0 24 24"><use href="#i-pin"/></svg></a>`;
  $$(".js-gmaps").forEach(a => setHref(a, `https://www.google.com/maps/search/?api=1&query=${mapsQ}`));

  $$(".js-wa").forEach(a => {
    a.target = "_blank"; a.rel = "noopener";
    a.addEventListener("click", e => { e.preventDefault(); openWa(`${ui().waHello} ${ui().waGeneral}`); });
  });
  $$(".js-insta").forEach(a => {
    if (CONFIG.instagram) setHref(a, CONFIG.instagram);
    else (a.closest(".gallery__more") || a).hidden = true;
  });
  $("#events").addEventListener("click", e => {
    const b = e.target.closest(".js-info");
    if (!b) return;
    const title = $("h3", b.closest(".event")).textContent;
    openWa(`${ui().waHello} ${ui().waInfo(title)}`);
  });
  $$(".js-terrace").forEach(a => a.addEventListener("click", () => {
    setRtype("teras");
    if (!form.elements.note.value.includes(ui().waSet)) {
      form.elements.note.value = (ui().waSet + " " + form.elements.note.value).trim();
    }
  }));

  /* ============ Gün batımı & açık/kapalı durumu ============
     Gün batımı, Cunda'nın koordinatları için güneş konumu formülüyle hesaplanır (suncalc yöntemi). */
  const CUNDA = { lat: Number.isFinite(S.lat) ? S.lat : 39.335, lng: Number.isFinite(S.lng) ? S.lng : 26.66 };
  const TZ = "Europe/Istanbul";

  function sunsetAt(date) {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
    const lw = rad * -CUNDA.lng, phi = rad * CUNDA.lat;
    const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const jset = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return new Date((jset + 0.5 - J1970) * dayMs);
  }
  const hm = d => d.toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

  function updateLiveInfo() {
    const now = new Date(), u = ui();
    let set = sunsetAt(now), tomorrow = false;
    if (now > set) { set = sunsetAt(new Date(now.getTime() + 864e5)); tomorrow = true; }

    $("#sunsetLabel").textContent = tomorrow ? u.sunTomorrow : u.sunToday;
    $("#sunsetTime").textContent = hm(set);
    $("#floatSunLabel").textContent = tomorrow ? u.sunTomorrow : u.sunToday;
    $("#floatSunTime").textContent = hm(set);

    // Cunda saati: gün batımından 90 dk önce altın saat, 40 dk sonrasından sabaha kadar gece
    const todaySet = sunsetAt(now), mins = (now - todaySet) / 6e4;
    const istHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
    const phase = mins >= -90 && mins <= 40 ? "golden" : (mins > 40 || istHour < 6) ? "night" : "day";
    document.documentElement.dataset.phase = phase;
    $("#sunPhase").textContent = u.phase[phase];
    $("#sunsetHint").textContent = tomorrow ? u.sunHintTomorrow : u.sunHint(Math.round((set - now) / 6e4));

    // Açık/kapalı: panel → Çalışma saatleri (kapanış açılıştan önceyse gece yarısını geçiyor demektir)
    const nowMin = toMin(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now));
    const o = toMin(CONFIG.openTime);
    let c = toMin(CONFIG.closeTime);
    if (c <= o) c += 1440;
    const open = (nowMin >= o && nowMin < c) || (nowMin + 1440 >= o && nowMin + 1440 < c);
    const status = $("#openStatus");
    status.classList.toggle("is-open", open);
    status.textContent = open ? u.openNow : u.closedNow(CONFIG.openTime);
  }
  updateLiveInfo();
  setInterval(updateLiveInfo, 60 * 1000);

  /* ============ Kayan yazı şeritleri ============ */
  function renderRibbons() {
    $$("[data-ribbon]").forEach(r => {
      const fromPanel = S[r.dataset.ribbon === "a" ? "ribbonA" : "ribbonB"];
      const words = fromPanel && fromPanel.length ? fromPanel.map(w => t(w)) : ui().ribbons[r.dataset.ribbon];
      const run = words.map(w => `<span class="ribbon__item">${esc(w)}</span>`).join("");
      r.innerHTML = `<div class="ribbon__track">${run}${run}</div>`; // iki kopya: kesintisiz döngü
    });
  }
  renderRibbons();

  /* ============ Süs ışıkları ============ */
  const garland = $("#garland");
  function buildGarland() {
    if (!garland) return;
    const narrow = garland.clientWidth < 700;
    const swags = narrow ? 2 : 3, perSwag = narrow ? 7 : 11, sag = narrow ? 42 : 62, top = 8;
    let path = "", bulbs = "", k = 0;
    for (let i = 0; i < swags; i++) {
      const x0 = (100 / swags) * i, x1 = (100 / swags) * (i + 1), xm = (x0 + x1) / 2;
      path += `M${x0} ${top} Q${xm} ${top + 2 * sag} ${x1} ${top} `;
      for (let j = 1; j < perSwag; j++) {
        const tt = j / perSwag;
        const x = x0 + (x1 - x0) * tt, y = top + 4 * sag * tt * (1 - tt);
        bulbs += `<span class="bulb" style="left:${x.toFixed(2)}%;top:${(y + 1).toFixed(1)}px;--dl:${((k++ * 0.37) % 3.4).toFixed(2)}s"></span>`;
      }
    }
    garland.innerHTML = `<svg viewBox="0 0 100 ${top + 2 * sag}" preserveAspectRatio="none" style="height:${top + 2 * sag}px"><path d="${path}"/></svg>${bulbs}`;
  }
  buildGarland();
  let garlandTimer;
  window.addEventListener("resize", () => { clearTimeout(garlandTimer); garlandTimer = setTimeout(buildGarland, 200); });

  /* ============ Yüzen rezervasyon butonu + derinlik efekti ============ */
  const floatBook = $("#floatBook");
  const hideFloatFor = new Set();
  const floatObserver = new IntersectionObserver(entries => {
    entries.forEach(en => en.isIntersecting ? hideFloatFor.add(en.target) : hideFloatFor.delete(en.target));
    updateFloat();
  }, { threshold: 0.15 });
  // Formların üstüne binmesin: rezervasyon, konaklama formu ve iletişim görünürken gizlenir
  ["#rezervasyon", "#stayBook", "#iletisim"].forEach(sel => { const el = $(sel); if (el) floatObserver.observe(el); });
  function updateFloat() {
    floatBook.classList.toggle("is-visible", window.scrollY > window.innerHeight * 0.9 && hideFloatFor.size === 0);
  }

  const parallaxEls = $$("[data-parallax]");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ticking = false;
  function onScrollFx() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateFloat();
      if (!reduceMotion) {
        const mid = window.innerHeight / 2;
        parallaxEls.forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
          el.style.translate = `0 ${((r.top + r.height / 2 - mid) * -parseFloat(el.dataset.parallax)).toFixed(1)}px`;
        });
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScrollFx, { passive: true });
  onScrollFx();

  /* ============ Başlat ============ */
  $("#year").textContent = today.getFullYear();
  applyLang();
  renderGallery();
  renderEvents();
  renderRooms();
  renderCredits();
  renderNotice();
  observeReveal(document);
}
})();
