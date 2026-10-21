/* İlk kurulum: veritabanı boşsa sitenin mevcut içeriği (index.html metinleri, data/menu.json,
   galeri, yorumlar, etkinlikler) veritabanına aktarılır. Sonrasında tek kaynak veritabanıdır. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { tx } = require("./db");

const ROOT = path.join(__dirname, "..");

const decode = s => String(s)
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const L = v => v == null ? { tr: "", en: "" } : typeof v === "string" ? { tr: v, en: "" } : { tr: v.tr || "", en: v.en || "" };

function loadI18n() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js/i18n.js"), "utf8"), ctx);
  return ctx.window.I18N;
}

// index.html içindeki data-i18n metinleri (Türkçe) + i18n.js'teki İngilizce karşılıkları
function collectTexts(html, I18N) {
  const texts = new Map();
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.-]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (!texts.has(m[2])) texts.set(m[2], { tr: decode(m[3].trim()), en: decode(I18N.en[m[2]] || "") });
  }
  for (const m of html.matchAll(/<(?:input|textarea)\b[^>]*>/g)) {
    const key = (m[0].match(/data-i18n-placeholder="([\w.-]+)"/) || [])[1];
    const ph = (m[0].match(/placeholder="([^"]*)"/) || [])[1];
    if (key && ph != null && !texts.has(key)) texts.set(key, { tr: decode(ph), en: decode(I18N.en[key] || "") });
  }
  return texts;
}

const EVENTS = [
  { image: "photo-1514933651103-005eec06c04b", when: { tr: "Cuma & Cumartesi · 21:00", en: "Friday & Saturday · 21:00" }, title: { tr: "Canlı Müzik Geceleri", en: "Live Music Nights" }, desc: { tr: "Akustik, caz ve Ege ezgileri; yıldızların altında, rakı kadehleri eşliğinde.", en: "Acoustic, jazz and Aegean tunes under the stars, with a glass of rakı." } },
  { image: "photo-1510812431401-41d2bd2722f3", when: { tr: "Her ay · Çarşamba", en: "Monthly · Wednesday" }, title: { tr: "Şarap Tadımı Akşamları", en: "Wine Tasting Evenings" }, desc: { tr: "Urla, Bozcaada ve Şirince bağlarından şaraplar, şefin eşleştirme tabaklarıyla.", en: "Wines from Urla, Bozcaada and Şirince, paired with the chef's plates." } },
  { image: "photo-1488477181946-6428a0291777", when: { tr: "Doğum günü · Evlilik teklifi · Nişan", en: "Birthdays · Proposals · Engagements" }, title: { tr: "Özel Gün Organizasyonları", en: "Special Occasions" }, desc: { tr: "Çiçekler, mumlar, pasta ve size özel bir köşe; gerisini biz düşünürüz.", en: "Flowers, candles, cake and a corner just for you — we take care of the rest." } },
  { image: "photo-1528605248644-14dd04022da1", when: { tr: "10 – 60 kişi", en: "10 – 60 guests" }, title: { tr: "Grup Yemekleri", en: "Group Dinners" }, desc: { tr: "Şirket yemekleri, mezuniyetler ve kalabalık sofralar için özel menüler.", en: "Tailored menus for company dinners, graduations and big tables." } }
];

const GALLERY = [
  { media: "img/cunda/aksamustu-tekne.jpg", ratio: "3:4", caption: { tr: "Cunda'da akşamüstü", en: "Late afternoon in Cunda" } },
  { media: "img/kardias/teras-gun-batimi.jpg", ratio: "1:1", caption: { tr: "Teras Kardias'ta gün batımı", en: "Sunset on the Kardias terrace" } },
  { media: "img/cunda/yel-degirmeni.jpg", ratio: "3:2", caption: { tr: "Tepedeki yel değirmeni", en: "The windmill on the hill" } },
  { media: "img/kardias/sarap-pizza.jpg", ratio: "1:1", caption: { tr: "Şarap ve taş fırın pizza", en: "Wine and stone-oven pizza" } },
  { media: "img/cunda/gullu-sokak.jpg", ratio: "4:3", caption: { tr: "Güllü sokaklar", en: "Lanes full of roses" } },
  { media: "img/kardias/margarita.jpg", ratio: "1:1", caption: { tr: "Margarita", en: "Margarita" } },
  { media: "img/cunda/tas-ev.jpg", ratio: "4:3", caption: { tr: "Rum mahallesinin taş evleri", en: "Stone houses of the Greek quarter" } },
  { media: "img/kardias/ravioli.jpg", ratio: "1:1", caption: { tr: "El açması mantarlı ravioli", en: "Handmade mushroom ravioli" } },
  { media: "img/cunda/kediler.jpg", ratio: "3:2", caption: { tr: "Adanın kedileri", en: "The island's cats" } },
  { media: "img/kardias/teras-manzara.jpg", ratio: "1:1", caption: { tr: "Terastan Cunda manzarası", en: "Cunda from the terrace" } },
  { media: "img/cunda/rum-kilisesi.jpg", ratio: "4:3", caption: { tr: "Eski Rum kilisesi", en: "The old Greek church" } },
  { media: "img/kardias/sef-omur-kayaoz.jpg", ratio: "1:1", caption: { tr: "Şefimiz Ömür Kayaöz", en: "Our chef, Ömür Kayaöz" } },
  { media: "img/kardias/pizza-duvar.jpg", ratio: "1:1", caption: { tr: "Kardias'ta keyifli anlar", en: "Good times at Kardias" } }
];

// Örnek yorumlar — "Örnek içerik" notu açık gelir; gerçek yorumlar girilince panelden kapatılır
const REVIEWS = [
  { name: "Elif K.", source: "Google", rating: 5, text: "Cunda'da gün batımını izlemek için daha güzel bir yer düşünemiyorum. Girit ezmesi ve Cunda pizzası harikaydı, servis çok ilgiliydi." },
  { name: "Mark T.", source: "Google", rating: 5, text: "The view over the harbour at sunset is unreal. Homemade pasta was excellent and the rakı-meze experience felt truly local." },
  { name: "Burak & Selin", source: "Google", rating: 5, text: "Evlilik teklifimizi burada yaptık; masayı mumlar ve çiçeklerle hazırlamışlardı. Hayatımızın en güzel akşamıydı." },
  { name: "Ayşe D.", source: "Google", rating: 4, text: "Taş evin atmosferi çok etkileyici. Mezeler taze, şarap listesi Ege bağlarından çok iyi seçilmiş. Hafta sonu mutlaka rezervasyon yapın." },
  { name: "Sophie L.", source: "Google", rating: 5, text: "We stayed at the hotel and had breakfast on the terrace every morning. Charming rooms, warm hosts, perfect location." },
  { name: "Murat Y.", source: "Google", rating: 5, text: "Pizzaların hamuru gerçekten farklı, tam kıvamında. Kalamarlı linguine ve lor tatlısı için tekrar geleceğiz." }
];

const CREDITS = [
  { title: "Cunda adası,Ayvalık - panoramio (1).jpg", url: "https://commons.wikimedia.org/wiki/File%3ACunda_adas%C4%B1%2CAyval%C4%B1k_-_panoramio_%281%29.jpg", author: "HALUK COMERTEL", license: "CC BY 3.0" },
  { title: "Cunda houses 2020 (2).jpg", url: "https://commons.wikimedia.org/wiki/File%3ACunda_houses_2020_%282%29.jpg", author: "Antoloji", license: "CC BY-SA 4.0" },
  { title: "A street from Cunda Island.JPG", url: "https://commons.wikimedia.org/wiki/File%3AA_street_from_Cunda_Island.JPG", author: "The cat", license: "Public domain" },
  { title: "Alibey Adasi, Ayvalık, Turkey (Unsplash).jpg", url: "https://commons.wikimedia.org/wiki/File%3AAlibey_Adasi%2C_Ayval%C4%B1k%2C_Turkey_%28Unsplash%29.jpg", author: "Arda Çetin ardacetin", license: "CC0" },
  { title: "Cunda2006.JPG", url: "https://commons.wikimedia.org/wiki/File%3ACunda2006.JPG", author: "Original uploader was Towsonu2003 at tr.wikipedia", license: "CC BY-SA 2.5" },
  { title: "Cunda Adası 01.jpg", url: "https://commons.wikimedia.org/wiki/File%3ACunda_Adas%C4%B1_01.jpg", author: "Ferit BAYCUMAN", license: "CC BY-SA 4.0" },
  { title: "Abandoned Old Church.jpg", url: "https://commons.wikimedia.org/wiki/File%3AAbandoned_Old_Church.jpg", author: "BilgeSaygin", license: "CC BY-SA 4.0" },
  { title: "Moshos Otel (9649207733).jpg", url: "https://commons.wikimedia.org/wiki/File%3AMoshos_Otel_%289649207733%29.jpg", author: "Omer Unlu from Ankara, Turkey", license: "CC BY 2.0" }
];

function seedIfEmpty(db, repo) {
  if (db.prepare("SELECT COUNT(*) AS n FROM settings").get().n > 0) return false;

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const I18N = loadI18n();
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, "data/menu.json"), "utf8"));
  const zip = (tr, en) => tr.map((t, i) => ({ tr: t, en: en[i] || "" }));
  const meta = name => decode((html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "");

  tx(db, () => {
    const settings = {
      contact: { phone: "+902663271965", phoneDisplay: "0266 327 19 65", whatsapp: "905324112938", email: "" },
      address: { addressStreet: "Mithatpaşa Mah., 20082 Sokak No:4", addressCity: "Cunda, 10405 Ayvalık / Balıkesir", postalCode: "10405", mapsQuery: "Kardias Cunda, Mithatpaşa, Ayvalık", lat: 39.335, lng: 26.66 },
      hours: { openTime: "14:00", closeTime: "00:00", firstBooking: "14:00", lastBooking: "23:00" },
      reservation: { typeStreet: true, typeTerrace: true, typeStay: true, sendWhatsapp: true },
      social: { instagram: "https://www.instagram.com/cundakardiasrestoran/", facebook: "", tiktok: "", youtube: "", tripadvisor: "" },
      menu: { showPrices: menu.showPrices !== false, currency: menu.currency || "₺" },
      reviews: { ratingScore: 4.7, showRating: true, showSampleNote: true },
      images: { heroImage: "img/cunda/liman-1920.jpg", storyImage: "img/cunda/tas-ev.jpg", storyInset: "img/cunda/gullu-sokak.jpg", stayImage: "photo-1611892440504-42a792e24d32", stayInset: "img/cunda/tas-konak.jpg", storyYear: "1890" },
      ribbons: { ribbonA: zip(I18N.ui.tr.ribbons.a, I18N.ui.en.ribbons.a), ribbonB: zip(I18N.ui.tr.ribbons.b, I18N.ui.en.ribbons.b) },
      seo: { siteTitle: decode((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "Kardias Cunda"), siteDescription: meta("description"), siteUrl: "https://www.kardiascunda.com/", noindex: true }
    };
    for (const [group, values] of Object.entries(settings)) repo.saveSettings(group, values);

    const insText = db.prepare("INSERT OR IGNORE INTO texts (key, tr, en) VALUES (?, ?, ?)");
    for (const [key, v] of collectTexts(html, I18N)) insText.run(key, v.tr, v.en);

    const sectionIds = {}, catIds = {};
    for (const s of menu.sections) sectionIds[s.id] = repo.create("sections", { slug: s.id, name: L(s.name), desc: L(s.desc) }).id;
    for (const c of menu.categories) {
      catIds[c.id] = repo.create("categories", { section: sectionIds[c.section], slug: c.id, name: L(c.name), note: L(c.note), image: c.image }).id;
      for (const it of c.items) {
        repo.create("items", {
          category: catIds[c.id], name: L(it.name), desc: L(it.desc), group: L(it.group), meta: it.meta || "",
          price: it.price ?? null, priceText: L(it.priceText), tags: it.tags || [], image: it.image || "",
          prices: (it.prices || []).map(p => ({ label: L(p.label), price: p.price }))
        });
      }
    }
    for (const c of menu.categories) {
      if (!c.pair || !catIds[c.pair]) continue;
      const cur = repo.get("categories", catIds[c.id]);
      repo.update("categories", cur.id, { ...cur, pair: catIds[c.pair] });
    }
    if (menu.setMenu) {
      const s = menu.setMenu;
      repo.create("setmenus", { title: L(s.title), desc: L(s.desc), items: s.items.map(L), price: s.price, per: L(s.per) });
    }
    EVENTS.forEach(e => repo.create("events", e));
    GALLERY.forEach(g => repo.create("gallery", g));
    REVIEWS.forEach(r => repo.create("reviews", r));
    CREDITS.forEach(c => repo.create("credits", c));
  });
  return true;
}

// Şablona sonradan eklenen yeni metin anahtarlarını (data-i18n) veritabanına ekler; mevcut metinlere dokunmaz
function syncNewTexts(db) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ins = db.prepare("INSERT OR IGNORE INTO texts (key, tr, en) VALUES (?, ?, ?)");
  for (const [key, v] of collectTexts(html, loadI18n())) ins.run(key, v.tr, v.en);
}

module.exports = { seedIfEmpty, syncNewTexts };
