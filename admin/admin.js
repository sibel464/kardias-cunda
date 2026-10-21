/* Kardias Cunda — yönetim paneli (tek sayfa uygulama).
   Formlar sunucudaki şemadan (/api/admin/schema) otomatik üretilir; tüm işlemler /api/admin üzerinden veritabanına yazılır. */
(() => {
  "use strict";

  /* ============ Yardımcılar ============ */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const PROPS = new Set(["value", "checked", "disabled", "hidden", "selected", "multiple", "draggable", "open"]);

  // h("div.sinif", { özellikler }, ...çocuklar) — DOM'u innerHTML kullanmadan kurar (kullanıcı verisi asla HTML olarak yorumlanmaz)
  function h(tag, attrs, ...kids) {
    const [name, ...cls] = tag.split(".");
    const el = document.createElement(name);
    if (cls.length) el.className = cls.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
      else if (k === "text") el.textContent = v;
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat(Infinity).forEach(k => { if (k != null && k !== false) el.append(k instanceof Node ? k : String(k)); });
    return el;
  }

  const imgUrl = (v, w = 400) => !v ? "" : /^photo-/.test(v) ? `https://images.unsplash.com/${v}?w=${w}&q=70&auto=format&fit=crop` : v.startsWith("/") ? v : "/" + v;
  const isVideo = v => /\.(mp4|webm)$/i.test(v || "");
  const money = n => n == null ? "" : new Intl.NumberFormat("tr-TR").format(n) + " ₺";
  const tr = v => (v && typeof v === "object" ? v.tr : v) || "";
  const fmtDate = s => s ? new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }) : "";
  const fmtDay = s => s ? new Date(s + "T00:00").toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "";
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const slugify = s => String(s).toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, c => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]))
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

  function mediaThumb(v, w = 300) {
    if (!v) return h("span", null, "—");
    return isVideo(v) ? h("video", { src: imgUrl(v) + "#t=0.1", muted: true, preload: "metadata" }) : h("img", { src: imgUrl(v, w), alt: "", loading: "lazy" });
  }

  function toast(msg, type = "") {
    const el = h("div.toast", { class: type ? "toast--" + type : "" }, msg);
    $("#toasts").append(el);
    setTimeout(() => el.remove(), type === "bad" ? 7000 : 3500);
  }

  /* ============ API ============ */
  const state = { csrf: null, user: null, schema: null, lists: {} };

  async function api(method, url, body, { quiet401 = false } = {}) {
    const headers = {};
    if (state.csrf && method !== "GET") headers["X-CSRF-Token"] = state.csrf;
    let payload;
    if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let r;
    try {
      r = await fetch("/api/admin" + url, { method, headers, body: payload, credentials: "same-origin" });
    } catch {
      throw Object.assign(new Error("Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin."), { status: 0 });
    }
    const data = await r.json().catch(() => null);
    if (r.status === 401 && !quiet401) { showLogin("Oturumunuzun süresi doldu, lütfen tekrar giriş yapın."); }
    if (!r.ok) throw Object.assign(new Error((data && data.error) || "İşlem başarısız."), { status: r.status, data });
    return data;
  }

  // Dosya yükleme (ilerleme çubuğu için XMLHttpRequest)
  function uploadFiles(files, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      [...files].forEach(f => fd.append("files", f));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/media");
      xhr.setRequestHeader("X-CSRF-Token", state.csrf);
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* boş yanıt */ }
        if (xhr.status === 401) showLogin("Oturumunuzun süresi doldu.");
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error((data && data.error) || "Yükleme başarısız."), { data }));
      };
      xhr.onerror = () => reject(new Error("Yükleme sırasında bağlantı kesildi."));
      xhr.send(fd);
    });
  }

  const listOf = async (type, force) => {
    if (force || !state.lists[type]) state.lists[type] = await api("GET", `/entities/${type}`);
    return state.lists[type];
  };

  /* ============ Giriş / çıkış ============ */
  function showLogin(msg) {
    state.csrf = null;
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    $("#forgotForm").hidden = true;
    $("#loginForm").hidden = false;
    $("#loginOk").hidden = true;
    $("#editModal").open && $("#editModal").close();
    $("#mediaModal").open && $("#mediaModal").close();
    const err = $("#loginError");
    err.hidden = !msg;
    err.textContent = msg || "";
    setTimeout(() => $("#loginForm").username.focus(), 30);
  }

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = $("button[type=submit]", f), err = $("#loginError");
    err.hidden = true;
    btn.disabled = true;
    try {
      const d = await api("POST", "/login", { username: f.username.value.trim(), password: f.password.value }, { quiet401: true });
      f.password.value = "";
      await start(d);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });

  /* ============ Şifremi unuttum (e-postaya 6 haneli kod) ============ */
  const forgot = { form: $("#forgotForm"), step: 1 };
  function forgotStep(n, info) {
    const f = forgot.form;
    forgot.step = n;
    $("#forgotStep1").hidden = n !== 1;
    $("#forgotStep2").hidden = n !== 2;
    $("#forgotResend").hidden = n !== 2;
    $("#forgotSubmit").textContent = n === 1 ? "Kod gönder" : "Parolayı yenile";
    $("#forgotInfo").textContent = info || "";
    $("#forgotError").hidden = true;
    setTimeout(() => (n === 1 ? f.identity : f.code).focus(), 30);
  }
  $("#forgotOpen").addEventListener("click", () => {
    $("#loginForm").hidden = true;
    forgot.form.hidden = false;
    forgot.form.identity.value = $("#loginForm").username.value.trim();
    forgot.form.code.value = forgot.form.password.value = forgot.form.password2.value = "";
    forgotStep(1);
  });
  $("#forgotBack").addEventListener("click", () => showLogin());
  async function sendForgotCode() {
    const d = await api("POST", "/forgot", { identity: forgot.form.identity.value.trim() }, { quiet401: true });
    forgotStep(2, d.message);
  }
  $("#forgotResend").addEventListener("click", async () => {
    try { await sendForgotCode(); toast("Yeni kod istendi. Önceki kod artık geçersiz.", "ok"); }
    catch (ex) { $("#forgotError").textContent = ex.message; $("#forgotError").hidden = false; }
  });
  forgot.form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = forgot.form, err = $("#forgotError"), btn = $("#forgotSubmit");
    err.hidden = true;
    if (forgot.step === 1 && !f.identity.value.trim()) { err.textContent = "Kullanıcı adınızı ya da e-postanızı yazın."; err.hidden = false; return; }
    if (forgot.step === 2 && f.password.value !== f.password2.value) { err.textContent = "Yeni parolalar aynı değil."; err.hidden = false; return; }
    btn.disabled = true;
    try {
      if (forgot.step === 1) await sendForgotCode();
      else {
        await api("POST", "/reset", { identity: f.identity.value.trim(), code: f.code.value, password: f.password.value }, { quiet401: true });
        const user = f.identity.value.trim();
        f.password.value = f.password2.value = f.code.value = "";
        showLogin();
        if (!user.includes("@")) $("#loginForm").username.value = user;
        $("#loginOk").hidden = false;
        setTimeout(() => $("#loginForm").password.focus(), 40);
      }
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("POST", "/logout"); } catch { /* yine de çık */ }
    state.lists = {};
    showLogin();
  });

  async function start(me) {
    state.csrf = me.csrf;
    state.user = me.user;
    state.schema = state.schema || await api("GET", "/schema");
    $("#who").textContent = "👤 " + me.user.username;
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    buildNav();
    refreshBadge();
    route();
  }

  /* ============ Menü (sol kenar) ve yönlendirme ============ */
  const NAV = [
    ["Genel", [["#/", "Genel bakış"], ["#/rezervasyonlar", "Rezervasyonlar", "resBadge"]]],
    ["Menü", [["#/e/items", "Yiyecek & içecekler"], ["#/e/categories", "Kategoriler"], ["#/e/sections", "Menü bölümleri"], ["#/e/setmenus", "Fiks menüler"], ["#/ayar/menu", "Menü ayarları"]]],
    ["İçerik", [["#/e/rooms", "Konaklama odaları"], ["#/e/events", "Etkinlikler"], ["#/e/gallery", "Fotoğraf & video galerisi"], ["#/e/reviews", "Misafir yorumları"], ["#/ayar/reviews", "Yorum puanı"], ["#/ayar/notice", "Duyuru şeridi"], ["#/ayar/sections", "Bölümleri göster / gizle"], ["#/metinler", "Sayfa metinleri"], ["#/ayar/images", "Site görselleri"], ["#/ayar/ribbons", "Kayan yazılar"], ["#/e/credits", "Fotoğraf künyesi"]]],
    ["İletişim & rezervasyon", [["#/ayar/contact", "Telefon & WhatsApp"], ["#/ayar/address", "Adres & konum"], ["#/ayar/hours", "Çalışma saatleri"], ["#/ayar/reservation", "Rezervasyon ayarları"], ["#/ayar/social", "Sosyal medya"]]],
    ["Sistem", [["#/medya", "Medya kütüphanesi"], ["#/ayar/seo", "Arama motorları (SEO)"], ["#/kullanicilar", "Kullanıcılar"], ["#/hesap", "Hesabım"], ["#/guvenlik", "Güvenlik kayıtları", "secBadge"], ["#/eposta", "E-posta gönderimi"]]]
  ];

  function buildNav() {
    const nav = $("#sideNav");
    // Her başlık açılır-kapanır; aynı anda yalnızca biri açık kalır
    nav.replaceChildren(...NAV.map(([group, links]) => h("details.side__sec", { name: "sidenav" },
      h("summary.side__group", null, h("span", null, group), h("span.side__dot", { hidden: true })),
      ...links.map(([href, label, badge]) => h("a", { href }, h("span", null, label), badge ? h("span.badge", { id: badge, hidden: true }) : null))
    )));
  }

  // Kapalı başlıkta bekleyen bir şey varsa (yeni rezervasyon, güvenlik uyarısı) başlıkta nokta göster
  function syncNavDots() {
    $$("#sideNav .side__sec").forEach(sec => {
      sec.querySelector(".side__dot").hidden = ![...sec.querySelectorAll(".badge")].some(b => !b.hidden);
    });
  }

  async function refreshBadge() {
    try {
      const s = await api("GET", "/stats");
      const b = $("#resBadge");
      if (b) { b.textContent = s.reservationsNew; b.hidden = !s.reservationsNew; }
      const sb = $("#secBadge");
      if (sb) { sb.textContent = "!"; sb.hidden = !s.security.alerts7d; sb.title = `Son 7 günde ${s.security.alerts7d} önemli güvenlik olayı`; }
      syncNavDots();
      return s;
    } catch { return null; }
  }
  setInterval(() => { if (state.csrf) refreshBadge(); }, 60000);

  const sideToggle = open => $("#side").classList.toggle("is-open", open);
  $("#burger").addEventListener("click", () => sideToggle(true));
  $("#sideClose").addEventListener("click", () => sideToggle(false));

  function parseHash() {
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    return { path, params: new URLSearchParams(query || "") };
  }

  let renderToken = 0;
  async function route() {
    if (!state.csrf) return;
    sideToggle(false);
    const { path, params } = parseHash();
    const base = "#" + path;
    $$("#sideNav a").forEach(a => {
      if (a.getAttribute("href") === base) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    // Açık sayfanın başlığı açık dursun
    const cur = $('#sideNav a[aria-current="page"]');
    if (cur) cur.closest("details").open = true;
    const label = NAV.flatMap(g => g[1]).find(l => l[0] === base);
    $("#crumbs").textContent = label ? label[1] : "";

    const c = $("#content"), token = ++renderToken;
    c.replaceChildren(h("p.loading", null, "Yükleniyor…"));
    const page = h("div");
    try {
      const m = path.match(/^\/(e|ayar)\/(\w+)$/);
      if (path === "/") await viewDashboard(page);
      else if (m && m[1] === "e") await viewEntity(page, m[2], params);
      else if (m && m[1] === "ayar") await viewSettings(page, m[2]);
      else if (path === "/rezervasyonlar") await viewReservations(page, params);
      else if (path === "/metinler") await viewTexts(page);
      else if (path === "/medya") await viewMedia(page);
      else if (path === "/kullanicilar") await viewUsers(page);
      else if (path === "/hesap") await viewAccount(page);
      else if (path === "/guvenlik") await viewSecurity(page, params);
      else if (path === "/eposta") await viewMail(page);
      else page.append(h("p.empty", null, "Sayfa bulunamadı."));
    } catch (ex) {
      if (ex.status === 401) return;
      page.replaceChildren(h("div.card.card--note", null, h("strong", null, "Sayfa yüklenemedi: "), ex.message));
    }
    if (token !== renderToken) return; // bu arada başka sayfaya geçildi
    c.replaceChildren(page);
    c.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  const pageHead = (title, desc, ...actions) => h("div.page-head", null,
    h("div", null, h("h1", null, title), desc ? h("p", null, desc) : null),
    actions.length ? h("div.toolbar", { style: "margin:0" }, actions) : null);

  /* ============ Genel bakış ============ */
  const TYPE_LABEL = { sokak: "Sokak masası", teras: "Teras masası", konaklama: "Konaklama" };
  const STATUS_LABEL = { yeni: "Yeni", onaylandi: "Onaylandı", tamamlandi: "Tamamlandı", iptal: "İptal" };

  async function viewDashboard(page) {
    const s = await refreshBadge() || await api("GET", "/stats");
    const stat = (href, n, label, hot) => h("a.stat", { href, class: hot ? "stat--hot" : "" }, h("b", null, String(n)), h("span", null, label));
    page.append(
      pageHead("Genel bakış", `Hoş geldiniz, ${state.user.username}. Burada yaptığınız her değişiklik kaydedildiği anda sitede görünür.`,
        h("a.btn.btn--primary", { href: "/", target: "_blank", rel: "noopener" }, "Siteyi aç ↗")),
      securityCard(s.security),
      h("div.stats", null,
        stat("#/rezervasyonlar?status=yeni", s.reservationsNew, "Yeni rezervasyon talebi", s.reservationsNew > 0),
        stat("#/rezervasyonlar", s.reservationsUpcoming, "Yaklaşan rezervasyon"),
        stat("#/e/items", s.items, "Menüdeki ürün"),
        stat("#/e/categories", s.categories, "Menü kategorisi"),
        stat("#/e/rooms", s.rooms, "Konaklama odası"),
        stat("#/e/gallery", s.gallery, "Galeri öğesi"),
        stat("#/e/events", s.events, "Etkinlik"),
        stat("#/medya", s.media, "Yüklenen dosya")),
      h("div.card", null,
        h("h2", null, "Son rezervasyon talepleri"),
        s.latest.length ? s.latest.map(r => resSummary(r)) : h("p.muted", null, "Henüz rezervasyon talebi yok. Sitedeki formdan gelen talepler burada görünür."),
        s.latest.length ? h("a.btn", { href: "#/rezervasyonlar" }, "Tümünü gör →") : null),
      h("div.card", null,
        h("h2", null, "Hızlı işlemler"),
        h("div.toolbar", null,
          h("button.btn", { type: "button", onclick: () => openEditor("items", null) }, "+ Menüye ürün ekle"),
          h("button.btn", { type: "button", onclick: () => openEditor("rooms", null) }, "+ Oda ekle"),
          h("button.btn", { type: "button", onclick: () => openEditor("gallery", null) }, "+ Galeriye fotoğraf/video ekle"),
          h("button.btn", { type: "button", onclick: () => openEditor("events", null) }, "+ Etkinlik ekle"),
          h("a.btn", { href: "#/ayar/menu" }, "Fiyatları göster / gizle")))
    );
  }

  // Genel bakıştaki güvenlik özeti: sorun yoksa kısa bir "her şey yolunda" notu
  function securityCard(sec) {
    const todo = [];
    if (!sec.mailConfigured) todo.push(h("li", null, "E-posta gönderimi ayarlanmamış; şifre sıfırlama kodları ve uyarılar gönderilemez. ", h("a", { href: "#/eposta" }, "Ayarla →")));
    if (!sec.emailVerified) todo.push(h("li", null, "Hesabınıza doğrulanmış bir e-posta bağlı değil; şifrenizi unutursanız sıfırlayamazsınız. ", h("a", { href: "#/hesap" }, "E-posta ekle →")));
    if (sec.alerts7d) todo.push(h("li", null, `Son 7 günde ${sec.alerts7d} önemli güvenlik olayı var (kilitlenme, yeni yerden giriş, parola sıfırlama vb.). `, h("a", { href: "#/guvenlik?level=alert" }, "İncele →")));
    if (sec.failed24h >= 3) todo.push(h("li", null, `Son 24 saatte ${sec.failed24h} hatalı giriş / kod denemesi. `, h("a", { href: "#/guvenlik?level=warn" }, "İncele →")));
    if (!todo.length) return h("div.card.card--ok", null, h("strong", null, "🔒 Güvenlik: "), "her şey yolunda. ", h("a", { href: "#/guvenlik" }, "Güvenlik kayıtları →"));
    return h("div.card", { class: sec.alerts7d || sec.failed24h >= 3 ? "card--alert" : "card--note" }, h("h2", null, "🔒 Güvenlik"), h("ul", { style: "margin:0;padding-left:20px;display:grid;gap:6px" }, todo));
  }

  function resSummary(r) {
    const when = r.type === "konaklama" ? `${fmtDay(r.checkin)} → ${fmtDay(r.checkout)}` : `${fmtDay(r.date)} · ${r.time}`;
    return h("div.res", { style: "grid-template-columns:1fr" },
      h("div.res__head", null, h("strong", null, r.name), h("span.pill", { class: "pill--" + r.status }, STATUS_LABEL[r.status]), h("span.pill.pill--type", null, TYPE_LABEL[r.type])),
      h("div.res__info", null, h("span", null, when), h("span", null, `${r.guests} kişi`), h("span", null, r.phone)));
  }

  /* ============ İçerik listeleri (menü, odalar, galeri…) ============ */
  async function viewEntity(page, type, params) {
    const def = state.schema.entities[type];
    if (!def) { page.append(h("p.empty", null, "Bilinmeyen içerik türü.")); return; }
    const pf = def.parent ? def.fields.find(f => f.key === def.parent) : null;
    let parent = params.get("parent") || "";
    let parentList = [];
    if (pf) parentList = await listOf(pf.entity, true);
    if (pf && !parent && type === "items" && parentList.length) parent = String(parentList[0].id);

    const listEl = h("div.list");
    const search = h("input", { type: "search", placeholder: "Ara…", "aria-label": "Listede ara" });
    let items = [];

    const parentSel = pf ? h("select", { "aria-label": pf.label, onchange: () => { location.hash = `#/e/${type}${parentSel.value ? "?parent=" + parentSel.value : ""}`; } },
      h("option", { value: "" }, `Tüm ${pf.label.toLocaleLowerCase("tr")}ler`),
      parentList.map(p => h("option", { value: String(p.id), selected: String(p.id) === parent }, tr(p[state.schema.entities[pf.entity].title]) + (p.active ? "" : " (gizli)")))) : null;

    page.append(
      pageHead(def.label, def.help, h("button.btn.btn--primary", { type: "button", onclick: () => openEditor(type, null, pf && parent ? { [pf.key]: Number(parent) } : {}) }, `+ Yeni ${def.single.toLocaleLowerCase("tr")}`)),
      h("div.toolbar", null, parentSel, search, h("span.muted", null, pf && !parent
        ? `Sıralamayı değiştirmek için önce bir ${pf.label.toLocaleLowerCase("tr")} seçin.`
        : "Sıralamak için satırları ⋮⋮ tutamağından sürükleyin ya da oklarla taşıyın.")),
      listEl);

    const parentName = id => { const p = parentList.find(x => x.id === id); return p ? tr(p[state.schema.entities[pf.entity].title]) : ""; };

    async function load() {
      items = await api("GET", `/entities/${type}${pf && parent ? "?parent=" + parent : ""}`);
      state.lists[type] = null;
      draw();
    }

    function draw() {
      const q = search.value.trim().toLocaleLowerCase("tr");
      const shown = q ? items.filter(it => titleOf(def, it).toLocaleLowerCase("tr").includes(q)) : items;
      if (!shown.length) {
        listEl.replaceChildren(h("p.empty", null, q ? "Aramayla eşleşen kayıt yok." : "Henüz kayıt yok. “Yeni” düğmesiyle ekleyin."));
        return;
      }
      // Arama yapılırken ya da farklı gruplar karışık listelenirken sıralama kapalıdır
      listEl.replaceChildren(...shown.map((it, i) => rowEl(it, i, shown, !q && !(pf && !parent))));
    }

    function rowEl(it, i, shown, sortable) {
      let thumbVal = def.image ? it[def.image] : null;
      if (Array.isArray(thumbVal)) thumbVal = thumbVal[0];
      const subs = [];
      if (pf && !parent) subs.push(parentName(it[pf.key]));
      if (def.subtitle === "price") subs.push(it.price != null ? money(it.price) : (it.prices && it.prices.length ? it.prices.map(p => `${tr(p.label)} ${money(p.price)}`).join(" · ") : ""));
      if (def.subtitle === "rating") subs.push("★".repeat(it.rating || 0));
      if (type === "gallery" && isVideo(it.media)) subs.push("Video");
      if (type === "categories" || type === "sections") subs.push("#" + it.slug);
      const sw = h("input", { type: "checkbox", checked: it.active, "aria-label": "Sitede göster" });
      sw.addEventListener("change", async () => {
        try {
          const upd = await api("PATCH", `/entities/${type}/${it.id}/active`, { active: sw.checked });
          Object.assign(it, upd);
          row.classList.toggle("is-off", !upd.active);
          toast(upd.active ? "Sitede gösteriliyor." : "Siteden gizlendi.", "ok");
        } catch (ex) { sw.checked = !sw.checked; toast(ex.message, "bad"); }
      });
      const move = async dir => {
        const j = i + dir;
        if (j < 0 || j >= shown.length) return;
        const ids = shown.map(x => x.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await saveOrder(ids);
      };
      const row = h("div.row", { class: it.active ? "" : "is-off", draggable: sortable, "data-id": it.id },
        h("span.handle", { title: "Sürükle", "aria-hidden": "true" }, sortable ? "⋮⋮" : ""),
        h("div.row__thumb", null, def.image ? mediaThumb(thumbVal, 120) : null),
        h("div.row__title", null, h("strong", null, titleOf(def, it) || "(adsız)"), h("small", null, [...subs.filter(Boolean), it.active ? "" : "Sitede gizli"].filter(Boolean).join(" · "))),
        h("div.row__actions", null,
          h("div.row__move", null,
            h("button.icon-btn", { type: "button", title: "Yukarı taşı", "aria-label": "Yukarı taşı", disabled: !sortable || i === 0, onclick: () => move(-1) }, "↑"),
            h("button.icon-btn", { type: "button", title: "Aşağı taşı", "aria-label": "Aşağı taşı", disabled: !sortable || i === shown.length - 1, onclick: () => move(1) }, "↓")),
          h("label.switch", { title: "Sitede göster / gizle" }, sw, h("span")),
          h("button.btn.btn--sm", { type: "button", onclick: () => openEditor(type, it) }, "Düzenle"),
          // Kısa adı (slug) benzersiz olan türler (bölüm, kategori) kopyalanmaz
          def.fields.some(f => f.unique) ? null : h("button.btn.btn--sm", { type: "button", title: "Bu kaydın bir kopyasını oluştur", onclick: () => duplicate(it) }, "Kopyala"),
          h("button.btn.btn--sm.btn--danger", { type: "button", onclick: () => removeItem(it) }, "Sil")));
      if (sortable) {
        row.addEventListener("dragstart", e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(it.id)); row.classList.add("is-dragging"); });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("is-over"); });
        row.addEventListener("dragleave", () => row.classList.remove("is-over"));
        row.addEventListener("drop", async e => {
          e.preventDefault();
          row.classList.remove("is-over");
          const from = Number(e.dataTransfer.getData("text/plain"));
          if (!from || from === it.id) return;
          const ids = shown.map(x => x.id).filter(x => x !== from);
          ids.splice(ids.indexOf(it.id) + (shown.findIndex(x => x.id === from) < i ? 1 : 0), 0, from);
          await saveOrder(ids);
        });
      }
      return row;
    }

    async function saveOrder(ids) {
      try {
        await api("POST", `/entities/${type}/reorder`, { ids });
        items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        draw();
        toast("Sıralama kaydedildi.", "ok");
      } catch (ex) { toast(ex.message, "bad"); }
    }

    // Kopya, aynı grubun sonuna eklenir ve düzenlemek için hemen açılır
    async function duplicate(it) {
      const body = { active: it.active };
      def.fields.forEach(f => { body[f.key] = it[f.key]; });
      const tf = def.fields.find(f => f.key === def.title);
      if (tf && tf.type.startsWith("i18n")) body[def.title] = { ...it[def.title], tr: `${it[def.title].tr} (kopya)`.slice(0, tf.max || 200) };
      else if (tf) body[def.title] = `${it[def.title]} (kopya)`.slice(0, tf.max || 200);
      try {
        const copy = await api("POST", `/entities/${type}`, body);
        toast("Kopya oluşturuldu.", "ok");
        await load();
        openEditor(type, copy);
      } catch (ex) { toast(ex.message, "bad"); }
    }

    async function removeItem(it) {
      if (!confirm(`“${titleOf(def, it)}” silinsin mi? Bu işlem geri alınamaz.\n\nSadece geçici olarak kaldırmak istiyorsanız “Sitede göster” anahtarını kapatabilirsiniz.`)) return;
      try {
        await api("DELETE", `/entities/${type}/${it.id}`);
        toast("Silindi.", "ok");
        load();
      } catch (ex) { toast(ex.message, "bad"); }
    }

    search.addEventListener("input", draw);
    page.addEventListener("entity-saved", load);
    await load();
  }

  const titleOf = (def, it) => tr(it[def.title]) || (def.fields.find(f => f.key === def.title) || {}).label || "";

  /* ============ Kayıt formu (ekle / düzenle) ============ */
  const editModal = $("#editModal"), editForm = $("#editForm");
  let editCtx = null;
  $$("[data-close]", editModal).forEach(b => b.addEventListener("click", () => editModal.close()));
  editModal.addEventListener("close", () => { if (editCtx) { editCtx.resolve(editCtx.saved); editCtx = null; } });

  function openEditor(type, item, presets = {}) {
    const def = state.schema.entities[type];
    return new Promise(resolve => {
      const controls = def.fields.map(f => control(f, item ? item[f.key] : (presets[f.key] ?? f.default)));
      $("#editTitle").textContent = item ? `${def.single} düzenle` : `Yeni ${def.single.toLocaleLowerCase("tr")}`;
      $("#editBody").replaceChildren(...controls.map(c => c.el));
      $("#editActive").checked = item ? item.active : true;
      $("#editError").hidden = true;
      editCtx = { type, def, item, controls, resolve, saved: null };

      // Yeni kayıtta kısa ad (slug) addan otomatik üretilir
      const slugCtl = controls.find(c => c.field.type === "slug"), nameCtl = controls.find(c => c.field.key === "name");
      if (slugCtl && nameCtl && !item) {
        let touched = false;
        slugCtl.input.addEventListener("input", () => { touched = true; });
        nameCtl.trInput.addEventListener("input", () => { if (!touched) slugCtl.input.value = slugify(nameCtl.trInput.value); });
      }
      editModal.showModal();
      const first = $("input, textarea, select", $("#editBody"));
      if (first) first.focus();
    });
  }

  editForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (!editCtx) return;
    const { type, item, controls } = editCtx;
    const body = { active: $("#editActive").checked };
    controls.forEach(c => { c.setError(null); body[c.field.key] = c.get(); });
    $("#editError").hidden = true;
    const btn = $("#editSave");
    btn.disabled = true;
    try {
      const saved = item ? await api("PUT", `/entities/${type}/${item.id}`, body) : await api("POST", `/entities/${type}`, body);
      editCtx.saved = saved;
      state.lists[type] = null;
      editModal.close();
      toast("Kaydedildi — sitede güncellendi.", "ok");
      const page = $("#content > div");
      if (page && parseHash().path === "/e/" + type) page.dispatchEvent(new Event("entity-saved"));
    } catch (ex) {
      const fields = (ex.data && ex.data.fields) || {};
      controls.forEach(c => { if (fields[c.field.key]) c.setError(fields[c.field.key]); });
      $("#editError").textContent = ex.message;
      $("#editError").hidden = false;
      const bad = $(".is-invalid", $("#editBody"));
      if (bad) bad.scrollIntoView({ block: "center", behavior: "smooth" });
    } finally { btn.disabled = false; }
  });

  /* --- Alan türüne göre form denetimi --- */
  const INPUT_TYPE = { url: "url", email: "email", tel: "tel", time: "time", digits: "text", text: "text", slug: "text", link: "text" };

  function control(f, value) {
    const err = h("span.field-error", { hidden: true });
    const ctl = { field: f, get: () => null };
    let body;

    switch (f.type) {
      case "text": case "slug": case "url": case "email": case "tel": case "digits": case "time": case "link": {
        const input = h("input", { type: INPUT_TYPE[f.type], value: value ?? "", maxlength: f.max || (f.type === "url" || f.type === "link" ? 500 : 200), placeholder: f.type === "url" ? "https://…" : f.type === "link" ? "https://… ya da #etkinlikler" : null, inputmode: f.type === "digits" ? "numeric" : null });
        ctl.input = input;
        ctl.get = () => input.value;
        body = input;
        break;
      }
      case "textarea": {
        const ta = h("textarea", { maxlength: f.max || 2000, rows: 4 });
        ta.value = value ?? "";
        ctl.get = () => ta.value;
        body = ta;
        break;
      }
      case "i18n": case "i18ntext": {
        const multi = f.type === "i18ntext";
        const mk = v => multi ? Object.assign(h("textarea", { maxlength: f.max || 2000, rows: 3 }), { value: v || "" }) : h("input", { type: "text", value: v || "", maxlength: f.max || 200 });
        const a = mk(value && value.tr), b = mk(value && value.en);
        ctl.trInput = a;
        ctl.get = () => ({ tr: a.value, en: b.value });
        body = h("div.pair", null, h("label", null, h("em", null, "TÜRKÇE"), a), h("label", null, h("em", null, "İNGİLİZCE (isteğe bağlı)"), b));
        break;
      }
      case "int": case "number": case "money": {
        const input = h("input", { type: "number", value: value ?? "", step: f.type === "int" ? "1" : "any", min: f.min ?? (f.type === "money" ? 0 : null), max: f.max ?? null, inputmode: "decimal" });
        ctl.get = () => input.value === "" ? null : Number(input.value);
        body = f.type === "money" ? h("div.money", null, input, h("span.muted", null, "₺")) : input;
        break;
      }
      case "bool": {
        const cb = h("input", { type: "checkbox", checked: !!value });
        ctl.get = () => cb.checked;
        body = h("label.switch", null, cb, h("span"), f.label);
        break;
      }
      case "select": {
        const sel = h("select", null, f.options.map(o => h("option", { value: o, selected: o === (value || f.default) }, o === "auto" ? "Otomatik" : o)));
        ctl.get = () => sel.value;
        body = sel;
        break;
      }
      case "tags": {
        const set = new Set(value || []);
        const boxes = f.options.map(o => h("input", { type: "checkbox", value: o, checked: set.has(o) }));
        ctl.get = () => boxes.filter(b => b.checked).map(b => b.value);
        body = h("div.chips", null, boxes.map((b, i) => h("label.chip", null, b, (f.optionLabels || {})[f.options[i]] || f.options[i])));
        break;
      }
      case "ref": {
        const sel = h("select", null, h("option", { value: "" }, f.required ? "— Seçin —" : "— Yok —"));
        ctl.get = () => sel.value ? Number(sel.value) : null;
        refOptions(f, sel, value);
        body = sel;
        break;
      }
      case "image": case "media": {
        let cur = value || "";
        const preview = h("div.pick__preview");
        const paint = () => { preview.replaceChildren(cur ? mediaThumb(cur, 300) : h("span", null, "Seçilmedi")); clearBtn.hidden = !cur; };
        const clearBtn = h("button.btn.btn--sm", { type: "button", onclick: () => { cur = ""; paint(); } }, "Kaldır");
        const pickBtn = h("button.btn.btn--sm", {
          type: "button",
          onclick: async () => { const r = await pickMedia({ kind: f.type === "media" ? "any" : "image" }); if (r) { cur = r[0]; paint(); } }
        }, "Seç / yükle");
        paint();
        ctl.get = () => cur;
        body = h("div.pick", null, preview, pickBtn, clearBtn);
        break;
      }
      case "images": {
        let list = [...(value || [])];
        const box = h("div.thumbs");
        const paint = () => box.replaceChildren(...list.map((v, i) => h("div.thumbs__item", null,
          h("img", { src: imgUrl(v, 240), alt: "" }),
          h("div.thumbs__bar", null,
            h("button.icon-btn", { type: "button", "aria-label": "Sola taşı", disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; paint(); } }, "←"),
            h("button.icon-btn", { type: "button", "aria-label": "Kaldır", onclick: () => { list.splice(i, 1); paint(); } }, "×"),
            h("button.icon-btn", { type: "button", "aria-label": "Sağa taşı", disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; paint(); } }, "→")))));
        paint();
        ctl.get = () => list;
        body = h("div", null, box, h("button.btn.btn--sm", {
          type: "button",
          onclick: async () => { const r = await pickMedia({ kind: "image", multiple: true }); if (r) { list = [...list, ...r.filter(x => !list.includes(x))]; paint(); } }
        }, "+ Görsel ekle"));
        break;
      }
      case "i18nlist": {
        const lines = h("div.lines");
        const add = v => {
          const a = h("input", { type: "text", value: (v && v.tr) || "", placeholder: "Türkçe", maxlength: f.max || 160 });
          const b = h("input", { type: "text", value: (v && v.en) || "", placeholder: "İngilizce", maxlength: f.max || 160 });
          const line = h("div.line", null, a, b, h("div.line__tools", null,
            h("button.icon-btn", { type: "button", "aria-label": "Yukarı", onclick: () => line.previousElementSibling && lines.insertBefore(line, line.previousElementSibling) }, "↑"),
            h("button.icon-btn", { type: "button", "aria-label": "Sil", onclick: () => line.remove() }, "×")));
          line._get = () => ({ tr: a.value, en: b.value });
          lines.append(line);
          return a;
        };
        (value || []).forEach(add);
        ctl.get = () => [...lines.children].map(l => l._get()).filter(x => x.tr.trim() || x.en.trim());
        body = h("div", null, lines, h("button.btn.btn--sm", { type: "button", onclick: () => add().focus() }, "+ Satır ekle"));
        break;
      }
      case "prices": {
        const lines = h("div.lines");
        const add = v => {
          const a = h("input", { type: "text", value: (v && v.label && v.label.tr) || "", placeholder: "Seçenek (ör. Kadeh)", maxlength: 40 });
          const b = h("input", { type: "text", value: (v && v.label && v.label.en) || "", placeholder: "İngilizcesi (Glass)", maxlength: 40 });
          const p = h("input", { type: "number", value: v ? v.price : "", min: 0, step: "any", placeholder: "Fiyat" });
          const line = h("div.line.line--price", null, a, b, p, h("div.line__tools", null, h("button.icon-btn", { type: "button", "aria-label": "Sil", onclick: () => line.remove() }, "×")));
          line._get = () => ({ label: { tr: a.value, en: b.value }, price: p.value === "" ? null : Number(p.value) });
          lines.append(line);
          return a;
        };
        (value || []).forEach(add);
        ctl.get = () => [...lines.children].map(l => l._get()).filter(x => x.label.tr.trim() || x.label.en.trim() || x.price != null);
        body = h("div", null, lines, h("button.btn.btn--sm", { type: "button", onclick: () => add().focus() }, "+ Fiyat seçeneği ekle"));
        break;
      }
      default:
        body = h("span.muted", null, "Desteklenmeyen alan");
    }

    const isBool = f.type === "bool";
    ctl.el = h("div.field", { "data-field": f.key },
      isBool ? null : h("span", null, f.label + (f.required ? " *" : "")),
      body,
      f.help ? h("small.help", null, f.help) : null,
      err);
    ctl.setError = msg => {
      err.hidden = !msg;
      err.textContent = msg || "";
      ctl.el.classList.toggle("is-invalid", !!msg);
    };
    return ctl;
  }

  async function refOptions(f, sel, value) {
    const list = await listOf(f.entity);
    const def = state.schema.entities[f.entity];
    const label = x => tr(x[def.title]) + (x.active ? "" : " (gizli)");
    // Kategori seçerken bölümlere göre grupla
    if (def.parent) {
      const pf = def.fields.find(x => x.key === def.parent);
      const parents = await listOf(pf.entity);
      const pdef = state.schema.entities[pf.entity];
      parents.forEach(p => {
        const kids = list.filter(x => x[pf.key] === p.id);
        if (kids.length) sel.append(h("optgroup", { label: tr(p[pdef.title]) }, kids.map(x => h("option", { value: String(x.id), selected: x.id === value }, label(x)))));
      });
    } else {
      list.forEach(x => sel.append(h("option", { value: String(x.id), selected: x.id === value }, label(x))));
    }
  }

  /* ============ Medya seçici ve kütüphane ============ */
  const mediaModal = $("#mediaModal");
  let pickCtx = null;
  $$("[data-close]", mediaModal).forEach(b => b.addEventListener("click", () => mediaModal.close()));
  mediaModal.addEventListener("close", () => { if (pickCtx) { pickCtx.resolve(pickCtx.result); pickCtx = null; } });

  function pickMedia({ kind = "image", multiple = false }) {
    return new Promise(resolve => {
      const selected = new Set();
      pickCtx = { resolve, result: null };
      const choose = $("#mediaChoose");
      choose.disabled = true;
      choose.onclick = () => { pickCtx.result = [...selected]; mediaModal.close(); };
      $("#mediaTitle").textContent = kind === "image" ? (multiple ? "Görselleri seçin" : "Görsel seçin") : "Görsel veya video seçin";
      $("#mediaHint").textContent = multiple ? "Birden fazla seçebilirsiniz." : "";
      const grid = h("div.grid");
      const draw = list => {
        const shown = list.filter(m => kind === "any" || m.kind === "image");
        grid.replaceChildren(...(shown.length ? shown.map(m => {
          const tile = h("button.tile", { type: "button", class: selected.has(m.path) ? "is-selected" : "", title: m.name || m.path },
            h("div.tile__media", null, mediaThumb(m.path, 300)),
            m.kind === "video" ? h("span.tile__kind", null, "Video") : null,
            h("div.tile__meta", null, m.name || m.path));
          tile.addEventListener("click", () => {
            if (!multiple) { selected.clear(); $$(".tile", grid).forEach(t => t.classList.remove("is-selected")); }
            selected.has(m.path) ? selected.delete(m.path) : selected.add(m.path);
            tile.classList.toggle("is-selected", selected.has(m.path));
            choose.disabled = !selected.size;
          });
          tile.addEventListener("dblclick", () => { if (!multiple) { pickCtx.result = [m.path]; mediaModal.close(); } });
          return tile;
        }) : [h("p.empty", null, "Kütüphanede henüz dosya yok. Yukarıdan yükleyin.")]));
      };
      const drop = uploader(kind === "image" ? "image/*" : "image/*,video/mp4,video/webm", saved => {
        saved.forEach(m => { if (kind === "any" || m.kind === "image") { if (!multiple) selected.clear(); selected.add(m.path); } });
        choose.disabled = !selected.size;
        load();
      });
      const load = async () => draw(await api("GET", "/media"));
      $("#mediaBody").replaceChildren(drop, grid);
      mediaModal.showModal();
      load().catch(ex => toast(ex.message, "bad"));
    });
  }

  // Sürükle-bırak destekli yükleme alanı
  function uploader(accept, onDone) {
    const input = h("input", { type: "file", multiple: true, accept, hidden: true });
    const bar = h("span"), progress = h("div.progress", { hidden: true }, bar);
    const status = h("p.muted", { style: "margin:8px 0 0" });
    const drop = h("div.drop", null,
      h("p", null, "Dosyaları buraya sürükleyin ya da"),
      h("button.btn.btn--primary", { type: "button", onclick: () => input.click() }, "Bilgisayardan seç"),
      h("p.muted", { style: "margin:10px 0 0" }, "Görsel: JPG, PNG, WEBP, GIF, AVIF (en fazla 15 MB) · Video: MP4, WEBM (en fazla 200 MB)"),
      input, progress, status);
    const send = async files => {
      if (!files.length) return;
      progress.hidden = false;
      bar.style.width = "0";
      status.textContent = `${files.length} dosya yükleniyor…`;
      try {
        const out = await uploadFiles(files, p => { bar.style.width = Math.round(p * 100) + "%"; });
        status.textContent = `${out.saved.length} dosya yüklendi.` + (out.rejected.length ? " Yüklenemeyenler: " + out.rejected.map(r => `${r.name} (${r.error})`).join(", ") : "");
        if (out.rejected.length) toast("Bazı dosyalar yüklenemedi.", "bad"); else toast("Yükleme tamamlandı.", "ok");
        onDone(out.saved);
      } catch (ex) {
        status.textContent = ex.message;
        toast(ex.message, "bad");
      } finally {
        progress.hidden = true;
        input.value = "";
      }
    };
    input.addEventListener("change", () => send([...input.files]));
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("is-over"); send([...e.dataTransfer.files]); });
    return drop;
  }

  async function viewMedia(page) {
    let filter = "all";
    const grid = h("div.grid");
    const tabs = h("div.tabs", null, [["all", "Tümü"], ["image", "Görseller"], ["video", "Videolar"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === filter), onclick: e => { filter = k; $$("button", tabs).forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); load(); } }, l)));
    const load = async () => {
      const list = (await api("GET", "/media")).filter(m => filter === "all" || m.kind === filter);
      grid.replaceChildren(...(list.length ? list.map(m => h("div.tile", null,
        h("a.tile__media", { href: m.path, target: "_blank", rel: "noopener" }, mediaThumb(m.path, 300)),
        m.kind === "video" ? h("span.tile__kind", null, "Video") : null,
        h("div.tile__meta", { title: m.name }, `${m.name || m.path} · ${fmtSize(m.size)}`),
        h("div.tile__del", null, h("button.icon-btn", {
          type: "button", title: "Sil", "aria-label": "Sil",
          onclick: async () => {
            if (!confirm(`“${m.name || m.path}” kalıcı olarak silinsin mi?`)) return;
            try { await api("DELETE", `/media/${m.id}`); toast("Dosya silindi.", "ok"); load(); } catch (ex) { toast(ex.message, "bad"); }
          }
        }, "×")))) : [h("p.empty", null, "Bu filtrede dosya yok.")]));
    };
    page.append(
      pageHead("Medya kütüphanesi", "Sitede kullanılan tüm fotoğraf ve videolar. Bir dosya sitede kullanılıyorsa silinmesine izin verilmez; önce kullanıldığı yerden kaldırın."),
      uploader("image/*,video/mp4,video/webm", () => load()), tabs, grid);
    await load();
  }

  /* ============ Ayarlar ============ */
  async function viewSettings(page, group) {
    const g = state.schema.settings.find(x => x.group === group);
    if (!g) { page.append(h("p.empty", null, "Bilinmeyen ayar grubu.")); return; }
    const values = await api("GET", "/settings");
    const controls = g.fields.map(f => control(f, values[f.key] ?? f.default));
    const err = h("p.form-error", { hidden: true, role: "alert" });
    const btn = h("button.btn.btn--primary", { type: "submit" }, "Kaydet");
    const form = h("form.card", { novalidate: true }, controls.map(c => c.el), err, btn);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const body = {};
      controls.forEach(c => { c.setError(null); body[c.field.key] = c.get(); });
      err.hidden = true;
      btn.disabled = true;
      try {
        await api("PUT", `/settings/${group}`, body);
        toast("Kaydedildi — sitede güncellendi.", "ok");
      } catch (ex) {
        const fields = (ex.data && ex.data.fields) || {};
        controls.forEach(c => { if (fields[c.field.key]) c.setError(fields[c.field.key]); });
        err.textContent = ex.message;
        err.hidden = false;
      } finally { btn.disabled = false; }
    });
    page.append(pageHead(g.label, g.help), form);
  }

  /* ============ Sayfa metinleri ============ */
  const TEXT_GROUPS = {
    brand: "Logo yanındaki yazı", skip: "Erişilebilirlik", nav: "Üst menü bağlantıları", cta: "Düğmeler", hero: "Giriş (hero) bölümü", info: "Bilgi şeridi",
    story: "Hikâyemiz", menu: "Menü bölümü", set: "Fiks menü kutusu", events: "Etkinlikler bölümü",
    gallery: "Galeri bölümü", stay: "Konaklama bölümü", rooms: "Oda kartları", rev: "Yorumlar bölümü", res: "Rezervasyon bölümü",
    f: "Rezervasyon formu", c: "İletişim & konum", foot: "Alt bilgi (footer)", mb: "Mobil alt düğmeler"
  };

  async function viewTexts(page) {
    const texts = await api("GET", "/texts");
    const search = h("input", { type: "search", placeholder: "Metinlerde ara… (ör. gün batımı)", "aria-label": "Metinlerde ara" });
    const box = h("div");
    const groups = {};
    texts.forEach(t => { const g = t.key.split(".")[0]; (groups[g] ||= []).push(t); });
    const rows = [];
    const order = Object.keys(TEXT_GROUPS).filter(k => groups[k]).concat(Object.keys(groups).filter(k => !TEXT_GROUPS[k]));
    order.forEach(g => {
      const card = h("div.card.text-group", null, h("h2", null, TEXT_GROUPS[g] || g));
      groups[g].forEach(t => {
        const a = h("textarea", { rows: 2, maxlength: 2000, "aria-label": t.key + " Türkçe" }); a.value = t.tr;
        const b = h("textarea", { rows: 2, maxlength: 2000, "aria-label": t.key + " İngilizce" }); b.value = t.en;
        const save = h("button.btn.btn--sm.btn--primary", { type: "button", disabled: true }, "Kaydet");
        const dirty = () => { save.disabled = a.value === t.tr && b.value === t.en; };
        a.addEventListener("input", dirty);
        b.addEventListener("input", dirty);
        save.addEventListener("click", async () => {
          save.disabled = true;
          try {
            const out = await api("PUT", `/texts/${encodeURIComponent(t.key)}`, { tr: a.value, en: b.value });
            t.tr = out.tr; t.en = out.en;
            a.classList.remove("is-invalid");
            toast("Metin kaydedildi.", "ok");
          } catch (ex) { a.classList.add("is-invalid"); toast(ex.message, "bad"); dirty(); }
        });
        const row = h("div.text-row", null, h("code", null, t.key), h("label", null, h("span.muted", null, "Türkçe"), a), h("label", null, h("span.muted", null, "İngilizce"), b), save);
        row._hay = (t.key + " " + t.tr + " " + t.en).toLocaleLowerCase("tr");
        rows.push(row);
        card.append(row);
      });
      box.append(card);
    });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLocaleLowerCase("tr");
      rows.forEach(r => { r.hidden = q && !r._hay.includes(q); });
      $$(".text-group", box).forEach(c => { c.hidden = !$$(".text-row", c).some(r => !r.hidden); });
    });
    page.append(
      pageHead("Sayfa metinleri", "Sitedeki başlıklar, paragraflar ve düğme yazıları. Vurgulu (italik turuncu) yazı için kelimeyi <em>…</em> arasına alın; satır atlamak için Enter kullanın. İngilizce boş bırakılırsa İngilizce sayfada Türkçesi görünür."),
      h("div.toolbar", null, search), box);
  }

  /* ============ Rezervasyonlar ============ */
  async function viewReservations(page, params) {
    let status = params.get("status") || "";
    const list = h("div");
    const tabs = h("div.tabs", null, [["", "Tümü"], ...Object.entries(STATUS_LABEL)].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === status), onclick: () => { location.hash = "#/rezervasyonlar" + (k ? "?status=" + k : ""); } }, l)));
    const load = async () => {
      const rows = await api("GET", "/reservations" + (status ? "?status=" + status : ""));
      list.replaceChildren(...(rows.length ? rows.map(resCard) : [h("p.empty", null, "Bu durumda rezervasyon yok.")]));
      refreshBadge();
    };
    const waNumber = p => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("0")) d = "9" + d; else if (d.length === 10 && d.startsWith("5")) d = "90" + d; return d; };

    function resCard(r) {
      const stay = r.type === "konaklama";
      const nights = stay ? Math.round((new Date(r.checkout) - new Date(r.checkin)) / 864e5) : 0;
      const sel = h("select.status-select", { "aria-label": "Durum" }, Object.entries(STATUS_LABEL).map(([k, l]) => h("option", { value: k, selected: k === r.status }, l)));
      sel.addEventListener("change", async () => {
        try { await api("PATCH", `/reservations/${r.id}`, { status: sel.value }); toast("Durum güncellendi.", "ok"); load(); } catch (ex) { toast(ex.message, "bad"); }
      });
      const note = h("input", { type: "text", value: r.admin_note || "", placeholder: "İç not (yalnızca panelde görünür)", maxlength: 1000 });
      return h("div.res", null,
        h("div.res__head", null, h("strong", null, r.name), h("span.pill", { class: "pill--" + r.status }, STATUS_LABEL[r.status]), h("span.pill.pill--type", null, TYPE_LABEL[r.type]), h("span.muted", null, "Talep: " + fmtDate(r.created_at))),
        h("div.res__info", null,
          h("span", null, h("b", null, "Telefon: "), h("a", { href: "tel:" + r.phone.replace(/[^\d+]/g, "") }, r.phone)),
          stay
            ? [h("span", null, h("b", null, "Giriş: "), fmtDay(r.checkin)), h("span", null, h("b", null, "Çıkış: "), `${fmtDay(r.checkout)} (${nights} gece)`), h("span", null, h("b", null, "Kahvaltı: "), r.breakfast ? "Evet" : "Hayır"), r.room_name ? h("span", null, h("b", null, "Oda: "), r.room_name) : null]
            : [h("span", null, h("b", null, "Tarih: "), fmtDay(r.date)), h("span", null, h("b", null, "Saat: "), r.time)],
          h("span", null, h("b", null, "Kişi: "), r.guests),
          h("span", null, h("b", null, "Dil: "), r.lang === "en" ? "İngilizce" : "Türkçe")),
        r.note ? h("p.res__note", null, r.note) : null,
        h("div.res__side", null, sel,
          h("a.btn.btn--sm", { href: `https://wa.me/${waNumber(r.phone)}`, target: "_blank", rel: "noopener" }, "WhatsApp'tan yaz"),
          h("button.btn.btn--sm.btn--danger", {
            type: "button",
            onclick: async () => {
              if (!confirm(`${r.name} adlı misafirin talebi silinsin mi?`)) return;
              try { await api("DELETE", `/reservations/${r.id}`); toast("Rezervasyon silindi.", "ok"); load(); } catch (ex) { toast(ex.message, "bad"); }
            }
          }, "Sil")),
        h("div.res__admin", null, note, h("button.btn.btn--sm", {
          type: "button",
          onclick: async () => { try { await api("PATCH", `/reservations/${r.id}`, { adminNote: note.value }); toast("Not kaydedildi.", "ok"); } catch (ex) { toast(ex.message, "bad"); } }
        }, "Notu kaydet")));
    }

    page.append(pageHead("Rezervasyonlar", "Sitedeki rezervasyon formundan gelen talepler. Misafiri arayıp onayladıktan sonra durumu “Onaylandı” yapın."), tabs, list);
    await load();
  }

  /* ============ Kullanıcılar ve hesap ============ */
  async function viewUsers(page) {
    const list = h("div.list");
    const load = async () => {
      const users = await api("GET", "/users");
      list.replaceChildren(...users.map(u => h("div.row", { style: "grid-template-columns:1fr auto" },
        h("div.row__title", null, h("strong", null, u.username + (u.id === state.user.id ? " (siz)" : "")), h("small", null, `${u.email ? "E-posta: " + u.email : "⚠ Doğrulanmış e-posta yok"} · Oluşturma: ${fmtDate(u.createdAt)} · Son giriş: ${u.lastLoginAt ? fmtDate(u.lastLoginAt) : "hiç"}`)),
        u.id === state.user.id ? h("span") : h("button.btn.btn--sm.btn--danger", {
          type: "button",
          onclick: async () => {
            if (!confirm(`“${u.username}” kullanıcısı silinsin mi?`)) return;
            try { await api("DELETE", `/users/${u.id}`); toast("Kullanıcı silindi.", "ok"); load(); } catch (ex) { toast(ex.message, "bad"); }
          }
        }, "Sil"))));
    };
    const un = h("input", { type: "text", autocomplete: "off", maxlength: 40, required: true });
    const pw = h("input", { type: "password", autocomplete: "new-password", maxlength: 200, required: true });
    const err = h("p.form-error", { hidden: true });
    const form = h("form.card", { novalidate: true },
      h("h2", null, "Yeni yönetici ekle"),
      h("label.field", null, h("span", null, "Kullanıcı adı"), un),
      h("label.field", null, h("span", null, "Parola"), pw, h("small.help", null, "En az 10 karakter; en az bir harf ve bir rakam.")),
      err, h("button.btn.btn--primary", { type: "submit" }, "Ekle"));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      err.hidden = true;
      try {
        await api("POST", "/users", { username: un.value.trim(), password: pw.value });
        un.value = pw.value = "";
        toast("Kullanıcı eklendi.", "ok");
        load();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    page.append(pageHead("Kullanıcılar", "Panele giriş yapabilen kişiler. Her kişiye ayrı hesap açın; parolaları paylaşmayın."), list, h("div", { style: "height:18px" }), form);
    await load();
  }

  async function viewAccount(page) {
    const cur = h("input", { type: "password", autocomplete: "current-password", maxlength: 200 });
    const nw = h("input", { type: "password", autocomplete: "new-password", maxlength: 200 });
    const nw2 = h("input", { type: "password", autocomplete: "new-password", maxlength: 200 });
    const err = h("p.form-error", { hidden: true });
    const form = h("form.card", { novalidate: true },
      h("h2", null, "Parolayı değiştir"),
      h("label.field", null, h("span", null, "Mevcut parola"), cur),
      h("label.field", null, h("span", null, "Yeni parola"), nw, h("small.help", null, "En az 10 karakter; en az bir harf ve bir rakam; işletme adı gibi kolay tahmin edilen parolalar kabul edilmez. Değiştirince diğer cihazlardaki oturumlar kapanır.")),
      h("label.field", null, h("span", null, "Yeni parola (tekrar)"), nw2),
      err, h("button.btn.btn--primary", { type: "submit" }, "Parolayı değiştir"));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      err.hidden = true;
      if (nw.value !== nw2.value) { err.textContent = "Yeni parolalar aynı değil."; err.hidden = false; return; }
      try {
        await api("POST", "/password", { current: cur.value, next: nw.value });
        cur.value = nw.value = nw2.value = "";
        toast("Parolanız değiştirildi.", "ok");
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    const emailBox = h("div"), sessBox = h("div");
    page.append(pageHead("Hesabım", `Giriş yapan kullanıcı: ${state.user.username}`), emailBox, form, sessBox);
    renderEmailCard(emailBox, await api("GET", "/account"));
    renderSessions(sessBox, await api("GET", "/account/sessions"));
  }

  // Açık oturumlar: hesabın hangi cihazlarda açık olduğu; tanımadığınız varsa tek tıkla kapatılır
  function renderSessions(box, list) {
    const others = list.filter(s => !s.current).length;
    const btn = others ? h("button.btn", { type: "button", onclick: async () => {
      if (!confirm("Bu cihaz dışındaki tüm oturumlar kapatılsın mı?")) return;
      try {
        const r = await api("POST", "/account/sessions/end-others");
        toast(`${r.ended} oturum kapatıldı.`, "ok");
        renderSessions(box, await api("GET", "/account/sessions"));
      } catch (ex) { toast(ex.message, "err"); }
    } }, "Diğer cihazlardan çıkış yap") : null;
    box.replaceChildren(h("div.card", null,
      h("h2", null, "Açık oturumlar"),
      h("p.muted", null, "Hesabınızın açık olduğu cihazlar. Tanımadığınız bir cihaz görürseniz diğer oturumları kapatıp parolanızı değiştirin. 60 dakika işlem yapılmayan oturumlar kendiliğinden kapanır."),
      h("ul", { style: "list-style:none;padding:0;margin:0 0 14px;display:grid;gap:10px" }, list.map(s => h("li", null,
        h("strong", null, shortUa(s.ua) || "Bilinmeyen cihaz", s.current ? h("span.pill.pill--info", { style: "margin-left:8px" }, "Bu cihaz") : null),
        h("small.muted", { style: "display:block" }, `IP: ${s.ip || "-"} · Giriş: ${fmtDate(s.createdAt)}${s.lastSeen ? " · Son işlem: " + fmtDate(s.lastSeen) : ""}`)))),
      btn));
  }

  // Hesap e-postası: ekle / değiştir → e-postaya gelen 6 haneli kodla doğrula
  function renderEmailCard(box, acc) {
    const err = h("p.form-error", { hidden: true });
    const fail = ex => { err.textContent = ex.message; err.hidden = false; };
    const mailNote = acc.mailConfigured ? null : h("p.card.card--note", { style: "margin:0 0 14px" },
      "E-posta gönderimi henüz ayarlanmadı; kod gerçek bir e-posta olarak gitmez. Önce ", h("a", { href: "#/eposta" }, "E-posta gönderimi"), " sayfasını doldurun.");

    if (acc.pendingEmail) {
      const code = h("input.code-input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 7, placeholder: "______" });
      const form = h("form.card", { novalidate: true },
        h("h2", null, "E-postanızı doğrulayın"), mailNote,
        h("p", null, `${acc.pendingEmail} adresine 6 haneli bir kod gönderdik. Kod 15 dakika geçerli.`),
        h("label.field", null, h("span", null, "Doğrulama kodu"), code),
        err,
        h("div.toolbar", { style: "margin:0" },
          h("button.btn.btn--primary", { type: "submit" }, "Doğrula"),
          h("button.btn", { type: "button", onclick: () => renderEmailCard(box, { ...acc, pendingEmail: null, changing: true }) }, "Farklı adres / kodu tekrar gönder")));
      form.addEventListener("submit", async e => {
        e.preventDefault();
        err.hidden = true;
        try {
          const next = await api("POST", "/account/email/verify", { code: code.value });
          toast("E-posta adresiniz doğrulandı.", "ok");
          renderEmailCard(box, next);
        } catch (ex) { fail(ex); }
      });
      box.replaceChildren(form);
      setTimeout(() => code.focus(), 30);
      return;
    }

    if (acc.email && !acc.changing) {
      const pw = h("input", { type: "password", autocomplete: "current-password", maxlength: 200 });
      const removeRow = h("div", { hidden: true },
        h("label.field", null, h("span", null, "Kaldırmak için parolanız"), pw),
        h("button.btn.btn--danger", { type: "button", onclick: async () => {
          if (!confirm("E-posta kaldırılırsa şifrenizi unuttuğunuzda sıfırlayamazsınız. Emin misiniz?")) return;
          try { renderEmailCard(box, await api("POST", "/account/email/remove", { password: pw.value })); toast("E-posta kaldırıldı."); } catch (ex) { fail(ex); }
        } }, "E-postayı kaldır"));
      box.replaceChildren(h("div.card.card--ok", null,
        h("h2", null, "Kurtarma e-postası"),
        h("p", null, "✔ ", h("strong", null, acc.email), " doğrulandı. Şifrenizi unutursanız giriş ekranındaki “Şifremi unuttum” ile bu adrese kod gelir. Güvenlik uyarıları da bu adrese gönderilir."),
        err,
        h("div.toolbar", { style: "margin:0" },
          h("button.btn", { type: "button", onclick: () => renderEmailCard(box, { ...acc, changing: true }) }, "Adresi değiştir"),
          h("button.btn.btn--link", { type: "button", style: "color:var(--bad)", onclick: () => { removeRow.hidden = false; } }, "Kaldır…")),
        removeRow));
      return;
    }

    const email = h("input", { type: "email", autocomplete: "email", maxlength: 200, value: acc.email || "" });
    const pw = h("input", { type: "password", autocomplete: "current-password", maxlength: 200 });
    const form = h("form.card", { novalidate: true, class: acc.email ? "" : "card--note" },
      h("h2", null, acc.email ? "Kurtarma e-postasını değiştir" : "⚠ Kurtarma e-postası ekleyin"),
      h("p", null, "Şifrenizi unutursanız sıfırlama kodu bu adrese gelir; şüpheli girişlerde uyarı da buraya gönderilir. Adresi eklemek için size bir doğrulama kodu göndereceğiz."),
      mailNote,
      h("label.field", null, h("span", null, "E-posta adresi"), email),
      h("label.field", null, h("span", null, "Mevcut parolanız"), pw, h("small.help", null, "Güvenlik için e-posta değişikliğinde parolanız istenir.")),
      err,
      h("div.toolbar", { style: "margin:0" },
        h("button.btn.btn--primary", { type: "submit" }, "Doğrulama kodu gönder"),
        acc.email ? h("button.btn", { type: "button", onclick: () => renderEmailCard(box, { ...acc, changing: false }) }, "Vazgeç") : null));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      err.hidden = true;
      try {
        const next = await api("POST", "/account/email", { email: email.value, password: pw.value });
        toast("Doğrulama kodu gönderildi.", "ok");
        renderEmailCard(box, next);
      } catch (ex) { fail(ex); }
    });
    box.replaceChildren(form);
  }

  /* ============ Güvenlik kayıtları ============ */
  const SEC_EVENTS = {
    login_ok: "Başarılı giriş", login_failed: "Hatalı giriş denemesi", login_locked: "Giriş kilitlendi (çok fazla hatalı deneme)",
    login_blocked: "Kilitliyken giriş denendi", login_new_ip: "Yeni bir yerden (IP) giriş", logout: "Çıkış",
    password_changed: "Parola değiştirildi", password_change_failed: "Parola değiştirme: mevcut parola hatalı",
    password_reset: "Parola e-posta koduyla sıfırlandı", password_reset_cli: "Parola sunucudan komutla yenilendi",
    reset_requested: "Şifre sıfırlama kodu istendi", reset_unknown: "Olmayan hesap için sıfırlama istendi",
    reset_no_email: "Sıfırlama istendi ama hesapta e-posta yok", reset_code_wrong: "Hatalı sıfırlama kodu", reset_rate_limited: "Sıfırlama çok sık denendi",
    email_verify_sent: "E-posta doğrulama kodu gönderildi", email_verified: "E-posta doğrulandı", email_verify_failed: "Hatalı doğrulama kodu",
    email_change_failed: "E-posta ekleme: parola hatalı", email_removed: "Hesaptan e-posta kaldırıldı",
    sessions_ended: "Diğer cihazlardaki oturumlar kapatıldı",
    user_created: "Yeni yönetici eklendi", user_deleted: "Yönetici silindi",
    mail_settings_changed: "E-posta gönderim ayarları değişti", mail_settings_removed: "E-posta gönderim ayarları silindi", mail_failed: "E-posta gönderilemedi"
  };
  const LEVEL_LABEL = { info: "Bilgi", warn: "Dikkat", alert: "Önemli" };

  // Tarayıcı bilgisini kısaltır (ör. "Chrome · Windows")
  const shortUa = ua => {
    if (!ua) return "";
    const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
    const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    return [b, o].filter(Boolean).join(" · ");
  };

  async function viewSecurity(page, params) {
    const level = params.get("level") || "";
    const rows = await api("GET", "/security" + (level ? "?level=" + level : ""));
    const tabs = h("div.tabs", null, [["", "Tümü"], ["warn", "Dikkat + önemli"], ["alert", "Sadece önemli"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === level), onclick: () => { location.hash = "#/guvenlik" + (k ? "?level=" + k : ""); } }, l)));
    const ips = {};
    rows.filter(r => r.event === "login_failed").forEach(r => { ips[r.ip] = (ips[r.ip] || 0) + 1; });
    const topIps = Object.entries(ips).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const list = rows.length ? h("div.list.seclog", null, rows.map(r => h("div.row", null,
      h("div", null, h("span.pill", { class: "pill--" + r.level }, LEVEL_LABEL[r.level]), h("div.seclog__when", null, fmtDate(r.at))),
      h("div.row__title", null,
        h("strong", null, SEC_EVENTS[r.event] || r.event),
        h("small", null, [r.username ? "Kullanıcı: " + r.username : null, r.detail, r.ip ? "IP: " + r.ip : null, shortUa(r.ua)].filter(Boolean).join(" · "))),
      h("span")))) : h("p.empty", null, "Bu filtrede kayıt yok.");
    page.append(
      pageHead("Güvenlik kayıtları", "Panele yapılan girişler, hatalı denemeler, kilitlenmeler, parola ve e-posta işlemleri burada tutulur (son 180 gün, en yeni 500 kayıt). “Önemli” olaylarda doğrulanmış e-posta adreslerine uyarı da gönderilir."),
      topIps.length ? h("div.card.card--note", null, h("strong", null, "En çok hatalı giriş denenen IP adresleri: "), topIps.map(([ip, n]) => `${ip} (${n})`).join(", ")) : null,
      tabs, list);
  }

  /* ============ E-posta gönderimi (SMTP) ============ */
  async function viewMail(page) {
    const { config } = await api("GET", "/mail");
    const c = config || { host: "smtp.gmail.com", port: 465, user: "", from: "" };
    const inp = (name, attrs) => h("input", { name, ...attrs });
    const host = inp("host", { value: c.host, maxlength: 253 }), port = inp("port", { type: "number", value: String(c.port), min: 1, max: 65535 });
    const user = inp("user", { type: "email", value: c.user, autocomplete: "off", maxlength: 200 });
    const pass = inp("pass", { type: "password", autocomplete: "new-password", maxlength: 200, placeholder: config && config.hasPass ? "•••••••• (kayıtlı — değiştirmek için yazın)" : "" });
    const from = inp("from", { type: "email", value: c.from, maxlength: 200 });
    const err = h("p.form-error", { hidden: true });
    const fieldErr = {};
    const field = (label, input, help) => {
      fieldErr[input.name] = h("small.field-error", { hidden: true });
      return h("label.field", null, h("span", null, label), input, help ? h("small.help", null, help) : null, fieldErr[input.name]);
    };
    const form = h("form.card", { novalidate: true },
      h("h2", null, "Gönderen e-posta hesabı"),
      field("Gönderen hesabın e-posta adresi", user, "Ör: kardiascunda@gmail.com — kodlar ve uyarılar bu hesaptan gönderilir."),
      field("Uygulama şifresi", pass, "Gmail'de normal şifreniz çalışmaz: Google Hesabı → Güvenlik → 2 Adımlı Doğrulama'yı açın → “Uygulama şifreleri”nden 16 haneli bir şifre oluşturup buraya yapıştırın."),
      h("details", { style: "margin-bottom:14px" }, h("summary", null, "Gelişmiş (Gmail dışı e-posta için)"),
        h("div", { style: "margin-top:12px" }, field("SMTP sunucusu", host, "Gmail: smtp.gmail.com · Outlook: smtp.office365.com · Yandex: smtp.yandex.com"), field("Port", port, "Genellikle 465 (SSL) ya da 587."),
          field("Gönderen adresi (isteğe bağlı)", from, "Boş bırakılırsa yukarıdaki hesap adresi kullanılır."))),
      err,
      h("div.toolbar", { style: "margin:0" },
        h("button.btn.btn--primary", { type: "submit" }, "Kaydet"),
        config ? h("button.btn", { type: "button", onclick: testMail }, "Deneme e-postası gönder") : null,
        config ? h("button.btn.btn--link", { type: "button", style: "color:var(--bad)", onclick: async () => {
          if (!confirm("E-posta ayarları silinsin mi? Şifre sıfırlama kodları gönderilemez.")) return;
          await api("DELETE", "/mail"); toast("Silindi."); route();
        } }, "Ayarları sil") : null));
    async function testMail() {
      try {
        const r = await api("POST", "/mail/test");
        toast(`Deneme e-postası gönderildi: ${r.to}. Gelen kutunuzu kontrol edin.`, "ok");
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    }
    form.addEventListener("submit", async e => {
      e.preventDefault();
      err.hidden = true;
      Object.values(fieldErr).forEach(x => { x.hidden = true; });
      try {
        await api("PUT", "/mail", { host: host.value, port: Number(port.value), user: user.value, pass: pass.value, from: from.value });
        toast("Kaydedildi. Şimdi “Deneme e-postası gönder” ile kontrol edin.", "ok");
        route();
      } catch (ex) {
        const f = (ex.data && ex.data.fields) || {};
        Object.entries(f).forEach(([k, m]) => { if (fieldErr[k]) { fieldErr[k].textContent = m; fieldErr[k].hidden = false; } });
        err.textContent = ex.message; err.hidden = false;
      }
    });
    page.append(
      pageHead("E-posta gönderimi", "Şifre sıfırlama kodları, e-posta doğrulama kodları ve güvenlik uyarıları bu hesaptan gönderilir."),
      config ? h("div.card.card--ok", null, "✔ Ayarlı: ", h("strong", null, config.user), " hesabından gönderiliyor.") : h("div.card.card--note", null, "Henüz ayarlanmadı. Bu ayar yapılmadan “Şifremi unuttum” kodu e-postayla gitmez."),
      form);
  }

  /* ============ Başlat ============ */
  api("GET", "/me", undefined, { quiet401: true }).then(start).catch(ex => {
    // Sunucu yoksa (ör. GitHub Pages önizlemesi) panel çalışamaz
    if (ex.status !== 401) {
      showLogin("Yönetim paneli bu adreste çalışmıyor. Panel yalnızca sitenin kendi sunucusunda (npm start) açılır; GitHub Pages önizlemesinde kullanılamaz.");
      $("#loginForm button[type=submit]").disabled = true;
      return;
    }
    showLogin();
  });
})();
