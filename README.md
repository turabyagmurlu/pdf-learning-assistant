# PDF Öğrenme Asistanı 📚🤖

PDF yükle → analiz edilsin → kaynağa (sayfa) dayalı yapay zekâ asistanıyla çalış.
Chatbot + PDF okuyucu + öğrenme koçu (flashcard/quiz/spaced repetition) + kişisel bilgi kütüphanesi.

- **Frontend:** Next.js 14 · TypeScript · Tailwind
- **Backend:** FastAPI (Python) + Celery worker
- **Veritabanı:** PostgreSQL + pgvector
- **Depolama:** S3/MinIO · **AI:** Gemini (ücretsiz — sohbet + embedding)

## Uygulanan Fazlar
- **Faz 1 (MVP):** kayıt/giriş, PDF yükleme, metin çıkarma, chunk+embedding, RAG sohbet (SSE + kaynak/sayfa), otomatik özet, kütüphane, hata yönetimi.
- **Faz 2:** flashcard/quiz/açık uçlu üretimi, not alma, anahtar kavram çıkarımı, öğrenme paneli, AI modları (öğretmen/sokratik/sınav…).
- **Faz 3:** koleksiyonlar, çoklu belge semantik arama, kavram haritası uçları (`/graph`).
- **Faz 4:** spaced repetition (SM-2), yeniden işleme (`/reprocess`), OCR kancası (bkz. `app/pdf`), sağlayıcı-bağımsız AI katmanı (OpenAI→Claude/local geçişe hazır).

---

## 1) Yerelde Çalıştırma (tek komut)

Gerekli: Docker Desktop.

```bash
cp .env.example .env
# .env icindeki GEMINI_API_KEY'i Google AI Studio ucretsiz anahtarinla degistir
docker compose up --build
```

Sonra:
- Web:  http://localhost:3000
- API:  http://localhost:8000/health
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

İlk açılışta kayıt ol → PDF yükle → kart "Hazır" olunca aç → sağ panelden soru sor.

> Gemini anahtari (ucretsiz, kartsiz) olmadan embedding/analiz/sohbet adimlari hata verir. Anahtar: https://aistudio.google.com/apikey

---

## 2) Canlıya Alma (GitHub → Render + Vercel)

GitHub kodu barındırır; uygulama Render (backend) + Vercel (frontend) üzerinde koşar.
Hepsinin **ücretsiz** katmanı vardır (OpenAI kullanımı hariç).

### Adım A — Kodu GitHub'a yükle
```bash
git init && git add . && git commit -m "PDF Öğrenme Asistanı"
git branch -M main
git remote add origin https://github.com/KULLANICI/pdf-learning-assistant.git
git push -u origin main
```

### Adım B — Veritabanı (Supabase, pgvector'lü)
1. supabase.com → yeni proje.
2. SQL Editor'de `infra/init.sql` içeriğini çalıştır (pgvector + tablolar).
3. Project Settings → Database → **Connection string (URI)** kopyala → Render'da `DATABASE_URL`.

### Adım C — Dosya depolama (Cloudflare R2 veya AWS S3)
- Bir bucket aç (`pdfs`). Access key + secret al.
- `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` değerlerini Render'a gir.

### Adım D — Backend (Render Blueprint)
1. render.com → **New + → Blueprint** → GitHub repo'nu seç.
2. `render.yaml` otomatik okunur: `pdf-api` (web), `pdf-worker`, `pdf-redis` oluşur.
3. Dashboard'da `sync:false` işaretli env değişkenlerini gir:
   `GEMINI_API_KEY`, `DATABASE_URL`, `S3_*`, `CORS_ORIGINS` (Vercel URL'in).
4. Deploy → `https://pdf-api-xxxx.onrender.com/health` → `{"status":"ok"}`.

### Adım E — Frontend (Vercel)
1. vercel.com → **Add New → Project** → repo → **Root Directory: `apps/web`**.
2. Environment Variable: `NEXT_PUBLIC_API_URL = https://pdf-api-xxxx.onrender.com`.
3. Deploy. Çıkan URL'i Render'da `CORS_ORIGINS`'e ekle ve `pdf-api`'yi redeploy et.

### Adım F — Doğrula
Vercel URL'inde kayıt ol → PDF yükle → "Hazır" → soru sor → kaynaklı cevap gelmeli. ✅

CI: her `main` push'unda `.github/workflows/ci.yml` API syntax + web build kontrolü yapar.

---

## Proje Yapısı
```
apps/api   FastAPI + worker (auth, documents, chat/RAG, notes, study, search, graph)
apps/web   Next.js (login, kütüphane, PDF çalışma ekranı, öğrenme paneli)
infra      init.sql (pgvector şeması)
render.yaml / vercel.json / .github  deploy + CI
```

## Ortam Değişkenleri
Tümü `.env.example` içinde açıklamalı. En kritik: `GEMINI_API_KEY` (ucretsiz), `DATABASE_URL`, `S3_*`, `JWT_SECRET`.

## Yol Haritası (sonraki iyileştirmeler)
- Gerçek PDF.js entegrasyonu + sayfa vurgulama/anchor
- Hibrit arama (tsvector + RRF) ve cross-encoder re-rank
- OCR (ocrmypdf) tam entegrasyonu
- Kavram haritası görselleştirme (node-link UI)
