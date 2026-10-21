/* Sitenin herkese açık verisi ve index.html'in sunucuda doldurulması.
   Panelde yapılan her değişiklik önbelleği temizler; bir sonraki sayfa isteği yeni veriyle üretilir. */
const fs = require("node:fs");
const { escapeHtml } = require("./validate");
const { buildSiteData, imageUrl, clean } = require("./site-data");

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
