/* Veritabanı erişimi: içerik kayıtları, ayarlar, metinler */
const { ENTITIES, SETTINGS, SETTING_FIELDS, columnsOf, JSON_TYPES } = require("./schema");
const { validate, ValidationError } = require("./validate");
const { q, tx } = require("./db");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function entityDef(type) {
  const def = Object.prototype.hasOwnProperty.call(ENTITIES, type) ? ENTITIES[type] : null;
  if (!def) throw new HttpError(404, "Bilinmeyen içerik türü.");
  return def;
}

// Veritabanı satırı → API nesnesi
function rowToObj(def, row) {
  const o = { id: row.id, sort: row.sort, active: !!row.active, updatedAt: row.updated_at || row.created_at };
  for (const f of def.fields) {
    if (f.type === "i18n" || f.type === "i18ntext") o[f.key] = { tr: row[f.key + "_tr"] || "", en: row[f.key + "_en"] || "" };
    else if (f.type === "ref") o[f.key] = row[f.key + "_id"] ?? null;
    else if (f.type === "bool") o[f.key] = !!row[f.key];
    else if (JSON_TYPES.has(f.type)) o[f.key] = row[f.key] ? JSON.parse(row[f.key]) : [];
    else o[f.key] = row[f.key] ?? (f.type === "int" || f.type === "number" || f.type === "money" ? null : "");
  }
  return o;
}

// Temiz nesne → sütun/değer çiftleri
function objToCols(def, data) {
  const cols = {};
  for (const f of def.fields) {
    if (!(f.key in data)) continue;
    const v = data[f.key];
    if (f.type === "i18n" || f.type === "i18ntext") { cols[f.key + "_tr"] = v.tr; cols[f.key + "_en"] = v.en; }
    else if (f.type === "ref") cols[f.key + "_id"] = v;
    else if (f.type === "bool") cols[f.key] = v ? 1 : 0;
    else if (JSON_TYPES.has(f.type)) cols[f.key] = JSON.stringify(v);
    else cols[f.key] = v;
  }
  return cols;
}

function makeRepo(db) {
  const refExists = (entity, id) => !!db.prepare(`SELECT 1 FROM ${q(ENTITIES[entity].table)} WHERE id = ?`).get(id);

  function checkUnique(def, data, id) {
    const errors = {};
    for (const f of def.fields) {
      if (!f.unique || !data[f.key]) continue;
      const col = columnsOf(f)[0][0];
      const hit = db.prepare(`SELECT id FROM ${q(def.table)} WHERE ${q(col)} = ? AND id != ?`).get(data[f.key], id || 0);
      if (hit) errors[f.key] = "Bu değer başka bir kayıtta kullanılıyor.";
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
  }

  function checkSelfRef(type, def, data, id) {
    for (const f of def.fields) {
      if (f.type === "ref" && f.entity === type && data[f.key] === id) {
        throw new ValidationError({ [f.key]: "Bir kayıt kendisini seçemez." });
      }
    }
  }

  const parentField = def => def.parent ? def.fields.find(f => f.key === def.parent) : null;

  return {
    list(type, { parent, activeOnly } = {}) {
      const def = entityDef(type), pf = parentField(def);
      const where = [], args = [];
      if (pf && parent != null && parent !== "") { where.push(`${q(pf.key + "_id")} = ?`); args.push(Number(parent)); }
      if (activeOnly) where.push("active = 1");
      // Üst kayda bağlı türlerde (ör. kategoriler → bölüm) tüm liste gruplar hâlinde sıralanır
      const order = pf ? `${q(pf.key + "_id")}, sort, id` : "sort, id";
      const sql = `SELECT * FROM ${q(def.table)}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${order}`;
      return db.prepare(sql).all(...args).map(r => rowToObj(def, r));
    },

    get(type, id) {
      const def = entityDef(type);
      const row = db.prepare(`SELECT * FROM ${q(def.table)} WHERE id = ?`).get(Number(id));
      if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
      return rowToObj(def, row);
    },

    create(type, input) {
      const def = entityDef(type);
      const data = validate(def.fields, input, { refExists });
      checkUnique(def, data);
      const cols = objToCols(def, data);
      const pf = parentField(def);
      // Yeni kayıt, kendi grubunun (ör. aynı kategorinin) sonuna eklenir
      const sortRow = pf
        ? db.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${q(def.table)} WHERE ${q(pf.key + "_id")} IS ?`).get(cols[pf.key + "_id"])
        : db.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${q(def.table)}`).get();
      cols.sort = sortRow.n;
      cols.active = input.active === false ? 0 : 1;
      const names = Object.keys(cols);
      const info = db.prepare(`INSERT INTO ${q(def.table)} (${names.map(q).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
        .run(...names.map(n => cols[n]));
      return this.get(type, info.lastInsertRowid);
    },

    update(type, id, input) {
      const def = entityDef(type);
      this.get(type, id);
      const data = validate(def.fields, input, { refExists });
      checkSelfRef(type, def, data, Number(id));
      checkUnique(def, data, Number(id));
      const cols = objToCols(def, data);
      if (typeof input.active === "boolean") cols.active = input.active ? 1 : 0;
      const names = Object.keys(cols);
      db.prepare(`UPDATE ${q(def.table)} SET ${names.map(n => `${q(n)} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
        .run(...names.map(n => cols[n]), Number(id));
      return this.get(type, id);
    },

    setActive(type, id, active) {
      const def = entityDef(type);
      if (typeof active !== "boolean") throw new ValidationError({ active: "Evet/Hayır değeri bekleniyor." });
      const info = db.prepare(`UPDATE ${q(def.table)} SET active = ?, updated_at = datetime('now') WHERE id = ?`).run(active ? 1 : 0, Number(id));
      if (!info.changes) throw new HttpError(404, "Kayıt bulunamadı.");
      return this.get(type, id);
    },

    remove(type, id) {
      const def = entityDef(type);
      this.get(type, id);
      try {
        db.prepare(`DELETE FROM ${q(def.table)} WHERE id = ?`).run(Number(id));
      } catch (e) {
        if (/FOREIGN KEY/i.test(e.message)) {
          throw new HttpError(409, "Bu kayda bağlı başka kayıtlar var (ör. kategorideki ürünler). Önce onları silin ya da başka yere taşıyın.");
        }
        throw e;
      }
    },

    reorder(type, ids) {
      const def = entityDef(type);
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(x => !Number.isInteger(x))) {
        throw new ValidationError({}, "Geçersiz sıralama.");
      }
      const stmt = db.prepare(`UPDATE ${q(def.table)} SET sort = ? WHERE id = ?`);
      tx(db, () => ids.forEach((id, i) => stmt.run(i, id)));
    },

    /* --- Ayarlar --- */
    getSettings() {
      const out = {};
      for (const row of db.prepare("SELECT key, value FROM settings").all()) {
        if (SETTING_FIELDS[row.key]) out[row.key] = JSON.parse(row.value);
      }
      return out;
    },
    saveSettings(group, input) {
      const g = SETTINGS.find(x => x.group === group);
      if (!g) throw new HttpError(404, "Bilinmeyen ayar grubu.");
      const data = validate(g.fields, input);
      const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      tx(db, () => Object.entries(data).forEach(([k, v]) => stmt.run(k, JSON.stringify(v))));
      return this.getSettings();
    },

    /* --- Metinler --- */
    getTexts() {
      return db.prepare("SELECT key, tr, en FROM texts ORDER BY key").all().map(r => ({ key: r.key, tr: r.tr, en: r.en }));
    },
    saveText(key, input) {
      const exists = db.prepare("SELECT 1 FROM texts WHERE key = ?").get(key);
      if (!exists) throw new HttpError(404, "Metin bulunamadı.");
      const data = validate([{ key: "value", type: "i18ntext", required: true, max: 2000 }], { value: input });
      db.prepare("UPDATE texts SET tr = ?, en = ? WHERE key = ?").run(data.value.tr, data.value.en, key);
      return { key, ...data.value };
    }
  };
}

module.exports = { makeRepo, HttpError, entityDef, rowToObj, objToCols };
