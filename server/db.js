/* SQLite veritabanı (Node'un yerleşik node:sqlite modülü) ve tablo kurulumu */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ENTITIES, columnsOf } = require("./schema");

const q = name => `"${name.replace(/"/g, "")}"`;

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,                -- oturum anahtarının SHA-256 özeti (anahtarın kendisi saklanmaz)
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS texts (key TEXT PRIMARY KEY, tr TEXT NOT NULL DEFAULT '', en TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      original_name TEXT,
      mime TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('sokak', 'teras', 'konaklama')),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT, time TEXT, guests TEXT,
      checkin TEXT, checkout TEXT, breakfast INTEGER,
      room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      room_name TEXT,
      note TEXT,
      lang TEXT,
      status TEXT NOT NULL DEFAULT 'yeni' CHECK (status IN ('yeni', 'onaylandi', 'iptal', 'tamamlandi')),
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- E-postayla gönderilen tek kullanımlık kodlar (parola sıfırlama, e-posta doğrulama); kodun kendisi saklanmaz
    CREATE TABLE IF NOT EXISTS auth_codes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('reset', 'verify')),
      code_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Güvenlik kayıtları: girişler, hatalı denemeler, kilitlenmeler, parola ve e-posta işlemleri
    CREATE TABLE IF NOT EXISTS security_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'alert')),
      user_id INTEGER,
      username TEXT,
      ip TEXT,
      ua TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_security_log_at ON security_log(at);
    -- Siteye hiç gönderilmeyen ayarlar (ör. e-posta sunucusu parolası)
    CREATE TABLE IF NOT EXISTS private_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const userCols = new Set(db.prepare("PRAGMA table_info(users)").all().map(r => r.name));
  if (!userCols.has("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!userCols.has("email_verified_at")) db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
  // Oturumlar: son işlem zamanı (hareketsizlikte otomatik çıkış) ve hangi cihazdan açıldığı
  const sessCols = new Set(db.prepare("PRAGMA table_info(sessions)").all().map(r => r.name));
  if (!sessCols.has("last_seen")) db.exec("ALTER TABLE sessions ADD COLUMN last_seen INTEGER");
  if (!sessCols.has("ip")) db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT");
  if (!sessCols.has("ua")) db.exec("ALTER TABLE sessions ADD COLUMN ua TEXT");

  // İçerik tabloları şemadan oluşturulur; şemaya sonradan eklenen alanlar mevcut tabloya sütun olarak eklenir
  for (const def of Object.values(ENTITIES)) {
    const cols = [];
    for (const f of def.fields) {
      for (const [name, type] of columnsOf(f)) {
        let sql = `${q(name)} ${type}`;
        if (f.type === "ref") sql += ` REFERENCES ${q(ENTITIES[f.entity].table)}(id) ON DELETE ${f.onDelete || "SET NULL"}`;
        cols.push([name, sql]);
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS ${q(def.table)} (
      id INTEGER PRIMARY KEY,
      sort INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      ${cols.map(c => c[1]).join(",\n      ")},
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )`);
    const existing = new Set(db.prepare(`PRAGMA table_info(${q(def.table)})`).all().map(r => r.name));
    for (const [name, sql] of cols) if (!existing.has(name)) db.exec(`ALTER TABLE ${q(def.table)} ADD COLUMN ${sql}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_category ON menu_items(category_id, sort)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status, created_at)");
}

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

// Birden fazla yazma işlemini tek seferde (hepsi ya da hiçbiri). İç içe çağrılar dıştaki işleme katılır.
const txDepth = new WeakMap();
function tx(db, fn) {
  const depth = txDepth.get(db) || 0;
  if (depth > 0) {
    txDepth.set(db, depth + 1);
    try { return fn(); } finally { txDepth.set(db, depth); }
  }
  db.exec("BEGIN IMMEDIATE");
  txDepth.set(db, 1);
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth.set(db, 0);
  }
}

module.exports = { openDb, tx, q };
