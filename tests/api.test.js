/* Backend testleri: yetkilendirme, doğrulama, içerik işlemleri, medya, rezervasyon, güvenlik */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, client, PNG, MP4, istanbulDay } = require("./helpers");

let S, admin;
const PASS = "Kardias-test-2026";

before(async () => {
  S = await startServer();
  S.auth.createUser("yonetici", PASS);
  admin = client(S.base);
  const r = await admin.login("yonetici", PASS);
  assert.equal(r.status, 200);
});
after(() => S.close());

const siteData = async () => (await client(S.base).get("/api/site")).json;
const firstCategory = async () => (await admin.get("/api/admin/entities/categories")).json[0];

/* ---------- Site ve güvenlik başlıkları ---------- */
test("site, veritabanındaki içerikle ve güvenlik başlıklarıyla sunulur", async () => {
  const r = await client(S.base).get("/");
  assert.equal(r.status, 200);
  assert.match(r.text, /<script type="application\/json" id="site-data">/);
  assert.match(r.text, /Limana bakan terasta <em>gün batımı<\/em> sofrası/);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null);
  const d = await siteData();
  assert.equal(d.menu.categories.length, 16);
  assert.equal(d.events.length, 4);
  assert.equal(d.gallery.length, 13);
  assert.equal(d.reviews.length, 4);
  // Kategori sırası eski menu.json ile aynı (önce Mutfak, sonra Bar) — menüdeki önceki/sonraki geçişi buna dayanır
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/menu.json"), "utf8")).categories.map(c => c.id);
  assert.deepEqual(d.menu.categories.map(c => c.id), original);
});

test("sunucu dosyaları, veritabanı ve gizli klasörler dışarıdan okunamaz", async () => {
  const c = client(S.base);
  for (const u of ["/storage/kardias.db", "/server/app.js", "/package.json", "/data/menu.json", "/uploads/.tmp/", "/uploads/..%2fkardias.db",
    "/css/..%2f..%2fserver%2fapp.js", "/node_modules/express/package.json", "/tests/api.test.js", "/.git/config"]) {
    const r = await c.get(u);
    assert.ok([400, 403, 404].includes(r.status), `${u} → ${r.status}`);
  }
});

/* ---------- Yetkilendirme ---------- */
test("panel API'si oturumsuz kullanılamaz", async () => {
  const c = client(S.base);
  for (const [m, u] of [["GET", "/api/admin/me"], ["GET", "/api/admin/entities/items"], ["POST", "/api/admin/entities/items"], ["GET", "/api/admin/reservations"], ["PUT", "/api/admin/settings/contact"], ["POST", "/api/admin/media"]]) {
    const r = await c.req(m, u, m === "GET" ? undefined : {});
    assert.equal(r.status, 401, `${m} ${u}`);
  }
});

test("hatalı parola reddedilir; oturum çerezi HttpOnly ve SameSite=Strict", async () => {
  const c = client(S.base);
  assert.equal((await c.login("yonetici", "yanlis-parola-1")).status, 401);
  assert.equal((await c.login("olmayan", "bir-parola-123")).status, 401);
  const ok = await c.login("yonetici", PASS);
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  assert.ok(ok.json.csrf.length > 20);
});

test("CSRF anahtarı olmadan veri değiştirilemez", async () => {
  const r = await admin.put("/api/admin/settings/menu", { showPrices: true, currency: "₺" }, { noCsrf: true });
  assert.equal(r.status, 403);
  const bad = await admin.put("/api/admin/settings/menu", { showPrices: true, currency: "₺" }, { noCsrf: true, headers: { "X-CSRF-Token": "sahte" } });
  assert.equal(bad.status, 403);
});

test("art arda hatalı girişte hesap geçici olarak kilitlenir", async () => {
  S.auth.createUser("kilit", "Kilit-test-12345");
  const c = client(S.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.login("kilit", "yanlis-" + i + "aaaa")).status, 401);
  const locked = await c.login("kilit", "Kilit-test-12345");
  assert.equal(locked.status, 429, "doğru parola bile kilit süresince reddedilmeli");
  assert.equal((await client(S.base).login("yonetici", PASS)).status, 200, "aynı ağdaki başka kullanıcı kilitlenmemeli");
});

/* ---------- İçerik: menü ürünleri ---------- */
test("ürün ekleme: geçersiz veri alan bazında reddedilir", async () => {
  const cat = await firstCategory();
  const r = await admin.post("/api/admin/entities/items", {
    category: cat.id, name: { tr: "", en: "x" }, price: -5, image: "../../etc/passwd", tags: ["yok-boyle-etiket"], prices: [{ label: { tr: "" }, price: 10 }]
  });
  assert.equal(r.status, 400);
  for (const k of ["name", "price", "image", "tags", "prices"]) assert.ok(r.json.fields[k], `${k} hatası bekleniyordu`);
  const noCat = await admin.post("/api/admin/entities/items", { category: 999999, name: { tr: "Deneme" } });
  assert.equal(noCat.status, 400);
  assert.ok(noCat.json.fields.category);
});

test("ürün ekle → sitede görünür, gizle → kaybolur, düzenle, sırala, sil", async () => {
  const cat = await firstCategory();
  const created = await admin.post("/api/admin/entities/items", {
    category: cat.id, name: { tr: "Test Mezesi", en: "Test Meze" }, desc: { tr: "Açıklama", en: "" }, price: 199, tags: ["vegan"],
    prices: [{ label: { tr: "Küçük", en: "Small" }, price: 100 }]
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;

  let d = await siteData();
  const inSite = () => d.menu.categories.find(c => c.id === cat.slug).items.find(i => i.name.tr === "Test Mezesi");
  assert.ok(inSite(), "yeni ürün sitede olmalı");
  assert.match((await client(S.base).get("/")).text, /Test Mezesi/);

  assert.equal((await admin.patch(`/api/admin/entities/items/${id}/active`, { active: false })).status, 200);
  d = await siteData();
  assert.equal(inSite(), undefined, "gizlenen ürün sitede olmamalı");

  const upd = await admin.put(`/api/admin/entities/items/${id}`, { ...created.json, name: { tr: "Test Mezesi 2", en: "" }, active: true });
  assert.equal(upd.status, 200);
  d = await siteData();
  assert.ok(d.menu.categories.find(c => c.id === cat.slug).items.some(i => i.name.tr === "Test Mezesi 2"));

  // Sıralama: yeni ürünü kategorinin başına al
  const list = (await admin.get(`/api/admin/entities/items?parent=${cat.id}`)).json;
  const ids = [id, ...list.map(x => x.id).filter(x => x !== id)];
  assert.equal((await admin.post("/api/admin/entities/items/reorder", { ids })).status, 200);
  d = await siteData();
  assert.equal(d.menu.categories.find(c => c.id === cat.slug).items[0].name.tr, "Test Mezesi 2");

  assert.equal((await admin.del(`/api/admin/entities/items/${id}`)).status, 200);
  assert.equal((await admin.get(`/api/admin/entities/items/${id}`)).status, 404);
});

test("içinde ürün olan kategori silinemez (veri kaybı önlenir)", async () => {
  const cat = await firstCategory();
  const r = await admin.del(`/api/admin/entities/categories/${cat.id}`);
  assert.equal(r.status, 409);
  assert.ok((await admin.get(`/api/admin/entities/categories/${cat.id}`)).json.id);
});

test("kısa ad (slug) benzersiz ve biçimli olmalı", async () => {
  const sec = (await admin.get("/api/admin/entities/sections")).json[0];
  const dup = await admin.post("/api/admin/entities/categories", { section: sec.id, slug: "pizza", name: { tr: "Yine Pizza" }, image: "photo-1600891964599-f61ba0e24092" });
  assert.equal(dup.status, 400);
  assert.ok(dup.json.fields.slug);
  const bad = await admin.post("/api/admin/entities/categories", { section: sec.id, slug: "Büyük Harf!", name: { tr: "X" }, image: "photo-1600891964599-f61ba0e24092" });
  assert.equal(bad.status, 400);
});

test("bilinmeyen içerik türü ve kötü niyetli tür adı 404 döner", async () => {
  assert.equal((await admin.get("/api/admin/entities/users")).status, 404);
  assert.equal((await admin.get("/api/admin/entities/items%3BDROP%20TABLE%20users")).status, 404);
  assert.equal((await admin.get("/api/admin/entities/__proto__")).status, 404);
});

/* ---------- Odalar ---------- */
test("oda ekleme: sitede ve rezervasyon seçeneklerinde görünür", async () => {
  const r = await admin.post("/api/admin/entities/rooms", {
    name: { tr: "Deniz Manzaralı Oda", en: "Sea View Room" }, images: ["photo-1611892440504-42a792e24d32"], capacity: 2, size: "24 m²",
    features: [{ tr: "Klima", en: "Air conditioning" }], price: 3500, priceNote: { tr: "gecelik", en: "per night" }
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const d = await siteData();
  assert.equal(d.rooms.length, 1);
  assert.equal(d.rooms[0].name.en, "Sea View Room");
  assert.equal(d.rooms[0].price, 3500, "oda fiyatı menü fiyatlarından bağımsız görünmeli");
  const resv = { typeStreet: true, typeTerrace: true, typeStay: true, sendWhatsapp: true };
  assert.equal((await admin.put("/api/admin/settings/reservation", { ...resv, showRoomPrices: false })).status, 200);
  assert.equal((await siteData()).rooms[0].price, undefined, "oda fiyatları kapalıyken gönderilmemeli");
  await admin.put("/api/admin/settings/reservation", { ...resv, showRoomPrices: true });
  const noImg = await admin.post("/api/admin/entities/rooms", { name: { tr: "Fotoğrafsız" }, images: [] });
  assert.equal(noImg.status, 400);
});

/* ---------- Ayarlar ---------- */
test("fiyatları göster/gizle ayarı siteye anında yansır; gizliyken fiyat verisi hiç gönderilmez", async () => {
  let d = await siteData();
  assert.equal(d.menu.showPrices, false);
  assert.ok(d.menu.categories.every(c => c.items.every(i => i.price === undefined && i.prices === undefined)));
  assert.equal((await admin.put("/api/admin/settings/menu", { showPrices: true, currency: "₺" })).status, 200);
  d = await siteData();
  assert.equal(d.menu.showPrices, true);
  assert.ok(d.menu.categories.some(c => c.items.some(i => typeof i.price === "number")));
  assert.equal(typeof d.menu.setMenu.price, "number");
  await admin.put("/api/admin/settings/menu", { showPrices: false, currency: "₺" });
});

test("iletişim ayarları doğrulanır ve HTML'e işlenir", async () => {
  const bad = await admin.put("/api/admin/settings/contact", { phone: "abc", phoneDisplay: "", whatsapp: "+90 (532) abc", email: "x@" });
  assert.equal(bad.status, 400);
  for (const k of ["phone", "phoneDisplay", "whatsapp", "email"]) assert.ok(bad.json.fields[k], k);
  const ok = await admin.put("/api/admin/settings/contact", { phone: "+90 266 111 22 33", phoneDisplay: "0266 111 22 33", whatsapp: "905551112233", email: "info@ornek.com" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.phone, "+902661112233");
  const html = (await client(S.base).get("/")).text;
  assert.match(html, /href="tel:\+902663271965" class="nav__extra-link js-tel"><svg[^]*?<span data-bind="phoneDisplay">0266 111 22 33<\/span>/);
  const social = await admin.put("/api/admin/settings/social", { instagram: "javascript:alert(1)" });
  assert.equal(social.status, 400, "javascript: bağlantısı kabul edilmemeli");
});

test("duyuru şeridi, bölüm gizleme ve 'Bugün yok' işareti siteye aktarılır", async () => {
  const bad = await admin.put("/api/admin/settings/notice", { noticeOn: true, noticeText: { tr: "Canlı müzik" }, noticeLink: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.noticeLink);
  assert.equal((await admin.put("/api/admin/settings/notice", { noticeOn: true, noticeText: { tr: "Bu akşam canlı müzik", en: "Live music tonight" }, noticeLink: "#etkinlikler" })).status, 200);
  const sections = { showStory: true, showMenu: true, showEvents: true, showGallery: false, showStay: true, showReviews: true, showReservation: true, showContact: true };
  assert.equal((await admin.put("/api/admin/settings/sections", sections)).status, 200);

  const cat = await firstCategory();
  const item = (await admin.get(`/api/admin/entities/items?parent=${cat.id}`)).json[0];
  await admin.put(`/api/admin/entities/items/${item.id}`, { ...item, soldOut: true });

  const d = await siteData();
  assert.equal(d.settings.noticeText.en, "Live music tonight");
  assert.equal(d.settings.noticeLink, "#etkinlikler");
  assert.equal(d.settings.showGallery, false);
  assert.equal(d.menu.categories.find(c => c.id === cat.slug).items[0].soldOut, true);

  await admin.put(`/api/admin/entities/items/${item.id}`, { ...item, soldOut: false });
  await admin.put("/api/admin/settings/sections", { ...sections, showGallery: true });
  await admin.put("/api/admin/settings/notice", { noticeOn: false, noticeText: { tr: "" }, noticeLink: "" });
});

test("SEO ayarı: noindex kapatılınca robots etiketi kalkar", async () => {
  let html = (await client(S.base).get("/")).text;
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const cur = (await admin.get("/api/admin/settings")).json;
  await admin.put("/api/admin/settings/seo", { siteTitle: "Yeni Başlık <script>", siteDescription: cur.siteDescription, siteUrl: cur.siteUrl, noindex: false });
  html = (await client(S.base).get("/")).text;
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /<title>Yeni Başlık &lt;script&gt;<\/title>/);
});

/* ---------- Metinler ---------- */
test("metinlerde yalnızca <em>/<strong>/<br> geçer; betik etiketleri etkisizleştirilir", async () => {
  const r = await admin.put("/api/admin/texts/hero.title", { tr: "Merhaba <em>dünya</em><script>alert(1)</script><img src=x onerror=alert(1)>", en: "Hello" });
  assert.equal(r.status, 200);
  const html = (await client(S.base).get("/")).text;
  assert.match(html, /Merhaba <em>dünya<\/em>&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  // JSON veri bloğu da "</script>" ile kapatılamaz
  const block = html.match(/<script type="application\/json" id="site-data">([^]*?)<\/script>/)[1];
  assert.doesNotMatch(block, /<\/script/i);
  assert.equal((await admin.put("/api/admin/texts/olmayan.anahtar", { tr: "x" })).status, 404);
  assert.equal((await admin.put("/api/admin/texts/hero.title", { tr: "" })).status, 400);
});

/* ---------- Medya ---------- */
test("medya: sahte uzantılı dosya reddedilir, gerçek görsel ve video kabul edilir", async () => {
  const fake = new FormData();
  fake.append("files", new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" }), "kotu.jpg");
  const bad = await admin.post("/api/admin/media", fake);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Desteklenmeyen/);
  const svg = new FormData();
  svg.append("files", new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], { type: "image/svg+xml" }), "a.svg");
  assert.equal((await admin.post("/api/admin/media", svg)).status, 400, "SVG (betik içerebilir) kabul edilmemeli");

  const fd = new FormData();
  fd.append("files", new Blob([PNG], { type: "image/png" }), "piksel.png");
  fd.append("files", new Blob([MP4], { type: "video/mp4" }), "klip.mp4");
  const ok = await admin.post("/api/admin/media", fd);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const [png, mp4] = ok.json.saved;
  assert.equal(png.kind, "image");
  assert.equal(mp4.kind, "video");
  assert.match(png.path, /^\/uploads\/[a-z0-9-]+\.png$/);

  const served = await fetch(S.base + png.path);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
  assert.deepEqual(fs.readdirSync(path.join(S.dataDir, "uploads", ".tmp")), [], "geçici dosyalar temizlenmeli");
});

test("medya: sitede kullanılan dosya silinemez; kullanımdan kalkınca silinir", async () => {
  const fd = new FormData();
  fd.append("files", new Blob([PNG], { type: "image/png" }), "galeri.png");
  const m = (await admin.post("/api/admin/media", fd)).json.saved[0];
  const g = await admin.post("/api/admin/entities/gallery", { media: m.path, caption: { tr: "Yeni kare" }, ratio: "1:1" });
  assert.equal(g.status, 201);
  const d = await siteData();
  assert.ok(d.gallery.some(x => x.src === m.path));

  const blocked = await admin.del(`/api/admin/media/${m.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /Galeri öğesi: Yeni kare/);

  await admin.del(`/api/admin/entities/gallery/${g.json.id}`);
  assert.equal((await admin.del(`/api/admin/media/${m.id}`)).status, 200);
  assert.equal((await fetch(S.base + m.path)).status, 404);
});

test("galeriye video eklenir ve sitede video olarak işaretlenir", async () => {
  const fd = new FormData();
  fd.append("files", new Blob([MP4], { type: "video/mp4" }), "teras.mp4");
  const m = (await admin.post("/api/admin/media", fd)).json.saved[0];
  const g = await admin.post("/api/admin/entities/gallery", { media: m.path, caption: { tr: "Terasta akşam" } });
  assert.equal(g.status, 201);
  const item = (await siteData()).gallery.find(x => x.src === m.path);
  assert.equal(item.kind, "video");
  const imgOnly = await admin.post("/api/admin/entities/events", { title: { tr: "Video kapaklı" }, image: m.path });
  assert.equal(imgOnly.status, 400, "görsel alanına video konamaz");
});

/* ---------- Rezervasyonlar ---------- */
test("rezervasyon: geçersiz talepler reddedilir", async () => {
  const c = client(S.base);
  const r = await c.post("/api/reservations", { type: "sokak", name: "A", phone: "12", date: "2001-01-01", time: "03:00", guests: "99" });
  assert.equal(r.status, 400);
  for (const k of ["name", "phone", "date", "time", "guests"]) assert.ok(r.json.fields[k], k);
  const stay = await c.post("/api/reservations", { type: "konaklama", name: "Ayşe Yılmaz", phone: "0532 111 22 33", checkin: istanbulDay(5), checkout: istanbulDay(3), guests: "2" });
  assert.equal(stay.status, 400);
  assert.ok(stay.json.fields.checkout);
  const bot = await c.post("/api/reservations", { type: "sokak", name: "Bot", phone: "05321112233", date: istanbulDay(1), time: "19:30", guests: "2", website: "http://spam" });
  assert.equal(bot.status, 400);
});

test("rezervasyon: kaydedilir, panelde listelenir, durumu güncellenir ve silinir", async () => {
  const c = client(S.base);
  const room = (await admin.get("/api/admin/entities/rooms")).json[0];
  const a = await c.post("/api/reservations", { type: "teras", name: "Mehmet Kaya", phone: "0532 111 22 33", date: istanbulDay(2), time: "19:30", guests: "4", note: "Doğum günü", lang: "tr" });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const b = await c.post("/api/reservations", { type: "konaklama", name: "Anna Smith", phone: "+44 7700 900123", checkin: istanbulDay(10), checkout: istanbulDay(13), guests: "2", breakfast: true, room: room.id, lang: "en" });
  assert.equal(b.status, 201, JSON.stringify(b.json));

  const list = (await admin.get("/api/admin/reservations?status=yeni")).json;
  const ra = list.find(x => x.id === a.json.id), rb = list.find(x => x.id === b.json.id);
  assert.equal(ra.type, "teras");
  assert.equal(ra.note, "Doğum günü");
  assert.equal(rb.room_name, "Deniz Manzaralı Oda");
  assert.equal(rb.breakfast, 1);

  const stats = (await admin.get("/api/admin/stats")).json;
  assert.ok(stats.reservationsNew >= 2);

  const p = await admin.patch(`/api/admin/reservations/${a.json.id}`, { status: "onaylandi", adminNote: "Teras 4 nolu masa" });
  assert.equal(p.json.status, "onaylandi");
  assert.equal((await admin.patch(`/api/admin/reservations/${a.json.id}`, { status: "hack" })).status, 400);
  assert.equal((await admin.del(`/api/admin/reservations/${b.json.id}`)).status, 200);
  assert.equal((await admin.del(`/api/admin/reservations/${b.json.id}`)).status, 404);
});

test("rezervasyon: seçilen odanın kapasitesinden fazla kişi kabul edilmez", async () => {
  const room = (await admin.get("/api/admin/entities/rooms")).json[0]; // 2 kişilik
  const c = client(S.base);
  const base = { type: "konaklama", name: "Kalabalık Aile", phone: "05321112233", checkin: istanbulDay(20), checkout: istanbulDay(22), room: room.id };
  const over = await c.post("/api/reservations", { ...base, guests: "4" });
  assert.equal(over.status, 400);
  assert.match(over.json.fields.guests, /en fazla 2 kişilik/);
  assert.equal((await c.post("/api/reservations", { ...base, guests: "10+" })).status, 400);
  assert.equal((await c.post("/api/reservations", { ...base, guests: "2" })).status, 201);
});

test("rezervasyon türü panelden kapatılınca o türde talep alınmaz", async () => {
  await admin.put("/api/admin/settings/reservation", { typeStreet: true, typeTerrace: false, typeStay: true, sendWhatsapp: true });
  const r = await client(S.base).post("/api/reservations", { type: "teras", name: "Deneme Kişi", phone: "05321112233", date: istanbulDay(1), time: "19:30", guests: "2" });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.type);
  await admin.put("/api/admin/settings/reservation", { typeStreet: true, typeTerrace: true, typeStay: true, sendWhatsapp: true });
});

/* ---------- Kullanıcılar ve parola ---------- */
test("kullanıcılar: zayıf parola reddedilir, kişi kendini silemez", async () => {
  assert.equal((await admin.post("/api/admin/users", { username: "editor", password: "123" })).status, 400);
  assert.equal((await admin.post("/api/admin/users", { username: "editor", password: "editor-parola-1" })).status, 400, "parola kullanıcı adını içermemeli");
  const ok = await admin.post("/api/admin/users", { username: "editor", password: "Guclu-parola-77" });
  assert.equal(ok.status, 201);
  const me = (await admin.get("/api/admin/me")).json.user;
  assert.equal((await admin.del(`/api/admin/users/${me.id}`)).status, 400);
  assert.equal((await admin.del(`/api/admin/users/${ok.json.id}`)).status, 200);
});

test("parola değişimi: mevcut parola doğrulanır, diğer oturumlar kapanır", async () => {
  S.auth.createUser("ikinci", "Baska-parola-01");
  const a = client(S.base), b = client(S.base);
  assert.equal((await a.login("ikinci", "Baska-parola-01")).status, 200);
  assert.equal((await b.login("ikinci", "Baska-parola-01")).status, 200);
  assert.equal((await a.post("/api/admin/password", { current: "yanlis", next: "Yeni-parola-2026" })).status, 400);
  assert.equal((await a.post("/api/admin/password", { current: "Baska-parola-01", next: "Yeni-parola-2026" })).status, 200);
  assert.equal((await a.get("/api/admin/me")).status, 200, "parolayı değiştiren oturum açık kalır");
  assert.equal((await b.get("/api/admin/me")).status, 401, "diğer cihazdaki oturum kapanır");
  assert.equal((await client(S.base).login("ikinci", "Baska-parola-01")).status, 401);
  assert.equal((await client(S.base).login("ikinci", "Yeni-parola-2026")).status, 200);
});

test("çıkış yapınca oturum geçersiz olur", async () => {
  const c = client(S.base);
  assert.equal((await c.login("yonetici", PASS)).status, 200);
  const stolen = c.cookie;
  assert.equal((await fetch(S.base + "/api/admin/me", { headers: { Cookie: stolen } })).status, 200);
  assert.equal((await c.post("/api/admin/logout")).status, 200);
  const r = await fetch(S.base + "/api/admin/me", { headers: { Cookie: stolen } });
  assert.equal(r.status, 401, "çıkıştan sonra eski çerez işe yaramamalı");
});

test("parolalar veritabanında düz metin olarak tutulmaz", () => {
  const rows = S.db.prepare("SELECT password_hash FROM users").all();
  assert.ok(rows.length);
  rows.forEach(r => { assert.match(r.password_hash, /^scrypt\$/); assert.ok(!r.password_hash.includes(PASS)); });
  const sessions = S.db.prepare("SELECT id FROM sessions").all();
  sessions.forEach(s => assert.match(s.id, /^[0-9a-f]{64}$/, "oturum anahtarı özet olarak saklanmalı"));
});

test("rezervasyon formu kötüye kullanıma karşı sınırlandırılır", async () => {
  const c = client(S.base);
  let last;
  for (let i = 0; i < 12; i++) {
    last = await c.post("/api/reservations", { type: "sokak", name: "Sınır Testi", phone: "05321112233", date: istanbulDay(1), time: "20:00", guests: "2" });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
});
