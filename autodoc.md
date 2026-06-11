# Proje Teknik Dokümantasyonu (autodoc.md)

Bu doküman, sistemin amacını, mimari tasarımını, dizin yapısını, veri akışını ve kurulum/dağıtım adımlarını ayrıntılı bir şekilde açıklamaktadır. Yazılım geliştiriciler, sistem yöneticileri ve teknik paydaşlar için bir başvuru kaynağı olarak hazırlanmıştır.

---

## 1. Projenin Amacı ve Kapsamı

Bu proje; ölçeklenebilir, test edilebilir ve bakımı kolay bir altyapı sunmak amacıyla modern yazılım geliştirme prensipleri (Clean Architecture, SOLID, DDD - Domain Driven Design) doğrultusunda tasarlanmış bir **Web API ve Veri İşleme Servisi** platformudur.

### Temel Özellikler
* **Katmanlı Mimari:** İş mantığı (domain) ile dış bağımlılıkların (veritabanı, dış servisler) tamamen birbirinden ayrıştırılması.
* **Gelişmiş Yetkilendirme ve Güvenlik:** Rol tabanlı erişim kontrolü (RBAC) ve güvenli kimlik doğrulama mekanizmaları.
* **Asenkron Veri İşleme:** Yoğun iş yüklerini hafifletmek için kuyruk tabanlı arka plan görevleri (Background Jobs).
* **Esnek Entegrasyon Altyapısı:** Üçüncü parti servislerle kolay entegrasyon için soyutlanmış servis katmanları.

---

## 2. Mimari ve Tasarım Desenleri

Proje, bağımlılıkların dışarıdan içeriye doğru aktığı ve merkezde iş kurallarının (domain) yer aldığı **Soğan (Onion) / Temiz (Clean) Mimari** prensiplerine dayanmaktadır.

```
      +-----------------------------------------+
      |        Sunum Katmanı (Presentation)      |
      |   [REST Controllers / API Endpoints]    |
      +-------------------+---------------------+
                          |
                          v
      +-------------------+---------------------+
      |        Uygulama Katmanı (Application)   |
      |    [DTOs, CQRS Handlers, Use Cases]     |
      +-------------------+---------------------+
                          |
                          v
      +-------------------+---------------------+
      |          Çekirdek / Domain Katmanı      |
      |       [Entities, Value Objects]         |
      +-----------------------------------------+
                          ^
                          | (Arayüz Entegrasyonu)
      +-------------------+---------------------+
      |     Altyapı Katmanı (Infrastructure)     |
      |  [Repositories, DB Context, Third-Party] |
      +-----------------------------------------+
```

### Kullanılan Tasarım Desenleri (Design Patterns)
* **Dependency Injection (Bağımlılık Enjeksiyonu):** Sınıflar arası sıkı sıkıya bağlılığı (tight coupling) önlemek ve test edilebilirliği artırmak için kullanılır.
* **Repository Pattern (Depo Deseni):** Veri erişim mantığını iş mantığından soyutlamak için tercih edilmiştir.
* **CQRS (Command Query Responsibility Segregation):** Yazma (Command) ve okuma (Query) operasyonlarını birbirinden ayırarak performans ve ölçeklenebilirlik sağlar.
* **Factory Pattern:** Karmaşık nesne üretim süreçlerini standartlaştırmak amacıyla kullanılır.

---

## 3. Dizin Yapısı ve Modüller

Projenin genel dosya ve klasör organizasyonu aşağıdaki gibidir:

```text
├── src/                          # Kaynak kodların bulunduğu ana dizin
│   ├── Domain/                   # İş kuralları ve temel iş nesneleri (Entities)
│   │   ├── Entities/             # Veritabanı tablolarına karşılık gelen sınıflar
│   │   ├── Exceptions/           # İş mantığına özel hata tanımlamaları
│   │   └── ValueObjects/         # Değer nesneleri
│   │
│   ├── Application/              # Uygulama mantığı ve kullanım senaryoları (Use Cases)
│   │   ├── Interfaces/           # Altyapı katmanı için arayüz (Interface) tanımları
│   │   ├── DTOs/                 # Veri transfer nesneleri (Data Transfer Objects)
│   │   └── Services/             # İş süreçlerini yöneten servis sınıfları
│   │
│   ├── Infrastructure/           # Dış dünya ile iletişim ve veri erişim katmanı
│   │   ├── Persistence/          # Veritabanı bağlantısı, ORM yapılandırmaları ve göçler (Migrations)
│   │   ├── Identity/             # Kullanıcı yönetimi ve güvenlik işlemleri
│   │   └── Services/             # Dış API entegrasyonları, dosya depolama vb.
│   │
│   └── Presentation/             # Kullanıcı veya dış sistemlerle etkileşim katmanı
│       ├── Controllers/          # HTTP isteklerini karşılayan ve yanıtlayan sınıflar
│       ├── Middleware/           # İstek ve yanıt arasına giren ara yazılımlar (Hata yönetimi, Loglama)
│       └── Program.cs / Startup  # Uygulama başlangıç yapılandırması ve DI kayıtları
│
├── tests/                        # Test senaryoları
│   ├── UnitTests/                # Birim testleri
│   └── IntegrationTests/         # Entegrasyon testleri
│
├── docs/                         # Ek dokümantasyonlar ve diyagramlar
├── Dockerfile                    # Konteynerleştirme yapılandırması
├── docker-compose.yml            # Yerel geliştirme ortamı servis tanımları
├── README.md                     # Genel proje açıklaması
└── autodoc.md                    # Bu doküman
```

---

## 4. Bileşen Detayları ve Veri Akışı

### 4.1. İstek (Request) Ömrü ve Veri Akışı
Sistemde bir HTTP isteğinin işlenme süreci şu adımlardan oluşur:

1. **İstek Kabulü:** İstemci (Client) tarafından gönderilen istek `Presentation` katmanındaki ilgili Controller'a ulaşır.
2. **Güvenlik & Doğrulama:** İstek, Middleware katmanında JWT doğrulaması ve girdi validasyonundan (Validation) geçirilir.
3. **İş Mantığına Aktarım:** Controller, gelen veriyi `DTO` formatında `Application` katmanındaki servis veya CQRS Handler'a iletir.
4. **Veri Erişimi:** Servis, gerekli verileri almak veya kaydetmek için `Infrastructure` katmanındaki soyutlanmış `Repository` arayüzlerini çağırır.
5. **İşlem ve Kayıt:** Veritabanı işlemleri Unit of Work deseniyle transaction altında gerçekleştirilir.
6. **Yanıt Hazırlama:** İşlem sonucu Controller üzerinden standart bir JSON yanıt şablonu ile istemciye geri dönülür.

### 4.2. Hata Yönetimi (Error Handling)
Uygulama genelinde merkezi bir hata yönetim mekanizması (Global Exception Handling Middleware) bulunur. Kod içerisinde fırlatılan tüm istisnalar (Exceptions) bu middleware tarafından yakalanır, loglanır ve istemciye aşağıdaki gibi standart bir formatta sunulur:

```json
{
  "success": false,
  "message": "İşlem sırasında bir hata oluştu.",
  "errors": [
    "İstenen kaynak bulunamadı."
  ],
  "statusCode": 404
}
```

---

## 5. Kurulum ve Yapılandırma

### Gereksinimler
Projenin yerel ortamda çalıştırılabilmesi için aşağıdaki yazılımların kurulu olması gerekmektedir:
* Çalışma Zamanı Ortamı (Örn: .NET SDK, Node.js, Python veya Java JDK - ilgili teknolojiye göre)
* Docker ve Docker Compose
* Veritabanı Sunucusu (Örn: PostgreSQL, MSSQL, MongoDB)

### Yerel Geliştirme Ortamı Kurulumu

1. **Depoyu Klonlayın:**
   ```bash
   git clone <proje-repo-adresi>
   cd <proje-klasor-adi>
   ```

2. **Çevre Değişkenlerini Yapılandırın:**
   Kök dizinde yer alan `.env.example` dosyasını kopyalayarak `.env` adında yeni bir dosya oluşturun ve gerekli bağlantı bilgilerini tanımlayın:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=project_db
   DB_USER=postgres
   DB_PASSWORD=secret_password
   JWT_SECRET=super_secret_key_minimum_32_characters
   ```

3. **Veritabanını ve Servisleri Başlatın (Docker):**
   ```bash
   docker-compose up -d
   ```

4. **Bağımlılıkları Yükleyin ve Uygulamayı Başlatın:**
   ```bash
   # Proje teknolojisine uygun bağımlılık yükleme komutu çalıştırılmalıdır.
   # Örnek:
   npm install      # Node.js için
   dotnet restore   # .NET için
   pip install -r requirements.txt # Python için
   
   # Uygulamayı çalıştırma:
   npm run start:dev
   # veya
   dotnet run --project src/Presentation
   ```

---

## 6. API ve Kullanım Örnekleri

Sistem ayağa kalktıktan sonra API uç noktalarına genellikle tarayıcı üzerinden `/swagger` veya `/docs` adreslerinden (Swagger UI / Redoc) erişilebilir.

### Örnek API İstek ve Yanıtı

#### `POST /api/v1/products` - Yeni Ürün Ekleme

* **İstek Başlığı (Headers):**
  ```http
  Content-Type: application/json
  Authorization: Bearer <token_degeri>
  ```

* **İstek Gövdesi (Body):**
  ```json
  {
    "name": "Kablosuz Kulaklık",
    "sku": "KBL-KLK-001",
    "price": 1250.00,
    "stock": 100
  }
  ```

* **Başarılı Yanıt (Response - 201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "e3b0c442-98fc-11eb-a8b3-0242ac130003",
      "name": "Kablosuz Kulaklık",
      "sku": "KBL-KLK-001",
      "price": 1250.00,
      "stock": 100,
      "createdAt": "2023-10-27T14:32:01Z"
    },
    "message": "Ürün başarıyla oluşturuldu."
  }
  ```

---

## 7. Test ve Kalite Güvencesi

Projede kod kalitesini ve kararlılığını korumak amacıyla otomatik test süreçleri kurgulanmıştır.

### Testleri Çalıştırma

* **Birim (Unit) Testleri:** İş kurallarının doğruluğunu test etmek için mocks/stubs kullanarak çalıştırılır.
  ```bash
  npm run test:unit       # Node.js
  dotnet test --filter Category=Unit # .NET
  ```

* **Entegrasyon (Integration) Testleri:** Veritabanı ve dış API entegrasyonlarının doğruluğunu test etmek için gerçek veya izole (testcontainers) servislerle çalıştırılır.
  ```bash
  npm run test:integration
  ```

### Kod Kalitesi Standartları
* **Linter & Formatters:** Projede kod standartlarını korumak için ESLint, Prettier, StyleCop veya Black gibi araçlar entegre edilmiştir. Taahhüt (commit) öncesinde bu kuralların kontrolü otomatik olarak yapılır.

---

## 8. Dağıtım (Deployment) ve CI/CD

Proje, modern bulut platformlarına ve Kubernetes ortamlarına kolayca dağıtılabilecek şekilde tamamen konteynerleştirilmiştir.

### CI/CD Pipeline İş Akışı

```
[Local Code Commit] 
       │
       ▼
[GitHub / GitLab CI] ──► Linter & Statik Kod Analizi (SonarQube)
       │
       ▼
[Run Tests] ──► Unit & Integration Testlerinin Koşturulması
       │
       ▼
[Build Docker Image] ──► Dockerfile ile İmaj Oluşturma
       │
       ▼
[Push to Registry] ──► Docker Hub / AWS ECR / GitLab Registry
       │
       ▼
[Deploy to Target] ──► Kubernetes / AWS ECS / VPS (Webhooks)
```

### Docker İmajı Oluşturma

Projenin üretim (production) ortamı için Docker imajı oluşturmak için aşağıdaki komut kullanılır:

```bash
docker build -t core-api-platform:latest .
```