/* GitHub Pages önizlemesi için sabit kopya:  npm run export-static
   Veritabanındaki güncel içeriği data/site.json dosyasına, sitede kullanılan yüklenmiş dosyaları static/uploads/ klasörüne yazar.
   Sunucu olmadan açılan sayfa (GitHub Pages) bu dosyayı okur. Panel ve rezervasyon kaydı orada çalışmaz;
   rezervasyon formu WhatsApp mesajıyla çalışmaya devam eder. İçerik değişince bu komutu tekrar çalıştırıp GitHub'a gönderin. */
const fs = require("node:fs");
const path = require("node:path");
const { openDb } = require("./db");
const { makeRepo } = require("./repo");
const { buildSiteData } = require("./site");

const ROOT = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(ROOT, "storage");
const uploadDir = path.join(dataDir, "uploads");
const outUploads = path.join(ROOT, "static", "uploads");
const MAX_FILE = 90 * 1024 * 1024; // GitHub dosya sınırı 100 MB

const db = openDb(path.join(dataDir, "kardias.db"));
const data = buildSiteData(makeRepo(db));
db.close();

// Sunucu olmadığı için talepler veritabanına yazılamaz: WhatsApp ile gönderim açık kalır
data.settings.sendWhatsapp = true;

// Yüklenen dosyalar: /uploads/x → static/uploads/x (alt klasörde yayınlanan sitede de çalışsın diye göreli yol)
let json = JSON.stringify(data);
const used = [...new Set(json.match(/\/uploads\/[a-z0-9-]+\.[a-z0-9]+/g) || [])];
fs.rmSync(outUploads, { recursive: true, force: true });
fs.mkdirSync(outUploads, { recursive: true });
const skipped = [];
for (const p of used) {
  const src = path.join(uploadDir, path.basename(p));
  if (!fs.existsSync(src)) { skipped.push(`${p} (bulunamadı)`); continue; }
  if (fs.statSync(src).size > MAX_FILE) { skipped.push(`${p} (90 MB'tan büyük)`); continue; }
  fs.copyFileSync(src, path.join(outUploads, path.basename(p)));
}
json = json.replace(/\/uploads\//g, "static/uploads/");

fs.writeFileSync(path.join(ROOT, "data", "site.json"), json);
console.log(`data/site.json yazıldı · ${used.length - skipped.length} dosya static/uploads/ klasörüne kopyalandı`);
if (skipped.length) console.log("Kopyalanamayanlar: " + skipped.join(", "));
