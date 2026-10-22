/* GitHub Pages kopyasını veritabanına aktarır (export-static'in tersi):
     npm run import-static              yalnızca ne değişeceğini gösterir, hiçbir şey yazmaz
     npm run import-static -- --uygula  önce otomatik yedek alır, sonra aktarır (sunucu durdurulmuşken çalıştırın)
   data/admin-db.json'daki içerik kayıtları (menü, odalar, galeri, yorumlar…), ayarlar, metinler ve medya kütüphanesi
   kimlikleri korunarak yazılır; kaynakta olmayan içerik kayıtları silinir. Rezervasyonlar, kullanıcılar, oturumlar ve
   güvenlik kayıtları DEĞİŞMEZ. Kaynak herkese açık bir depodan geldiği için her kayıt sunucudaki kurallarla yeniden doğrulanır. */
const fs = require("node:fs");
const path = require("node:path");
const { openDb, tx, q } = require("./db");
const { makeRepo, objToCols } = require("./repo");
const { ENTITIES, SETTINGS, SETTING_FIELDS } = require("./schema");
const { validate } = require("./validate");
const { sniff } = require("./media");
const { createBackup } = require("./backup");
const { seedIfEmpty, syncNewTexts } = require("./seed");

const ROOT = path.join(__dirname, "..");
// Üst kayıtlar önce yazılır, alt kayıtlar önce silinir
const ORDER = ["sections", "categories", "items", "setmenus", "rooms", "events", "gallery", "reviews", "credits"];

function loadSource(root = ROOT) {
  const src = JSON.parse(fs.readFileSync(path.join(root, "data", "admin-db.json"), "utf8"));
  if (src.version !== 1 || !src.entities || !src.settings) throw new Error("data/admin-db.json beklenen biçimde değil.");
  return src;
}

// Kaynak → doğrulanmış satırlar (hata varsa hiçbir şey yazılmadan durur)
function prepare(src, root = ROOT) {
  const errors = [], rows = {};
  for (const type of ORDER) {
    const def = ENTITIES[type];
    rows[type] = (src.entities[type] || []).map(o => {
      if (!Number.isInteger(o.id) || o.id < 1) { errors.push(`${type}: geçersiz kimlik`); return null; }
      try {
        const cols = objToCols(def, validate(def.fields, o));
        // Kaynaktaki son değişiklik zamanı korunur (değişmeyen kayıtlar "bugün güncellendi" görünmesin)
        const updated = typeof o.updatedAt === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o.updatedAt) ? o.updatedAt : null;
        return { ...cols, id: o.id, sort: Number.isInteger(o.sort) ? o.sort : 0, active: o.active === false ? 0 : 1, updated_at: updated };
      } catch (e) {
        errors.push(`${type} #${o.id}: ${e.fields ? Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join(", ") : e.message}`);
        return null;
      }
    }).filter(Boolean);
  }
  const settings = {};
  for (const g of SETTINGS) {
    const input = Object.fromEntries(g.fields.filter(f => f.key in src.settings).map(f => [f.key, src.settings[f.key]]));
    try { Object.assign(settings, validate(g.fields, input, { partial: true })); } catch (e) { errors.push(`ayar grubu ${g.group}: ${JSON.stringify(e.fields)}`); }
  }
  const texts = (src.texts || []).map(t => {
    try { return { key: String(t.key), ...validate([{ key: "value", type: "i18ntext", required: true, max: 2000 }], { value: { tr: t.tr, en: t.en } }).value }; }
    catch { errors.push(`metin ${t.key}: geçersiz`); return null; }
  }).filter(Boolean);
  // Medya: dosya static/uploads'ta olmalı ve içeriği kayıttaki türle uyuşmalı
  const media = (src.media || []).map(m => {
    const name = path.basename(String(m.path || ""));
    const file = path.join(root, "static", "uploads", name);
    if (!/^[a-z0-9-]+\.[a-z0-9]+$/.test(name) || `/uploads/${name}` !== m.path) { errors.push(`medya #${m.id}: geçersiz yol`); return null; }
    if (!fs.existsSync(file)) { errors.push(`medya #${m.id}: static/uploads/${name} yok`); return null; }
    const head = Buffer.alloc(32), fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd);
    const type = sniff(head);
    if (!type || type.mime !== m.mime) { errors.push(`medya #${m.id}: dosya içeriği ${m.mime} değil`); return null; }
    return { id: m.id, path: m.path, original_name: String(m.name || "").slice(0, 120), mime: type.mime, kind: type.kind, size: fs.statSync(file).size, file, created_at: m.createdAt || null };
  }).filter(Boolean);
  // İçerikte başvurulan her yüklenmiş dosya medya kütüphanesinde olmalı
  const refs = new Set((JSON.stringify(rows) + JSON.stringify(settings)).match(/\/uploads\/[a-z0-9-]+\.[a-z0-9]+/g) || []);
  for (const r of refs) if (!media.some(m => m.path === r)) errors.push(`içerik ${r} dosyasına başvuruyor ama medya kütüphanesinde yok`);
  return { errors, rows, settings, texts, media };
}

function plan(db, prepared) {
  const out = [];
  for (const type of ORDER) {
    const table = ENTITIES[type].table;
    const cur = new Set(db.prepare(`SELECT id FROM ${q(table)}`).all().map(r => r.id));
    const next = new Set(prepared.rows[type].map(r => r.id));
    out.push({ type, mevcut: cur.size, kaynak: next.size, eklenecek: [...next].filter(id => !cur.has(id)).length, silinecek: [...cur].filter(id => !next.has(id)).length });
  }
  const curMedia = new Set(db.prepare("SELECT id FROM media").all().map(r => r.id));
  out.push({ type: "media", mevcut: curMedia.size, kaynak: prepared.media.length, eklenecek: prepared.media.filter(m => !curMedia.has(m.id)).length, silinecek: [...curMedia].filter(id => !prepared.media.some(m => m.id === id)).length });
  return out;
}

function apply(db, prepared, uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  // Önce dosyalar (veritabanı yazımı başarısız olursa fazladan dosya kalır ama hiçbir kayıt dosyasız kalmaz)
  for (const m of prepared.media) {
    const dest = path.join(uploadDir, path.basename(m.path));
    if (!fs.existsSync(dest)) fs.copyFileSync(m.file, dest);
  }
  tx(db, () => {
    db.exec("PRAGMA defer_foreign_keys = ON"); // kategoriler birbirine başvurabilir; kontrol işlem sonunda yapılır
    for (const type of ORDER) {
      const table = q(ENTITIES[type].table);
      for (const r of prepared.rows[type]) {
        const names = Object.keys(r);
        db.prepare(`INSERT INTO ${table} (${names.map(q).join(", ")}) VALUES (${names.map(() => "?").join(", ")})
                    ON CONFLICT(id) DO UPDATE SET ${names.filter(n => n !== "id").map(n => `${q(n)} = excluded.${q(n)}`).join(", ")}`)
          .run(...names.map(n => r[n]));
      }
    }
    for (const type of [...ORDER].reverse()) {
      const keep = prepared.rows[type].map(r => r.id);
      db.prepare(`DELETE FROM ${q(ENTITIES[type].table)} WHERE id NOT IN (${keep.map(() => "?").join(",") || "-1"})`).run(...keep);
    }
    const setStmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [k, v] of Object.entries(prepared.settings)) if (SETTING_FIELDS[k]) setStmt.run(k, JSON.stringify(v));
    const textStmt = db.prepare("INSERT INTO texts (key, tr, en) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET tr = excluded.tr, en = excluded.en");
    for (const t of prepared.texts) textStmt.run(t.key, t.tr, t.en);
    for (const m of prepared.media) {
      db.prepare(`INSERT INTO media (id, path, original_name, mime, kind, size, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
                  ON CONFLICT(id) DO UPDATE SET path = excluded.path, original_name = excluded.original_name, mime = excluded.mime, kind = excluded.kind, size = excluded.size`)
        .run(m.id, m.path, m.original_name, m.mime, m.kind, m.size, m.created_at);
    }
    const keepMedia = prepared.media.map(m => m.id);
    db.prepare(`DELETE FROM media WHERE id NOT IN (${keepMedia.map(() => "?").join(",") || "-1"})`).run(...keepMedia);
  });
}

module.exports = { loadSource, prepare, plan, apply };

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(ROOT, "storage");
  const doApply = process.argv.includes("--uygula");
  try {
    const prepared = prepare(loadSource());
    if (prepared.errors.length) {
      console.error("Kaynak doğrulanamadı, hiçbir şey yazılmadı:\n- " + prepared.errors.join("\n- "));
      process.exit(1);
    }
    const db = openDb(path.join(dataDir, "kardias.db"));
    // Sunucunun açılışta yaptığının aynısı: boş veritabanında temel tablolar ve metinler hazırlanır
    seedIfEmpty(db, makeRepo(db));
    syncNewTexts(db);
    console.table(plan(db, prepared));
    if (!doApply) {
      console.log("Bu yalnızca bir önizlemedir. Uygulamak için:  npm run import-static -- --uygula  (sunucu durdurulmuşken)");
    } else {
      const b = createBackup({ dataDir, db, keep: Number(process.env.BACKUP_KEEP || 14) });
      console.log(`Önce yedek alındı: ${b.dir}`);
      apply(db, prepared, path.join(dataDir, "uploads"));
      const after = plan(db, prepared);
      const mismatch = after.filter(r => r.mevcut !== r.kaynak);
      console.table(after.map(({ type, mevcut, kaynak }) => ({ type, veritabani: mevcut, kaynak })));
      console.log(mismatch.length ? "UYARI: sayılar uyuşmuyor: " + mismatch.map(r => r.type).join(", ") : "Aktarım tamamlandı; tüm sayılar kaynakla aynı.");
    }
    db.close();
  } catch (e) {
    console.error("Hata: " + e.message);
    process.exit(1);
  }
}
