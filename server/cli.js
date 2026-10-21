/* Komut satırı araçları
     npm run create-admin -- <kullanici-adi> [parola]
   Parola verilmezse güçlü bir parola üretilip ekrana yazılır (ilk girişten sonra panelden değiştirin). */
const path = require("node:path");
const crypto = require("node:crypto");
const { openDb } = require("./db");
const { makeAuth } = require("./auth");

const [cmd, username, given] = process.argv.slice(2);
if (cmd !== "create-admin" || !username) {
  console.log("Kullanım: npm run create-admin -- <kullanici-adi> [parola]");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "storage");
const db = openDb(path.join(dataDir, "kardias.db"));
const auth = makeAuth(db, { sessionHours: 12, cookieSecure: "auto" });

// Okunması kolay ama tahmini zor: 4 grup x 4 karakter + rakam garantisi
const generated = () => {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join(""));
  return groups.join("-") + crypto.randomInt(10);
};
const password = given || generated();
const out = auth.createUser(username, password);
if (out.error) {
  console.error("Hata: " + out.error);
  process.exit(1);
}
console.log(`Yönetici oluşturuldu: ${out.username}`);
if (!given) console.log(`Parola: ${password}\n(İlk girişten sonra panelde “Hesabım” bölümünden değiştirin.)`);
