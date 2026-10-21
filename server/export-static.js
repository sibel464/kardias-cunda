/* GitHub Pages kopyası:  npm run export-static
   Veritabanındaki güncel içeriği data/site.json (sitenin okuduğu) ve data/admin-db.json (GitHub Pages panelinin
   düzenlediği tam kopya: gizli kayıtlar ve medya kütüphanesi dahil) dosyalarına, yüklenmiş dosyaları static/uploads/
   klasörüne yazar. Sunucu olmadan açılan sayfa (GitHub Pages) bu dosyaları okur; rezervasyon formu WhatsApp mesajıyla
   çalışmaya devam eder. İçerik değişince bu komutu tekrar çalıştırıp GitHub'a gönderin.
   Dikkat: GitHub Pages panelinde yapılan değişiklikler bu komutla veritabanındaki içeriğin üzerine yazılır. */
const fs = require("node:fs");
const path = require("node:path");
const { openDb } = require("./db");
const { makeRepo } = require("./repo");
const { buildSiteData, toStaticSiteData } = require("./site-data");
const { ENTITIES } = require("./schema");

const ROOT = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(ROOT, "storage");
const uploadDir = path.join(dataDir, "uploads");
const outUploads = path.join(ROOT, "static", "uploads");
const MAX_FILE = 50 * 1024 * 1024; // GitHub 50 MB üstü dosyalarda uyarır, 100 MB'ı kabul etmez

const db = openDb(path.join(dataDir, "kardias.db"));
const repo = makeRepo(db);
const data = buildSiteData(repo);
const media = db.prepare("SELECT id, path, original_name AS name, mime, kind, size, created_at AS createdAt FROM media ORDER BY id").all();

// Medya kütüphanesindeki dosyalar: /uploads/x → static/uploads/x
fs.rmSync(outUploads, { recursive: true, force: true });
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

console.log(`data/site.json ve data/admin-db.json yazıldı · ${copied.length} dosya static/uploads/ klasörüne kopyalandı`);
if (skipped.length) console.log("Kopyalanamayanlar: " + skipped.join(", "));
