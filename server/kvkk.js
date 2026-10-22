/* KVKK aydınlatma metni sayfası (/kvkk). Panel → KVKK aydınlatma metni ayarlarıyla oluşur; sunucu ve
   export-static (GitHub Pages kopyası: kvkk.html) aynı işlevi kullanır. Metin bir hukukçuya kontrol ettirilmelidir. */
const { escapeHtml: e } = require("./validate");

function renderKvkk(s, { isStatic = false } = {}) {
  const owner = s.kvkkLegalName || "Kardias Cunda";
  const address = s.kvkkAddress || [s.addressStreet, s.addressCity].filter(Boolean).join(", ");
  const email = s.kvkkEmail || s.email || "";
  const hosting = s.kvkkHosting || "sitenin barındırıldığı hizmet sağlayıcısı";
  const retention = s.kvkkRetentionDays
    ? `Rezervasyon kayıtları, konaklama ya da masa tarihinden itibaren ${Number(s.kvkkRetentionDays)} gün sonra otomatik olarak silinir.`
    : "Rezervasyon kayıtları, talebin amacı için gerekli olan süre ve ilgili mevzuatta öngörülen süreler boyunca saklanır, sonra silinir.";
  const contact = [
    address && `posta yoluyla <strong>${e(address)}</strong> adresine`,
    email && `e-postayla <a href="mailto:${e(email)}">${e(email)}</a> adresine`
  ].filter(Boolean).join(" ya da ");
  const home = isStatic ? "./" : "/";
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KVKK Aydınlatma Metni · Kardias Cunda</title>
  <meta name="description" content="Kardias Cunda rezervasyon formu kişisel verilerin korunması aydınlatma metni.">
  ${s.noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
  <link rel="icon" type="image/png" href="${home}img/kardias/logo-64.png">
  <style>
    :root { color-scheme: light; --ink: #1f2a30; --muted: #5b6770; --line: #e4e0d8; --accent: #b4532a; }
    body { margin: 0; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: #fbf8f3; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
    h1 { font-size: 1.7rem; line-height: 1.25; margin: 8px 0 4px; }
    h2 { font-size: 1.1rem; margin: 28px 0 6px; }
    p, li { color: var(--ink); } .muted { color: var(--muted); font-size: .92rem; }
    a { color: var(--accent); } ul { padding-left: 22px; }
    .back { display: inline-block; margin-bottom: 12px; text-decoration: none; }
    footer { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 16px; }
  </style>
</head>
<body>
<main>
  <a class="back" href="${home}">← Kardias Cunda ana sayfa</a>
  <h1>Kişisel Verilerin Korunması Aydınlatma Metni</h1>
  <p class="muted">6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) 10. maddesi uyarınca, rezervasyon formu ve WhatsApp üzerinden ilettiğiniz kişisel veriler hakkında bilgilendirme. <span lang="en">English: this page explains how we process the personal data you send through our reservation forms.</span></p>

  <h2>1. Veri sorumlusu</h2>
  <p><strong>${e(owner)}</strong>${address ? `, ${e(address)}` : ""}.</p>

  <h2>2. Hangi verileri işliyoruz?</h2>
  <ul>
    <li><strong>Kimlik ve iletişim:</strong> ad soyad, telefon numarası.</li>
    <li><strong>Rezervasyon bilgileri:</strong> rezervasyon türü, tarih ve saat ya da giriş–çıkış tarihleri, kişi sayısı, oda ve kahvaltı tercihi, form dili.</li>
    <li><strong>Özel istek notu:</strong> not alanına kendi yazdıklarınız. Lütfen bu alana sağlık bilgisi gibi özel nitelikli veri yazmayın; alerji gibi bir durum varsa bunu rezervasyonu onaylarken telefonla iletebilirsiniz.</li>
    <li><strong>Teknik veriler:</strong> kötüye kullanımı önlemek için IP adresiniz kısa süreli olarak sunucu belleğinde tutulur, rezervasyon kaydına yazılmaz. Dil tercihiniz yalnızca tarayıcınızda saklanır. Sitede reklam ya da takip çerezi kullanılmaz.</li>
  </ul>

  <h2>3. Hangi amaçlarla ve hangi hukuki sebeple?</h2>
  <ul>
    <li>Rezervasyon talebinizi almak, sizinle iletişime geçip talebi onaylamak ve hizmeti sunmak — KVKK m. 5/2-c (bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması).</li>
    <li>Sitenin ve formların güvenliğini sağlamak, sahte ve otomatik başvuruları önlemek — KVKK m. 5/2-f (meşru menfaat).</li>
    <li>Mevzuattan doğan yükümlülükleri yerine getirmek (ör. konaklamada kimlik bildirimi) — KVKK m. 5/2-ç.</li>
  </ul>

  <h2>4. Veriler kimlere aktarılır?</h2>
  <ul>
    <li><strong>Barındırma:</strong> form verileri ${e(hosting)} üzerindeki sunucuda saklanır. Sunucu Türkiye dışındaysa bu, KVKK m. 9 kapsamında yurt dışına aktarımdır.</li>
    <li><strong>WhatsApp:</strong> “WhatsApp ile Gönder” seçeneğinde hazır mesaj, sizin onayınızla WhatsApp (Meta Platforms) üzerinden iletilir; WhatsApp'ın kendi gizlilik koşulları geçerlidir.</li>
    <li><strong>Google:</strong> sayfadaki yazı tipleri ve harita Google sunucularından yüklenir; bu sırada IP adresiniz Google'a iletilir.</li>
    <li>Yetkili kamu kurum ve kuruluşlarına, yalnızca yasal zorunluluk hâlinde.</li>
  </ul>
  <p>Verileriniz satılmaz ve pazarlama amacıyla üçüncü kişilerle paylaşılmaz.</p>

  <h2>5. Toplama yöntemi ve saklama süresi</h2>
  <p>Veriler, sitedeki rezervasyon formları ve WhatsApp mesajı aracılığıyla elektronik ortamda toplanır. ${e(retention)}</p>

  <h2>6. Haklarınız (KVKK m. 11)</h2>
  <p>Kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, silinmesini ya da yok edilmesini isteme, bu işlemlerin aktarılan üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.</p>
  <p>Başvurularınızı ${contact || "işletmemizin iletişim kanalları üzerinden"} iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.</p>

  <footer><p class="muted">Kardias Cunda · <a href="${home}">Ana sayfa</a></p></footer>
</main>
</body>
</html>`;
}

module.exports = { renderKvkk };
