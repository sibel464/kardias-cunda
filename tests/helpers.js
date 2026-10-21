/* Testler için: geçici veri klasörüyle sunucu başlatır, çerezli istemci sağlar */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/app");

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kardias-test-"));
  const ctx = createApp({ dataDir });
  const server = await new Promise(res => { const s = ctx.app.listen(0, "127.0.0.1", () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...ctx, base, dataDir,
    async close() {
      await new Promise(r => server.close(r));
      ctx.db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// Oturum çerezini ve CSRF anahtarını hatırlayan basit istemci
function client(base) {
  let cookie = "", csrf = "";
  async function req(method, url, body, { raw, headers = {}, noCsrf } = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (csrf && !noCsrf && method !== "GET") h["X-CSRF-Token"] = csrf;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && !raw) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: payload, redirect: "manual" });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML ya da boş */ }
    return { status: r.status, headers: r.headers, json, text, setCookie: set };
  }
  return {
    req,
    get: (u, o) => req("GET", u, undefined, o),
    post: (u, b, o) => req("POST", u, b, o),
    put: (u, b, o) => req("PUT", u, b, o),
    patch: (u, b, o) => req("PATCH", u, b, o),
    del: (u, o) => req("DELETE", u, undefined, o),
    async login(username, password) {
      const r = await req("POST", "/api/admin/login", { username, password });
      if (r.json && r.json.csrf) csrf = r.json.csrf;
      return r;
    },
    get cookie() { return cookie; }
  };
}

// 1x1 piksel gerçek PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// MP4 başlığı (ftyp isom)
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);

const istanbulDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

module.exports = { startServer, client, PNG, MP4, istanbulDay };
