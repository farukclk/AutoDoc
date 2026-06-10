### Updated: python/config.py

# `python/config.py` Teknik Dokümantasyonu

Bu doküman, `python/config.py` dosyasındaki yapılandırma parametrelerini ve bunların sistem içerisindeki rollerini açıklamaktadır. Bu dosya; API anahtarlarını, mesaj kuyruğu (RabbitMQ) ayarlarını ve servis uç noktalarını (endpoints) merkezi olarak yönetmek için kullanılır.

## Yapılandırma Parametreleri Referansı

| Değişken Adı | Veri Tipi | Varsayılan Değer | Açıklama |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | `str` | `""` | Google Gemini yapay zeka modeline erişim sağlamak için gereken API kimlik doğrulama anahtarı. |
| `RABBITMQ_HOST` | `str` | `"localhost"` | RabbitMQ mesaj kuyruğu sunucusunun ana bilgisayar (host) adresi. |
| `CODE_FETCHED_QUEUE` | `str` | `"CodeFetched"` | Kaynak kodun başarıyla alındığını/çekildiğini bildiren mesajların aktarıldığı RabbitMQ kuyruk adı. |
| `CONTEXT_READY_QUEUE` | `str` | `"ContextReady"` | Yapay zeka veya işlem süreçleri için bağlamın (context) hazır hale getirildiğini bildiren mesajların aktarıldığı RabbitMQ kuyruk adı. |
| `API_ENDPOINT` | `str` | `"http://localhost:4141"` | Sistem bileşenlerinin veri alışverişi yaptığı ana yerel API servisinin temel URL adresi. |

---

## Bileşen Detayları

### 1. Yapay Zeka Entegrasyonu (`GEMINI_API_KEY`)
*   **Amaç:** Gemini API servislerine yapılacak isteklerde yetkilendirme (authorization) sağlamak.
*   **Kullanım Notu:** Üretim (production) ortamında bu değerin doğrudan kod içerisine yazılması yerine çevre değişkenleri (`environment variables` veya `.env` dosyası) üzerinden okunacak şekilde dinamikleştirilmesi önerilir.

### 2. Mesaj Kuyruğu Yapılandırması (RabbitMQ)
Sistem, asenkron iletişim ve mikroservis mimarisi için RabbitMQ kullanmaktadır.
*   **Bağlantı Adresi (`RABBITMQ_HOST`):** Broker servisine bağlanılacak adresi belirtir. Yerel testler için `localhost` olarak yapılandırılmıştır.
*   **Kuyruklar:**
    *   `CodeFetched`: Kod çekme servisinin işlem tamamlandığında tetiklediği kuyruktur.
    *   `ContextReady`: İşlenen kodun analiz için hazır olduğunu ve bir sonraki aşamaya (örneğin LLM analizine) geçebileceğini belirten kuyruktur.

### 3. API Servis Uç Noktası (`API_ENDPOINT`)
*   **Amaç:** Uygulamanın arka plan servisleri veya dış sistemlerle HTTP protokolü üzerinden iletişim kurmasını sağlar. Varsayılan olarak `4141` portu üzerinden yerel sunucuyu işaret eder.