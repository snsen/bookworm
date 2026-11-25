# Kitap Kurdu

Bir PDF veya EPUB kitabı tam ekranda, açık bir kitap gibi gösterir. Sayfalar kıvrılarak, kendiliğinden çevrilir. Projektörle duvara ya da tavana yansıtıp okuma sırasında atmosfer oluşturmak için tasarlandı.

- Sunucu yok: dosya yalnızca tarayıcıda açılır, hiçbir yere yüklenmez.
- `npm run build` çıktısı (`dist/`) herhangi bir statik barındırmada çalışır (GitHub Pages dahil).

## Kurulum

Gereksinim: Node.js 20 veya üzeri (22 ile test edildi).

```bash
npm install
```

Geliştirme sunucusunu başlatmak için:

```bash
npm run dev
```

Ardından tarayıcıda http://localhost:5173 adresini açın.

Statik dosyaları üretmek için:

```bash
npm run build
```

Çıktı `dist/` klasörüne yazılır. Yollar göreli olduğu için klasör bir alt dizinden de (ör. `https://kullanici.github.io/bookworm/`) sunulabilir. Üretilen sürümü yerelde denemek için:

```bash
npm run preview
```

### GitHub Pages'te yayınlama

`.github/workflows/deploy.yml` her push'ta projeyi derler (önce birim testlerini çalıştırır) ve `dist/` klasörünü yayınlar.

1. Depoda **Settings → Pages → Build and deployment → Source** menüsünden **GitHub Actions**'ı seçin. GitHub'ın önerdiği "Static HTML" ya da "Jekyll" workflow'larını eklemeyin.
2. `guzel-kitap` veya `main` dalına push yapın. Yayının durumunu **Actions** sekmesinden takip edebilirsiniz.

## Kullanım

1. **Kitap açma:** Dosyayı sayfaya sürükleyip bırakın ya da **Dosya seçin** düğmesini kullanın. Bir kitap açıkken alt çubuktaki klasör simgesiyle başka bir kitap açabilirsiniz.
2. **Otomatik çevirme:** ▶ düğmesi veya **Boşluk** tuşu başlatır ve duraklatır. Süre Ayarlar'dan 3–60 saniye arasında ayarlanır. Elle sayfa çevirdiğinizde geri sayım baştan başlar.
3. **Tam ekran:** ⛶ düğmesi veya **F** tuşu. Tam ekranda 3 saniye hareketsizlikten sonra kontroller ve fare imleci gizlenir. Fareyi oynattığınızda geri gelirler.

### Kısayollar ve elle kontrol

| Eylem | Klavye / fare |
|---|---|
| Sonraki / önceki sayfa | → ← (ya da ↓ ↑, PageDown / PageUp) |
| Kitabın başı / sonu | Home / End |
| Otomatik çevirmeyi başlat/duraklat | Boşluk |
| Tam ekran | F |
| Ayarları kapat | Esc |
| Sayfa çevirme | Sağ sayfaya tıklama ileri, sol sayfaya tıklama geri. Kitabın dışında ekranın sağ ya da sol yarısına tıklamak da aynı işi görür. |
| Kıvırarak çevirme | Sayfayı köşesinden sürükleyin |
| Tekerlek | Fare tekerleği veya touchpad kaydırması. Bir kaydırma hareketi tek sayfa çevirir. |

### Ayarlar

Ayarlar tarayıcıda saklanır, sayfayı yeniden açtığınızda korunur.

- **Çevirme süresi:** 3–60 sn. Varsayılan 15 sn.
- **Sona gelince başa dön (döngü):** Açıksa son sayfadan sonra kitap başa döner. Kapalıysa otomatik çevirme son sayfada durur.
- **Sayfa çevirme sesi:** Tarayıcıda üretilen hafif bir kâğıt hışırtısı. Varsayılanı kapalı.
- **Arka plan:** Siyah, gece mavisi, koyu kahve, koyu yeşil, antrasit ya da özel bir renk.
- **Parlaklık:** %30–100. Her şeyin üstüne siyah bir perde koyar, böylece projektörün yaydığı ışığı gerçekten azaltır.
- **Sayfa tonu:**
  - Beyaz.
  - Sepya (varsayılan).
  - Gece: koyu sayfa, açık renk yazı. Karanlık odada gözü en az yoran seçenek.
- **Masalsı atmosfer:** Açıkken şunlar eklenir:
  - Kâğıt dokusu ve sayfa kenarlarına doğru hafif kararma
  - Kitabın arkasında yavaşça titreyen mum ışığı
  - Işıkta süzülen birkaç toz zerresi
  - EPUB'larda bölüm başlarında süslü büyük ilk harf

  Varsayılanı açık. Efektler yalnızca GPU'da çalışan CSS animasyonlarıdır, sayfa çevirmeyi yavaşlatmaz. İşletim sisteminde "hareketi azalt" açıksa toz ve titreme kapanır.
- **Yazı boyutu (EPUB):** Küçük, Orta, Büyük. Değiştirince kitap yeniden sayfalanır ve okuduğunuz yer korunur.

Karanlık oda için varsayılanlar: neredeyse siyah arka plan, %75 parlaklık, sepya ton, 15 sn, döngü açık, ses kapalı, atmosfer açık.

### Projektör ipuçları

- Tarayıcıyı tam ekrana alın (F). Otomatik çevirme sürerken ekranın uykuya geçmesi Screen Wake Lock ile engellenir.
- Tavana yansıtırken **Gece** tonu ve %50–60 parlaklık iyi bir başlangıç noktasıdır.
- Çok uzaktan okunacaksa EPUB'da **Büyük** yazı boyutunu seçin.

## Desteklenen dosyalar

| Tür | Durum |
|---|---|
| PDF | Desteklenir. Farklı boyuttaki sayfalar kenar boşluklu sığdırılır. |
| EPUB 2/3 (akışkan metin) | Desteklenir. |
| DRM'li EPUB (Adobe ADEPT, Apple FairPlay, Readium LCP) | Desteklenmez, anlaşılır bir hata mesajı gösterilir. |
| Parola korumalı ya da DRM'li PDF | Desteklenmez, hata mesajı gösterilir. |
| Kindle (AZW, AZW3, KFX, MOBI), Adobe `.acsm` lisans dosyası | Desteklenmez, hata mesajı gösterilir. |

## Nasıl çalışır

```
src/
├─ main.ts                 # Uygulama: dosya açma, oturum, ayarların uygulanması
├─ settings.ts             # Varsayılanlar, doğrulama, localStorage
├─ i18n.ts                 # Arayüz metinleri (Türkçe)
├─ sources/
│  ├─ detect.ts            # Dosya türü, Kindle ve DRM tespiti
│  ├─ pdfSource.ts         # PDF.js → canvas (sayfa tonu piksellere işlenir)
│  ├─ epubSource.ts        # epub.js ile ayrıştırma + sütunlarla kendi sayfalayıcımız
│  └─ epub/css.ts          # Kitap CSS'ini sayfanın shadow root'una uyarlar
├─ book/
│  ├─ flipEngine.ts        # Sayfa çevirme kütüphanesine dokunan tek dosya
│  ├─ pageCache.ts         # Kayan pencere: önceden hazırlama ve bellekten atma
│  ├─ window.ts            # Hangi sayfaların hazır tutulacağı (saf fonksiyon)
│  └─ layout.ts            # Çift sayfayı ekrana sığdırma
├─ player/                 # Otomatik çevirme (döngü, wake lock) ve ses
└─ ui/                     # Araç çubuğu, ayarlar, ekranlar, girdi, tam ekran, atmosfer
```

### Önemli tasarım kararları

- **Büyük kitaplarda performans:**
  - Sayfa çevirme motoruna başta yalnızca boş sayfa kabukları verilir.
  - Görünen çift sayfa, 6 sayfa ilerisi ve 2 sayfa gerisi hazırlanır.
  - Pencereden çıkan sayfalar bellekten atılır: çizim iptal edilir, canvas pikselleri ve blob URL'ler serbest bırakılır.
  - Döngü açıkken sona yaklaşınca kitabın ilk sayfaları da önceden hazırlanır.
- **PDF:**
  - Sayfalar ekrandaki boyutta çizilir (cihaz piksel oranı en fazla 2).
  - Sayfa tonu çizim sırasında piksellere işlenir, böylece çevirme animasyonunda pahalı CSS filtreleri gerekmez.
  - Pencere boyutu değişirse yalnızca hazırlanan sayfalar yeniden çizilir.
- **EPUB:**
  - EPUB'larda hazır "sayfa" yoktur. epub.js paketi ayrıştırmak için kullanılır.
  - Her bölüm sabit boyutlu mantıksal bir sayfada CSS sütunlarıyla sayfalanır ve ekrana ölçeklenir. Bu yüzden tam ekrana geçmek yeniden sayfalama gerektirmez.
  - İçerik DOMPurify ile temizlenir ve her sayfa kendi Shadow DOM'unda çizilir. Kitabın CSS'i uygulamayı etkilemez.
- **Gizlilik:**
  - `index.html` içindeki Content-Security-Policy, kitabın içindeki görsellerin, yazı tiplerinin ve stillerin ağa erişmesini engeller.
  - Uzak adreslere işaret eden `url(...)` ve `<img>` kaynakları zaten kaldırılır.

### Kütüphaneler

| Kütüphane | Neden | Lisans |
|---|---|---|
| [`pdfjs-dist`](https://github.com/mozilla/pdf.js) | PDF ayrıştırma ve çizim (worker'da) | Apache-2.0 |
| [`epubjs`](https://github.com/futurepress/epub.js) | EPUB paketini ayrıştırma | BSD-2-Clause |
| [`@gullabs/flipbook-core`](https://github.com/gul-labs/flipbook) | Sayfa kıvrılma animasyonu. Orijinali 2021'den beri güncellenmeyen StPageFlip'in bakımı süren çatalı. API'si aynı olduğu için gerekirse `src/book/flipEngine.ts` değiştirilerek orijinal `page-flip`'e dönülebilir. | MPL-2.0 (değiştirilmeden kullanılıyor, kaynağı yukarıdaki bağlantıda) |
| [`dompurify`](https://github.com/cure53/DOMPurify) | EPUB içeriğini temizleme | Apache-2.0 / MPL-2.0 |
| [`jszip`](https://github.com/Stuk/jszip) | EPUB içinde DRM dosyalarını arama | MIT / GPLv3 |

epub.js'in eski bir bağımlılığı olan `@xmldom/xmldom`, güvenlik açıkları nedeniyle `package.json` içindeki `overrides` ile güncel sürüme yükseltildi. Tarayıcıda zaten kullanılmaz.

## Testler

```bash
npm test
```

Birim testleri (Vitest): sayfa penceresi, DRM ve dosya türü tespiti, ayarlar, CSS dönüştürme, bölüm parçalama, otomatik oynatıcı.

Uçtan uca testler için önce test kitaplarını hazırlayın:

```bash
npm run fixtures
```

Bu komut kamu malı test kitaplarını `fixtures/` klasörüne indirir ve üretir. Bu klasör repoya eklenmez.

- `alice.epub` ve `pride.epub`: [Standard Ebooks](https://standardebooks.org)'un kaynakları. Project Gutenberg metinlerinden hazırlanmış, CC0 ile kamu malı. GitHub'dan indirilir.
- `pride-a5.pdf`: Aynı metinden Chromium ile basılan 654 sayfalık bir PDF.
- `drm-adobe.epub` ve `fake-kindle.azw3`: Hata mesajlarını denemek için sahte dosyalar.

Playwright tarayıcıları yüklü değilse (bir kerelik):

```bash
npx playwright install chromium firefox
```

Uçtan uca testler (üretim derlemesine karşı, 12 senaryo):

```bash
npm run e2e
```

Aynı testleri Firefox'ta çalıştırmak için:

```bash
node tests/e2e/run.mjs --browser firefox
```

Bellek dayanıklılık testi: 1 saat boyunca 3 sn'de bir otomatik çevirir. JS heap, DOM düğümü, canvas belleği ve tarayıcı süreçlerinin RSS'ini ölçer (yalnızca Chromium):

```bash
npm run soak -- --file pride-a5.pdf --minutes 60 --interval 3
```

### Firefox için elle kontrol listesi

Geliştirme ortamında Firefox indirilemediği için otomatik testler yalnızca Chromium'da koşturuldu. Firefox'ta aşağıdakileri bir kez elle (ya da yukarıdaki `--browser firefox` komutuyla) doğrulayın:

1. 1920×1080 tam ekranda (F) PDF ve EPUB düzgün ortalanıyor, kontroller 3 sn sonra gizleniyor.
2. Sayfa çevirme animasyonu akıcı. Köşeden sürükleme ve tıklama çalışıyor.
3. Gece tonunda PDF ve EPUB okunaklı. Mum ışığı ve toz efektleri takılmaya yol açmıyor.
4. Otomatik çevirme 15 dakika boyunca sorunsuz sürüyor. `about:memory` içinde bellek artmıyor.

## Bilinen sınırlamalar

- Sabit düzenli (fixed-layout) EPUB'lar akışkan metin gibi sayfalanır.
- Gece tonunda PDF'teki fotoğraflar negatif görünür (tüm sayfa tersine çevrilir). EPUB'da yalnızca çizimler tersine çevrilir, fotoğraflar sadece karartılır.
- Gizlenmiş (obfuscated) gömülü yazı tipleri yüklenmez, yerine sistemdeki serif yazı tipi kullanılır.
- İlk sayfa gerçek bir kitaptaki gibi sağda tek başına durur. Kapak sert bir sayfa olarak çevrilir.
