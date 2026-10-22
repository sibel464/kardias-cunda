/* Yayına hazırlık testleri: mükerrer rezervasyon, KVKK sayfası, robots/sitemap, sağlık denetimi, yedek indirme,
   yedekle/doğrula/geri yükle, GitHub kopyasından içe aktarma, export-static koruması, maskeli güvenlik kayıtları */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { startServer, client, PNG, istanbulDay } = require("./helpers");
const { createBackup, verifyBackup, restoreBackup } = require("../server/backup");
const { makeMailer } = require("../server/mailer");

const ROOT = path.join(__dirname, "..");
let S, admin;
const PASS = "Kardias-test-2026";

before(async () => {
  S = await startServer();
  S.auth.createUser("yonetici", PASS);
  admin = client(S.base);
  assert.equal((await admin.login("yonetici", PASS)).status, 200);
});
after(() => S.close());

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kardias-launch-"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("aynı rezervasyon çift gönderilirse ikinci kayıt açılmaz, farklı talep yeni kayıt olur", async () => {
  const c = client(S.base);
  const body = { type: "sokak", name: "Çift Tık", phone: "0532 999 88 77", date: istanbulDay(3), time: "20:00", guests: "2" };
  const [a, b] = await Promise.all([c.post("/api/reservations", body), c.post("/api/reservations", body)]);
  const first = a.status === 201 ? a : b, second = a.status === 201 ? b : a;
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  assert.equal(second.json.id, first.json.id);
  const other = await c.post("/api/reservations", { ...body, time: "21:00" });
  assert.equal(other.status, 201);
  assert.notEqual(other.json.id, first.json.id);
  const n = S.db.prepare("SELECT COUNT(*) n FROM reservations WHERE phone = ?").get(body.phone).n;
  assert.equal(n, 2);
});

test("KVKK sayfası ayarlarla oluşur, değerler kaçışlanır; formlarda bağlantısı vardır", async () => {
  const kv = await admin.put("/api/admin/settings/kvkk", { kvkkLegalName: "Örnek <b>Turizm</b> Ltd. Şti.", kvkkEmail: "kvkk@example.com", kvkkRetentionDays: 365 });
  assert.equal(kv.status, 200);
  const r = await client(S.base).get("/kvkk");
  assert.equal(r.status, 200);
  assert.match(r.text, /Örnek &lt;b&gt;Turizm&lt;\/b&gt; Ltd\. Şti\./);
  assert.match(r.text, /mailto:kvkk@example\.com/);
  assert.match(r.text, /365 gün sonra/);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  const home = await client(S.base).get("/");
  assert.equal((home.text.match(/href="kvkk"/g) || []).length, 2);
  const stats = (await admin.get("/api/admin/stats")).json.security;
  assert.equal(stats.kvkkMissing, false);
});

test("robots.txt önizlemede her şeyi kapatır; yayında panel ve API'yi kapatıp sitemap'i gösterir", async () => {
  await admin.put("/api/admin/settings/seo", { siteTitle: "Kardias", siteDescription: "Açıklama", siteUrl: "https://www.kardiascunda.com", noindex: true });
  let r = await client(S.base).get("/robots.txt");
  assert.equal(r.text, "User-agent: *\nDisallow: /\n");
  assert.equal((await client(S.base).get("/sitemap.xml")).status, 404);
  assert.match((await client(S.base).get("/")).text, /<meta name="robots" content="noindex, nofollow">/);

  await admin.put("/api/admin/settings/seo", { siteTitle: "Kardias", siteDescription: "Açıklama", siteUrl: "https://www.kardiascunda.com", noindex: false });
  r = await client(S.base).get("/robots.txt");
  assert.match(r.text, /Disallow: \/admin\/\nDisallow: \/api\//);
  assert.match(r.text, /Sitemap: https:\/\/www\.kardiascunda\.com\/sitemap\.xml/);
  const sm = await client(S.base).get("/sitemap.xml");
  assert.equal(sm.status, 200);
  assert.match(sm.text, /<loc>https:\/\/www\.kardiascunda\.com\/<\/loc>/);
  assert.doesNotMatch((await client(S.base).get("/")).text, /name="robots"/);
});

test("sağlık denetimi 200 döner; hassas dosyalar HTTP'den alınamaz", async () => {
  const c = client(S.base);
  assert.equal((await c.get("/healthz")).text, "ok");
  for (const u of ["/package.json", "/.env", "/storage/kardias.db", "/server/app.js", "/data/admin-db.json", "/uploads/.tmp/", "/tests/helpers.js", "/Dockerfile", "/backups/", "/css/", "/uploads/../package.json"]) {
    const r = await c.get(u);
    assert.ok([400, 403, 404].includes(r.status), `${u} → ${r.status}`);
  }
});

test("yedek indirme yalnızca girişle olur ve geçerli bir SQLite dosyası verir", async () => {
  assert.equal((await client(S.base).get("/api/admin/backup")).status, 401);
  const r = await fetch(S.base + "/api/admin/backup", { headers: { Cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /kardias-yedek-\d{4}-\d{2}-\d{2}\.db/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), "SQLite format 3");
  const logged = S.db.prepare("SELECT 1 FROM security_log WHERE event = 'backup_downloaded'").get();
  assert.ok(logged);
});

test("yedek alınır, doğrulanır, bozulursa yakalanır ve geri yüklenince veri geri gelir", async () => {
  const up = new FormData();
  up.append("files", new Blob([PNG], { type: "image/png" }), "foto.png");
  assert.equal((await admin.post("/api/admin/media", up)).status, 201);
  const backupDir = tmpDir();
  const b = createBackup({ dataDir: S.dataDir, backupDir, db: S.db });
  assert.ok(verifyBackup(b.dir).ok);
  assert.equal(b.counts.media, S.db.prepare("SELECT COUNT(*) n FROM media").get().n);

  // Bozulan yedek fark edilir
  const copy = path.join(backupDir, "bozuk");
  fs.cpSync(b.dir, copy, { recursive: true });
  const up1 = fs.readdirSync(path.join(copy, "uploads"))[0];
  fs.appendFileSync(path.join(copy, "uploads", up1), "x");
  assert.equal(verifyBackup(copy).ok, false);

  // Ayrı bir veri klasörüne geri yükleme: önceki dosyalar silinmez, kenara alınır
  const target = tmpDir();
  fs.writeFileSync(path.join(target, "kardias.db"), "eski");
  const out = restoreBackup({ dir: b.dir, dataDir: target });
  assert.equal(fs.readFileSync(path.join(out.aside, "kardias.db"), "utf8"), "eski");
  const db = new DatabaseSync(path.join(target, "kardias.db"), { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM menu_items").get().n, b.counts.menu_items);
  for (const { path: p } of db.prepare("SELECT path FROM media").all()) assert.ok(fs.existsSync(path.join(target, "uploads", path.basename(p))));
  db.close();

  // Saklama sınırı: en yeni N yedek kalır
  for (let i = 0; i < 3; i++) createBackup({ dataDir: S.dataDir, backupDir, db: S.db, keep: 2 });
  assert.equal(fs.readdirSync(backupDir).filter(n => n.startsWith("yedek-")).length, 2);
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test("GitHub kopyasından içe aktarma: önizleme yazmaz, uygulama kimlikleri korur, rezervasyon ve kullanıcıya dokunmaz", () => {
  const dataDir = tmpDir();
  const env = { ...process.env, DATA_DIR: dataDir, NODE_NO_WARNINGS: "1" };
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, "data/admin-db.json"), "utf8"));
  // Önce boş kurulum + bir kullanıcı ve bir rezervasyon
  execFileSync(process.execPath, ["server/cli.js", "create-admin", "deneme", PASS], { cwd: ROOT, env });
  const pre = new DatabaseSync(path.join(dataDir, "kardias.db"));
  pre.prepare("INSERT INTO reservations (type, name, phone, date, time, guests) VALUES ('sokak', 'Misafir', '05320000000', '2030-01-01', '20:00', '2')").run();
  pre.close();

  const dry = spawnSync(process.execPath, ["server/import-static.js"], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /önizlemedir/);
  let db = new DatabaseSync(path.join(dataDir, "kardias.db"), { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media").get().n, 0);
  db.close();

  const run = spawnSync(process.execPath, ["server/import-static.js", "--uygula"], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /tüm sayılar kaynakla aynı/);
  db = new DatabaseSync(path.join(dataDir, "kardias.db"), { readOnly: true });
  const ids = t => db.prepare(`SELECT id FROM ${t} ORDER BY id`).all().map(r => r.id);
  assert.deepEqual(ids("menu_items"), src.entities.items.map(x => x.id).sort((a, b) => a - b));
  assert.deepEqual(ids("rooms"), src.entities.rooms.map(x => x.id).sort((a, b) => a - b));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media").get().n, src.media.length);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reservations").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
  for (const m of src.media) assert.ok(fs.existsSync(path.join(dataDir, "uploads", path.basename(m.path))));
  db.close();
  assert.equal(fs.readdirSync(path.join(dataDir, "backups")).filter(n => n.startsWith("yedek-")).length, 1, "uygulamadan önce yedek alınmalı");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("export-static, GitHub kopyasında olup veritabanında olmayan kayıtları silmek yerine durur", () => {
  const dataDir = tmpDir();
  const env = { ...process.env, DATA_DIR: dataDir, NODE_NO_WARNINGS: "1" };
  execFileSync(process.execPath, ["server/cli.js", "create-admin", "deneme", PASS], { cwd: ROOT, env }); // varsayılan (eski) içerik
  const files = ["data/admin-db.json", "data/site.json"].map(f => path.join(ROOT, f));
  const before = files.map(sha), uploadsBefore = fs.readdirSync(path.join(ROOT, "static/uploads")).join();
  const r = spawnSync(process.execPath, ["server/export-static.js"], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Durduruldu/);
  assert.deepEqual(files.map(sha), before);
  assert.equal(fs.readdirSync(path.join(ROOT, "static/uploads")).join(), uploadsBefore);
  assert.equal(fs.existsSync(path.join(ROOT, "kvkk.html")) && fs.statSync(path.join(ROOT, "kvkk.html")).mtimeMs > Date.now() - 5000, false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("yayında SMTP yoksa parola sıfırlama 'kod gönderildi' demez ve kod diske yazılmaz", async () => {
  const dir = tmpDir();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE private_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const mailer = makeMailer(db, dir, { allowOutbox: false });
  assert.equal(mailer.canSend(), false);
  await assert.rejects(mailer.send({ to: "a@example.com", subject: "x", text: "y" }), /ayarlanmamış/);
  assert.equal(fs.existsSync(path.join(dir, "outbox")), false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  // Sunucu düzeyinde: gönderilemiyorsa 503 ve açıklayıcı hata
  const orig = S.mailer.canSend;
  S.mailer.canSend = () => false;
  try {
    const r = await client(S.base).post("/api/admin/forgot", { identity: "yonetici" });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /reset-password/);
  } finally {
    S.mailer.canSend = orig;
  }
});

test("olmayan kullanıcı adıyla yapılan denemeler güvenlik kaydına maskeli yazılır", async () => {
  await client(S.base).post("/api/admin/login", { username: "GizliParola123", password: "yanlis-parola-1" });
  const row = S.db.prepare("SELECT username FROM security_log WHERE event = 'login_failed' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.username, "Gi***");
  assert.equal(S.db.prepare("SELECT COUNT(*) n FROM security_log WHERE username LIKE '%GizliParola%' OR detail LIKE '%GizliParola%'").get().n, 0);
});
