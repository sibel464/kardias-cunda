/* İçerik şeması — veritabanı tabloları, doğrulama ve yönetim paneli formları buradan üretilir.
   Alan türleri:
     text, textarea, slug, url, email, tel, digits, time   → metin
     i18n, i18ntext                                         → { tr, en } (Türkçe zorunlu olabilir, İngilizce isteğe bağlı)
     int, number, money, bool, select, tags                 → sayı / seçim
     image, media, images                                   → yüklenen görsel/video yolu (Medya kütüphanesinden)
     i18nlist                                               → [{ tr, en }, …] satır listesi
     prices                                                 → [{ label: { tr, en }, price }, …]
     ref                                                    → başka bir tablodaki kayıt (id) */
// Hem sunucuda (require) hem tarayıcıda (GitHub Pages paneli: window.KardiasSchema) çalışır
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KardiasSchema = factory();
})(typeof self !== "undefined" ? self : this, function () {

const TAGS = ["favori", "vejetaryen", "vegan", "acili", "glutensiz", "sef"];
const TAG_LABELS = { favori: "Favori", vejetaryen: "Vejetaryen", vegan: "Vegan", acili: "Acılı", glutensiz: "Glutensiz", sef: "Şefin önerisi" };
const RATIOS = ["auto", "3:4", "2:3", "1:1", "4:3", "3:2", "16:9"];

const ENTITIES = {
  sections: {
    table: "menu_sections", label: "Menü bölümleri", single: "Bölüm", title: "name", group: "Menü",
    help: "Menünün ana bölümleri (ör. Mutfak, Bar). Kategoriler bu bölümlere bağlanır.",
    fields: [
      { key: "name", type: "i18n", label: "Ad", required: true, max: 60 },
      { key: "slug", type: "slug", label: "Kısa ad (sayfa adresi için)", required: true, unique: true, help: "Küçük harf, rakam ve tire. Ör: mutfak" },
      { key: "desc", type: "i18n", label: "Açıklama", max: 200 }
    ]
  },
  categories: {
    table: "menu_categories", label: "Menü kategorileri", single: "Kategori", title: "name", group: "Menü",
    parent: "section", image: "image",
    fields: [
      { key: "section", type: "ref", entity: "sections", label: "Bölüm", required: true, onDelete: "RESTRICT" },
      { key: "name", type: "i18n", label: "Ad", required: true, max: 60 },
      { key: "slug", type: "slug", label: "Kısa ad (sayfa adresi için)", required: true, unique: true, help: "Ör: pizza → site adresi #menu/pizza olur" },
      { key: "image", type: "image", label: "Kapak görseli", required: true },
      { key: "note", type: "i18n", label: "Kategori notu", max: 300, help: "Kategori sayfasında başlığın altında görünür (ör. pişirme süresi)." },
      { key: "pair", type: "ref", entity: "categories", label: "“Yanına yakışır” önerilen kategori", onDelete: "SET NULL" }
    ]
  },
  items: {
    table: "menu_items", label: "Yiyecek & içecekler", single: "Ürün", title: "name", group: "Menü",
    parent: "category", image: "image", subtitle: "price",
    fields: [
      { key: "category", type: "ref", entity: "categories", label: "Kategori", required: true, onDelete: "RESTRICT" },
      { key: "name", type: "i18n", label: "Ürün adı", required: true, max: 80 },
      { key: "desc", type: "i18ntext", label: "Açıklama", max: 500 },
      { key: "image", type: "image", label: "Fotoğraf", help: "Boş bırakılırsa kategorinin kapak görseli kullanılır." },
      { key: "price", type: "money", label: "Fiyat", help: "Tek fiyat. Birden fazla seçenek varsa aşağıdaki “Fiyat seçenekleri”ni kullanın." },
      { key: "prices", type: "prices", label: "Fiyat seçenekleri", help: "Ör: Kadeh / Şişe, 35 cl / 70 cl" },
      { key: "priceText", type: "i18n", label: "Fiyat yerine metin", max: 40, help: "Ör: “Günlük fiyat”. Doluysa sayısal fiyatın yerine gösterilir." },
      { key: "tags", type: "tags", label: "Etiketler", options: TAGS, optionLabels: TAG_LABELS },
      { key: "soldOut", type: "bool", label: "Bugün yok", help: "İşaretliyse ürün menüde soluk ve “Bugün yok” etiketiyle görünür; tamamen kaldırmak için “Sitede göster”i kapatın." },
      { key: "group", type: "i18n", label: "Alt başlık", max: 60, help: "Kategori içinde gruplama için (ör. Kırmızı şaraplar). Aynı alt başlığa sahip ürünler art arda sıralanmalı." },
      { key: "meta", type: "text", label: "Küçük bilgi satırı", max: 80, help: "Ör: Urla · Kadeh 15 cl" }
    ]
  },
  setmenus: {
    table: "set_menus", label: "Fiks menüler", single: "Fiks menü", title: "title", group: "Menü",
    help: "Menü bölümünün altındaki öne çıkan fiks menü kutusu. Sitede sıradaki ilk aktif menü gösterilir.",
    subtitle: "price",
    fields: [
      { key: "title", type: "i18n", label: "Başlık", required: true, max: 80 },
      { key: "desc", type: "i18ntext", label: "Açıklama", max: 400 },
      { key: "items", type: "i18nlist", label: "Menüdekiler", max: 120 },
      { key: "price", type: "money", label: "Fiyat" },
      { key: "per", type: "i18n", label: "Fiyat birimi", max: 40, help: "Ör: kişi başı" }
    ]
  },
  rooms: {
    table: "rooms", label: "Konaklama odaları", single: "Oda", title: "name", group: "İçerik",
    help: "Konaklama bölümünde oda kartları olarak görünür; rezervasyon formunda oda seçimi olarak da çıkar.",
    image: "images", subtitle: "price",
    fields: [
      { key: "name", type: "i18n", label: "Oda adı", required: true, max: 80 },
      { key: "desc", type: "i18ntext", label: "Açıklama", max: 800 },
      { key: "images", type: "images", label: "Fotoğraflar", required: true, max: 12, help: "İlk fotoğraf kapak olur." },
      { key: "capacity", type: "int", label: "Kişi kapasitesi", min: 1, max: 20 },
      { key: "size", type: "text", label: "Büyüklük", max: 30, help: "Ör: 24 m²" },
      { key: "view", type: "i18n", label: "Manzara", max: 60, help: "Ör: Deniz manzaralı" },
      { key: "features", type: "i18nlist", label: "Özellikler", max: 80 },
      { key: "price", type: "money", label: "Gecelik fiyat", help: "Boş bırakılırsa sitede fiyat görünmez. “Rezervasyon ayarları → Oda fiyatlarını sitede göster” ile topluca gizlenebilir." },
      { key: "priceNote", type: "i18n", label: "Fiyat notu", max: 60, help: "Ör: gecelik, kahvaltı dahil" }
    ]
  },
  events: {
    table: "events", label: "Etkinlikler", single: "Etkinlik", title: "title", group: "İçerik",
    image: "image",
    fields: [
      { key: "title", type: "i18n", label: "Başlık", required: true, max: 80 },
      { key: "when", type: "i18n", label: "Zaman / kısa bilgi", max: 80, help: "Ör: Cuma & Cumartesi · 21:00" },
      { key: "desc", type: "i18ntext", label: "Açıklama", max: 400 },
      { key: "image", type: "image", label: "Görsel", required: true }
    ]
  },
  gallery: {
    table: "gallery", label: "Fotoğraf & video galerisi", single: "Galeri öğesi", title: "caption", group: "İçerik",
    image: "media",
    fields: [
      { key: "media", type: "media", label: "Fotoğraf veya video", required: true },
      { key: "poster", type: "image", label: "Video kapak görseli", help: "Yalnızca video için. Boşsa videonun ilk karesi gösterilir." },
      { key: "caption", type: "i18n", label: "Açıklama", max: 120 },
      { key: "ratio", type: "select", label: "En-boy oranı", options: RATIOS, default: "auto", help: "“auto”: dosyanın kendi oranı." }
    ]
  },
  reviews: {
    table: "reviews", label: "Misafir yorumları", single: "Yorum", title: "name", group: "İçerik",
    subtitle: "rating",
    fields: [
      { key: "name", type: "text", label: "Misafir adı", required: true, max: 60 },
      { key: "rating", type: "int", label: "Puan (1–5)", required: true, min: 1, max: 5, default: 5 },
      { key: "text", type: "textarea", label: "Yorum", required: true, max: 1000 },
      { key: "date", type: "date", label: "Yorum tarihi", help: "Yorumun Google'da yazıldığı tarih. Sitede ay ve yıl olarak görünür." },
      { key: "source", type: "text", label: "Kaynak", max: 40, default: "Google" }
    ]
  },
  credits: {
    table: "credits", label: "Fotoğraf künyesi", single: "Künye", title: "title", group: "İçerik",
    help: "Footer'daki “Fotoğraf künyesi” listesi. Lisanslı fotoğrafları kullandıkça kaldırmayın.",
    fields: [
      { key: "title", type: "text", label: "Dosya / eser adı", required: true, max: 160 },
      { key: "url", type: "url", label: "Kaynak bağlantısı" },
      { key: "author", type: "text", label: "Sahibi", max: 120 },
      { key: "license", type: "text", label: "Lisans", max: 60 }
    ]
  }
};

const SETTINGS = [
  {
    group: "contact", label: "Telefon & WhatsApp",
    fields: [
      { key: "phone", type: "tel", label: "Telefon (arama bağlantısı)", required: true, help: "Ülke koduyla: +902663271965" },
      { key: "phoneDisplay", type: "text", label: "Telefon (görünen)", required: true, max: 30, help: "Ör: 0266 327 19 65" },
      { key: "phone2", type: "tel", label: "İkinci telefon (arama bağlantısı)", help: "Rezervasyon bölümündeki ikinci “Bizi arayın” kutusu. Boş bırakılırsa kutu gizlenir. Ör: +905324112938" },
      { key: "phone2Display", type: "text", label: "İkinci telefon (görünen)", max: 30, help: "Ör: 0532 411 29 38" },
      { key: "whatsapp", type: "digits", label: "WhatsApp numarası", required: true, help: "Ülke koduyla, + ve boşluk olmadan: 905xxxxxxxxx" },
      { key: "email", type: "email", label: "E-posta" }
    ]
  },
  {
    group: "address", label: "Adres & konum",
    fields: [
      { key: "addressStreet", type: "text", label: "Adres (1. satır)", required: true, max: 120 },
      { key: "addressCity", type: "text", label: "Adres (2. satır)", required: true, max: 120 },
      { key: "postalCode", type: "text", label: "Posta kodu", max: 10 },
      { key: "mapsQuery", type: "text", label: "Google Haritalar araması", required: true, max: 160, help: "Harita, yol tarifi ve “Google'da değerlendir” bağlantıları bununla oluşturulur." },
      { key: "lat", type: "number", label: "Enlem", min: -90, max: 90, help: "Gün batımı saati hesabı için" },
      { key: "lng", type: "number", label: "Boylam", min: -180, max: 180 }
    ]
  },
  {
    group: "hours", label: "Çalışma saatleri",
    help: "Sitede yazan saat metni “Metinler → c.hoursv / info.hours” alanlarındadır.",
    fields: [
      { key: "openTime", type: "time", label: "Açılış", required: true },
      { key: "closeTime", type: "time", label: "Kapanış", required: true, help: "Gece yarısı için 00:00" },
      { key: "firstBooking", type: "time", label: "İlk rezervasyon saati", required: true },
      { key: "lastBooking", type: "time", label: "Son rezervasyon saati", required: true }
    ]
  },
  {
    group: "reservation", label: "Rezervasyon ayarları",
    fields: [
      { key: "typeStreet", type: "bool", label: "Sokak masası rezervasyonu açık" },
      { key: "typeTerrace", type: "bool", label: "Teras masası rezervasyonu açık" },
      { key: "typeStay", type: "bool", label: "Konaklama rezervasyonu açık" },
      { key: "showRoomPrices", type: "bool", label: "Oda fiyatlarını sitede göster", help: "Açıkken fiyat girilen odalarda gecelik fiyat görünür. Menü fiyatlarından bağımsızdır." },
      { key: "sendWhatsapp", type: "bool", label: "Kayıttan sonra WhatsApp mesajı da açılsın", help: "Kapalıysa talep yalnızca panele düşer, misafire “talebiniz alındı” mesajı gösterilir." }
    ]
  },
  {
    group: "social", label: "Sosyal medya",
    help: "Boş bırakılan hesaplar sitede gösterilmez.",
    fields: [
      { key: "instagram", type: "url", label: "Instagram" },
      { key: "facebook", type: "url", label: "Facebook" },
      { key: "tiktok", type: "url", label: "TikTok" },
      { key: "youtube", type: "url", label: "YouTube" },
      { key: "tripadvisor", type: "url", label: "Tripadvisor" }
    ]
  },
  {
    group: "menu", label: "Menü ayarları",
    fields: [
      { key: "showPrices", type: "bool", label: "Fiyatları sitede göster", help: "Kapalıyken menüde ve fiks menüde fiyat görünmez; fiyatlar silinmez. Oda fiyatları “Rezervasyon ayarları”ndan yönetilir." },
      { key: "currency", type: "text", label: "Para birimi", required: true, max: 5 }
    ]
  },
  {
    group: "reviews", label: "Yorum puanı",
    fields: [
      { key: "ratingScore", type: "number", label: "Ortalama puan", min: 0, max: 5 },
      { key: "showRating", type: "bool", label: "Puan kutusunu göster" },
      { key: "showSampleNote", type: "bool", label: "“Örnek içerik” notunu göster" }
    ]
  },
  {
    group: "images", label: "Site görselleri",
    fields: [
      { key: "logo", type: "image", label: "Logo", help: "Üst menüde ve sayfa altında yuvarlak olarak görünür. Kare (ör. 512×512) bir görsel yükleyin; boşsa varsayılan Kardias logosu kullanılır." },
      { key: "heroImage", type: "image", label: "Giriş (hero) görseli", required: true },
      { key: "storyImage", type: "image", label: "Hikâyemiz — 1. fotoğraf", required: true },
      { key: "storyInset", type: "image", label: "Hikâyemiz — 2. fotoğraf", required: true },
      { key: "storyThird", type: "image", label: "Hikâyemiz — 3. fotoğraf", required: true },
      { key: "stayImage", type: "image", label: "Konaklama — büyük görsel", required: true },
      { key: "stayInset", type: "image", label: "Konaklama — küçük görsel", required: true }
    ]
  },
  {
    group: "notice", label: "Duyuru şeridi",
    help: "Sitenin girişinde, büyük başlığın üstünde küçük turuncu bir şerit olarak görünür.",
    fields: [
      { key: "noticeOn", type: "bool", label: "Duyuruyu göster" },
      { key: "noticeText", type: "i18n", label: "Duyuru metni", max: 120, help: "Ör: Bu akşam 21:00'de canlı müzik!" },
      { key: "noticeLink", type: "link", label: "Bağlantı (isteğe bağlı)", help: "Tıklanınca gidilecek yer: bir web adresi (https://…) ya da sayfadaki bir bölüm (#menu, #etkinlikler, #konaklama, #rezervasyon)." }
    ]
  },
  {
    group: "sections", label: "Bölümleri göster / gizle",
    help: "Kapatılan bölüm sitede görünmez ve üst menüdeki bağlantısı kalkar. İçerik silinmez; tekrar açınca geri gelir.",
    fields: [
      { key: "showStory", type: "bool", label: "Hikâyemiz", default: true },
      { key: "showMenu", type: "bool", label: "Menü", default: true },
      { key: "showEvents", type: "bool", label: "Etkinlikler", default: true },
      { key: "showGallery", type: "bool", label: "Galeri", default: true },
      { key: "showStay", type: "bool", label: "Konaklama", default: true },
      { key: "showReviews", type: "bool", label: "Yorumlar", default: true },
      { key: "showReservation", type: "bool", label: "Rezervasyon", default: true },
      { key: "showContact", type: "bool", label: "İletişim & konum", default: true }
    ]
  },
  {
    group: "ribbons", label: "Kayan yazılar",
    fields: [
      { key: "ribbonA", type: "i18nlist", label: "Galeri üstündeki şerit", max: 60 },
      { key: "ribbonB", type: "i18nlist", label: "Rezervasyon üstündeki şerit", max: 60 }
    ]
  },
  {
    group: "seo", label: "Arama motorları (SEO)",
    fields: [
      { key: "siteTitle", type: "text", label: "Sayfa başlığı", required: true, max: 120 },
      { key: "siteDescription", type: "textarea", label: "Sayfa açıklaması", required: true, max: 300 },
      { key: "siteUrl", type: "url", label: "Sitenin gerçek adresi", help: "Ör: https://www.kardiascunda.com" },
      { key: "noindex", type: "bool", label: "Arama motorlarından gizle (önizleme modu)", help: "Gerçek yayına geçince kapatın." }
    ]
  }
];

const SETTING_FIELDS = Object.fromEntries(SETTINGS.flatMap(g => g.fields.map(f => [f.key, f])));

// Bir alanın veritabanındaki sütunları
function columnsOf(f) {
  switch (f.type) {
    case "i18n": case "i18ntext": return [[f.key + "_tr", "TEXT"], [f.key + "_en", "TEXT"]];
    case "int": case "bool": return [[f.key, "INTEGER"]];
    case "number": case "money": return [[f.key, "REAL"]];
    case "ref": return [[f.key + "_id", "INTEGER"]];
    default: return [[f.key, "TEXT"]];
  }
}

const JSON_TYPES = new Set(["tags", "i18nlist", "prices", "images"]);

return { ENTITIES, SETTINGS, SETTING_FIELDS, TAGS, columnsOf, JSON_TYPES };
});
