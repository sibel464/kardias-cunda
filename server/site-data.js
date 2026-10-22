/* Sitenin herkese açık verisi (menü, odalar, galeri, metinler…). repo: list/getSettings/getTexts sağlayan nesne.
   Sunucu bunu veritabanıyla, GitHub Pages paneli ise tarayıcıdaki data/admin-db.json kopyasıyla kullanır. */
// Hem sunucuda (require) hem tarayıcıda (window.KardiasSiteData) çalışır
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./validate"));
  else root.KardiasSiteData = factory(root.KardiasValidate);
})(typeof self !== "undefined" ? self : this, function ({ safeInlineHtml }) {

const i18n = v => (v && v.tr ? (v.en ? { tr: v.tr, en: v.en } : { tr: v.tr }) : undefined);
const i18nList = list => (list || []).map(i18n).filter(Boolean);
const imageUrl = (v, w = 1920) => /^photo-/.test(v) ? `https://images.unsplash.com/${v}?w=${w}&q=70&auto=format&fit=crop` : v;
const clean = o => JSON.parse(JSON.stringify(o)); // undefined alanları at

function buildSiteData(repo) {
  const s = repo.getSettings();
  const showPrices = s.showPrices !== false;
  const money = v => (showPrices && v != null ? v : undefined);
  const showRoomPrices = s.showRoomPrices !== false;

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
      size: r.size || undefined, view: i18n(r.view), features: i18nList(r.features), price: showRoomPrices && r.price != null ? r.price : undefined, priceNote: showRoomPrices && r.price != null ? i18n(r.priceNote) : undefined
    })),
    gallery: repo.list("gallery", { activeOnly: true }).map(g => ({
      src: g.media, kind: /\.(mp4|webm)$/.test(g.media) ? "video" : "image", poster: g.poster || undefined, caption: i18n(g.caption), ratio: g.ratio || "auto"
    })),
    reviews: repo.list("reviews", { activeOnly: true }).map(r => ({ name: r.name, rating: r.rating, text: r.text, src: r.source || undefined, date: r.date || undefined })),
    credits: repo.list("credits", { activeOnly: true }).map(c => ({ title: c.title, url: c.url || undefined, author: c.author || undefined, license: c.license || undefined }))
  });
}

// GitHub Pages kopyası: sunucu olmadığı için talepler WhatsApp ile gider; yüklenen dosyalar static/uploads/ altından yayınlanır
function toStaticSiteData(data) {
  data.settings.sendWhatsapp = true;
  return JSON.stringify(data).replace(/\/uploads\//g, "static/uploads/");
}

return { buildSiteData, toStaticSiteData, imageUrl, clean };
});
