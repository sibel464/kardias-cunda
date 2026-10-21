# Kardias Cunda — web sitesi ve yönetim paneli

Sitedeki tüm içerik (menü, fiyatlar, odalar, etkinlikler, galeri, yorumlar, iletişim bilgileri, metinler)
**yönetim panelinden** eklenir, düzenlenir ve silinir. Değişiklikler veritabanına kaydedilir ve sayfa
yenilendiği anda sitede görünür.

```
index.html          Sayfa şablonu (tasarım) — metinler panelden gelir
css/style.css       Site tasarımı
js/main.js          Site davranışları (menü, galeri, rezervasyon formu…)
js/i18n.js          Arayüz metinleri (düğmeler, uyarılar)
admin/              Yönetim paneli (/admin)
server/             Sunucu: API, veritabanı, yetkilendirme, dosya yükleme
  schema.js         İçerik türleri ve alanları — panel formları buradan üretilir
storage/            Veritabanı (kardias.db) ve yüklenen dosyalar (uploads/) — YEDEKLEYİN
tests/              Otomatik testler
data/menu.json      Yalnızca ilk kurulumda veritabanına aktarılan eski menü
data/site.json      GitHub Pages önizlemesi için içerik kopyası (npm run export-static üretir)
static/uploads/     Önizleme için yüklenmiş fotoğrafların kopyası
```

## Çalıştırma

Node.js 22.13 veya üstü gerekir (24 önerilir).

    npm install
    npm run create-admin -- yonetici      # ilk yönetici hesabı; parola ekrana yazılır
    npm run reset-password -- yonetici    # parola unutulduysa ve e-postayla sıfırlanamıyorsa: yeni parola ekrana yazılır
    npm start                             # http://localhost:3000  ·  panel: http://localhost:3000/admin/

İlk çalıştırmada veritabanı otomatik oluşturulur ve sitenin mevcut içeriği (100 ürün, galeri, yorumlar,
etkinlikler, metinler) içine aktarılır.

## Panelde neler var

- **Menü:** yiyecek & içecekler, kategoriler, bölümler (Mutfak/Bar), fiks menüler; fiyatları göster/gizle;
  “Bugün yok” işareti; kayıt kopyalama
- **Duyuru şeridi** ve **bölümleri göster/gizle** (galeri, konaklama vb.)
- **İçerik:** konaklama odaları, etkinlikler, fotoğraf & video galerisi, misafir yorumları ve puan,
  sayfa metinleri (TR/EN), site görselleri, kayan yazılar, fotoğraf künyesi
- **İletişim & rezervasyon:** telefon, WhatsApp, e-posta, adres, harita, çalışma saatleri,
  rezervasyon türleri, sosyal medya hesapları
- **Rezervasyonlar:** sitedeki formdan gelen talepler; durum (yeni/onaylandı/tamamlandı/iptal) ve iç not
- **Medya kütüphanesi:** görsel (JPG, PNG, WEBP, GIF, AVIF — 15 MB) ve video (MP4, WEBM — 200 MB) yükleme
- Her kayıtta **sıralama** (sürükle-bırak veya oklar) ve **aktif/pasif** (sitede göster/gizle)
- **Kullanıcılar**, parola değiştirme, **Şifremi unuttum** (doğrulanmış e-postaya 6 haneli kod), **Güvenlik kayıtları** (girişler, hatalı denemeler, kilitlenmeler; önemli olaylarda e-posta uyarısı) ve **E-posta gönderimi** (Gmail uygulama şifresi); **SEO** (başlık, açıklama, arama motorlarından gizleme)

## Güvenlik

- Parolalar scrypt ile özetlenir; oturum anahtarı veritabanında yalnızca özet olarak tutulur
- Oturum çerezi `HttpOnly` + `SameSite=Strict`; veri değiştiren her istekte CSRF anahtarı zorunlu
- Hatalı girişte kilit: kullanıcı başına 5, IP başına 20 deneme / 15 dk
- Tüm girdiler sunucuda alan bazında doğrulanır; metinlerde yalnızca `<em>`, `<strong>`, `<br>` geçer
- Yüklenen dosyaların türü uzantıdan değil içeriğinden anlaşılır; SVG/HTML gibi betik taşıyabilen dosyalar reddedilir
- Sitede kullanılan bir dosya silinemez; ürünü olan kategori silinemez
- Rezervasyon formunda bot tuzağı ve IP başına saatlik sınır
- İçerik Güvenlik Politikası (CSP) ve diğer güvenlik başlıkları

## Testler

    npm test

Backend (yetkilendirme, doğrulama, medya, rezervasyon, güvenlik) ve uçtan uca tarayıcı testleri
(Chrome/Edge ile paneli kullanıp sitenin değiştiğini doğrular) çalışır.

## Yayına alma

Bu sürüm bir sunucu (Node.js) ve veritabanı gerektirir; **GitHub Pages yalnızca statik dosya
barındırdığı için paneli çalıştıramaz.** Node.js destekleyen bir sunucuya (VPS, Render, Railway,
Hetzner, cPanel'de Node.js uygulaması vb.) kurun:

- `storage/` klasörü kalıcı bir diskte olmalı (`DATA_DIR` ortam değişkeniyle değiştirilebilir) ve düzenli yedeklenmeli
- Site HTTPS arkasında çalışmalı; bir proxy (Nginx, Cloudflare vb.) arkasındaysa `TRUST_PROXY=1` verin
- Ayarlar: `PORT` (varsayılan 3000), `HOST`, `DATA_DIR`, `COOKIE_SECURE` (auto/always), `SESSION_HOURS` (varsayılan 12), `IDLE_MINUTES` (işlem yapılmazsa otomatik çıkış, varsayılan 60)

## GitHub Pages önizlemesi ve GitHub'ı güncelleme

**Önizleme:** https://sibel464.github.io/kardias-cunda/

GitHub Pages sunucu çalıştıramaz; önizleme, panelde girilen içeriğin sabit bir kopyasını
(`data/site.json` ve `static/uploads/`) gösterir. Orada panel açılmaz; rezervasyon formu WhatsApp ile çalışır.
Panelde içerik değiştirdikten sonra önizlemeyi güncellemek için:

    npm run export-static
    git add -A
    git commit -m "İçerik güncellendi"
    git push

## Gerçek yayına geçmeden önce (panelden)

- **Arama motorları (SEO):** “Arama motorlarından gizle” anahtarını kapatın
- **Yorum puanı:** “Örnek içerik” notunu, gerçek yorumları girdikten sonra kapatın
- **Misafir yorumları / puan:** örnek yorumları gerçek Google yorumlarıyla değiştirin
- **Telefon & WhatsApp:** WhatsApp numarasını kontrol edin
- **Menü ayarları:** fiyatlar hazır olunca “Fiyatları sitede göster”i açın
- Fotoğraf künyesi, Cunda fotoğraflarının lisansı gereğidir; o fotoğrafları kullandıkça kaldırmayın
