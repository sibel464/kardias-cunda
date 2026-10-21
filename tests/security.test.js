/* Şifremi unuttum, e-posta doğrulama ve güvenlik kayıtları testleri.
   SMTP ayarlı olmadığından e-postalar outbox'a yazılır; kodlar oradan okunur. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, client } = require("./helpers");

let S, admin;
const PASS = "Kardias-test-2026";
const NEW_PASS = "Yeni-parola-2027";

before(async () => {
  S = await startServer();
  S.auth.createUser("yonetici", PASS);
  admin = client(S.base);
  assert.equal((await admin.login("yonetici", PASS)).status, 200);
});
after(() => S.close());

// Gönderilen son e-postadaki 6 haneli kod
const lastCode = async () => {
  for (let i = 0; i < 20 && !S.mailer.recent.length; i++) await new Promise(r => setTimeout(r, 10));
  const m = S.mailer.recent.at(-1);
  return { ...m, code: (m.text.match(/\b(\d{6})\b/) || [])[1] };
};
const events = () => S.db.prepare("SELECT event, level, username FROM security_log ORDER BY id").all();

test("e-posta doğrulanmadan şifre sıfırlama kodu gönderilmez; yanıt yine de aynıdır", async () => {
  const before = S.mailer.recent.length;
  const r = await client(S.base).post("/api/admin/forgot", { identity: "yonetici" });
  assert.equal(r.status, 200);
  const r2 = await client(S.base).post("/api/admin/forgot", { identity: "olmayan-kisi" });
  assert.deepEqual(r2.json, r.json); // hesap var mı yok mu anlaşılmaz
  assert.equal(S.mailer.recent.length, before);
  assert.ok(events().some(e => e.event === "reset_no_email"));
  assert.ok(events().some(e => e.event === "reset_unknown"));
});

test("hesaba e-posta eklemek parola ister ve kodla doğrulanır", async () => {
  let r = await admin.post("/api/admin/account/email", { email: "sahip@example.com", password: "yanlis-parola-1" });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.password);
  r = await admin.post("/api/admin/account/email", { email: "gecersiz", password: PASS });
  assert.equal(r.status, 400);

  r = await admin.post("/api/admin/account/email", { email: "Sahip@Example.com", password: PASS });
  assert.equal(r.status, 200);
  assert.equal(r.json.pendingEmail, "sahip@example.com");
  assert.equal(r.json.email, null);
  const m = await lastCode();
  assert.equal(m.to, "sahip@example.com");
  assert.match(m.code, /^\d{6}$/);

  r = await admin.post("/api/admin/account/email/verify", { code: m.code === "000000" ? "111111" : "000000" });
  assert.equal(r.status, 400);
  r = await admin.post("/api/admin/account/email/verify", { code: m.code });
  assert.equal(r.status, 200);
  assert.equal(r.json.email, "sahip@example.com");
  // Kod tek kullanımlık
  r = await admin.post("/api/admin/account/email/verify", { code: m.code });
  assert.equal(r.status, 400);
});

test("şifremi unuttum: e-postaya gelen kodla parola yenilenir, eski oturumlar kapanır", async () => {
  const anon = client(S.base);
  let r = await anon.post("/api/admin/forgot", { identity: "sahip@example.com" });
  assert.equal(r.status, 200);
  const m = await lastCode();
  assert.equal(m.to, "sahip@example.com");

  // Zayıf parola reddedilir
  r = await anon.post("/api/admin/reset", { identity: "yonetici", code: m.code, password: "kisa" });
  assert.equal(r.status, 400);
  // Yanlış kod reddedilir
  r = await anon.post("/api/admin/reset", { identity: "yonetici", code: m.code === "123456" ? "654321" : "123456", password: NEW_PASS });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.code);

  r = await anon.post("/api/admin/reset", { identity: "yonetici", code: m.code, password: NEW_PASS });
  assert.equal(r.status, 200);
  // Kod ikinci kez kullanılamaz
  r = await anon.post("/api/admin/reset", { identity: "yonetici", code: m.code, password: "Baska-parola-99" });
  assert.equal(r.status, 400);

  // Açık oturum kapandı; eski parola çalışmaz, yeni parola çalışır
  assert.equal((await admin.get("/api/admin/me")).status, 401);
  assert.equal((await client(S.base).login("yonetici", PASS)).status, 401);
  admin = client(S.base);
  assert.equal((await admin.login("yonetici", NEW_PASS)).status, 200);

  // Parola değiştiğine dair bilgilendirme e-postası
  assert.match(S.mailer.recent.at(-1).subject, /sıfırlandı/);
  assert.ok(events().some(e => e.event === "password_reset" && e.level === "alert"));
});

test("sıfırlama kodu 5 hatalı denemeden sonra geçersiz olur", async () => {
  const anon = client(S.base);
  await anon.post("/api/admin/forgot", { identity: "yonetici" });
  const m = await lastCode();
  const wrong = m.code === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i++) await anon.post("/api/admin/reset", { identity: "yonetici", code: wrong, password: "Deneme-parola-55" });
  const r = await anon.post("/api/admin/reset", { identity: "yonetici", code: m.code, password: "Deneme-parola-55" });
  assert.equal(r.status, 400);
  assert.equal((await client(S.base).login("yonetici", NEW_PASS)).status, 200);
});

test("art arda hatalı girişler kaydedilir, kilitlenince e-postayla uyarı gider", async () => {
  const before = S.mailer.recent.length;
  for (let i = 0; i < 5; i++) await client(S.base).login("yonetici", "yanlis-parola-" + i);
  const r = await client(S.base).login("yonetici", NEW_PASS);
  assert.equal(r.status, 429);
  const ev = events();
  assert.ok(ev.filter(e => e.event === "login_failed").length >= 5);
  assert.ok(ev.some(e => e.event === "login_locked" && e.level === "alert"));
  assert.ok(S.mailer.recent.slice(before).some(m => /hatalı giriş/.test(m.subject) && m.to === "sahip@example.com"));

  // Panelde güvenlik kayıtları ve genel bakıştaki özet
  const list = await admin.get("/api/admin/security?level=alert");
  assert.equal(list.status, 200);
  assert.ok(list.json.every(e => e.level === "alert"));
  assert.ok(list.json.some(e => e.event === "login_locked"));
  const stats = await admin.get("/api/admin/stats");
  assert.ok(stats.json.security.alerts7d >= 1);
  assert.equal(stats.json.security.emailVerified, true);
  // Oturumsuz erişilemez
  assert.equal((await client(S.base).get("/api/admin/security")).status, 401);
});

test("e-posta gönderim ayarlarında parola panele geri gönderilmez", async () => {
  let r = await admin.put("/api/admin/mail", { host: "smtp.example.com", port: 465, user: "gonderen@example.com", pass: "abcd efgh ijkl mnop" });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.hasPass, true);
  assert.equal(r.json.config.pass, undefined);
  r = await admin.get("/api/admin/mail");
  assert.equal(JSON.stringify(r.json).includes("abcdefgh"), false);
  // Parola alanı boş bırakılırsa eski parola korunur
  r = await admin.put("/api/admin/mail", { host: "smtp.example.com", port: 587, user: "gonderen@example.com", pass: "" });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.hasPass, true);
  r = await admin.put("/api/admin/mail", { host: "kötü adres", port: 0, user: "x", pass: "y" });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.host && r.json.fields.port && r.json.fields.user);
  // Site verisinde SMTP bilgisi yok
  const site = await client(S.base).get("/api/site");
  assert.equal(site.text.includes("gonderen@example.com"), false);
  await admin.del("/api/admin/mail");
});

test("kolay tahmin edilen parolalar reddedilir", () => {
  const { checkPasswordPolicy } = require("../server/auth");
  for (const pw of ["Kardias2024!", "admin123456", "aaaaa11111", "Yonetici2026", "ab12ab12ab12"]) assert.ok(checkPasswordPolicy(pw), pw);
  assert.equal(checkPasswordPolicy("Liman-Fener-1890"), null);
});

test("açık oturumlar listelenir, diğer cihazlar kapatılabilir; hareketsiz oturum kendiliğinden kapanır", async () => {
  assert.ok(!S.auth.createUser("ikinci", "Deniz-Feneri-42").error);
  const a = client(S.base), b = client(S.base);
  assert.equal((await a.login("ikinci", "Deniz-Feneri-42")).status, 200);
  assert.equal((await b.login("ikinci", "Deniz-Feneri-42")).status, 200);
  let r = await a.get("/api/admin/account/sessions");
  assert.equal(r.json.length, 2);
  assert.equal(r.json.filter(s => s.current).length, 1);

  r = await a.post("/api/admin/account/sessions/end-others");
  assert.equal(r.json.ended, 1);
  assert.equal((await b.get("/api/admin/me")).status, 401);
  assert.equal((await a.get("/api/admin/me")).status, 200);
  assert.ok(events().some(e => e.event === "sessions_ended"));

  // 60 dakikadan uzun süre işlem yapılmamış gibi göster
  S.db.prepare("UPDATE sessions SET last_seen = ? WHERE user_id = (SELECT id FROM users WHERE username = 'ikinci')").run(Date.now() - 61 * 60 * 1000);
  assert.equal((await a.get("/api/admin/me")).status, 401);
});
