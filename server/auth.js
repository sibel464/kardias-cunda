/* Yetkilendirme: parola özeti (scrypt), oturum çerezi, CSRF koruması, giriş denemesi sınırı,
   e-postayla parola sıfırlama / e-posta doğrulama kodları ve güvenlik kayıtları */
const crypto = require("node:crypto");
const { EMAIL_RE } = require("./mailer");

const COOKIE = "kc_session";
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 10;
const CODE_TTL_MS = 15 * 60 * 1000;   // e-postadaki kod 15 dakika geçerli
const CODE_MAX_TRIES = 5;             // bir kod için en fazla 5 hatalı deneme, sonra geçersiz
const LOG_KEEP_DAYS = 180;

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
  if (isWeakPassword(pw)) return "Bu parola çok kolay tahmin edilir. Daha özgün bir parola seçin.";
  return null;
}

// Sık kullanılan / tahmini kolay parolalar (işletme adı, ada adı, ardışık tuşlar, tek karakter tekrarı)
const WEAK_WORDS = ["kardias", "cunda", "ayvalik", "ayvalık", "password", "parola", "sifre", "şifre", "admin", "yonetici", "yönetici", "qwerty", "asdf", "123456", "abc123"];
function isWeakPassword(pw) {
  const p = pw.toLowerCase();
  const core = p.replace(/[0-9\W_]+/g, "");
  if (WEAK_WORDS.some(w => core === w || core === w + w)) return true;     // ör. "kardias2024!", "admin123456"
  if (/^(.)\1+$/.test(p.replace(/[0-9]/g, "")) && /^(.)\1+$/.test(p.replace(/\D/g, ""))) return true; // "aaaa1111"
  if (new Set(p).size < 4 || /^(.{1,4})\1+$/.test(p)) return true;               // "ab12ab12ab12"
  return false;
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

// 6 haneli kod; veritabanında yalnızca tuzlu özeti durur
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const hashCode = code => { const salt = randomToken(12); return `${salt}$${sha256(salt + code)}`; };
const codeMatches = (code, stored) => {
  const [salt, hash] = String(stored).split("$");
  const a = Buffer.from(sha256(salt + String(code))), b = Buffer.from(hash || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const maskEmail = e => String(e).replace(/^(.)(.*)(@.*)$/, (m, a, mid, d) => a + "*".repeat(Math.min(mid.length, 6)) + d);

function makeAuth(db, config, mailer) {
  const ttlMs = config.sessionHours * 3600 * 1000;
  // Bu kadar süre hiç işlem yapılmazsa oturum kendiliğinden kapanır (açık unutulan bilgisayarlara karşı)
  const idleMs = (Number(config.idleMinutes) || 60) * 60 * 1000;
  // Kullanıcı adı başına 5, IP başına 20 hatalı deneme / 15 dk (aynı ağdaki diğer personel hemen kilitlenmesin)
  const userLimiter = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
  const ipLimiter = makeLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
  // "Şifremi unuttum": IP başına 5 kod isteği, 10 hatalı kod denemesi / 15 dk
  const forgotLimiter = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
  const resetLimiter = makeLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  db.prepare("DELETE FROM security_log WHERE at < datetime('now', ?)").run(`-${LOG_KEEP_DAYS} days`);
  db.prepare("DELETE FROM auth_codes WHERE expires_at < ?").run(Date.now());

  /* ---------- Güvenlik kayıtları ve uyarılar ---------- */
  function security(event, { req, userId, username, detail, level = "info" } = {}) {
    db.prepare("INSERT INTO security_log (event, level, user_id, username, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      event, level, userId ?? null, username ? String(username).slice(0, 60) : null,
      req ? String(req.ip).slice(0, 64) : null, req ? String(req.get("user-agent") || "").slice(0, 200) : null, detail ? String(detail).slice(0, 300) : null);
  }

  // E-posta hatası işlemi durdurmaz; yalnızca kayda geçer
  function mail(to, subject, text) {
    return mailer.send({ to, subject, text }).catch(err => {
      security("mail_failed", { level: "warn", detail: `${subject.replace(/\d{6}/, "******")} → ${maskEmail(to)}: ${err.message}` });
    });
  }

  const when = req => `${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · IP: ${req ? req.ip : "-"}`;

  // Doğrulanmış e-postası olan tüm yöneticilere uyarı
  function alertAdmins(subject, text) {
    db.prepare("SELECT email FROM users WHERE email IS NOT NULL AND email_verified_at IS NOT NULL").all()
      .forEach(u => mail(u.email, subject, text));
  }

  const cookieAttrs = req => {
    const secure = config.cookieSecure === "always" || (config.cookieSecure === "auto" && req.secure);
    return `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  };

  function createSession(res, req, userId) {
    const token = randomToken(), csrf = randomToken();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    db.prepare("INSERT INTO sessions (id, user_id, csrf, expires_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      sha256(token), userId, csrf, Date.now() + ttlMs, Date.now(), String(req.ip).slice(0, 64), String(req.get("user-agent") || "").slice(0, 200));
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Max-Age=${Math.floor(ttlMs / 1000)}; ${cookieAttrs(req)}`);
    return csrf;
  }

  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const row = db.prepare(`SELECT s.id, s.csrf, s.expires_at, s.last_seen, u.id AS user_id, u.username
                            FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha256(token));
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at < now || (row.last_seen && row.last_seen + idleMs < now)) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
      return null;
    }
    // Son işlem zamanı en fazla dakikada bir yazılır
    if (!row.last_seen || now - row.last_seen > 60_000) db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?").run(now, row.id);
    return row;
  }

  // Hesabın açık oturumları (hangi cihaz / IP, son işlem) ve diğerlerini kapatma
  function sessions(userId, currentId) {
    const now = Date.now();
    return db.prepare("SELECT id, ip, ua, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC").all(userId, now)
      .filter(s => !s.last_seen || s.last_seen + idleMs >= now)
      .map(s => ({ ip: s.ip, ua: s.ua, createdAt: s.created_at, lastSeen: s.last_seen ? new Date(s.last_seen).toISOString() : null, current: s.id === currentId }));
  }

  function endOtherSessions(req) {
    const n = db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(req.user.id, req.session.id).changes;
    if (n) security("sessions_ended", { req, userId: req.user.id, username: req.user.username, level: "warn", detail: `${n} oturum uzaktan kapatıldı` });
    return n;
  }

  function login(req, res) {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string" || !username || !password || username.length > 60 || password.length > 200) {
      return res.status(400).json({ error: "Kullanıcı adı ve parola gerekli." });
    }
    const userKey = username.toLowerCase(), ipKey = String(req.ip);
    const wait = Math.max(userLimiter.blocked(userKey), ipLimiter.blocked(ipKey));
    if (wait) {
      security("login_blocked", { req, username, level: "warn", detail: "Kilitliyken giriş denendi" });
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 60)} dakika sonra tekrar deneyin.` });
    }
    const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH) && !!user;
    if (!ok) {
      userLimiter.hit(userKey);
      ipLimiter.hit(ipKey);
      security("login_failed", { req, userId: user && user.id, username, level: "warn", detail: user ? "Parola hatalı" : "Böyle bir kullanıcı yok" });
      if (userLimiter.blocked(userKey) || ipLimiter.blocked(ipKey)) {
        security("login_locked", { req, userId: user && user.id, username, level: "alert", detail: "Çok fazla hatalı deneme — giriş 15 dakika kilitlendi" });
        alertAdmins("⚠ Kardias paneli: çok fazla hatalı giriş denemesi",
          `Yönetim paneline “${username}” kullanıcı adıyla art arda hatalı parola girildi ve giriş 15 dakika kilitlendi.\n${when(req)}\n\nBu siz değilseniz parolanızı değiştirin ve panelde “Güvenlik kayıtları” sayfasına bakın.`);
      }
      return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }
    userLimiter.reset(userKey);
    // Bu kullanıcı daha önce hiç bu IP'den girmediyse uyarı
    const knownIp = db.prepare("SELECT 1 FROM security_log WHERE event = 'login_ok' AND user_id = ? AND ip = ? LIMIT 1").get(user.id, String(req.ip));
    const hadLogins = db.prepare("SELECT 1 FROM security_log WHERE event = 'login_ok' AND user_id = ? LIMIT 1").get(user.id);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    const csrf = createSession(res, req, user.id);
    audit(user.id, "login");
    security("login_ok", { req, userId: user.id, username: user.username });
    if (hadLogins && !knownIp) {
      security("login_new_ip", { req, userId: user.id, username: user.username, level: "alert", detail: "İlk kez görülen bir IP adresinden giriş" });
      const u = db.prepare("SELECT email FROM users WHERE id = ? AND email_verified_at IS NOT NULL").get(user.id);
      if (u) mail(u.email, "Kardias paneli: yeni bir yerden giriş", `“${user.username}” hesabınıza daha önce görülmemiş bir yerden giriş yapıldı.\n${when(req)}\nTarayıcı: ${String(req.get("user-agent") || "-").slice(0, 160)}\n\nBu siz değilseniz hemen parolanızı değiştirin.`);
    }
    res.json({ user: { id: user.id, username: user.username }, csrf });
  }

  function logout(req, res) {
    const s = readSession(req);
    if (s) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
      security("logout", { req, userId: s.user_id, username: s.username });
    }
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

  function changePassword(userId, current, next, currentSessionId, req) {
    const user = db.prepare("SELECT username, password_hash, email, email_verified_at FROM users WHERE id = ?").get(userId);
    if (!user || typeof current !== "string" || !verifyPassword(current, user.password_hash)) {
      security("password_change_failed", { req, userId, username: user && user.username, level: "warn", detail: "Mevcut parola hatalı girildi" });
      return { error: "Mevcut parola hatalı.", field: "current" };
    }
    const policy = checkPasswordPolicy(next, user.username);
    if (policy) return { error: policy, field: "next" };
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), userId);
    // Diğer cihazlardaki oturumlar kapanır
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, currentSessionId);
    security("password_changed", { req, userId, username: user.username });
    if (user.email_verified_at) mail(user.email, "Kardias paneli: parolanız değiştirildi", `“${user.username}” hesabının parolası değiştirildi.\n${when(req)}\n\nBu siz değilseniz hemen giriş ekranındaki “Şifremi unuttum” ile yeni parola alın.`);
    return { ok: true };
  }

  // Sunucuya erişimi olan kişi için komut satırından parola belirleme (npm run reset-password)
  function setPassword(username, password) {
    const user = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
    if (!user) return { error: "Böyle bir kullanıcı yok." };
    const policy = checkPasswordPolicy(password, user.username);
    if (policy) return { error: policy };
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    security("password_reset_cli", { userId: user.id, username: user.username, level: "alert", detail: "Parola sunucudaki komutla yenilendi" });
    return { ok: true, username: user.username };
  }

  /* ---------- E-postayla gönderilen kodlar (parola sıfırlama, e-posta doğrulama) ---------- */
  function issueCode(userId, purpose, email) {
    const code = newCode();
    db.prepare("DELETE FROM auth_codes WHERE user_id = ? AND purpose = ?").run(userId, purpose);
    db.prepare("INSERT INTO auth_codes (user_id, purpose, code_hash, email, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, purpose, hashCode(code), email, Date.now() + CODE_TTL_MS);
    return code;
  }

  // Kod doğruysa satırı döndürür ve siler (tek kullanımlık); yanlışsa deneme sayısını artırır
  function consumeCode(userId, purpose, code) {
    const row = db.prepare("SELECT * FROM auth_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1").get(userId, purpose);
    if (!row || row.expires_at < Date.now() || row.attempts >= CODE_MAX_TRIES) return null;
    const c = String(code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(c) || !codeMatches(c, row.code_hash)) {
      db.prepare("UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
      return null;
    }
    db.prepare("DELETE FROM auth_codes WHERE id = ?").run(row.id);
    return row;
  }

  const findByIdentity = identity => {
    const v = typeof identity === "string" ? identity.trim().slice(0, 200) : "";
    if (!v) return null;
    return db.prepare("SELECT id, username, email, email_verified_at FROM users WHERE username = ? OR (email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL) LIMIT 1").get(v, v);
  };

  // Şifremi unuttum, 1. adım: kullanıcı adı ya da e-posta → doğrulanmış adrese 6 haneli kod.
  // Yanıt her durumda aynıdır; böylece bir hesabın var olup olmadığı dışarıdan anlaşılmaz.
  function forgot(req, res) {
    const generic = { ok: true, message: "Bu bilgilere ait doğrulanmış bir e-posta adresi varsa 6 haneli kod gönderildi. Gelen kutunuzu (ve gereksiz/spam klasörünü) kontrol edin." };
    const ipKey = "forgot:" + req.ip;
    if (forgotLimiter.blocked(ipKey)) {
      security("reset_rate_limited", { req, level: "warn", detail: "Çok fazla kod isteği" });
      return res.status(429).json({ error: "Çok fazla istek. 15 dakika sonra tekrar deneyin." });
    }
    forgotLimiter.hit(ipKey);
    const identity = req.body && req.body.identity;
    const user = findByIdentity(identity);
    if (!user) {
      security("reset_unknown", { req, username: typeof identity === "string" ? identity : null, level: "warn", detail: "Olmayan bir hesap için kod istendi" });
      return res.json(generic);
    }
    if (!user.email || !user.email_verified_at) {
      security("reset_no_email", { req, userId: user.id, username: user.username, level: "warn", detail: "Hesapta doğrulanmış e-posta yok, kod gönderilemedi" });
      return res.json(generic);
    }
    const code = issueCode(user.id, "reset", user.email);
    security("reset_requested", { req, userId: user.id, username: user.username, detail: `Kod gönderildi: ${maskEmail(user.email)}` });
    mail(user.email, `Kardias paneli parola sıfırlama kodu: ${code}`,
      `Merhaba ${user.username},\n\nYönetim paneli için parola sıfırlama kodunuz:\n\n    ${code}\n\nKod 15 dakika geçerlidir ve yalnızca bir kez kullanılabilir.\n${when(req)}\n\nBu isteği siz yapmadıysanız bu e-postayı dikkate almayın; parolanız değişmez.`);
    res.json(generic);
  }

  // Şifremi unuttum, 2. adım: kod + yeni parola
  function reset(req, res) {
    const b = req.body || {}, ipKey = "reset:" + req.ip;
    if (resetLimiter.blocked(ipKey)) {
      security("reset_rate_limited", { req, level: "alert", detail: "Çok fazla hatalı kod denemesi" });
      return res.status(429).json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." });
    }
    const user = findByIdentity(b.identity);
    const policy = checkPasswordPolicy(b.password, user && user.username);
    if (policy) return res.status(400).json({ error: policy, fields: { password: policy } });
    const row = user && consumeCode(user.id, "reset", b.code);
    if (!row) {
      resetLimiter.hit(ipKey);
      security("reset_code_wrong", { req, userId: user && user.id, username: user ? user.username : typeof b.identity === "string" ? b.identity : null, level: "warn", detail: "Hatalı ya da süresi dolmuş kod" });
      return res.status(400).json({ error: "Kod hatalı ya da süresi dolmuş. Yeni kod isteyebilirsiniz.", fields: { code: "Kod hatalı ya da süresi dolmuş." } });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.password), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    resetLimiter.reset(ipKey);
    userLimiter.reset(user.username.toLowerCase());
    security("password_reset", { req, userId: user.id, username: user.username, level: "alert", detail: "Parola e-posta koduyla yenilendi" });
    mail(user.email, "Kardias paneli: parolanız sıfırlandı", `“${user.username}” hesabının parolası e-posta koduyla yenilendi.\n${when(req)}\n\nBu siz değilseniz hemen tekrar “Şifremi unuttum” ile parolanızı değiştirin.`);
    res.json({ ok: true });
  }

  /* ---------- Hesap e-postası ve doğrulama ---------- */
  function account(userId) {
    const u = db.prepare("SELECT username, email, email_verified_at FROM users WHERE id = ?").get(userId);
    const pending = db.prepare("SELECT email FROM auth_codes WHERE user_id = ? AND purpose = 'verify' AND expires_at > ? ORDER BY id DESC LIMIT 1").get(userId, Date.now());
    return { username: u.username, email: u.email_verified_at ? u.email : null, pendingEmail: pending ? pending.email : null, mailConfigured: mailer.isConfigured() };
  }

  function requestEmail(req, userId, email, password) {
    const user = db.prepare("SELECT username, password_hash FROM users WHERE id = ?").get(userId);
    if (typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      security("email_change_failed", { req, userId, username: user.username, level: "warn", detail: "E-posta eklerken parola hatalı girildi" });
      return { error: "Parola hatalı.", field: "password" };
    }
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (e.length > 200 || !EMAIL_RE.test(e)) return { error: "Geçerli bir e-posta adresi girin.", field: "email" };
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL AND id != ?").get(e, userId)) {
      return { error: "Bu e-posta başka bir hesapta kayıtlı.", field: "email" };
    }
    const code = issueCode(userId, "verify", e);
    security("email_verify_sent", { req, userId, username: user.username, detail: `Doğrulama kodu gönderildi: ${maskEmail(e)}` });
    mail(e, `Kardias paneli e-posta doğrulama kodu: ${code}`,
      `Merhaba ${user.username},\n\nBu adresi yönetim paneli hesabınıza bağlamak için doğrulama kodunuz:\n\n    ${code}\n\nKod 15 dakika geçerlidir. Parolanızı unutursanız sıfırlama kodu bu adrese gelecek.\n\nBu isteği siz yapmadıysanız bu e-postayı dikkate almayın.`);
    return { ok: true };
  }

  function confirmEmail(req, userId, code) {
    const user = db.prepare("SELECT username, email, email_verified_at FROM users WHERE id = ?").get(userId);
    const row = consumeCode(userId, "verify", code);
    if (!row) {
      security("email_verify_failed", { req, userId, username: user.username, level: "warn", detail: "Hatalı ya da süresi dolmuş doğrulama kodu" });
      return { error: "Kod hatalı ya da süresi dolmuş.", field: "code" };
    }
    const old = user.email_verified_at ? user.email : null;
    db.prepare("UPDATE users SET email = ?, email_verified_at = datetime('now') WHERE id = ?").run(row.email, userId);
    security("email_verified", { req, userId, username: user.username, detail: `E-posta doğrulandı: ${maskEmail(row.email)}` });
    if (old && old !== row.email) mail(old, "Kardias paneli: hesap e-postanız değiştirildi", `“${user.username}” hesabının e-posta adresi ${maskEmail(row.email)} olarak değiştirildi.\n${when(req)}\n\nBu siz değilseniz hemen panele girip parolanızı değiştirin.`);
    return { ok: true };
  }

  function removeEmail(req, userId, password) {
    const user = db.prepare("SELECT username, password_hash FROM users WHERE id = ?").get(userId);
    if (typeof password !== "string" || !verifyPassword(password, user.password_hash)) return { error: "Parola hatalı.", field: "password" };
    db.prepare("UPDATE users SET email = NULL, email_verified_at = NULL WHERE id = ?").run(userId);
    db.prepare("DELETE FROM auth_codes WHERE user_id = ?").run(userId);
    security("email_removed", { req, userId, username: user.username, level: "warn", detail: "Hesaptan e-posta kaldırıldı" });
    return { ok: true };
  }

  return { login, logout, requireAuth, readSession, createUser, changePassword, setPassword, audit, security, alertAdmins,
    forgot, reset, account, requestEmail, confirmEmail, removeEmail, mail, sessions, endOtherSessions };
}

module.exports = { makeAuth, makeLimiter, hashPassword, verifyPassword, checkPasswordPolicy, randomToken };
