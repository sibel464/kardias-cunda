/* Medya kütüphanesi: görsel/video yükleme, dosya türü doğrulama, kullanım kontrolü, silme */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const { ENTITIES, SETTINGS } = require("./schema");
const { q } = require("./db");
const { HttpError } = require("./repo");

const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 200 * 1024 * 1024;

// Dosyanın gerçek türünü ilk baytlarından anlar (uzantıya / tarayıcının söylediğine güvenilmez)
function sniff(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString("latin1");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png", kind: "image" };
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", ext: "avif", kind: "image" };
    if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV"].includes(brand)) return { mime: "video/mp4", ext: "mp4", kind: "video" };
    if (brand === "qt  ") return null; // .mov: tarayıcılarda güvenilir oynamaz
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mime: "video/webm", ext: "webm", kind: "video" };
  return null;
}

function readHead(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    return buf;
  } finally { fs.closeSync(fd); }
}

function makeMedia(db, uploadDir) {
  const tmpDir = path.join(uploadDir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: tmpDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex"))
    }),
    // Tür kontrolü kaydetmeden önce dosyanın içeriğine bakılarak yapılır (sniff)
    limits: { fileSize: VIDEO_MAX, files: 20, fields: 5, parts: 30 }
  });

  function list() {
    return db.prepare("SELECT id, path, original_name AS name, mime, kind, size, created_at AS createdAt FROM media ORDER BY id DESC").all();
  }

  // Yüklenen dosyaları doğrula ve kalıcı adlarıyla kaydet
  function store(files) {
    const saved = [], rejected = [];
    for (const f of files || []) {
      try {
        const type = sniff(readHead(f.path));
        if (!type) { rejected.push({ name: f.originalname, error: "Desteklenmeyen dosya türü. JPG, PNG, WEBP, GIF, AVIF, MP4 veya WEBM yükleyin." }); continue; }
        if (type.kind === "image" && f.size > IMAGE_MAX) { rejected.push({ name: f.originalname, error: "Görsel en fazla 15 MB olabilir." }); continue; }
        const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${type.ext}`;
        fs.renameSync(f.path, path.join(uploadDir, name));
        const original = String(f.originalname || "").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120);
        const info = db.prepare("INSERT INTO media (path, original_name, mime, kind, size) VALUES (?, ?, ?, ?, ?)")
          .run("/uploads/" + name, original, type.mime, type.kind, f.size);
        saved.push(db.prepare("SELECT id, path, original_name AS name, mime, kind, size, created_at AS createdAt FROM media WHERE id = ?").get(info.lastInsertRowid));
      } finally {
        if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
      }
    }
    return { saved, rejected };
  }

  // Bu dosya sitede bir yerde kullanılıyor mu?
  function usages(p) {
    const found = [];
    const like = `%${p.replace(/[%_\\]/g, "\\$&")}%`;
    for (const [type, def] of Object.entries(ENTITIES)) {
      const cols = def.fields.filter(f => ["image", "media", "images"].includes(f.type)).map(f => f.key);
      if (!cols.length) continue;
      const titleCol = def.fields.find(f => f.key === def.title).type.startsWith("i18n") ? def.title + "_tr" : def.title;
      const rows = db.prepare(`SELECT id, ${q(titleCol)} AS t FROM ${q(def.table)} WHERE ${cols.map(c => `${q(c)} LIKE ? ESCAPE '\\'`).join(" OR ")}`)
        .all(...cols.map(() => like));
      rows.forEach(r => found.push(`${def.single}: ${r.t || "#" + r.id}`));
    }
    const settingLabels = Object.fromEntries(SETTINGS.flatMap(g => g.fields.map(f => [f.key, f.label])));
    db.prepare("SELECT key FROM settings WHERE value LIKE ? ESCAPE '\\'").all(like).forEach(r => found.push(`Site ayarı: ${settingLabels[r.key] || r.key}`));
    return found;
  }

  function remove(id) {
    const row = db.prepare("SELECT path FROM media WHERE id = ?").get(Number(id));
    if (!row) throw new HttpError(404, "Dosya bulunamadı.");
    const used = usages(row.path);
    if (used.length) {
      const err = new HttpError(409, "Bu dosya sitede kullanılıyor; önce şu yerlerden kaldırın: " + used.join(", "));
      err.usages = used;
      throw err;
    }
    db.prepare("DELETE FROM media WHERE id = ?").run(Number(id));
    const file = path.join(uploadDir, path.basename(row.path));
    if (file.startsWith(uploadDir) && fs.existsSync(file)) fs.rmSync(file);
  }

  return { upload, list, store, remove, usages };
}

module.exports = { makeMedia, sniff };
