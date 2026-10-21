/* E-posta gönderimi: panelde girilen SMTP bilgileriyle (ör. Gmail + uygulama şifresi).
   SMTP ayarlanmamışsa e-postalar gönderilmez; storage/outbox klasörüne metin dosyası olarak yazılır (yerel deneme için). */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const { ValidationError } = require("./validate");

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[a-zA-Z0-9.-]{1,190}\.[a-zA-Z]{2,24}$/;
const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;

function makeMailer(db, dataDir) {
  const outboxDir = path.join(dataDir, "outbox");
  const recent = []; // son yazılan outbox iletileri (testler okur)

  const read = () => {
    const row = db.prepare("SELECT value FROM private_settings WHERE key = 'smtp'").get();
    return row ? JSON.parse(row.value) : null;
  };

  // Panelde gösterilecek hâli: parola asla geri gönderilmez
  function publicConfig() {
    const c = read();
    return c ? { host: c.host, port: c.port, user: c.user, from: c.from || "", hasPass: !!c.pass } : null;
  }

  function save(input) {
    const b = input || {}, cur = read() || {}, errors = {};
    const host = String(b.host || "").trim(), user = String(b.user || "").trim(), from = String(b.from || "").trim();
    const port = Number(b.port);
    const pass = typeof b.pass === "string" && b.pass ? b.pass.replace(/\s+/g, "") : cur.pass;
    if (!HOST_RE.test(host)) errors.host = "Geçerli bir sunucu adresi girin (ör. smtp.gmail.com).";
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Geçerli bir port girin (ör. 465).";
    if (!EMAIL_RE.test(user)) errors.user = "Gönderen hesabın e-posta adresini girin.";
    if (!pass || pass.length > 200) errors.pass = "Uygulama şifresini girin.";
    if (from && !EMAIL_RE.test(from)) errors.from = "Geçerli bir e-posta adresi girin ya da boş bırakın.";
    if (Object.keys(errors).length) throw new ValidationError(errors);
    db.prepare("INSERT OR REPLACE INTO private_settings (key, value) VALUES ('smtp', ?)").run(JSON.stringify({ host, port, user, pass, from }));
    return publicConfig();
  }

  function clear() { db.prepare("DELETE FROM private_settings WHERE key = 'smtp'").run(); }

  async function send({ to, subject, text }) {
    const c = read();
    if (!c) {
      fs.mkdirSync(outboxDir, { recursive: true });
      const file = path.join(outboxDir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.txt`);
      fs.writeFileSync(file, `Kime: ${to}\nKonu: ${subject}\n\n${text}\n`);
      recent.push({ to, subject, text });
      if (recent.length > 20) recent.shift();
      return { outbox: true };
    }
    const transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000
    });
    await transport.sendMail({ from: `"Kardias Yönetim Paneli" <${c.from || c.user}>`, to, subject, text });
    return { sent: true };
  }

  return { publicConfig, save, clear, send, isConfigured: () => !!read(), recent };
}

module.exports = { makeMailer, EMAIL_RE };
