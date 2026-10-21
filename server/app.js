/* Express uygulaması: site, herkese açık API ve yönetim paneli API'si */
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { openDb } = require("./db");
const { ENTITIES, SETTINGS } = require("./schema");
const { makeRepo, HttpError } = require("./repo");
const { ValidationError } = require("./validate");
const { makeAuth, makeLimiter } = require("./auth");
const { makeMedia } = require("./media");
const { makeMailer } = require("./mailer");
const { makeSite } = require("./site");
const { seedIfEmpty, syncNewTexts } = require("./seed");

const ROOT = path.join(__dirname, "..");

const CSP_SITE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://images.unsplash.com",
  "media-src 'self'",
  "frame-src https://www.google.com https://maps.google.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");
const CSP_ADMIN = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

// İstanbul saatine göre bugünün tarihi (YYYY-MM-DD)
const todayIstanbul = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const GUESTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10+"];
const STATUSES = ["yeni", "onaylandi", "iptal", "tamamlandi"];

function createApp(opts = {}) {
  const config = {
    dataDir: opts.dataDir || process.env.DATA_DIR || path.join(ROOT, "storage"),
    cookieSecure: opts.cookieSecure || process.env.COOKIE_SECURE || "auto",
    sessionHours: Number(opts.sessionHours || process.env.SESSION_HOURS || 12),
    idleMinutes: Number(opts.idleMinutes || process.env.IDLE_MINUTES || 60),
    trustProxy: opts.trustProxy ?? process.env.TRUST_PROXY ?? false
  };
  const uploadDir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  const db = openDb(path.join(config.dataDir, "kardias.db"));
  const repo = makeRepo(db);
  seedIfEmpty(db, repo);
  syncNewTexts(db);
  const mailer = makeMailer(db, config.dataDir);
  const auth = makeAuth(db, config, mailer);
  const media = makeMedia(db, uploadDir);
  const site = makeSite(repo, path.join(ROOT, "index.html"));
  const reservationLimiter = makeLimiter({ max: 8, windowMs: 60 * 60 * 1000 });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "true" ? true : /^\d+$/.test(String(config.trustProxy)) ? Number(config.trustProxy) : config.trustProxy === true);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Content-Security-Policy", req.path.startsWith("/admin") ? CSP_ADMIN : CSP_SITE);
    if (req.path.startsWith("/admin")) res.setHeader("X-Frame-Options", "DENY");
    // HTTPS ile açıldıysa tarayıcı bundan sonra siteye hep HTTPS ile bağlansın
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  });

  /* ---------- Site ---------- */
  const sendSite = (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(site.html());
  };
  app.get("/", sendSite);
  app.get("/index.html", sendSite);
  const staticOpts = { index: false, dotfiles: "deny", fallthrough: true };
  app.use("/css", express.static(path.join(ROOT, "css"), staticOpts));
  app.use("/js", express.static(path.join(ROOT, "js"), staticOpts));
  app.use("/img", express.static(path.join(ROOT, "img"), { ...staticOpts, maxAge: "7d" }));
  app.use("/uploads", express.static(uploadDir, {
    ...staticOpts, dotfiles: "ignore", maxAge: "365d", immutable: true,
    setHeaders: res => res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
  }));
  app.get("/admin", (req, res, next) => (req.originalUrl === "/admin" ? res.redirect(301, "/admin/") : next()));
  app.use("/admin", express.static(path.join(ROOT, "admin"), { dotfiles: "deny", setHeaders: res => res.setHeader("Cache-Control", "no-cache") }));

  /* ---------- Herkese açık API ---------- */
  const api = express.Router();
  api.use(express.json({ limit: "1mb" }));

  api.get("/site", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json(site.data());
  });

  api.post("/reservations", (req, res) => {
    const ipKey = "res:" + req.ip;
    const wait = reservationLimiter.blocked(ipKey);
    if (wait) return res.status(429).json({ error: "Çok fazla talep gönderildi. Lütfen biraz sonra tekrar deneyin ya da bizi arayın." });
    const b = req.body || {};
    if (b.website) return res.status(400).json({ error: "Geçersiz istek." }); // bot tuzağı (görünmez alan)

    const s = repo.getSettings();
    const enabled = { sokak: s.typeStreet !== false, teras: s.typeTerrace !== false, konaklama: s.typeStay !== false };
    const errors = {};
    const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max + 1);
    const type = str(b.type, 20);
    if (!enabled[type]) errors.type = "Bu rezervasyon türü şu an kapalı.";
    const name = str(b.name, 80);
    if (name.length < 2 || name.length > 80) errors.name = "Ad soyad 2–80 karakter olmalı.";
    const phone = str(b.phone, 25);
    if (!/^\+?[0-9 ()-]{7,20}$/.test(phone) || phone.replace(/\D/g, "").length < 7) errors.phone = "Geçerli bir telefon girin.";
    const note = str(b.note, 1000);
    if (note.length > 1000) errors.note = "Not en fazla 1000 karakter olabilir.";
    const lang = b.lang === "en" ? "en" : "tr";
    const today = todayIstanbul(), isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
    const row = { type, name, phone, note, lang, date: null, time: null, guests: null, checkin: null, checkout: null, breakfast: null, room_id: null, room_name: null };

    if (type === "konaklama") {
      row.checkin = str(b.checkin, 10); row.checkout = str(b.checkout, 10);
      if (!isDate(row.checkin) || row.checkin < today || row.checkin > addDays(today, 730)) errors.checkin = "Geçerli bir giriş tarihi seçin.";
      if (!isDate(row.checkout) || row.checkout <= row.checkin || row.checkout > addDays(row.checkin, 60)) errors.checkout = "Çıkış tarihi girişten sonra olmalı (en fazla 60 gece).";
      row.guests = str(b.guests, 3);
      row.breakfast = b.breakfast ? 1 : 0;
      if (b.room != null && b.room !== "") {
        const room = repo.list("rooms", { activeOnly: true }).find(r => r.id === Number(b.room));
        if (!room) errors.room = "Seçilen oda bulunamadı.";
        else {
          row.room_id = room.id; row.room_name = room.name.tr;
          const n = row.guests === "10+" ? 11 : Number(row.guests);
          if (room.capacity && n > room.capacity) errors.guests = `Seçilen oda en fazla ${room.capacity} kişiliktir.`;
        }
      }
    } else if (type) {
      row.date = str(b.date, 10); row.time = str(b.time, 5); row.guests = str(b.guests, 3);
      if (!isDate(row.date) || row.date < today || row.date > addDays(today, 365)) errors.date = "Geçerli bir tarih seçin.";
      const first = s.firstBooking || "00:00", last = s.lastBooking || "23:59";
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) || row.time < first || row.time > last) errors.time = "Geçerli bir saat seçin.";
    }
    if (type && !GUESTS.includes(row.guests)) errors.guests = "Kişi sayısını seçin.";

    if (Object.keys(errors).length) return res.status(400).json({ error: "Lütfen işaretli alanları kontrol edin.", fields: errors });
    reservationLimiter.hit(ipKey);
    const cols = Object.keys(row);
    const info = db.prepare(`INSERT INTO reservations (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map(c => row[c]));
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  /* ---------- Yönetim API'si ---------- */
  const admin = express.Router();
  admin.post("/login", auth.login);
  admin.post("/logout", auth.logout);
  admin.post("/forgot", auth.forgot);
  admin.post("/reset", auth.reset);
  admin.use(auth.requireAuth);

  // Başarılı her değişiklikten sonra sitenin önbelleği temizlenir ve işlem kayda geçer
  admin.use((req, res, next) => {
    if (req.method !== "GET") {
      res.on("finish", () => {
        if (res.statusCode < 400) {
          site.invalidate();
          auth.audit(req.user.id, `${req.method} ${req.path}`.slice(0, 200));
        }
      });
    }
    next();
  });

  admin.get("/me", (req, res) => res.json({ user: req.user, csrf: req.session.csrf }));

  admin.post("/password", (req, res) => {
    const { current, next } = req.body || {};
    const out = auth.changePassword(req.user.id, current, next, req.session.id, req);
    if (out.error) return res.status(400).json({ error: out.error, fields: { [out.field]: out.error } });
    res.json({ ok: true });
  });

  // Hesap e-postası (parola sıfırlama kodu bu adrese gelir)
  const fieldError = (res, out) => res.status(400).json({ error: out.error, fields: { [out.field]: out.error } });
  admin.get("/account", (req, res) => res.json(auth.account(req.user.id)));
  admin.post("/account/email", (req, res) => {
    const out = auth.requestEmail(req, req.user.id, req.body && req.body.email, req.body && req.body.password);
    out.error ? fieldError(res, out) : res.json(auth.account(req.user.id));
  });
  admin.post("/account/email/verify", (req, res) => {
    const out = auth.confirmEmail(req, req.user.id, req.body && req.body.code);
    out.error ? fieldError(res, out) : res.json(auth.account(req.user.id));
  });
  admin.post("/account/email/remove", (req, res) => {
    const out = auth.removeEmail(req, req.user.id, req.body && req.body.password);
    out.error ? fieldError(res, out) : res.json(auth.account(req.user.id));
  });

  admin.get("/account/sessions", (req, res) => res.json(auth.sessions(req.user.id, req.session.id)));
  admin.post("/account/sessions/end-others", (req, res) => res.json({ ended: auth.endOtherSessions(req) }));

  // Güvenlik kayıtları
  admin.get("/security", (req, res) => {
    const level = ["warn", "alert"].includes(req.query.level) ? req.query.level : null;
    const where = level === "alert" ? "WHERE level = 'alert'" : level === "warn" ? "WHERE level IN ('warn','alert')" : "";
    res.json(db.prepare(`SELECT id, at, event, level, username, ip, ua, detail FROM security_log ${where} ORDER BY id DESC LIMIT 500`).all());
  });

  // E-posta gönderim ayarları (SMTP) — parola panele asla geri gönderilmez
  admin.get("/mail", (req, res) => res.json({ config: mailer.publicConfig() }));
  admin.put("/mail", (req, res) => {
    const config = mailer.save(req.body);
    auth.security("mail_settings_changed", { req, userId: req.user.id, username: req.user.username, level: "warn", detail: `Gönderen hesap: ${config.user}` });
    res.json({ config });
  });
  admin.delete("/mail", (req, res) => {
    mailer.clear();
    auth.security("mail_settings_removed", { req, userId: req.user.id, username: req.user.username, level: "warn" });
    res.json({ config: null });
  });
  admin.post("/mail/test", async (req, res) => {
    const me = auth.account(req.user.id);
    const to = me.email || (mailer.publicConfig() || {}).user;
    if (!to) return res.status(400).json({ error: "Önce e-posta ayarlarını kaydedin." });
    try {
      const out = await mailer.send({ to, subject: "Kardias paneli: deneme e-postası", text: "Bu e-postayı aldıysanız yönetim panelinin e-posta gönderimi çalışıyor." });
      res.json({ ok: true, to, outbox: !!out.outbox });
    } catch (err) {
      auth.security("mail_failed", { req, userId: req.user.id, username: req.user.username, level: "warn", detail: "Deneme e-postası: " + err.message });
      res.status(400).json({ error: "E-posta gönderilemedi: " + err.message });
    }
  });

  admin.get("/schema", (req, res) => {
    const entities = Object.fromEntries(Object.entries(ENTITIES).map(([k, d]) => {
      const { table, ...rest } = d;
      return [k, rest];
    }));
    res.json({ entities, settings: SETTINGS });
  });

  admin.get("/stats", (req, res) => {
    const count = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    res.json({
      items: count("menu_items"), categories: count("menu_categories"), rooms: count("rooms"), gallery: count("gallery"),
      events: count("events"), reviews: count("reviews"), media: count("media"),
      reservationsNew: db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'yeni'").get().n,
      reservationsUpcoming: db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status IN ('yeni','onaylandi') AND COALESCE(date, checkin) >= ?").get(todayIstanbul()).n,
      latest: db.prepare("SELECT * FROM reservations ORDER BY id DESC LIMIT 6").all(),
      security: {
        failed24h: db.prepare("SELECT COUNT(*) AS n FROM security_log WHERE event IN ('login_failed','reset_code_wrong') AND at >= datetime('now','-1 day')").get().n,
        alerts7d: db.prepare("SELECT COUNT(*) AS n FROM security_log WHERE level = 'alert' AND at >= datetime('now','-7 days')").get().n,
        emailVerified: !!db.prepare("SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL").get(req.user.id),
        mailConfigured: mailer.isConfigured()
      }
    });
  });

  // İçerik kayıtları (menü, odalar, etkinlikler, galeri, yorumlar, künye)
  admin.get("/entities/:type", (req, res) => res.json(repo.list(req.params.type, { parent: req.query.parent })));
  admin.post("/entities/:type", (req, res) => res.status(201).json(repo.create(req.params.type, req.body)));
  admin.post("/entities/:type/reorder", (req, res) => { repo.reorder(req.params.type, req.body && req.body.ids); res.json({ ok: true }); });
  admin.get("/entities/:type/:id", (req, res) => res.json(repo.get(req.params.type, req.params.id)));
  admin.put("/entities/:type/:id", (req, res) => res.json(repo.update(req.params.type, req.params.id, req.body)));
  admin.patch("/entities/:type/:id/active", (req, res) => res.json(repo.setActive(req.params.type, req.params.id, req.body && req.body.active)));
  admin.delete("/entities/:type/:id", (req, res) => { repo.remove(req.params.type, req.params.id); res.json({ ok: true }); });

  // Ayarlar ve metinler
  admin.get("/settings", (req, res) => res.json(repo.getSettings()));
  admin.put("/settings/:group", (req, res) => res.json(repo.saveSettings(req.params.group, req.body)));
  admin.get("/texts", (req, res) => res.json(repo.getTexts()));
  admin.put("/texts/:key", (req, res) => res.json(repo.saveText(req.params.key, req.body)));

  // Medya
  admin.get("/media", (req, res) => res.json(media.list()));
  admin.post("/media", (req, res, next) => {
    media.upload.array("files", 20)(req, res, err => {
      if (err) {
        (req.files || []).forEach(f => fs.rmSync(f.path, { force: true }));
        if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Dosya çok büyük (video en fazla 200 MB, görsel en fazla 15 MB)." });
        if (err instanceof require("multer").MulterError) return res.status(400).json({ error: "Yükleme hatası: " + err.message });
        return next(err);
      }
      const out = media.store(req.files);
      res.status(out.saved.length ? 201 : 400).json(out.saved.length ? out : { ...out, error: out.rejected.map(r => `${r.name}: ${r.error}`).join(" ") || "Dosya seçilmedi." });
    });
  });
  admin.delete("/media/:id", (req, res) => { media.remove(req.params.id); res.json({ ok: true }); });

  // Rezervasyonlar
  admin.get("/reservations", (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = status
      ? db.prepare("SELECT * FROM reservations WHERE status = ? ORDER BY id DESC LIMIT 1000").all(status)
      : db.prepare("SELECT * FROM reservations ORDER BY id DESC LIMIT 1000").all();
    res.json(rows);
  });
  admin.patch("/reservations/:id", (req, res) => {
    const b = req.body || {}, id = Number(req.params.id);
    const cur = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    if (!cur) throw new HttpError(404, "Rezervasyon bulunamadı.");
    const status = b.status === undefined ? cur.status : b.status;
    if (!STATUSES.includes(status)) throw new ValidationError({ status: "Geçersiz durum." });
    const adminNote = b.adminNote === undefined ? cur.admin_note : String(b.adminNote).trim();
    if (adminNote && adminNote.length > 1000) throw new ValidationError({ adminNote: "En fazla 1000 karakter." });
    db.prepare("UPDATE reservations SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?").run(status, adminNote || null, id);
    res.json(db.prepare("SELECT * FROM reservations WHERE id = ?").get(id));
  });
  admin.delete("/reservations/:id", (req, res) => {
    const info = db.prepare("DELETE FROM reservations WHERE id = ?").run(Number(req.params.id));
    if (!info.changes) throw new HttpError(404, "Rezervasyon bulunamadı.");
    res.json({ ok: true });
  });

  // Kullanıcılar
  admin.get("/users", (req, res) => res.json(db.prepare("SELECT id, username, CASE WHEN email_verified_at IS NOT NULL THEN email END AS email, created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY id").all()));
  admin.post("/users", (req, res) => {
    const out = auth.createUser(req.body && req.body.username, req.body && req.body.password);
    if (out.error) return res.status(400).json({ error: out.error });
    auth.security("user_created", { req, userId: req.user.id, username: req.user.username, level: "alert", detail: `Yeni yönetici eklendi: ${out.username}` });
    res.status(201).json(out);
  });
  admin.delete("/users/:id", (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: "Kendi hesabınızı silemezsiniz." });
    const target = db.prepare("SELECT username FROM users WHERE id = ?").get(id);
    const info = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    if (!info.changes) throw new HttpError(404, "Kullanıcı bulunamadı.");
    auth.security("user_deleted", { req, userId: req.user.id, username: req.user.username, level: "alert", detail: `Yönetici silindi: ${target.username}` });
    res.json({ ok: true });
  });

  api.use("/admin", admin);
  app.use("/api", api);
  app.use("/api", (req, res) => res.status(404).json({ error: "Bulunamadı." }));

  app.use((req, res) => res.status(404).type("text").send("Sayfa bulunamadı."));

  // Hata yakalayıcı: doğrulama hataları alan bazında, beklenmeyen hatalar genel mesajla döner
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, fields: err.fields });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, usages: err.usages });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Geçersiz JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "İstek çok büyük." });
    console.error(err);
    res.status(500).json({ error: "Beklenmeyen bir hata oluştu." });
  });

  return { app, db, repo, auth, site, config, mailer };
}

module.exports = { createApp };
