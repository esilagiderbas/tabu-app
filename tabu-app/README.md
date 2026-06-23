# Kelime Avı 🎉

Kendi kelimelerinizle, kendi inside joke'larınızla oynanan bir Tabu oyunu. İki ayrı telefondan, aynı WiFi üzerinden oynanır.

## Kurulum (sadece bir kerelik)

1. [Node.js](https://nodejs.org) yüklü değilse indir ve kur (LTS sürümü yeterli).
2. Bu klasörü bilgisayarına indir/kopyala.
3. Terminal/Komut İstemi aç, bu klasöre git:
   ```
   cd tabu-app
   ```
4. Sunucuyu başlat:
   ```
   node server.js
   ```
5. Terminalde şöyle bir şey göreceksin:
   ```
   🎉 Kelime Avı sunucusu çalışıyor!
   Bu bilgisayarda: http://localhost:3000
   Aynı WiFi'daki arkadaşın için: http://192.168.1.23:3000
   ```

> npm install gerekmez — proje hiçbir dış kütüphane kullanmıyor, sadece Node.js'in kendi içindeki araçlarla yazıldı.

## Nasıl oynanır

1. **Sen** (sunucuyu çalıştıran kişi = kurucu): Bilgisayarında `http://localhost:3000` adresini taraycıda aç.
2. **Arkadaşların**: Telefonlarında, terminalde yazan "Aynı WiFi'daki arkadaşın için" linkindeki adresi tarayıcıya yazsınlar (örn. `http://192.168.1.23:3000`).
   - Eğer aynı WiFi'da değilseniz, hotspot/internet paylaşımı açın — bağlandığında otomatik olarak aynı ağda sayılırsınız.
3. Sende **"Yeni oyun kur"** butonuna bas, sana 4 haneli bir **oda kodu** verilecek (örn. `K7P2`).
4. Arkadaşların o kodu kendi ekranlarındaki **"Bir oda koduna katıl"** kutusuna yazıp katılsınlar.
5. Herkes (sen dahil) ismini yazıp hangi takımda olduğunu (Takım 1 / Takım 2) seçer.
6. **Sadece sen (kurucu)** süre, tabu hakkı, pas hakkı ve takım isimlerini ayarlayabilirsin. Diğer herkes bu ayarları salt-okunur görür.
7. **Kelime ekleme herkese açık** — odadaki herkes kendi ekranından kelime ekleyebilir.
8. En az 5 kelime ve her iki takımda en az 1 kişi olduğunda, sen **"Oyunu başlat"**a basarsın.

## Anlatıcı sistemi

- Her turda, sırası gelen takımdaki oyunculardan biri **otomatik olarak anlatıcı** seçilir.
- Sıralama, o takımdaki oyuncuların **isimlerine göre alfabetik**tir (örn. Ayşe → Mehmet → Zeynep → tekrar Ayşe).
- **Sadece anlatıcının ekranında** kelime ve yasaklı kelimeler görünür, Doğru/Tabu/Pas butonları da sadece onda aktiftir.
- **Diğer herkesin ekranında** kelime gizlidir, sadece "X anlatıyor" yazar — onlar tahmin etmeye çalışır.
- Tur bitince sıra diğer takıma geçer ve **sıradaki turu başlatma** işini de kurucu yapar (herkesin hazır olduğundan emin olmak için).

## Kelime ekleme

- Lobi ekranında "Ana kelime" + en az 4 "yasaklı kelime" gir, **"Kelime ekle"**ye bas. Bunu odadaki **herkes** yapabilir.
- Eklenen kelimeler `words.json` dosyasında kalıcı olarak saklanır — sunucuyu kapatıp açsan da kaybolmaz.
- İstersen `words.json` dosyasını bir metin editörüyle de açıp toplu kelime ekleyebilirsin (aynı formatta: `main` ve `forbidden` alanları).
- Başlangıçta birkaç örnek Gen Z kelimesi var, dilediğin gibi silip kendi listeni oluşturabilirsin.

## Oyun kuralları (uygulanmış hali)

- Anlatan kişinin ekranında kelime + altında yasaklı kelimeler görünür; diğer herkes "X anlatıyor" yazısını görür.
- **Doğru** → +1 puan, sıradaki karta geçilir.
- **Tabu** → -1 puan (0'ın altına inmez) + o takımın tabu sayacı 1 artar. Tabu sayacı seçtiğiniz limite ulaşırsa (2/3/4) o takım kaybeder, oyun biter.
- **Pas** → puan değişmez, pas hakkı 1 azalır (hak biterse pas butonu kilitlenir).
- Süre dolunca otomatik olarak sıra diğer takıma geçer.
- **Turu bitir** butonu (sadece kurucuda) ile süre dolmadan da tur manuel bitirilebilir.

## Kapatma / yeniden başlatma

- Sunucuyu durdurmak için terminalde `Ctrl + C`.
- Bir sonraki sefer tekrar `node server.js` yazman yeterli, kelimelerin duruyor olacak.

## Notlar

- Bu uygulama yerel ağda (LAN) çalışacak şekilde tasarlandı. İnternet üzerinden farklı şehirlerden oynamak istersen, bu ayrı bir kurulum (sunucuyu bir bulut servisine deploy etmek) gerektirir — istersen onu da ayrıca konuşabiliriz.
