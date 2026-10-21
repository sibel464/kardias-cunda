/* Sitenin herkese açık verisi ve index.html'in sunucuda doldurulması.
   Panelde yapılan her değişiklik önbelleği temizler; bir sonraki sayfa isteği yeni veriyle üretilir. */
const fs = require("node:fs");
const { escapeHtml, safeInlineHtml } = require("./validate");

const i18n = v => (v && v.tr ? (v.en ? { tr: v.tr, en: v.en } : { tr: v.tr }) : undefined);
const i18nList = list => (list || []).map(i18n).filter(Boolean);
const imageUrl = (v, w = 1920) => /^photo-/.test(v) ? `https://images.unsplash.com/${v}?w=${w}&q=70&auto=format&fit=crop` : v;
const clean = o => JSON.parse(JSON.stringify(o)); // undefined alanları at

function buildSiteData(repo) {
  const s = repo.getSettings();
  const showPrices = s.showPrices !== false;
  const money = v => (showPrices && v != null ? v : undefined);

  const texts = {};
  for (const t of repo.getTexts()) {
    texts[t.key] = { tr: safeInlineHtml(t.tr) };
    if (t.en) texts[t.key].en = safeInlineHtml(t.en);
  }

  const sections = repo.list("sections", { activeOnly: true });
  const sectionSlug = Object.fromEntries(sections.map(x => [x.id, x.slug]));
  const sectionIdx = Object.fromEntries(sections.map((x, i) => [x.id, i]));
  const items = repo.list("items", { activeOnly: true });
  // Kategoriler önce bölüm sırasına, sonra kendi sıralarına göre (menü panelindeki önceki/sonraki geçişi için)
  const cats = repo.list("categories", { activeOnly: true })
    .filter(c => sectionSlug[c.section])
    .sort((a, b) => sectionIdx[a.section] - sectionIdx[b.section] || a.sort - b.sort || a.id - b.id)
    .map(c => ({ c, items: items.filter(i => i.category === c.id) }))
    .filter(x => x.items.length); // ürünü olmayan kategori sitede görünmez
  const catSlug = Object.fromEntries(cats.map(x => [x.c.id, x.c.slug]));

  const menu = {
    currency: s.currency || "₺",
    showPrices,
    sections: sections.filter(x => cats.some(k => k.c.section === x.id)).map(x => ({ id: x.slug, name: i18n(x.name), desc: i18n(x.desc) })),
    categories: cats.map(({ c, items }) => ({
      id: c.slug,
      section: sectionSlug[c.section],
      name: i18n(c.name),
      note: i18n(c.note),
      image: c.image,
      pair: catSlug[c.pair],
      items: items.map(it => ({
        name: i18n(it.name),
        desc: i18n(it.desc),
        group: i18n(it.group),
        meta: it.meta || undefined,
        price: money(it.price),
        prices: showPrices && it.prices.length ? it.prices.map(p => ({ label: i18n(p.label), price: p.price })) : undefined,
        priceText: showPrices ? i18n(it.priceText) : undefined,
        tags: it.tags.length ? it.tags : undefined,
        soldOut: it.soldOut || undefined,
        image: it.image || undefined
      }))
    }))
  };
  const set = repo.list("setmenus", { activeOnly: true })[0];
  if (set) menu.setMenu = { title: i18n(set.title), desc: i18n(set.desc), items: i18nList(set.items), price: money(set.price), per: i18n(set.per) };

  return clean({
    settings: s,
    texts,
    menu,
    events: repo.list("events", { activeOnly: true }).map(e => ({ title: i18n(e.title), when: i18n(e.when), desc: i18n(e.desc), image: e.image })),
    rooms: repo.list("rooms", { activeOnly: true }).map(r => ({
      id: r.id, name: i18n(r.name), desc: i18n(r.desc), images: r.images, capacity: r.capacity ?? undefined,
      size: r.size || undefined, view: i18n(r.view), features: i18nList(r.features), price: money(r.price), priceNote: showPrices ? i18n(r.priceNote) : undefined
    })),
    gallery: repo.list("gallery", { activeOnly: true }).map(g => ({
      src: g.media, kind: /\.(mp4|webm)$/.test(g.media) ? "video" : "image", poster: g.poster || undefined, caption: i18n(g.caption), ratio: g.ratio || "auto"
    })),
    reviews: repo.list("reviews", { activeOnly: true }).map(r => ({ name: r.name, rating: r.rating, text: r.text, src: r.source || undefined })),
    credits: repo.list("credits", { activeOnly: true }).map(c => ({ title: c.title, url: c.url || undefined, author: c.author || undefined, license: c.license || undefined }))
  });
}

/* --- HTML doldurma yardımcıları --- */
const setAttr = (tag, name, value) => {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const attr = ` ${name}="${escapeHtml(value)}"`;
  return re.test(tag) ? tag.replace(re, attr) : tag.replace(/\s*\/?>$/, m => attr + m);
};
const dropAttr = (tag, name) => tag.replace(new RegExp(`\\s${name}="[^"]*"`), "");

function bindings(s) {
  const hours = s.openTime && s.closeTime ? `${s.openTime} – ${s.closeTime}` : "";
  return {
    phoneDisplay: s.phoneDisplay,
    phone2Display: s.phone2Display,
    addressStreet: s.addressStreet,
    addressCity: s.addressCity,
    addressFull: [s.addressStreet, s.addressCity].filter(Boolean).join(", "),
    hoursRange: hours,
    ratingScore: s.ratingScore != null ? String(s.ratingScore) : ""
  };
}

function jsonLd(s) {
  const base = (s.siteUrl || "").replace(/\/$/, "");
  const ld = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "Kardias Cunda",
    image: s.heroImage ? (/^(https?:)?\/\//.test(imageUrl(s.heroImage)) ? imageUrl(s.heroImage) : base + "/" + imageUrl(s.heroImage).replace(/^\//, "")) : undefined,
    telephone: s.phone,
    email: s.email || undefined,
    servesCuisine: ["Ege", "Akdeniz", "Pizza", "Makarna", "Meze"],
    priceRange: "₺₺₺",
    acceptsReservations: true,
    menu: base ? base + "/#menu" : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: s.addressStreet,
      addressLocality: "Ayvalık",
      addressRegion: "Balıkesir",
      postalCode: s.postalCode || undefined,
      addressCountry: "TR"
    },
    geo: s.lat != null && s.lng != null ? { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lng } : undefined,
    openingHoursSpecification: s.openTime ? [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: s.openTime, closes: s.closeTime
    }] : undefined,
    sameAs: ["instagram", "facebook", "tiktok", "youtube", "tripadvisor"].map(k => s[k]).filter(Boolean)
  };
  return JSON.stringify(clean(ld), null, 2).replace(/</g, "\\u003c");
}

function renderIndex(template, data) {
  const s = data.settings, b = bindings(s);
  let html = template;

  // Çevrilebilir metinler (data-i18n): Türkçe hâli doğrudan HTML'e yazılır (arama motorları için)
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.-]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (m, open, tag, key, inner, close) => data.texts[key] ? open + data.texts[key].tr + close : m);
  // Ayarlardan gelen değerler (data-bind)
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-bind="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (m, open, tag, key, inner, close) => b[key] != null && b[key] !== "" ? open + escapeHtml(b[key]) + close : m);
  // Site görselleri (data-img): varsayılandan farklıysa src değişir, hazır srcset kaldırılır
  html = html.replace(/<(img|link)\b[^>]*\sdata-img="(\w+)"[^>]*>/g, (tag, el, key) => {
    const v = s[key];
    if (!v) return tag;
    const attr = el === "img" ? "src" : "href";
    const current = (tag.match(new RegExp(`\\s${attr}="([^"]*)"`)) || [])[1];
    if (current === v) return tag;
    let out = setAttr(tag, attr, imageUrl(v));
    for (const a of ["srcset", "sizes", "imagesrcset", "imagesizes"]) out = dropAttr(out, a);
    return out;
  });

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(s.siteTitle || "Kardias Cunda")}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(s.siteDescription || "")}">`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escapeHtml(s.siteDescription || "")}">`);
  html = html.replace(/<meta name="robots"[^>]*>\s*/, s.noindex ? `<meta name="robots" content="noindex, nofollow">\n  ` : "");
  if (s.siteUrl) html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escapeHtml(s.siteUrl.replace(/\/?$/, "/"))}">`);
  html = html.replace(/(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/, `$1\n${jsonLd(s)}\n  $2`);

  // Veri bloğu çalıştırılmaz (type=application/json); yalnızca "</script" kapanışını engellemek için "<" kaçışlanır
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  html = html.replace(/(\s*)<script src="js\/i18n\.js"><\/script>/, (m, ws) => `${ws}<script type="application/json" id="site-data">${json}</script>${m}`);
  return html;
}

function makeSite(repo, templatePath) {
  let cache = null, templateTime = 0;
  return {
    data() { return (cache ||= { data: buildSiteData(repo) }).data; },
    html() {
      // index.html (tasarım) değiştiyse sayfa yeniden üretilir
      const mtime = fs.statSync(templatePath).mtimeMs;
      if (mtime !== templateTime) { templateTime = mtime; if (cache) cache.html = null; }
      if (!cache) cache = { data: buildSiteData(repo) };
      if (!cache.html) cache.html = renderIndex(fs.readFileSync(templatePath, "utf8"), cache.data);
      return cache.html;
    },
    invalidate() { cache = null; }
  };
}

module.exports = { makeSite, buildSiteData, renderIndex };
