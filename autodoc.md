# AutoDoc: Yapay Zekâ Destekli Otomatik Dokümantasyon Boru Hattı

AutoDoc, yazılım projelerinin kaynak kodlarındaki değişiklikleri veya projenin ilk durumunu analiz ederek otomatik olarak kapsamlı bir `autodoc.md` teknik dokümantasyonu oluşturan ve bunu hedef depoya (repository) bir Çekme İsteği (Pull Request - PR) olarak sunan, olay güdümlü (event-driven) ve mikroservis tabanlı bir sistemdir.

Sistem; GitHub Webhook tetiklemeleri, mesaj kuyrukları (RabbitMQ), gelişmiş dil modelleri (Gemini API) ve GitHub API entegrasyonlarını bir araya getirerek geliştiricilerin her kod gönderiminde (push) güncel bir dokümantasyona sahip olmasını sağlar.

---

## 1. Genel Mimari ve İş Akışı

Sistem, gevşek bağlı (loosely-coupled) dört ana servis ve bir mesaj kuyruğu katmanından oluşmaktadır:

```
+------------------+             +-------------------+             +------------------+
|                  |  Webhook    |                   |  Message    |                  |
|  GitHub Repo     +------------>+  Webhook Service  +------------>|  RabbitMQ Queue  |
|                  |  (Push Event)                   |  (Node.js)  |             (CodeFetched)
+--------^---------+             +-------------------+             +--------+---------+
         |                                                                  |
         | Pull                                                             | Consume
         | Request                                                          v
+--------+---------+             +-------------------+             +--------+---------+
|                  |  API POST   |                   |  Message    |                  |
|    PR Service    |<------------+  AI Docs Service  |<------------|  Parsing Service |
|    (Node.js)     |             |     (Python)      |             |     (Python)     |
+------------------+             +-------------------+             +------------------+
                                                        (ContextReady)
```

### Detaylı İş Akışı:
1. **Tetiklenme (Push Event):** Kullanıcı GitHub deposuna kod gönderir. GitHub Webhook'u, `webhook_service` üzerindeki `/webhook` endpoint'ine bir POST isteği fırlatır.
2. **Değişikliklerin Yakalanması:** 
   - `webhook_service` gelen push olayındaki commit'leri ve değiştirilen dosyaları analiz eder.
   - Eğer projede daha önce üretilmiş bir `autodoc.md` **yoksa** (`isInit` durumu), sistem projenin kök dizininden başlayarak dışlanan klasörler haricindeki en fazla 30 kaynak kod dosyasını tüm içeriğiyle çeker.
   - Eğer `autodoc.md` **varsa**, sadece değişen dosyaların fark yamalarını (diff/patch) toplar.
   - Toplanan bu veriler birleştirilerek RabbitMQ üzerindeki `CodeFetched` kuyruğuna gönderilir.
3. **Ön İşleme (Parsing):** `code_parsing_service` kuyruktan mesajı alır, gerekli ön işlemleri tamamlar (genişletilebilir filtreler/düzenlemeler uygular) ve `ContextReady` kuyruğuna aktarır.
4. **Yapay Zekâ ile Üretim:** `ai_docs_service` ilgili kuyruktan işlenmiş kod verisini teslim alır. Duruma uygun (İlk Kurulum veya Değişiklik Güncellemesi) hazırlanan prompt'u Google Gemini API modellerine iletir. Model yanıtı (Markdown içeriği) doğrulanarak `pr_service`'e iletilir.
5. **PR Oluşturma:** `pr_service` gelen yeni Markdown içeriğini alır, hedef projeyi bot kullanıcısı adına çatallar (fork), değişiklikleri çatallanan depoya commit eder ve ana projeye (upstream) otomatik bir Pull Request açar.

---

## 2. Servis Detayları

### 2.1. Webhook Service (Node.js)
Giriş noktasıdır. GitHub üzerindeki anlık değişiklikleri yakalar ve bağlamsal veriyi hazırlar.

* **Dosya:** `node/webhook_service/src/index.js`
* **Port:** `3000` (veya `PORT` env)
* **Önemli Yetenekler:**
  - **Filtreleme:** Sadece `push` event'lerini işler.
  - **Yamalama (Patching):** Commit listesindeki her bir dosyanın `patch` verilerini birleştirerek `filePatches` sözlüğü oluşturur.
  - **İlk Kurulum Taraması (Init Scan):** `autodoc.md` bulunamadığı senaryolarda `node_modules`, `bin`, `obj`, `.git`, `dist`, `build` gibi klasörleri filtreleyerek belirlenen uzantılardaki (`.cs`, `.js`, `.py`, `.ts`, `.md`, vb.) kaynak kod dosyalarını bulur. Limit aşımını önlemek amacıyla en güncel 30 dosyayı tam metin olarak çeker.
  - **RabbitMQ Entegrasyonu:** Hazırlanan bu veriyi `CodeFetched` kuyruğuna `durable` (kalıcı) olarak bırakır.

### 2.2. Code Parsing Service (Python)
Gelen ham verilerin temizlenmesi, normalize edilmesi ve işleme hazır hale getirilmesinden sorumlu ara katmandır.

* **Dosya:** `python/code_parsing_service.py`
* **İşlevi:** `CodeFetched` kuyruğundan mesajı okur. `preprocess_data` fonksiyonu aracılığıyla veriyi işler (bu aşamada veri yapısı korunur ancak gelecekte AST analizi, token küçültme vb. eklentilere uygundur). Mesajı `ContextReady` kuyruğuna iletir.

### 2.3. AI Docs Service (Python)
Yapay zekâ yeteneklerini yöneten akıllı karar servisidir.

* **Dosya:** `python/ai_docs_service.py`
* **İşlevi:** 
  - Gelen mesajda `isInit` bayrağını denetler. True ise tüm kaynak kod dosyalarını içeren kapsamlı bir **"İlk Kez Dokümantasyon Oluşturma"** prompt'u hazırlar. False ise mevcut `autodoc.md` içeriği ile gelen diff/patch verilerini harmanlayarak bir **"Dokümantasyon Güncelleme"** prompt'u oluşturur.
  - **Esnek Model Yönetimi:** Ağ gecikmeleri, kota sınırları veya API hatalarına karşı sistem sırasıyla şu modelleri dener:
    1. `gemini-3.5-flash`
    2. `gemini-3.0-flash`
    3. `gemini-2.5-flash`
    4. `gemini-3.1-flash-lite`
    5. `gemini-2.5-flash-lite`
    6. `gemma-4-31b`
    7. `gemma-4-26b`
  - **Yeniden Deneme Mekanizması (Retry with Backoff):** Her bir model için başarısızlık durumunda üstel gecikme ile 3 kez deneme yapar. Biri başarısız olursa bir sonraki modele otomatik geçer.
  - Modelden gelen yanıtı temizledikten sonra `pr_service`'e POST isteği olarak gönderir.

### 2.4. PR Service (Node.js)
Üretilen dokümantasyonun güvenli bir şekilde ana projeye entegre edilmesini sağlayan kapıcı (gatekeeper) servisidir.

* **Dosya:** `node/pr_service/src/index.js`
* **Port:** `3001` (veya `PORT` env)
* **Önemli Yetenekler:**
  - **Çatallama (Forking):** Doğrudan ana projeye yazmak yerine güvenli tarafta kalmak adına hedef repoyu bot hesabı üzerine çatallar (`{repo}.AutoDoc.Fork`).
  - **Senkronizasyon (Upstream Sync):** Çatallanan projenin güncelliğini yitirmemesi için upstream'den otomatik `mergeUpstream` tetikler.
  - **Kod Bloğu Temizliği:** Gemini yanıtlarında oluşabilecek fazla Markdown blok işaretlerini (` ```markdown ` vb.) regex/metin temizleme yoluyla arındırır.
  - **PR Yönetimi:** Değişiklikleri çatallanan repoda commit eder. Ardından ana deponun ana dalına (default branch) yönlendirilmiş bir Pull Request açar. Eğer halihazırda açık bir AutoDoc PR'ı varsa, yeni commit'leri doğrudan o PR'a pushlayarak PR kirliliğini önler.

### 2.5. Orchestrator / Python Runner
Python servislerinin tek bir process ağacında düzgün bir şekilde yönetilmesini ve eşzamanlı çalışmasını sağlar.

* **Dosya:** `python/main.py`
* **İşlevi:** `multiprocessing.Process` kullanarak `CodeParsingService` ve `AIDocsService` yapılarını asenkron olarak ayağa kaldırır. `SIGINT` (CTRL+C) sinyali yakalandığında tüm alt süreçleri (processes) güvenli bir şekilde sonlandırır.

---

## 3. Veri Akış Modeli ve Kuyruk Yapısı

Sistemde kullanılan RabbitMQ kuyrukları mesaj kayıplarını önlemek amacıyla `durable: true` (kalıcı) olarak tanımlanmıştır. `basic_qos(prefetch_count=1)` ayarı ile "Fair Dispatch" (Adil Dağıtım) uygulanarak yoğun zamanlarda işçilerin (workers) aşırı yüklenmesi engellenir.

### Kuyruğa Gönderilen Mesaj Formatı (JSON):
```json
{
  "repoUrl": "https://github.com/user/demo-repo",
  "repoFullName": "user/demo-repo",
  "changes": [
    {
      "filename": "src/main.js",
      "patch": "@@ -1,5 +1,8 @@\n+const logger = require('./logger');..."
    }
  ],
  "existingDoc": "# Eski Doküman Başlığı\nEski içerik detayları...",
  "isInit": false,
  "initFiles": [],
  "timestamp": "2025-10-27T14:20:00.000Z"
}
```

---

## 4. Kullanılan Teknolojiler

* **Runtime:** Node.js (v18+), Python (v3.10+)
* **Mesajlaşma:** RabbitMQ (AMQP)
* **İletişim / API İstemcileri:** 
  - `@octokit/rest` (GitHub REST API istemcisi)
  - `google-genai` (Google Gemini API istemcisi)
  - `pika` (Python RabbitMQ sürücüsü)
  - `express` (Node.js HTTP sunucusu)
  - `requests` (Python HTTP kütüphanesi)
* **Tasarım Kalıpları:** Event-Driven Architecture, Microservices, Worker-Queue Pattern, Fallback & Retry Pattern

---

## 5. Kurulum ve Çalıştırma

### 5.1. Gereksinimler
* Çalışır durumda bir RabbitMQ Sunucusu (`amqp://guest:guest@localhost:5672`)
* Yetkili bir GitHub Kişisel Erişim Token'ı (Personal Access Token - PAT). Çatallama ve PR açma yetkilerine sahip olmalıdır.
* Google Gemini API Anahtarı.

### 5.2. Ortam Değişkenleri (.env)

#### Node Servisleri (`node/webhook_service/.env` ve `node/pr_service/.env`)
```env
PORT=3000 # webhook_service için 3000, pr_service için 3001
GITHUB_TOKEN=ghp_YourGitHubPersonalAccessToken
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

#### Python Servisleri (`python/.env` veya Sistem Ortam Değişkenleri)
```env
GEMINI_API_KEY=AIzaSyYourGeminiApiKey
RABBITMQ_HOST=localhost
CODE_FETCHED_QUEUE=CodeFetched
CONTEXT_READY_QUEUE=ContextReady
API_ENDPOINT=http://localhost:3001/publish
```

### 5.3. Servislerin Başlatılması

1. **RabbitMQ'yu Başlatın:**
   ```bash
   docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
   ```

2. **Webhook Service Çalıştırın:**
   ```bash
   cd node/webhook_service
   npm install
   npm start
   ```

3. **PR Service Çalıştırın:**
   ```bash
   cd node/pr_service
   npm install
   npm start
   ```

4. **Python Servislerini Başlatın:**
   ```bash
   cd python
   pip install -r requirements.txt # pika, requests, google-genai paketleri yüklenmelidir
   python main.py
   ```