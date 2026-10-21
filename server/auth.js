/* Yetkilendirme: parola özeti (scrypt), oturum çerezi, CSRF koruması, giriş denemesi sınırı */
const crypto = require("node:crypto");

const COOKIE = "kc_session";
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 10;

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}

// Kullanıcı yokken de aynı süreyi harcamak için (kullanıcı adı tahminini zorlaştırır)
const DUMMY_HASH = hashPassword(randomToken());

function checkPasswordPolicy(pw, username) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Parola en az ${MIN_PASSWORD} karakter olmalı.`;
  if (pw.length > 200) return "Parola çok uzun.";
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return "Parola kullanıcı adını içermemeli.";
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(pw) || !/[0-9]/.test(pw)) return "Parola en az bir harf ve bir rakam içermeli.";
  return null;
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bozuk çerez */ }
  });
  return out;
}

/* Basit, bellek içi deneme sınırlayıcı: belirli sürede belirli sayıda başarısız denemeden sonra kilitler */
function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000);
  sweep.unref();
  return {
    blocked(key) {
      const h = hits.get(key);
      return h && h.reset > Date.now() && h.count >= max ? Math.ceil((h.reset - Date.now()) / 1000) : 0;
    },
    hit(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
      else h.count++;
    },
    reset(key) { hits.delete(key); }
  };
}

function makeAuth(db, config) {
  const ttlMs = config.sessionHours * 3600 * 1000;
  // Kullanıcı adı başına 5, IP başına 20 hatalı deneme / 15 dk (aynı ağdaki diğer personel hemen kilitlenmesin)
  const userLimiter = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
  const ipLimiter = makeLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

  const cookieAttrs = req => {
    const secure = config.cookieSecure === "always" || (config.cookieSecure === "auto" && req.secure);
    return `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  };

  function createSession(res, req, userId) {
    const token = randomToken(), csrf = randomToken();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    db.prepare("INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), userId, csrf, Date.now() + ttlMs);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Max-Age=${Math.floor(ttlMs / 1000)}; ${cookieAttrs(req)}`);
    return csrf;
  }

  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const row = db.prepare(`SELECT s.id, s.csrf, s.expires_at, u.id AS user_id, u.username
                            FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha256(token));
    if (!row) return null;
    if (row.expires_at < Date.now()) { db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id); return null; }
    return row;
  }

  function login(req, res) {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string" || !username || !password || username.length > 60 || password.length > 200) {
      return res.status(400).json({ error: "Kullanıcı adı ve parola gerekli." });
    }
    const userKey = username.toLowerCase(), ipKey = String(req.ip);
    const wait = Math.max(userLimiter.blocked(userKey), ipLimiter.blocked(ipKey));
    if (wait) {
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 60)} dakika sonra tekrar deneyin.` });
    }
    const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH) && !!user;
    if (!ok) {
      userLimiter.hit(userKey);
      ipLimiter.hit(ipKey);
      return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }
    userLimiter.reset(userKey);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    const csrf = createSession(res, req, user.id);
    audit(user.id, "login");
    res.json({ user: { id: user.id, username: user.username }, csrf });
  }

  function logout(req, res) {
    const s = readSession(req);
    if (s) db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieAttrs(req)}`);
    res.json({ ok: true });
  }

  // Panel API'leri için: oturum zorunlu; veri değiştiren isteklerde CSRF anahtarı da zorunlu
  function requireAuth(req, res, next) {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: "Oturum açmanız gerekiyor." });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const sent = String(req.get("x-csrf-token") || "");
      const a = Buffer.from(sent), b = Buffer.from(s.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(403).json({ error: "Güvenlik anahtarı geçersiz. Sayfayı yenileyin." });
      }
    }
    req.user = { id: s.user_id, username: s.username };
    req.session = s;
    next();
  }

  function audit(userId, action, target) {
    db.prepare("INSERT INTO audit_log (user_id, action, target) VALUES (?, ?, ?)").run(userId ?? null, action, target ?? null);
  }

  function createUser(username, password) {
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
      return { error: "Kullanıcı adı 3–40 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir." };
    }
    const policy = checkPasswordPolicy(password, username);
    if (policy) return { error: policy };
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return { error: "Bu kullanıcı adı zaten var." };
    const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
    return { id: Number(info.lastInsertRowid), username };
  }

  function changePassword(userId, current, next, currentSessionId) {
    const user = db.prepare("SELECT username, password_hash FROM users WHERE id = ?").get(userId);
    if (!user || typeof current !== "string" || !verifyPassword(current, user.password_hash)) return { error: "Mevcut parola hatalı.", field: "current" };
    const policy = checkPasswordPolicy(next, user.username);
    if (policy) return { error: policy, field: "next" };
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), userId);
    // Diğer cihazlardaki oturumlar kapanır
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, currentSessionId);
    return { ok: true };
  }

  return { login, logout, requireAuth, readSession, createUser, changePassword, audit };
}

module.exports = { makeAuth, makeLimiter, hashPassword, verifyPassword, checkPasswordPolicy, randomToken };
