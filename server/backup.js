/* Yedekleme ve geri yükleme
     npm run backup                          yeni yedek al (sunucu çalışırken de güvenli)
     npm run backup -- verify <klasör>       yedeği doğrula
     npm run backup -- restore <klasör> --onay   yedeği geri yükle (önce sunucuyu durdurun)
   Veritabanı VACUUM INTO ile tek dosyaya yazılır (WAL içeriği dahil, tutarlı anlık görüntü); yüklenen dosyalar yanına
   kopyalanır. Her yedekte manifest.json (satır sayıları + SHA-256) bulunur ve yedek alındıktan hemen sonra doğrulanır.
   Ayarlar: DATA_DIR, BACKUP_DIR (varsayılan DATA_DIR/backups), BACKUP_KEEP (saklanacak yedek sayısı, varsayılan 14). */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PREFIX = "yedek-";
const sha256File = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const stamp = () => new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");

function tableCounts(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
}

// db: açık veritabanı bağlantısı (sunucunun kendisi) ya da yoksa dataDir'deki dosya salt okunur açılır
function createBackup({ dataDir, backupDir = path.join(dataDir, "backups"), db = null, keep = 14 }) {
  const dir = path.join(backupDir, PREFIX + stamp() + "-" + crypto.randomBytes(2).toString("hex"));
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const own = !db;
  const conn = db || new DatabaseSync(path.join(dataDir, "kardias.db"), { readOnly: true });
  try {
    conn.exec(`VACUUM INTO '${path.join(dir, "kardias.db").replace(/'/g, "''")}'`);
  } finally {
    if (own) conn.close();
  }
  // Veritabanının başvurduğu dosyalar + klasördeki diğer yüklemeler
  const uploadDir = path.join(dataDir, "uploads");
  if (fs.existsSync(uploadDir)) {
    for (const name of fs.readdirSync(uploadDir)) {
      const src = path.join(uploadDir, name);
      if (!name.startsWith(".") && fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, "uploads", name));
    }
  }
  const snap = new DatabaseSync(path.join(dir, "kardias.db"), { readOnly: true });
  const counts = tableCounts(snap);
  const mediaPaths = snap.prepare("SELECT path FROM media").all().map(r => path.basename(r.path));
  snap.close();
  // Yedek alınırken yüklenen bir dosya kopyadan sonra eklendiyse şimdi tamamlanır
  for (const name of mediaPaths) {
    const dest = path.join(dir, "uploads", name), src = path.join(uploadDir, name);
    if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
  const files = {};
  for (const rel of ["kardias.db", ...fs.readdirSync(path.join(dir, "uploads")).map(n => "uploads/" + n)]) files[rel] = sha256File(path.join(dir, rel));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), counts, files }, null, 1));
  const check = verifyBackup(dir);
  if (!check.ok) throw new Error("Yedek doğrulanamadı: " + check.problems.join("; "));
  pruneBackups(backupDir, keep);
  return { dir, counts, fileCount: Object.keys(files).length };
}

// Bütünlük, satır sayıları, dosya özetleri ve veritabanının başvurduğu yüklemelerin varlığı
function verifyBackup(dir) {
  const problems = [];
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); } catch { return { ok: false, problems: ["manifest.json okunamadı"] }; }
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const f = path.join(dir, rel);
    if (!fs.existsSync(f)) problems.push(`${rel} eksik`);
    else if (sha256File(f) !== hash) problems.push(`${rel} değişmiş`);
  }
  try {
    const db = new DatabaseSync(path.join(dir, "kardias.db"), { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").all().map(r => Object.values(r)[0]).join(", ");
    if (integrity !== "ok") problems.push("integrity_check: " + integrity);
    if (db.prepare("PRAGMA foreign_key_check").all().length) problems.push("yabancı anahtar ihlali");
    if (JSON.stringify(tableCounts(db)) !== JSON.stringify(manifest.counts)) problems.push("satır sayıları manifestle uyuşmuyor");
    for (const { path: p } of db.prepare("SELECT path FROM media").all()) {
      if (!fs.existsSync(path.join(dir, "uploads", path.basename(p)))) problems.push(`yüklenen dosya yok: ${p}`);
    }
    db.close();
  } catch (e) {
    problems.push("veritabanı açılamadı: " + e.message);
  }
  return { ok: !problems.length, problems, counts: manifest.counts };
}

// En yeni `keep` yedek kalır; yalnızca bu aracın oluşturduğu (yedek-…) klasörlere dokunulur
function pruneBackups(backupDir, keep) {
  if (!(keep > 0) || !fs.existsSync(backupDir)) return;
  const dirs = fs.readdirSync(backupDir).filter(n => n.startsWith(PREFIX)).sort();
  for (const n of dirs.slice(0, Math.max(0, dirs.length - keep))) fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
}

// Geri yükleme: mevcut veritabanı ve yüklemeler silinmez, "geri-yukleme-oncesi-…" klasörüne taşınır
function restoreBackup({ dir, dataDir }) {
  const check = verifyBackup(dir);
  if (!check.ok) throw new Error("Yedek doğrulanamadı, geri yüklenmedi: " + check.problems.join("; "));
  const aside = path.join(dataDir, "geri-yukleme-oncesi-" + stamp());
  fs.mkdirSync(aside, { recursive: true });
  for (const f of ["kardias.db", "kardias.db-wal", "kardias.db-shm"]) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, f));
  }
  const uploadDir = path.join(dataDir, "uploads");
  if (fs.existsSync(uploadDir)) fs.renameSync(uploadDir, path.join(aside, "uploads"));
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.copyFileSync(path.join(dir, "kardias.db"), path.join(dataDir, "kardias.db"));
  for (const n of fs.readdirSync(path.join(dir, "uploads"))) fs.copyFileSync(path.join(dir, "uploads", n), path.join(uploadDir, n));
  return { aside, counts: check.counts };
}

module.exports = { createBackup, verifyBackup, restoreBackup, pruneBackups };

if (require.main === module) {
  const [cmd = "create", target] = process.argv.slice(2);
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "storage");
  const backupDir = process.env.BACKUP_DIR || path.join(dataDir, "backups");
  try {
    if (cmd === "create") {
      const out = createBackup({ dataDir, backupDir, keep: Number(process.env.BACKUP_KEEP || 14) });
      console.log(`Yedek alındı ve doğrulandı: ${out.dir}\n${out.fileCount} dosya · ${Object.entries(out.counts).filter(([, n]) => n).map(([t, n]) => `${t}=${n}`).join(" ")}`);
    } else if (cmd === "verify" && target) {
      const out = verifyBackup(path.resolve(target));
      console.log(out.ok ? "Yedek sağlam." : "SORUNLAR:\n- " + out.problems.join("\n- "));
      process.exit(out.ok ? 0 : 1);
    } else if (cmd === "restore" && target && process.argv.includes("--onay")) {
      const out = restoreBackup({ dir: path.resolve(target), dataDir });
      console.log(`Geri yüklendi. Önceki veriler silinmedi, şuraya taşındı: ${out.aside}\nŞimdi sunucuyu başlatın.`);
    } else {
      console.log("Kullanım: npm run backup  |  npm run backup -- verify <klasör>  |  npm run backup -- restore <klasör> --onay (sunucu durdurulmuşken)");
      process.exit(1);
    }
  } catch (e) {
    console.error("Hata: " + e.message);
    process.exit(1);
  }
}
