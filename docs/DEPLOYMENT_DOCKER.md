# Panduan Deployment Docker (Docker Compose)

Panduan ini ditujukan bagi **Tim IT & DevOps** untuk mendeploy aplikasi **Asset Detection & P&ID Analyzer** ke server produksi menggunakan **Docker Compose**.

---

## 1. Arsitektur Container

Sistem berjalan menggunakan 4 service yang saling terhubung dalam satu jaringan internal Docker:

| Service | Container Name | Image / Base | Fungsi & Keterangan |
| :--- | :--- | :--- | :--- |
| **`postgres`** | `asset_detection_db` | `pgvector/pgvector:pg16` | Database PostgreSQL 16 lengkap dengan ekstensi **pgvector** untuk pencarian kemiripan simbol visual. |
| **`redis`** | `asset_detection_redis` | `redis:7-alpine` | Message broker untuk antrean background processing BullMQ. |
| **`app`** | `asset_detection_app` | `node:22-bookworm-slim` | Web server Next.js (port `3000`), melayani UI antarmuka dan REST API. Otomatis menjalankan migrasi database saat startup. |
| **`worker`** | `asset_detection_worker` | `node:22-bookworm-slim` | Background worker untuk menjalankan deteksi P&ID (YOLO ONNX + Gemini Vision). |

---

## 2. Prasyarat Server

* **OS:** Linux (Ubuntu 22.04 / Debian 12 / Rocky Linux) atau Windows Server.
* **Hardware:** Minimal **2 vCPU** dan **4 GB RAM** (Server **tidak memerlukan GPU**; inferensi berjalan cepat di CPU via ONNX Runtime).
* **Perangkat Lunak:**
  * Docker Engine versi 24.0+
  * Docker Compose versi v2.20+

---

## 3. Langkah-demi-Langkah Deployment

### Langkah 1: Siapkan File Environment (`.env`)
Salin template konfigurasi:
```bash
cp .env.example .env
```
Buka file `.env` menggunakan text editor (misal: `nano .env`) dan pastikan parameter berikut terisi:

```env
# Database Credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=ganti_password_kuat_disini_2026
POSTGRES_DB=asset_detection

# Keamanan Sesi Cookie (Wajib ganti minimal 32 karakter acak)
AUTH_SECRET=kunci-rahasia-sesi-jwt-sangat-aman-dan-panjang-2026

# Provider AI (Gemini)
AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...kunci_api_gemini_anda
GEMINI_MODEL=gemini-2.5-flash
```

---

### Langkah 2: Build & Jalankan Seluruh Container
Jalankan perintah berikut di root folder project:

```bash
docker compose up -d --build
```

Perintah ini akan:
1. Membangun (*build*) image aplikasi Next.js secara optimal (multi-stage build).
2. Menjalankan database PostgreSQL dengan pgvector dan inisialisasi tabel otomatis dari `sql/init.sql`.
3. Menjalankan Redis broker.
4. Menjalankan web server dan background detection worker.

---

### Langkah 3: Verifikasi Status Container
Periksa apakah seluruh service telah berjalan dan sehat (*healthy*):

```bash
docker compose ps
```
*Output yang diharapkan:*
```text
NAME                     IMAGE                    STATUS                   PORTS
asset_detection_db       pgvector/pgvector:pg16   Up (healthy)             0.0.0.0:5432->5432/tcp
asset_detection_redis    redis:7-alpine           Up (healthy)             0.0.0.0:6379->6379/tcp
asset_detection_app      asset-detection-app      Up                       0.0.0.0:3000->3000/tcp
asset_detection_worker   asset-detection-worker   Up                       
```

Buka browser dan akses aplikasi di:
```text
http://<IP-SERVER-ANDA>:3000
```

---

## 4. Persistensi Data & Volume Host

Data penting di-mount langsung ke harddisk host agar **tidak hilang** saat container di-restart atau di-update:

| Path di Host | Path di Container | Fungsi |
| :--- | :--- | :--- |
| **`./storage/`** | `/app/storage` | Menyimpan dokumen PDF asli, hasil render visual halaman, dataset konfirmasi, dan crop simbol legend. |
| **`./model/`** | `/app/model` | Menyimpan model deteksi lokal (`yolo-pid-v8n-203.onnx`). Tim IT dapat menimpa file model baru di folder host ini tanpa perlu rebuild container. |
| `postgres_data` | `/var/lib/postgresql/data` | Volume Docker untuk seluruh basis data relasional. |
| `redis_data` | `/data` | Volume Docker untuk persistensi antrean background jobs. |

---

## 5. Perintah Operasional Penting untuk Tim IT

### Melihat Log Real-time:
```bash
# Log seluruh sistem
docker compose logs -f

# Log background detection worker saja
docker compose logs -f worker

# Log web application
docker compose logs -f app
```

### Menjalankan Migrasi Database Tambahan:
```bash
docker compose exec app npm run migrate
```

### Ekspor Dataset YOLO untuk Google Colab:
Ketika jumlah dataset di Dashboard sudah mencapai ambang batas (≥ 500 sampel):
```bash
docker compose exec app npm run dataset:export-yolo
```
File `yolo_dataset.zip` akan otomatis muncul di folder root host Anda, siap di-upload ke Google Colab.

### Memperbarui Model YOLO Baru:
Setelah selesai melatih di Google Colab dan mendownload `yolo-pid-v8n-203.onnx`:
```bash
# 1. Timpa file di folder model host
cp /path/to/downloaded/yolo-pid-v8n-203.onnx ./model/yolo-pid-v8n-203.onnx

# 2. Restart worker agar langsung memuat model baru
docker compose restart worker
```

---

## 6. Prosedur Backup & Restore Basis Data

### Backup Database:
```bash
docker compose exec postgres pg_dump -U postgres asset_detection > backup_$(date +%Y%m%d).sql
```

### Restore Database:
```bash
cat backup_20261104.sql | docker compose exec -T postgres psql -U postgres asset_detection
```

---

## 7. Cara Update Aplikasi ke Versi Terbaru (Git Pull)

Jika ada update kode baru di repository Git:
```bash
# 1. Ambil kode terbaru
git pull origin main

# 2. Re-build dan restart container (downtime < 10 detik)
docker compose up -d --build

# 3. Jalankan migrasi jika ada schema baru
docker compose exec app npm run migrate
```

