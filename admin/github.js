/* GitHub Pages paneli: sunucu yokken (ör. https://kullanici.github.io/depo/admin/) panel, sunucu API'sinin yerine bunu kullanır.
   İçeriğin tam kopyası depodaki data/admin-db.json dosyasındadır. Her değişiklik tarayıcıda doğrulanır, sitenin okuduğu
   data/site.json yeniden üretilir ve ikisi (yüklenen dosyalarla birlikte) tek bir commit olarak GitHub'a yazılır;
   GitHub Pages siteyi 1–2 dakika içinde yeniden yayınlar. Giriş, depoya yazma izni olan bir GitHub erişim anahtarıyla yapılır. */
(() => {
  "use strict";

  const API = "https://api.github.com";
  const TOKEN_KEY = "kardias-gh-token";
  const REPO_KEY = "kardias-gh-repo"; // yerelde denemek için: localStorage'a "kullanici/depo" yazılır
  const DB_PATH = "data/admin-db.json";
  const SITE_PATH = "data/site.json";
  const IMAGE_MAX = 15 * 1024 * 1024;
  const VIDEO_MAX = 50 * 1024 * 1024; // GitHub 50 MB üstü dosyalarda uyarır, 100 MB'ı kabul etmez
  const SCRIPTS = ["../server/schema.js", "../server/validate.js", "../server/site-data.js"];

  // Erişim anahtarı yalnızca bu sekmede (sessionStorage) tutulur: sekme kapanınca silinir ve aynı github.io adresindeki
  // başka sayfalarla paylaşılmaz. Depo ayarı (REPO_KEY) yerel denemeler için localStorage'dan okunur.
  const store = {
    get: k => { try { return k === REPO_KEY ? localStorage.getItem(k) : sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* depolama kapalı: yalnızca bu sayfa */ } },
    del: k => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* yok say */ } }
  };
  // Eski sürümün kalıcı olarak sakladığı anahtar temizlenir
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* yok say */ }

  class HttpError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data; }
  }

  // Hangi depo? kullanici.github.io/depo/admin/ → kullanici/depo
  function target() {
    const saved = store.get(REPO_KEY);
    if (saved && /^[\w.-]+\/[\w.-]+$/.test(saved)) { const [owner, repo] = saved.split("/"); return { owner, repo }; }
    if (!location.hostname.endsWith(".github.io")) return null;
    const owner = location.hostname.split(".")[0];
    const first = location.pathname.split("/")[1];
    return { owner, repo: first && first !== "admin" ? first : `${owner}.github.io` };
  }

  const gh = {
    token: null, owner: null, repo: null, branch: null,
    head: null,   // bilinen son commit
    dbSha: null,  // data/admin-db.json dosyasının bilinen sürümü (başka yerden değiştirildi mi?)
    db: null,     // içeriğin tamamı
    user: null,
    previews: new Map() // bu oturumda yüklenen dosyalar: GitHub Pages yayınlayana kadar önizleme
  };

  async function call(method, path, body, accept) {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        headers: {
          Authorization: "Bearer " + gh.token,
          Accept: accept || "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store"
      });
    } catch {
      throw new HttpError(0, "GitHub'a ulaşılamadı. İnternet bağlantınızı kontrol edin.");
    }
    if (accept && accept.includes("raw") && r.ok) return r.text();
    const data = await r.json().catch(() => null);
    if (r.ok) return data;
    if (r.status === 401) throw new HttpError(401, "GitHub erişim anahtarı geçersiz ya da süresi dolmuş.");
    if (r.status === 403 && /rate limit/i.test((data && data.message) || "")) throw new HttpError(429, "GitHub istek sınırı doldu; birkaç dakika sonra tekrar deneyin.");
    if (r.status === 403 || (r.status === 404 && method !== "GET")) throw new HttpError(403, "Bu erişim anahtarının depoya yazma izni yok. Anahtarda “Contents: Read and write” izni olmalı.");
    throw new HttpError(r.status, (data && data.message) || "GitHub isteği başarısız.", data);
  }

  const repoPath = p => `/repos/${gh.owner}/${gh.repo}${p}`;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new HttpError(0, "Panel dosyaları yüklenemedi: " + src));
      document.head.append(s);
    });
  }
  let scriptsLoaded = null;
  const loadScripts = () => (scriptsLoaded ||= SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()));

  const utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

  // data/admin-db.json'u ve sürümünü oku
  async function fetchDb(ref) {
    const meta = await call("GET", repoPath(`/contents/${DB_PATH}?ref=${encodeURIComponent(ref)}`))
      .catch(ex => { throw ex.status === 404 ? new HttpError(404, "Depoda data/admin-db.json yok. Bilgisayarda “npm run export-static” çalıştırıp GitHub'a gönderin.") : ex; });
    const text = meta.content && meta.encoding === "base64" ? utf8(meta.content) : await call("GET", repoPath(`/contents/${DB_PATH}?ref=${encodeURIComponent(ref)}`), undefined, "application/vnd.github.raw+json");
    return { sha: meta.sha, db: JSON.parse(text) };
  }

  const headSha = async () => (await call("GET", repoPath(`/git/ref/heads/${encodeURIComponent(gh.branch)}`))).object.sha;

  async function login(token) {
    const t = target();
    if (!t) throw new HttpError(400, "Bu adreste hangi GitHub deposunun kullanılacağı anlaşılamadı.");
    gh.token = String(token || "").trim();
    if (!gh.token) throw new HttpError(400, "GitHub erişim anahtarını yapıştırın.");
    Object.assign(gh, t);
    try {
      await loadScripts();
      const info = await call("GET", repoPath(""))
        .catch(ex => { throw ex.status === 404 ? new HttpError(404, `${t.owner}/${t.repo} deposu bulunamadı ya da bu anahtarın o depoya erişimi yok.`) : ex; });
      gh.branch = info.default_branch;
      gh.user = await call("GET", "/user").then(u => u.login, () => t.owner);
      gh.head = await headSha();
      const { sha, db } = await fetchDb(gh.head);
      gh.dbSha = sha;
      gh.db = db;
      store.set(TOKEN_KEY, gh.token);
      return { user: { id: 1, username: gh.user }, csrf: "github" };
    } catch (ex) {
      gh.token = null;
      throw ex;
    }
  }

  function logout() {
    store.del(TOKEN_KEY);
    gh.token = gh.db = null;
  }

  /* ============ Bellekteki içerik deposu (server/repo.js ile aynı kurallar) ============ */
  const clone = o => JSON.parse(JSON.stringify(o));
  const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

  function makeRepo(db) {
    const { ENTITIES, SETTINGS, SETTING_FIELDS } = window.KardiasSchema;
    const { validate, ValidationError } = window.KardiasValidate;

    const entityDef = type => {
      const def = Object.prototype.hasOwnProperty.call(ENTITIES, type) ? ENTITIES[type] : null;
      if (!def) throw new HttpError(404, "Bilinmeyen içerik türü.");
      return def;
    };
    const rows = type => (db.entities[type] ||= []);
    const find = (type, id) => rows(type).find(r => r.id === Number(id));
    const refExists = (entity, id) => !!find(entity, id);
    const parentField = def => def.parent ? def.fields.find(f => f.key === def.parent) : null;
    const nextId = type => {
      db.nextId ||= {};
      const id = Math.max(db.nextId[type] || 1, rows(type).reduce((n, r) => Math.max(n, r.id + 1), 1));
      db.nextId[type] = id + 1;
      return id;
    };

    function checkUnique(type, def, data, id) {
      const errors = {};
      for (const f of def.fields) {
        if (f.unique && data[f.key] && rows(type).some(r => r.id !== (id || 0) && r[f.key] === data[f.key])) errors[f.key] = "Bu değer başka bir kayıtta kullanılıyor.";
      }
      if (Object.keys(errors).length) throw new ValidationError(errors);
    }

    return {
      list(type, { parent, activeOnly } = {}) {
        const def = entityDef(type), pf = parentField(def);
        const out = rows(type).filter(r => (!pf || parent == null || parent === "" || r[pf.key] === Number(parent)) && (!activeOnly || r.active));
        // Üst kayda bağlı türlerde tüm liste gruplar hâlinde sıralanır (boş üst kayıt en başta)
        const pk = r => (pf ? r[pf.key] ?? -1 : 0);
        return clone(out.sort((a, b) => pk(a) - pk(b) || a.sort - b.sort || a.id - b.id));
      },

      get(type, id) {
        entityDef(type);
        const row = find(type, id);
        if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
        return clone(row);
      },

      create(type, input) {
        const def = entityDef(type);
        const data = validate(def.fields, input, { refExists });
        checkUnique(type, def, data);
        const pf = parentField(def);
        // Yeni kayıt, kendi grubunun (ör. aynı kategorinin) sonuna eklenir
        const group = rows(type).filter(r => !pf || r[pf.key] === data[pf.key]);
        const row = { id: nextId(type), sort: group.reduce((n, r) => Math.max(n, r.sort + 1), 0), active: input.active !== false, updatedAt: now(), ...data };
        rows(type).push(row);
        return clone(row);
      },

      update(type, id, input) {
        const def = entityDef(type);
        const row = find(type, id);
        if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
        const data = validate(def.fields, input, { refExists });
        for (const f of def.fields) {
          if (f.type === "ref" && f.entity === type && data[f.key] === row.id) throw new ValidationError({ [f.key]: "Bir kayıt kendisini seçemez." });
        }
        checkUnique(type, def, data, row.id);
        Object.assign(row, data, { updatedAt: now() });
        if (typeof input.active === "boolean") row.active = input.active;
        return clone(row);
      },

      setActive(type, id, active) {
        entityDef(type);
        if (typeof active !== "boolean") throw new ValidationError({ active: "Evet/Hayır değeri bekleniyor." });
        const row = find(type, id);
        if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
        Object.assign(row, { active, updatedAt: now() });
        return clone(row);
      },

      remove(type, id) {
        entityDef(type);
        const row = find(type, id);
        if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
        // Bu kayda bağlı kayıtlar: RESTRICT ise silme engellenir, değilse bağlantı boşaltılır
        const links = [];
        for (const [t, d] of Object.entries(ENTITIES)) {
          for (const f of d.fields) {
            if (f.type !== "ref" || f.entity !== type) continue;
            const hits = rows(t).filter(r => r[f.key] === row.id && !(t === type && r.id === row.id));
            if (hits.length && f.onDelete === "RESTRICT") {
              throw new HttpError(409, "Bu kayda bağlı başka kayıtlar var (ör. kategorideki ürünler). Önce onları silin ya da başka yere taşıyın.");
            }
            hits.forEach(r => links.push([r, f.key]));
          }
        }
        links.forEach(([r, key]) => { r[key] = null; });
        db.entities[type] = rows(type).filter(r => r !== row);
      },

      reorder(type, ids) {
        entityDef(type);
        if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(x => !Number.isInteger(x))) {
          throw new ValidationError({}, "Geçersiz sıralama.");
        }
        ids.forEach((id, i) => { const r = find(type, id); if (r) r.sort = i; });
      },

      getSettings() {
        return clone(Object.fromEntries(Object.entries(db.settings || {}).filter(([k]) => SETTING_FIELDS[k])));
      },
      saveSettings(group, input) {
        const g = SETTINGS.find(x => x.group === group);
        if (!g) throw new HttpError(404, "Bilinmeyen ayar grubu.");
        db.settings = { ...db.settings, ...validate(g.fields, input) };
        return this.getSettings();
      },

      getTexts() {
        return clone([...db.texts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
      },
      saveText(key, input) {
        const t = db.texts.find(x => x.key === key);
        if (!t) throw new HttpError(404, "Metin bulunamadı.");
        const data = validate([{ key: "value", type: "i18ntext", required: true, max: 2000 }], { value: input });
        Object.assign(t, data.value);
        return { key, ...data.value };
      },

      /* --- Medya --- */
      // Bu dosya sitede bir yerde kullanılıyor mu?
      usages(p) {
        const found = [];
        const has = v => JSON.stringify(v ?? "").includes(p);
        for (const [type, def] of Object.entries(ENTITIES)) {
          const cols = def.fields.filter(f => ["image", "media", "images"].includes(f.type)).map(f => f.key);
          if (!cols.length) continue;
          rows(type).filter(r => cols.some(c => has(r[c]))).forEach(r => {
            const t = r[def.title];
            found.push(`${def.single}: ${(t && typeof t === "object" ? t.tr : t) || "#" + r.id}`);
          });
        }
        const labels = Object.fromEntries(SETTINGS.flatMap(g => g.fields.map(f => [f.key, f.label])));
        Object.entries(db.settings || {}).filter(([, v]) => has(v)).forEach(([k]) => found.push(`Site ayarı: ${labels[k] || k}`));
        return found;
      }
    };
  }

  /* ============ GitHub'a yazma ============ */
  // Dosyanın gerçek türünü ilk baytlarından anlar (server/media.js ile aynı)
  function sniff(buf) {
    const ascii = (a, b) => String.fromCharCode(...buf.subarray(a, b));
    const starts = bytes => bytes.every((b, i) => buf[i] === b);
    if (starts([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", kind: "image" };
    if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif", kind: "image" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" };
    if (ascii(4, 8) === "ftyp") {
      const brand = ascii(8, 12);
      if (brand === "avif" || brand === "avis") return { mime: "image/avif", ext: "avif", kind: "image" };
      if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV"].includes(brand)) return { mime: "video/mp4", ext: "mp4", kind: "video" };
    }
    if (starts([0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: "webm", kind: "video" };
    return null;
  }

  const toBase64 = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new HttpError(0, "Dosya okunamadı: " + file.name));
    r.readAsDataURL(file);
  });

  // Büyük dosyalar için ilerleme gösterebilmek adına XMLHttpRequest
  function createBlob(base64, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API + repoPath("/git/blobs"));
      xhr.setRequestHeader("Authorization", "Bearer " + gh.token);
      xhr.setRequestHeader("Accept", "application/vnd.github+json");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* boş yanıt */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.sha);
        else reject(new HttpError(xhr.status, xhr.status === 401 ? "GitHub erişim anahtarı geçersiz ya da süresi dolmuş."
          : xhr.status === 403 || xhr.status === 404 ? "Bu erişim anahtarının depoya yazma izni yok. Anahtarda “Contents: Read and write” izni olmalı."
          : (data && data.message) || "Dosya GitHub'a yüklenemedi."));
      };
      xhr.onerror = () => reject(new HttpError(0, "Yükleme sırasında bağlantı kesildi."));
      xhr.send(JSON.stringify({ content: base64, encoding: "base64" }));
    });
  }

  // files: [{ path, content } | { path, sha } | { path, remove: true }] → tek commit
  async function commit(message, files) {
    for (let attempt = 0; ; attempt++) {
      const head = await headSha();
      if (head !== gh.head) {
        // Başka bir yerden (başka sekme/cihaz ya da bilgisayardan git push) değişiklik gelmiş: içerik değiştiyse üzerine yazma
        const meta = await call("GET", repoPath(`/contents/${DB_PATH}?ref=${head}`));
        if (meta.sha !== gh.dbSha) throw new HttpError(409, "İçerik başka bir yerde (başka sekme ya da cihaz) değiştirilmiş. Sayfayı yenileyip tekrar deneyin; yaptığınız son değişiklik kaydedilmedi.");
        gh.head = head;
      }
      const base = await call("GET", repoPath(`/git/commits/${head}`));
      const tree = await call("POST", repoPath("/git/trees"), {
        base_tree: base.tree.sha,
        tree: files.map(f => ({ path: f.path, mode: "100644", type: "blob", ...(f.remove ? { sha: null } : f.sha ? { sha: f.sha } : { content: f.content }) }))
      });
      const c = await call("POST", repoPath("/git/commits"), { message, tree: tree.sha, parents: [head] });
      try {
        await call("PATCH", repoPath(`/git/refs/heads/${encodeURIComponent(gh.branch)}`), { sha: c.sha });
        gh.head = c.sha;
        return;
      } catch (ex) {
        // Bu arada başka bir commit geldiyse (422) baştan dene
        if (ex.status !== 422 || attempt >= 2) throw ex;
      }
    }
  }

  // Değişiklikler sırayla yazılır; hata olursa bellekteki içerik değişmez
  let queue = Promise.resolve();
  function mutate(message, fn, extraFiles = []) {
    const run = queue.then(async () => {
      const draft = clone(gh.db);
      const result = fn(makeRepo(draft), draft);
      const site = window.KardiasSiteData;
      const dbText = JSON.stringify(draft, null, 1);
      const dbSha = (await call("POST", repoPath("/git/blobs"), { content: dbText, encoding: "utf-8" })).sha;
      await commit(message, [
        ...(typeof extraFiles === "function" ? extraFiles(draft) : extraFiles),
        { path: DB_PATH, sha: dbSha },
        { path: SITE_PATH, content: site.toStaticSiteData(site.buildSiteData(makeRepo(draft))) }
      ]);
      gh.db = draft;
      gh.dbSha = dbSha;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  /* ============ Panelin sunucuya yaptığı istekler (/api/admin/…) ============ */
  async function route(method, url, body) {
    const [path, qs] = url.split("?");
    const params = new URLSearchParams(qs || "");
    const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
    const key = `${method} /${seg[0] || ""}`;
    const repo = makeRepo(gh.db);
    const { ENTITIES, SETTINGS } = window.KardiasSchema;

    if (key === "GET /me") return { user: { id: 1, username: gh.user }, csrf: "github" };
    if (key === "POST /logout") { logout(); return { ok: true }; }
    if (key === "GET /schema") {
      return { entities: Object.fromEntries(Object.entries(ENTITIES).map(([k, { table, ...rest }]) => [k, rest])), settings: SETTINGS };
    }
    if (key === "GET /stats") {
      const n = t => (gh.db.entities[t] || []).length;
      return {
        items: n("items"), categories: n("categories"), rooms: n("rooms"), gallery: n("gallery"), events: n("events"), reviews: n("reviews"),
        media: gh.db.media.length, reservationsNew: 0, reservationsUpcoming: 0, latest: [],
        security: { failed24h: 0, alerts7d: 0, emailVerified: true, mailConfigured: true }
      };
    }

    if (seg[0] === "entities" && seg[1]) {
      const [, type, id, sub] = seg;
      if (method === "GET" && !id) return repo.list(type, { parent: params.get("parent") });
      if (method === "GET") return repo.get(type, id);
      if (method === "POST" && !id) return mutate(`Panel: yeni kayıt (${type})`, r => r.create(type, body));
      if (method === "POST" && id === "reorder") return mutate(`Panel: sıralama (${type})`, r => { r.reorder(type, body && body.ids); return { ok: true }; });
      if (method === "PUT" && id) return mutate(`Panel: kayıt düzenlendi (${type} #${id})`, r => r.update(type, id, body));
      if (method === "PATCH" && sub === "active") return mutate(`Panel: ${body && body.active ? "gösterildi" : "gizlendi"} (${type} #${id})`, r => r.setActive(type, id, body && body.active));
      if (method === "DELETE" && id) return mutate(`Panel: kayıt silindi (${type} #${id})`, r => { r.remove(type, id); return { ok: true }; });
    }

    if (key === "GET /settings") return repo.getSettings();
    if (key === "PUT /settings" && seg[1]) return mutate(`Panel: ayarlar (${seg[1]})`, r => r.saveSettings(seg[1], body));
    if (key === "GET /texts") return repo.getTexts();
    if (key === "PUT /texts" && seg[1]) return mutate(`Panel: metin (${seg[1]})`, r => r.saveText(seg[1], body));

    if (key === "GET /media") return clone([...gh.db.media].sort((a, b) => b.id - a.id));
    if (key === "DELETE /media" && seg[1]) {
      const m = gh.db.media.find(x => x.id === Number(seg[1]));
      if (!m) throw new HttpError(404, "Dosya bulunamadı.");
      const used = repo.usages(m.path);
      if (used.length) throw new HttpError(409, "Bu dosya sitede kullanılıyor; önce şu yerlerden kaldırın: " + used.join(", "));
      const file = "static" + m.path;
      const exists = await call("GET", repoPath(`/contents/${file}?ref=${gh.head}`)).then(() => true, () => false);
      return mutate(`Panel: dosya silindi (${m.name || m.path})`, (r, db) => { db.media = db.media.filter(x => x.id !== m.id); return { ok: true }; },
        exists ? [{ path: file, remove: true }] : []);
    }

    throw new HttpError(404, "Bu bölüm GitHub Pages panelinde kullanılamaz; yalnızca sitenin kendi sunucusunda çalışır.");
  }

  async function request(method, url, body) {
    if (!gh.db) throw Object.assign(new Error("Oturum kapalı, lütfen tekrar giriş yapın."), { status: 401 });
    try {
      return await route(method, url, body);
    } catch (ex) {
      const status = ex.status || 500;
      const message = ex.message || "İşlem başarısız.";
      throw Object.assign(new Error(message), { status, data: { error: message, fields: ex.fields } });
    }
  }

  // Dosya yükleme: türü içeriğinden doğrulanır, GitHub'a blob olarak gönderilir, kütüphaneye eklenir
  async function upload(files, onProgress) {
    if (!gh.db) throw new Error("Oturum kapalı, lütfen tekrar giriş yapın.");
    const saved = [], rejected = [], ready = [];
    for (const f of [...files]) {
      const type = sniff(new Uint8Array(await f.slice(0, 32).arrayBuffer()));
      if (!type) { rejected.push({ name: f.name, error: "Desteklenmeyen dosya türü. JPG, PNG, WEBP, GIF, AVIF, MP4 veya WEBM yükleyin." }); continue; }
      if (type.kind === "image" && f.size > IMAGE_MAX) { rejected.push({ name: f.name, error: "Görsel en fazla 15 MB olabilir." }); continue; }
      if (type.kind === "video" && f.size > VIDEO_MAX) { rejected.push({ name: f.name, error: "Video en fazla 50 MB olabilir (GitHub sınırı)." }); continue; }
      const rand = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
      ready.push({ file: f, type, name: `${Date.now().toString(36)}-${rand}.${type.ext}` });
    }
    if (!ready.length) {
      const message = rejected.map(r => `${r.name}: ${r.error}`).join(" ") || "Dosya seçilmedi.";
      throw Object.assign(new Error(message), { data: { error: message, saved, rejected } });
    }
    try {
      const total = ready.reduce((n, x) => n + x.file.size, 0);
      let done = 0;
      for (const x of ready) {
        x.sha = await createBlob(await toBase64(x.file), p => onProgress && onProgress(Math.min(0.95, (done + p * x.file.size) / total)));
        done += x.file.size;
      }
      await mutate(`Panel: ${ready.length} dosya yüklendi`, (r, db) => {
        db.nextId ||= {};
        for (const x of ready) {
          const id = Math.max(db.nextId.media || 1, db.media.reduce((n, m) => Math.max(n, m.id + 1), 1));
          db.nextId.media = id + 1;
          const row = {
            id, path: "/uploads/" + x.name, name: String(x.file.name || "").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120),
            mime: x.type.mime, kind: x.type.kind, size: x.file.size, createdAt: now()
          };
          db.media.push(row);
          saved.push(row);
        }
      }, ready.map(x => ({ path: "static/uploads/" + x.name, sha: x.sha })));
      ready.forEach(x => gh.previews.set("/uploads/" + x.name, URL.createObjectURL(x.file)));
      if (onProgress) onProgress(1);
      return { saved: clone(saved), rejected };
    } catch (ex) {
      throw Object.assign(new Error(ex.message || "Yükleme başarısız."), { status: ex.status, data: { error: ex.message } });
    }
  }

  // Panelde önizleme adresi: yeni yüklenenler tarayıcıdan, diğerleri GitHub Pages'teki kopyadan
  const fileUrl = p => gh.previews.get(p) || (p.startsWith("/uploads/") ? "../static" + p : p);

  window.KardiasGitHub = {
    available: () => !!target(),
    target,
    savedToken: () => store.get(TOKEN_KEY),
    login, logout, request, upload, fileUrl
  };
})();
