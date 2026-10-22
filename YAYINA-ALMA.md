# Yayına alma, yedekleme ve geri dönüş kılavuzu

Bu belge sitenin gerçek ortama (ör. https://www.kardiascunda.com) alınmasını, günlük yedekleri, geri yüklemeyi ve
sorun çıkarsa önceki sürüme dönüşü adım adım anlatır.

## 1. Barındırma seçimi

Uygulama Node.js + SQLite (tek dosya veritabanı) + yüklenen fotoğraflardan oluşur. Üçünün de **kalıcı bir diskte**
durması gerekir. Ücretsiz planların çoğu kalıcı disk vermez ya da uygulamayı uyutur; rezervasyon alan bir site için uygun değildir.

| | Render (önerilen) | Railway | VPS (ör. Hetzner) |
|---|---|---|---|
| Kurulum | `render.yaml` hazır, panelden birkaç tık | Dockerfile ile, disk elle eklenir | Sunucu, güvenlik duvarı, HTTPS, güncellemeler sizde |
| Kalıcı disk | Var (ücretli planlarda); günlük disk anlık görüntüsü | Var (volume) | Var |
| HTTPS + alan adı | Otomatik sertifika | Otomatik sertifika | Caddy/nginx ile siz kurarsınız |
| Uyku | Ücretli planda yok (ücretsiz plan 15 dk sonra uyur, disk yok) | Kullanım bazlı | Yok |
| Yaklaşık maliyet* | Starter ~7 $/ay + disk ~0,25 $/GB | Hobby 5 $/ay (5 $ kullanım dahil) | ~6 €/ay'dan başlar |
| İşletme sahibi için | En kolay | Kolay | Teknik bilgi ister |

\* Fiyatlar değişebilir; satın almadan önce sağlayıcının güncel fiyat sayfasına bakın.
Bu kılavuzdaki komutlar Render içindir; Railway'de aynı Dockerfile kullanılır, disk `/data` yoluna bağlanır.

**Not:** Diskli serviste yeni sürüm yüklenirken site birkaç saniye erişilemez (disk aynı anda iki sürüme bağlanamaz).

## 2. İlk kurulum (Render)

1. Kodu GitHub'a gönderin (bu dal: `yayina-hazirlik`).
2. Render → **New → Blueprint** → depoyu seçin. `render.yaml` servisi (Frankfurt, Docker, `/data` diski 1 GB,
   sağlık denetimi `/healthz`) tanımlar. Plan ücretlidir; onaylamadan önce fiyatı kontrol edin.
3. İlk açılışta veritabanı boşsa içerik `data/admin-db.json`'dan (GitHub Pages kopyası) otomatik yüklenir.
4. Render → servis → **Shell**:
   ```
   setpriv --reuid=node --regid=node --init-groups npm run create-admin -- <tahmini-zor-kullanici-adi>
   ```
   Ekrana yazılan parolayı saklayın, ilk girişte **Hesabım**'dan değiştirin. (`setpriv` komutu, dosyaların uygulamanın
   kullanıcısına ait kalmasını sağlar.)
5. Geçici adreste (…onrender.com) **Bölüm 5**'teki kontrolleri yapın.

Ortam değişkenleri Dockerfile'da hazırdır: `NODE_ENV=production`, `HOST=0.0.0.0`, `DATA_DIR=/data`,
`COOKIE_SECURE=always`, `TRUST_PROXY=1` (Render'ın önündeki proxy için), `BACKUP_INTERVAL_HOURS=24`, `BACKUP_KEEP=14`.
**Önünde proxy olmayan bir sunucuda (ev bilgisayarı, doğrudan açılmış VPS portu) `TRUST_PROXY` vermeyin**: ziyaretçiler
IP adreslerini taklit edip deneme sınırlarını aşabilir.

## 3. Panelden yapılacaklar (yayından önce)

- **E-posta gönderimi:** Gmail + uygulama şifresi girin, deneme e-postası gönderin. SMTP yokken yayında parola sıfırlama
  çalışmaz (bunu açıkça söyler) ve güvenlik uyarıları gitmez.
- **Hesabım:** doğrulanmış e-posta ekleyin.
- **KVKK aydınlatma metni:** ticari unvan, başvuru e-postası, barındırma hizmeti ve ülkesi (ör. "Render Services, Inc. —
  Frankfurt, Almanya"), saklama süresi. Metni bir hukukçuya kontrol ettirin.
- **Telefon & WhatsApp / Adres:** numaraları ve e-postayı kontrol edin.
- **Misafir yorumları ve puan:** yalnızca gerçek ve doğrulanabilir yorumlar kalsın; puan Google'daki güncel puanla aynı olsun.
- **SEO:** "Sitenin gerçek adresi" doğru olsun; alan adı bağlanıp HTTPS doğrulanınca "Arama motorlarından gizle"yi kapatın.

## 4. Alan adı ve HTTPS

1. Alan adını satın alın (kayıt firması: ör. Natro, İsimtescil, Cloudflare Registrar).
2. Render → servis → **Settings → Custom Domains** → `www.kardiascunda.com` ve `kardiascunda.com` ekleyin.
3. Kayıt firmasının DNS panelinde Render'ın gösterdiği kayıtları girin (genellikle `www` için CNAME, kök alan için A/ALIAS).
4. Render sertifikayı otomatik alır. Kontrol: `curl -I https://www.kardiascunda.com` → `200`, yanıt başlıklarında
   `strict-transport-security` bulunmalı.

## 5. Yayın öncesi / sonrası kontrol listesi

- [ ] `https://<adres>/healthz` → `ok`
- [ ] Ana sayfa, menü, galeri, odalar telefonda ve bilgisayarda düzgün
- [ ] `/kvkk` açılıyor, bilgiler doğru; formlarda bağlantısı var
- [ ] Panel girişi/çıkışı çalışıyor; girişsiz `/api/admin/reservations` → 401
- [ ] Deneme rezervasyonu → panelde görünüyor → WhatsApp mesajı doğru numaraya, doğru içerikle açılıyor → deneme kaydını silin
- [ ] `/package.json`, `/server/app.js`, `/storage/kardias.db`, `/.env` → 404
- [ ] `https://<adres>/robots.txt` yayında `Disallow: /admin/` gösteriyor; `/sitemap.xml` açılıyor
- [ ] Servisi panelden yeniden başlatın → içerik ve deneme rezervasyonu duruyor (disk kalıcı)
- [ ] Panel → Genel bakış: "Son otomatik yedek" uyarısı yok (ilk yedek açılıştan 1 dakika sonra alınır)

## 6. Yedekleme

- **Otomatik:** sunucu her 24 saatte bir `/data/backups/yedek-…` klasörüne tutarlı bir yedek alır (veritabanı
  `VACUUM INTO` ile + yüklenen dosyalar + `manifest.json`), yedeği hemen doğrular ve en yeni 14 tanesini saklar.
  Yedek alınamazsa güvenlik kayıtlarına "alert" düşer ve o gece saklama süresi temizliği yapılmaz.
- **Render disk anlık görüntüsü:** günlük, en az 7 gün. Render, veritabanlarını anlık görüntüden geri yüklemeyi önermez;
  bu yüzden asıl geri dönüş kaynağı yukarıdaki yedeklerdir (anlık görüntü onları da içerir).
- **Sunucu dışı kopya (haftalık, elle):** Panel → Genel bakış → "Veritabanı yedeğini indir". İnen `.db` dosyası parola
  özetleri ve misafir bilgileri içerir: şifreli bir klasörde ya da şifreli bulut depolamada saklayın, kimseyle paylaşmayın.
  Fotoğrafların kopyası ayrıca `npm run export-static` ile GitHub'daki `static/uploads/` klasöründedir.
- **Elle yedek:** `npm run backup` (sunucu çalışırken de güvenli). Doğrulama: `npm run backup -- verify <klasör>`.

## 7. Geri yükleme

1. Servisi durdurun (Render: **Suspend**) ya da yerelde sunucuyu kapatın.
2. `npm run backup -- verify /data/backups/yedek-…` → "Yedek sağlam."
3. `npm run backup -- restore /data/backups/yedek-… --onay`
   Mevcut veritabanı ve yüklemeler **silinmez**, `/data/geri-yukleme-oncesi-…` klasörüne taşınır.
4. Servisi başlatın, siteyi ve paneli kontrol edin.

İndirilen bir `.db` dosyasından dönmek için: dosyayı `kardias.db` adıyla boş bir klasöre koyup `DATA_DIR` olarak verin
ya da sunucuda `/data/kardias.db` yerine koyun (önce mevcut `kardias.db*` dosyalarını kenara taşıyın).

Bu prosedür otomatik testlerde (`tests/launch.test.js`) ayrı bir veri klasöründe denenir.

## 8. Önceki sürüme dönüş (kod)

- Render → servis → **Deploys** → önceki başarılı dağıtımda **Rollback**. Disk (veriler) etkilenmez.
- Yeni sürüm veritabanına yalnızca **ekleme** yapar (yeni sütun/ayar); eski sürüm bu veritabanıyla çalışmaya devam eder.
- Kod geçmişi GitHub'dadır; `git revert` ile geri alınabilir.
- Dağıtımdan önce panelden yedek indirmek iyi bir alışkanlıktır.

## 9. İçerik aktarımı (GitHub Pages ↔ sunucu)

- **GitHub → sunucu:** `npm run import-static` (önizleme) → `npm run import-static -- --uygula`. Önce otomatik yedek alır;
  rezervasyon, kullanıcı ve güvenlik kayıtlarına dokunmaz; kimlikleri korur.
- **Sunucu → GitHub:** `npm run export-static`. GitHub kopyasında veritabanında olmayan bir kayıt varsa **durur**
  (eskiden siliyordu). `static/uploads` klasörünü artık silmez.
- Sunucu yayına girince içeriği **yalnızca sunucudaki panelden** düzenleyin; GitHub Pages panelini kullanmayın
  (iki ayrı kopya birbirinin üzerine yazar).

## 10. Ev bilgisayarından yayın (önerilmez)

Kesinti (elektrik, internet, Windows güncellemesi), ev ağının internete açılması ve bilgisayar çalınırsa verinin gitmesi
riskleri vardır. Zorunluysa: port yönlendirmesi yapmayın, Cloudflare Tunnel kullanın, `HOST=127.0.0.1` (varsayılan)
bırakın; uygulamaya yalnızca tünel eriştiği için bu durumda `TRUST_PROXY=1` doğrudur. Ayrıca `NODE_ENV=production`,
`COOKIE_SECURE=always` verin, uyku modunu kapatın, diski BitLocker ile şifreleyin ve yedekleri başka bir cihaza alın.
