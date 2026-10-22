/* Girdi doğrulama: şemadaki alan tanımına göre gelen veriyi temizler, hataları alan bazında döndürür */
// Hem sunucuda (require) hem tarayıcıda (GitHub Pages paneli: window.KardiasValidate) çalışır
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KardiasValidate = factory();
})(typeof self !== "undefined" ? self : this, function () {

const IMAGE_RE = [
  /^\/uploads\/[a-z0-9-]+\.(jpe?g|png|webp|gif|avif)$/,   // panelden yüklenen
  /^img\/[a-z0-9/_-]+\.(jpe?g|png|webp)$/i,               // sitede hazır gelen
  /^photo-[A-Za-z0-9-]{6,80}$/                           // Unsplash görsel kimliği
];
const VIDEO_RE = /^\/uploads\/[a-z0-9-]+\.(mp4|webm)$/;
const isImage = v => IMAGE_RE.some(re => re.test(v));
const isVideo = v => VIDEO_RE.test(v);

class ValidationError extends Error {
  constructor(fields, message = "Lütfen işaretli alanları düzeltin.") {
    super(message);
    this.status = 400;
    this.fields = fields;
  }
}

const str = v => (v == null ? "" : String(v)).replace(/\r\n/g, "\n").trim();
const isBlank = v => v == null || (typeof v === "string" && v.trim() === "");

function cleanText(v, max, multiline) {
  if (v != null && typeof v !== "string" && typeof v !== "number") throw "Geçersiz değer.";
  let s = str(v);
  // Kontrol karakterlerini at (satır sonu yalnızca çok satırlı alanlarda kalır)
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  if (s.length > max) throw `En fazla ${max} karakter olabilir.`;
  return s;
}

function cleanI18n(v, f, multiline) {
  if (v == null) v = {};
  if (typeof v !== "object" || Array.isArray(v)) throw "Geçersiz değer.";
  const max = f.max || (multiline ? 2000 : 200);
  const tr = cleanText(v.tr, max, multiline), en = cleanText(v.en, max, multiline);
  if (f.required && !tr) throw "Türkçe metin zorunludur.";
  return { tr, en };
}

function cleanNumber(v, f, integer) {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw "Sayı girin.";
  if (integer && !Number.isInteger(n)) throw "Tam sayı girin.";
  const min = f.min ?? (f.type === "money" ? 0 : -1e9), max = f.max ?? 1e7;
  if (n < min || n > max) throw `${min} ile ${max} arasında olmalı.`;
  return f.type === "money" ? Math.round(n * 100) / 100 : n;
}

function cleanField(f, v, ctx) {
  switch (f.type) {
    case "text": return cleanText(v, f.max || 200);
    case "textarea": return cleanText(v, f.max || 2000, true);
    case "i18n": return cleanI18n(v, f, false);
    case "i18ntext": return cleanI18n(v, f, true);
    case "slug": {
      const s = str(v).toLowerCase();
      if (s && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw "Yalnızca küçük harf, rakam ve tire kullanın.";
      if (s.length > 40) throw "En fazla 40 karakter.";
      return s;
    }
    case "url": {
      const s = str(v);
      if (!s) return "";
      let u;
      try { u = new URL(s); } catch { throw "Geçerli bir bağlantı girin (https://…)."; }
      if (u.protocol !== "https:" && u.protocol !== "http:") throw "Bağlantı http:// veya https:// ile başlamalı.";
      if (s.length > 500) throw "Bağlantı çok uzun.";
      return u.href;
    }
    case "link": {
      // Web adresi ya da sayfa içi bölüm bağlantısı (#menu)
      const s = str(v);
      if (!s) return "";
      if (s.startsWith("#")) {
        if (!/^#[a-z0-9-]{1,40}$/i.test(s)) throw "Bölüm bağlantısı #menu gibi olmalı.";
        return s;
      }
      return cleanField({ type: "url" }, s);
    }
    case "email": {
      const s = str(v);
      if (s && !/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i.test(s)) throw "Geçerli bir e-posta girin.";
      return s;
    }
    case "tel": {
      const s = str(v).replace(/[\s()-]/g, "");
      if (s && !/^\+?[0-9]{7,15}$/.test(s)) throw "Geçerli bir telefon girin (ör. +902663271965).";
      return s;
    }
    case "digits": {
      const s = str(v).replace(/[\s+()-]/g, "");
      if (s && !/^[0-9]{8,15}$/.test(s)) throw "Yalnızca rakam, ülke koduyla (ör. 905321234567).";
      return s;
    }
    case "date": {
      const s = str(v);
      if (s && !(/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00")))) throw "Geçerli bir tarih seçin.";
      return s;
    }
    case "time": {
      const s = str(v);
      if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw "SS:DD biçiminde girin (ör. 14:00).";
      return s;
    }
    case "int": return cleanNumber(v, f, true);
    case "number": case "money": return cleanNumber(v, f, false);
    case "bool":
      if (v == null || v === "") return false;
      if (typeof v !== "boolean") throw "Evet/Hayır değeri bekleniyor.";
      return v;
    case "select": {
      const s = str(v) || f.default || "";
      if (s && !f.options.includes(s)) throw "Geçersiz seçim.";
      return s;
    }
    case "tags": {
      if (v == null) return [];
      if (!Array.isArray(v) || v.some(x => !f.options.includes(x))) throw "Geçersiz etiket.";
      return [...new Set(v)];
    }
    case "image": {
      const s = str(v);
      if (s && !isImage(s)) throw "Medya kütüphanesinden bir görsel seçin.";
      return s;
    }
    case "media": {
      const s = str(v);
      if (s && !isImage(s) && !isVideo(s)) throw "Medya kütüphanesinden bir görsel ya da video seçin.";
      return s;
    }
    case "images": {
      if (v == null) return [];
      if (!Array.isArray(v) || v.some(x => typeof x !== "string" || !isImage(x))) throw "Medya kütüphanesinden görsel seçin.";
      if (v.length > (f.max || 12)) throw `En fazla ${f.max || 12} görsel.`;
      return v;
    }
    case "i18nlist": {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > 40) throw "Geçersiz liste.";
      return v.map(x => cleanI18n(x, { max: f.max || 160 }, false)).filter(x => x.tr || x.en);
    }
    case "prices": {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > 10) throw "En fazla 10 fiyat seçeneği.";
      return v.map(x => {
        if (!x || typeof x !== "object") throw "Geçersiz fiyat satırı.";
        const label = cleanI18n(x.label, { max: 40 }, false);
        const price = cleanNumber(x.price, { type: "money", max: 1e7 }, false);
        if (!label.tr || price == null) throw "Her fiyat satırında Türkçe ad ve fiyat olmalı.";
        return { label, price };
      });
    }
    case "ref": {
      if (isBlank(v)) return null;
      const id = Number(v);
      if (!Number.isInteger(id) || id < 1) throw "Geçersiz seçim.";
      if (ctx && ctx.refExists && !ctx.refExists(f.entity, id)) throw "Seçilen kayıt bulunamadı.";
      return id;
    }
    default: throw "Bilinmeyen alan türü.";
  }
}

function isEmptyValue(f, v) {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (f.type === "i18n" || f.type === "i18ntext") return !v.tr;
  return false;
}

// fields: şema alanları, input: istekten gelen nesne. Dönüş: temizlenmiş nesne ya da ValidationError
function validate(fields, input, ctx = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError({}, "Geçersiz istek.");
  const out = {}, errors = {};
  for (const f of fields) {
    if (ctx.partial && !(f.key in input)) continue;
    let v = input[f.key];
    if (v === undefined && f.default !== undefined) v = f.default;
    try {
      const clean = cleanField(f, v, ctx);
      if (f.required && isEmptyValue(f, clean)) throw "Bu alan zorunludur.";
      out[f.key] = clean;
    } catch (msg) {
      errors[f.key] = typeof msg === "string" ? msg : "Geçersiz değer.";
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

/* Metinlerde yalnızca vurgu etiketlerine izin verilir: <em>, <strong>, <br>. Geri kalan her şey kaçışlanır. */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function safeInlineHtml(s) {
  return escapeHtml(s)
    .replace(/&lt;(\/?)(em|strong)&gt;/g, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/g, "<br>")
    .replace(/\n/g, "<br>");
}

return { validate, ValidationError, escapeHtml, safeInlineHtml, isImage, isVideo };
});
