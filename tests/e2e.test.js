/* Uçtan uca test: yönetim paneli gerçek tarayıcıda kullanılır, değişikliklerin siteye yansıdığı doğrulanır.
   Chrome/Edge bulunamazsa atlanır. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer, PNG, MP4 } = require("./helpers");

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const chrome = BROWSERS.find(p => fs.existsSync(p));
let puppeteer = null;
try { puppeteer = require("puppeteer-core"); } catch { /* kurulu değil */ }
const skip = !chrome || !puppeteer ? "Chrome/Edge veya puppeteer-core bulunamadı" : false;

let S, browser, adminPage, files;
const PASS = "E2e-test-parola-9";
const errors = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitText(page, selector, text, timeout = 8000) {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some(el => el.textContent.includes(t)), { timeout }, selector, text);
}
async function clickText(page, selector, text) {
  await waitText(page, selector, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find(el => el.textContent.trim().includes(t)).click(), selector, text);
}
async function openSite() {
  const p = await browser.newPage();
  p.on("pageerror", e => errors.push("site: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR|Failed to load resource/.test(m.text())) errors.push("site console: " + m.text()); });
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(S.base + "/", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".cat-tile");
  return p;
}
async function save(page) {
  await page.click("#editSave");
  await page.waitForFunction(() => !document.getElementById("editModal").open, { timeout: 8000 })
    .catch(async () => { throw new Error("Kayıt başarısız: " + await page.$eval("#editError", e => e.textContent)); });
}
async function pickUpload(page, fieldKey, file) {
  await page.click(`[data-field="${fieldKey}"] .btn`);
  await page.waitForSelector("#mediaModal[open] input[type=file]");
  const input = await page.$("#mediaModal input[type=file]");
  await input.uploadFile(file);
  await page.waitForSelector("#mediaModal .tile.is-selected", { timeout: 10000 });
  await page.click("#mediaChoose");
  await page.waitForFunction(() => !document.getElementById("mediaModal").open);
}

before(async () => {
  if (skip) return;
  S = await startServer();
  S.auth.createUser("panel", PASS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kardias-e2e-"));
  files = { png: path.join(dir, "urun.png"), mp4: path.join(dir, "teras.mp4"), dir };
  fs.writeFileSync(files.png, PNG);
  fs.writeFileSync(files.mp4, MP4);
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--lang=tr-TR"] });
  adminPage = await browser.newPage();
  adminPage.on("pageerror", e => errors.push("panel: " + e.message));
  adminPage.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("panel console: " + m.text()); });
  adminPage.on("dialog", d => d.accept());
  await adminPage.setViewport({ width: 1280, height: 900 });
});
after(async () => {
  if (skip) return;
  await browser.close();
  await S.close();
  fs.rmSync(files.dir, { recursive: true, force: true });
});

test("panel: hatalı girişte uyarı, doğru girişte genel bakış", { skip }, async () => {
  const p = adminPage;
  await p.goto(S.base + "/admin/", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#loginView:not([hidden])");
  await p.type("#loginForm [name=username]", "panel");
  await p.type("#loginForm [name=password]", "yanlis-parola-1");
  await p.click("#loginForm button[type=submit]");
  await waitText(p, "#loginError", "hatalı");
  await p.$eval("#loginForm [name=password]", el => { el.value = ""; });
  await p.type("#loginForm [name=password]", PASS);
  await p.click("#loginForm button[type=submit]");
  await waitText(p, "h1", "Genel bakış");
  await waitText(p, ".stat span", "Menüdeki ürün");
});

test("panel → yeni ürün (fotoğraf yükleyerek) → sitede görünür; gizlenince kaybolur", { skip }, async () => {
  const p = adminPage;
  await p.goto(S.base + "/admin/#/e/items", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Yiyecek & içecekler");
  await p.waitForSelector(".row");
  await clickText(p, ".page-head .btn", "Yeni ürün");
  await p.waitForSelector("#editModal[open]");
  await p.type('[data-field="name"] .pair label:first-child input', "Panel Testi Pizzası");
  await p.type('[data-field="name"] .pair label:last-child input', "Panel Test Pizza");
  await p.type('[data-field="price"] input', "450");
  await p.click('[data-field="tags"] input[value="vejetaryen"]');
  await pickUpload(p, "image", files.png);
  await save(p);
  await waitText(p, ".row__title strong", "Panel Testi Pizzası");

  const site = await openSite();
  await site.type("#menuSearch", "Panel Testi");
  await waitText(site, ".item__name", "Panel Testi Pizzası");
  const src = await site.$eval(".item img", el => el.getAttribute("src"));
  assert.match(src, /^\/uploads\/.+\.png/);

  // Gizle (anahtar) → site yenilenince ürün yok
  await p.evaluate(() => [...document.querySelectorAll(".row")].find(r => r.textContent.includes("Panel Testi Pizzası")).querySelector(".switch input").click());
  await waitText(p, ".toast", "gizlendi");
  await site.reload({ waitUntil: "domcontentloaded" });
  await site.waitForSelector(".cat-tile");
  await site.type("#menuSearch", "Panel Testi");
  await waitText(site, ".menu-empty", "bulunamadı");
  await site.close();
});

test("panel → fiyatları göster ayarı ve sayfa metni → siteye anında yansır", { skip }, async () => {
  const p = adminPage;
  await p.goto(S.base + "/admin/#/ayar/menu", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Menü ayarları");
  await p.click('[data-field="showPrices"] .switch');
  await clickText(p, "form.card button", "Kaydet");
  await waitText(p, ".toast", "Kaydedildi");

  await p.goto(S.base + "/admin/#/metinler", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Sayfa metinleri");
  await p.type('input[type=search]', "hero.title");
  await p.evaluate(() => {
    const row = [...document.querySelectorAll(".text-row")].find(r => r.querySelector("code").textContent === "hero.title");
    const ta = row.querySelector("textarea");
    ta.value = "Panelden gelen <em>yeni</em> başlık";
    ta.dispatchEvent(new Event("input"));
    row.querySelector("button").click();
  });
  await waitText(p, ".toast", "Metin kaydedildi");

  const site = await openSite();
  assert.equal(await site.$eval(".hero__title", el => el.innerHTML), "Panelden gelen <em>yeni</em> başlık");
  assert.notEqual(await site.$eval(".setmenu__amount", el => el.textContent), "", "fiks menü fiyatı görünmeli");
  await site.click('a.cat-tile[href="#menu/pizza"]');
  await site.waitForSelector("#menuDrawer.is-open .item__price");
  await site.close();
});

test("panel → oda ekle → sitede oda kartı ve formda oda seçimi; talep panele düşer", { skip }, async () => {
  const p = adminPage;
  // Yalnızca panele kayıt (WhatsApp kapalı) modunda dene: talep sunucuya gerçekten yazılmalı
  await p.goto(S.base + "/admin/#/ayar/reservation", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Rezervasyon ayarları");
  await p.click('[data-field="sendWhatsapp"] .switch');
  await clickText(p, "form.card button", "Kaydet");
  await waitText(p, ".toast", "Kaydedildi");

  await p.goto(S.base + "/admin/#/e/rooms", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Konaklama odaları");
  await clickText(p, ".page-head .btn", "Yeni oda");
  await p.waitForSelector("#editModal[open]");
  await p.type('[data-field="name"] .pair label:first-child input', "Limanı Gören Oda");
  await p.type('[data-field="capacity"] input', "3");
  await p.click('[data-field="features"] .btn');
  await p.type('[data-field="features"] .line input:first-child', "Balkon");
  // Görsel listesi: kütüphaneden yükle
  await p.click('[data-field="images"] .btn');
  await p.waitForSelector("#mediaModal[open] input[type=file]");
  await (await p.$("#mediaModal input[type=file]")).uploadFile(files.png);
  await p.waitForSelector("#mediaModal .tile.is-selected", { timeout: 10000 });
  await p.click("#mediaChoose");
  await p.waitForSelector('[data-field="images"] .thumbs__item');
  await save(p);
  await waitText(p, ".row__title strong", "Limanı Gören Oda");

  // Oda kartı konaklama bölümünde, rezervasyon formuyla aynı alanda; kapasite rozeti görünür
  const site = await openSite();
  await waitText(site, "#konaklama .room__name", "Limanı Gören Oda");
  assert.equal(await site.$eval("#konaklama .room__cap", el => el.textContent.trim()), "3 kişilik");
  assert.ok(await site.$("#konaklama #stayForm"), "konaklama formu konaklama bölümünde olmalı");
  await site.$eval("#konaklama", el => el.scrollIntoView());
  await site.click("[data-pick-room]");
  const selected = await site.$eval('#stayForm select[name="room"]', el => el.options[el.selectedIndex].text);
  assert.equal(selected, "Limanı Gören Oda · 3 kişilik");
  assert.equal(await site.$eval(".room", el => el.classList.contains("is-selected")), true);
  const guestOpts = await site.$eval('#stayForm select[name="guests"]', el => [...el.options].map(o => o.value));
  assert.deepEqual(guestOpts, ["1", "2", "3"], "kişi sayısı oda kapasitesini aşmamalı");
  await site.type('#stayForm [name="name"]', "Deniz Arslan");
  await site.type('#stayForm [name="phone"]', "0532 444 55 66");
  await site.$eval('#stayForm [name="note"]', el => { el.value = "Geç giriş yapacağız"; });
  await site.click('#stayForm button[type="submit"]');
  await waitText(site, "#stayForm .form__ok", "Talebiniz bize ulaştı");

  // Sokak / teras masası formu ayrıca çalışır
  await site.type('#reserveForm [name="name"]', "Masa Testi");
  await site.type('#reserveForm [name="phone"]', "0532 444 55 77");
  await site.click('#reserveForm button[type="submit"]');
  await waitText(site, "#formOk", "Talebiniz bize ulaştı");
  await site.close();
  assert.equal(S.db.prepare("SELECT type FROM reservations WHERE name = 'Masa Testi'").get().type, "sokak");

  await p.goto(S.base + "/admin/#/rezervasyonlar", { waitUntil: "domcontentloaded" });
  await waitText(p, ".res__head strong", "Deniz Arslan");
  await waitText(p, ".res__info", "Limanı Gören Oda");
  await p.evaluate(() => {
    const card = [...document.querySelectorAll(".res")].find(c => c.querySelector(".res__head strong").textContent === "Deniz Arslan");
    const sel = card.querySelector(".status-select");
    sel.value = "onaylandi";
    sel.dispatchEvent(new Event("change"));
  });
  await waitText(p, ".toast", "Durum güncellendi");
  const row = S.db.prepare("SELECT status, room_name, note FROM reservations WHERE name = 'Deniz Arslan'").get();
  assert.deepEqual({ ...row }, { status: "onaylandi", room_name: "Limanı Gören Oda", note: "Geç giriş yapacağız" });
});

test("panel → galeriye video yükle → sitede video oynatma düğmesiyle görünür", { skip }, async () => {
  const p = adminPage;
  await p.goto(S.base + "/admin/#/e/gallery", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Fotoğraf & video galerisi");
  await clickText(p, ".page-head .btn", "Yeni galeri öğesi");
  await p.waitForSelector("#editModal[open]");
  await pickUpload(p, "media", files.mp4);
  await p.type('[data-field="caption"] .pair label:first-child input', "Terasta bir akşam");
  await save(p);

  const site = await openSite();
  await site.waitForSelector(".masonry__item--video video");
  const label = await site.$eval(".masonry__item--video", el => el.getAttribute("aria-label"));
  assert.equal(label, "Videoyu oynat: Terasta bir akşam");
  await site.close();
});

test("panel → duyuru şeridi ve bölüm gizleme → sitede görünür", { skip }, async () => {
  const p = adminPage;
  await p.goto(S.base + "/admin/#/ayar/notice", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Duyuru şeridi");
  await p.click('[data-field="noticeOn"] .switch');
  await p.type('[data-field="noticeText"] .pair label:first-child input', "Bu akşam canlı müzik");
  await p.type('[data-field="noticeLink"] input', "#etkinlikler");
  await clickText(p, "form.card button", "Kaydet");
  await waitText(p, ".toast", "Kaydedildi");

  await p.goto(S.base + "/admin/#/ayar/sections", { waitUntil: "domcontentloaded" });
  await waitText(p, "h1", "Bölümleri göster / gizle");
  assert.equal(await p.$eval('[data-field="showGallery"] input', el => el.checked), true, "varsayılan: açık");
  await p.click('[data-field="showGallery"] .switch');
  await clickText(p, "form.card button", "Kaydet");
  await waitText(p, ".toast", "Kaydedildi");

  const site = await openSite();
  assert.equal(await site.$eval("#siteNotice", el => `${el.textContent}|${el.getAttribute("href")}`), "Bu akşam canlı müzik|#etkinlikler");
  assert.equal(await site.$eval("#galeri", el => el.hidden), true);
  assert.equal(await site.$('.nav__menu a[href="#galeri"]'), null, "gizli bölümün menü bağlantısı kalkmalı");
  assert.equal(await site.$eval("#hikaye", el => el.hidden), false);
  await site.close();
});

test("panelde ve sitede JavaScript hatası oluşmadı", { skip }, () => {
  assert.deepEqual(errors, []);
});
