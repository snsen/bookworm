# Yapılacaklar

Onaylanmış ama henüz başlanmamış geliştirmeler. Sıra öncelik değil, gruplamadır.

## Ses

- [ ] **Ortam sesleri:** Yağmur, şömine çıtırtısı, gece cırcır böcekleri, rüzgâr.
  - Web Audio ile tarayıcıda üretilir; ses dosyası ve lisans gerekmez.
  - Ses seviyesi kısık ve ayarlanabilir, sayfa çevirme sesiyle birlikte çalar.

## Görsel atmosfer

- [ ] **Mevsim ve tema seçimi:** Toz zerrelerinin yerine ateş böcekleri, yavaş düşen kar ya da sonbahar yaprakları.
  - Mevcut toz efektiyle aynı yöntem (yalnızca transform/opacity animasyonu), performansa etkisi yok.
- [ ] **Bölüm açılış kartı:** Yeni bölüme gelindiğinde başlık birkaç saniyeliğine süslü bir yazıyla belirip kaybolur.
  - EPUB'da içindekiler tablosundan, PDF'te varsa yer imlerinden (outline).
- [ ] **Resimli sayfalarda yavaş yakınlaşma (Ken Burns):** Çizim içeren sayfalarda resim çok yavaş büyür.

## Kullanım

- [ ] **Kitaplık:** Birden fazla kitap bırakılır, sırayla gösterilir.
  - Kitaplar ve her birinde kalınan yer yalnızca tarayıcının kendi deposunda (IndexedDB) saklanır.
- [ ] **Resimli kitap ve çizgi roman desteği:** Sabit düzenli (fixed-layout) EPUB'lar sayfa sayfa, orijinal düzeniyle gösterilir.
- [ ] **Yazı yoğunluğuna göre bekleme süresi:** Çok yazılı sayfada daha uzun, resimli ya da boş sayfada daha kısa beklenir.
  - Ayarlardaki süre ortalama değer olarak kullanılır.
