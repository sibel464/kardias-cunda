/* Sunucuyu başlatır:  npm start   (PORT, HOST, DATA_DIR, COOKIE_SECURE, TRUST_PROXY ortam değişkenleriyle ayarlanır) */
const { createApp } = require("./app");

const { app, db, config } = createApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Kardias Cunda çalışıyor:  http://localhost:${port}`);
  console.log(`Yönetim paneli:           http://localhost:${port}/admin/`);
  console.log(`Veri klasörü:             ${config.dataDir}`);
  if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    console.log("\n⚠  Henüz yönetici yok. Oluşturmak için:  npm run create-admin -- <kullanici-adi>\n");
  }
});
