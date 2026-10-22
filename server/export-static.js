/* GitHub Pages kopyası:  npm run export-static
   Veritabanındaki güncel içeriği data/site.json (sitenin okuduğu) ve data/admin-db.json (GitHub Pages panelinin
   düzenlediği tam kopya: gizli kayıtlar ve medya kütüphanesi dahil) dosyalarına, yüklenmiş dosyaları static/uploads/
   klasörüne yazar. Sunucu olmadan açılan sayfa (GitHub Pages) bu dosyaları okur; rezervasyon formu WhatsApp mesajıyla
   çalışmaya devam eder. İçerik değişince bu komutu tekrar çalıştırıp GitHub'a gönderin.
   Güvenlik: data/admin-db.json'da veritabanında olmayan bir kayıt ya da medya varsa (ör. GitHub Pages panelinde eklenmiş)
   hiçbir şey yazılmaz; önce `npm run import-static` ile alın ya da bilerek silmek için `-- --zorla` verin.
   static/uploads klasörü silinmez; yalnızca eksik dosyalar eklenir, veritabanında olmayanlar listelenir. */
const fs = require("node:fs");
const path = require("node:path");
const { openDb } = require("./db");
const { makeRepo } = require("./repo");
const { buildSiteData, toStaticSiteData } = require("./site-data");
const { ENTITIES } = require("./schema");
const { renderKvkk } = require("./kvkk");

const ROOT = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(ROOT, "storage");
const uploadDir = path.join(dataDir, "uploads");
const outUploads = path.join(ROOT, "static", "uploads");
const MAX_FILE = 50 * 1024 * 1024; // GitHub 50 MB üstü dosyalarda uyarır, 100 MB'ı kabul etmez

const db = openDb(path.join(dataDir, "kardias.db"));
const repo = makeRepo(db);
const data = buildSiteData(repo);
const media = db.prepare("SELECT id, path, original_name AS name, mime, kind, size, created_at AS createdAt FROM media ORDER BY id").all();

// Üzerine yazmadan önce: mevcut GitHub kopyasında olup veritabanında olmayan kayıtlar kaybolmasın
const adminDbFile = path.join(ROOT, "data", "admin-db.json");
if (fs.existsSync(adminDbFile) && !process.argv.includes("--zorla")) {
  const old = JSON.parse(fs.readFileSync(adminDbFile, "utf8"));
  const lost = [];
  for (const type of Object.keys(ENTITIES)) {
    const ids = new Set(repo.list(type).map(x => x.id));
    for (const x of (old.entities && old.entities[type]) || []) if (!ids.has(x.id)) lost.push(`${type} #${x.id}`);
  }
  const mediaIds = new Set(media.map(m => m.id));
  for (const m of old.media || []) if (!mediaIds.has(m.id)) lost.push(`medya #${m.id} ${m.path}`);
  if (lost.length) {
    console.error(`Durduruldu: data/admin-db.json'da veritabanında olmayan ${lost.length} kayıt var; dışa aktarım bunları silerdi:\n- ${lost.slice(0, 30).join("\n- ")}` +
      "\nÖnce `npm run import-static` ile veritabanına alın ya da bilerek silmek için `npm run export-static -- --zorla` kullanın.");
    db.close();
    process.exit(1);
  }
}

// Medya kütüphanesindeki dosyalar: /uploads/x → static/uploads/x (mevcut dosyalar silinmez)
fs.mkdirSync(outUploads, { recursive: true });
const skipped = [];
const copied = media.filter(m => {
  const src = path.join(uploadDir, path.basename(m.path));
  if (!fs.existsSync(src)) { skipped.push(`${m.path} (bulunamadı)`); return false; }
  if (fs.statSync(src).size > MAX_FILE) { skipped.push(`${m.path} (50 MB'tan büyük)`); return false; }
  fs.copyFileSync(src, path.join(outUploads, path.basename(m.path)));
  return true;
});

fs.writeFileSync(path.join(ROOT, "data", "site.json"), toStaticSiteData(data));
fs.writeFileSync(path.join(ROOT, "kvkk.html"), renderKvkk(data.settings, { isStatic: true }));

const nextId = list => list.reduce((n, x) => Math.max(n, x.id), 0) + 1;
const entities = Object.fromEntries(Object.keys(ENTITIES).map(type => [type, repo.list(type)]));
const adminDb = {
  version: 1,
  entities,
  nextId: { ...Object.fromEntries(Object.entries(entities).map(([type, list]) => [type, nextId(list)])), media: nextId(media) },
  settings: repo.getSettings(),
  texts: repo.getTexts(),
  media: copied
};
fs.writeFileSync(path.join(ROOT, "data", "admin-db.json"), JSON.stringify(adminDb, null, 1));
db.close();

console.log(`data/site.json, data/admin-db.json ve kvkk.html yazıldı · ${copied.length} dosya static/uploads/ klasöründe`);
if (skipped.length) console.log("Kopyalanamayanlar: " + skipped.join(", "));
const known = new Set(copied.map(m => path.basename(m.path)));
const extra = fs.readdirSync(outUploads).filter(n => !known.has(n));
if (extra.length) console.log(`static/uploads'ta veritabanında olmayan ${extra.length} dosya var (silinmedi): ${extra.join(", ")}`);
