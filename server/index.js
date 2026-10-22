/* Sunucuyu başlatır:  npm start
   Ortam değişkenleri: PORT, HOST, DATA_DIR, COOKIE_SECURE, TRUST_PROXY, SESSION_HOURS, IDLE_MINUTES,
   BACKUP_DIR, BACKUP_KEEP, BACKUP_INTERVAL_HOURS (otomatik yedek aralığı; 0 = kapalı, yayında varsayılan 24) */
const { createApp } = require("./app");
const { createBackup } = require("./backup");

const { app, db, config, auth, purgeOldReservations } = createApp();
const port = Number(process.env.PORT || 3000);
// Varsayılan olarak yalnızca bu bilgisayardan erişilir; Docker/barındırma hizmetinde HOST=0.0.0.0 verilir
const host = process.env.HOST || "127.0.0.1";
const production = process.env.NODE_ENV === "production";
const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? (production ? 24 : 0));

if (production && config.cookieSecure !== "always") {
  console.warn("⚠  Yayında COOKIE_SECURE=always verilmeli (site HTTPS arkasında çalışmalı).");
}

const server = app.listen(port, host, () => {
  console.log(`Kardias Cunda çalışıyor:  http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Yönetim paneli:           http://${host === "0.0.0.0" ? "localhost" : host}:${port}/admin/`);
  console.log(`Veri klasörü:             ${config.dataDir}`);
  console.log(`Otomatik yedek:           ${backupHours > 0 ? `${backupHours} saatte bir → ${config.backupDir}` : "kapalı (BACKUP_INTERVAL_HOURS)"}`);
  if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    console.log("\n⚠  Henüz yönetici yok. Oluşturmak için:  npm run create-admin -- <kullanici-adi>\n");
  }
});

// Günlük bakım: tutarlı yedek + KVKK saklama süresi dolan rezervasyonların silinmesi (önce yedek, sonra silme)
function maintenance() {
  try {
    const b = createBackup({ dataDir: config.dataDir, backupDir: config.backupDir, db, keep: Number(process.env.BACKUP_KEEP || 14) });
    console.log(`Yedek alındı: ${b.dir}`);
  } catch (err) {
    console.error("Yedek alınamadı:", err.message);
    auth.security("backup_failed", { level: "alert", detail: String(err.message).slice(0, 250) });
    return; // yedek yoksa veri silinmez
  }
  try { purgeOldReservations(); } catch (err) { console.error("Saklama süresi temizliği başarısız:", err.message); }
}
let timers = [];
if (backupHours > 0) {
  timers.push(setTimeout(maintenance, 60_000), setInterval(maintenance, backupHours * 3600_000));
  timers.forEach(t => t.unref());
}

// Barındırma hizmeti yeniden başlatırken (SIGTERM) istekler tamamlanır, veritabanı düzgün kapatılır
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} alındı, kapanıyor…`);
  timers.forEach(t => clearTimeout(t));
  server.close(() => {
    try { db.close(); } catch { /* zaten kapalı */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
