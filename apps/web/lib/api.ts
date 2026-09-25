export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}
export function setToken(t: string) { localStorage.setItem("token", t); }
export function clearToken() { localStorage.removeItem("token"); }

/**
 * Uygulama genelinde tek hata tipi.
 *  - `message`: kullaniciya gosterilebilir Turkce metin ("ne oldu + ne yapmali").
 *  - `code`: sunucunun `error.code` alani (USAGE_LIMIT, AI_BUSY, BAD_PASSWORD, RATE_LIMIT ...)
 *            ya da istemci kodu: OFFLINE, NETWORK, SERVER_WAKING, SESSION_EXPIRED, HTTP_<durum>.
 *  - `status`: HTTP durum kodu (ag hatasinda 0).
 *  - `network`: istek sunucuya hic ulasmadi / sunucu gecici olarak kapali.
 * Hata turunu ayirt ederken metne degil `code`'a bak: `e.code === "USAGE_LIMIT"`.
 */
export class ApiError extends Error {
  status: number;
  network: boolean;
  code: string;
  /** AI_BUSY: Gemini'nin tahmini yeniden acilma suresi (dk); sunucu bilmiyorsa null. */
  retryMin: number | null;
  constructor(msg: string, status = 0, network = false, code?: string, retryMin: number | null = null) {
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.network = network;
    this.code = code || (network ? "NETWORK" : status ? `HTTP_${status}` : "UNKNOWN");
    this.retryMin = retryMin;
  }
}

/**
 * Tek kullanicili kurulumda sinir sahibin degil Gemini'nin: servis yogun/doluyken
 * her yerde ayni kisa cumle. `retryMin` sunucudan (error.retry_min) gelir.
 */
export function aiBusyMessage(retryMin?: number | null): string {
  if (retryMin && retryMin > 0) {
    if (retryMin >= 90) return `Gemini bugünlük doldu; yaklaşık ${Math.round(retryMin / 60)} saat sonra tekrar dene.`;
    return `Gemini şu an yoğun; ~${retryMin} dk sonra tekrar dene.`;
  }
  return "Gemini şu an yoğun; birkaç dakika sonra tekrar dene.";
}

/** Kisisel gunluk sinir (yalniz sahip disindaki hesaplarda tetiklenir). */
export const USAGE_LIMIT_MSG = "Bugünkü yapay zekâ kullanımın doldu; yarın yenilenir.";

/** Sunucunun `error` govdesinden kullaniciya gosterilecek metni secer (kod bazli sadelestirme). */
function messageFor(code: string | undefined, userMsg: string | undefined, retryMin: number | null, fallback: string): string {
  // Sure biliniyorsa tek tip kisa cumle; bilinmiyorsa sunucunun (gunluk/dakikalik ayrimli) metni.
  if (code === "AI_BUSY") return retryMin ? aiBusyMessage(retryMin) : (userMsg || aiBusyMessage());
  if (code === "USAGE_LIMIT") return userMsg || USAGE_LIMIT_MSG;
  return userMsg || fallback;
}

/** Herhangi bir hatadan kullaniciya gosterilecek metni cikarir (bilesenlerde `catch (e)` icin). */
export function errorMessage(e: unknown, fallback = "İşlem tamamlanamadı. Birkaç saniye sonra tekrar dene."): string {
  if (e instanceof ApiError) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    const m = (e as { message: string }).message;
    // Tarayici ic hatalari (TypeError: Failed to fetch vb.) kullaniciya gosterilmez.
    if (m && !/^(TypeError|Failed to fetch|NetworkError|Load failed)/i.test(m)) return m;
  }
  return fallback;
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const OFFLINE_MSG = "İnternet bağlantın yok. Bağlantın gelince tekrar dene.";
const WAKING_MSG = "Sunucu şu an hazırlanıyor. 20-30 saniye bekleyip tekrar dene.";
const NETWORK_MSG = "Sunucuya ulaşılamadı. Birkaç saniye sonra tekrar dene; sürerse sayfayı yenile.";

/** Sunucu kodsuz hata dondurdugunde duruma gore varsayilan metin. */
function statusMessage(status: number): string {
  if (status === 400 || status === 422) return "Gönderilen bilgilerde eksik ya da hatalı bir şey var. Alanları kontrol edip tekrar dene.";
  if (status === 403) return "Bu işlem için iznin yok. Doğru hesapla giriş yaptığından emin ol.";
  if (status === 404) return "Aradığın içerik bulunamadı; silinmiş olabilir. Sayfayı yenileyip tekrar dene.";
  if (status === 409) return "Bu işlem şu an yapılamıyor; içerik başka bir yerde değişmiş olabilir. Sayfayı yenileyip tekrar dene.";
  if (status === 413) return "Dosya çok büyük. Dosyayı bölerek ya da sıkıştırarak yükle.";
  if (status === 429) return "Çok sık deneme yapıldı. Birkaç dakika bekleyip tekrar dene.";
  if (status >= 500) return "Sunucuda beklenmedik bir sorun oldu. Birkaç saniye sonra tekrar dene; sürerse sayfayı yenile.";
  return "İşlem tamamlanamadı. Birkaç saniye sonra tekrar dene.";
}

/** Turkce harf iceren duz metin mi? (FastAPI'nin Ingilizce / dizi `detail` degerleri gosterilmez) */
function looksLikeUserText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length < 400 && /[çğıöşüÇĞİÖŞÜ]/.test(v);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * API cagrisi.
 * Yeniden deneme YALNIZ veri okuma (GET/HEAD) isteklerinde ve ag hatasi ya da sunucu uyanirken
 * (kodsuz 502/503/504) yapilir. POST/PUT/PATCH/DELETE otomatik tekrarlanmaz (cift kayit olmasin).
 * Cevrimdisiyken hic denenmez; "Internet baglantin yok" hatasi atilir.
 */
export async function api(path: string, opts: RequestInit = {}, retries = 3) {
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const method = (opts.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const attempts = idempotent ? Math.max(1, retries) : 1;

  let lastErr: ApiError | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(2500 * attempt);
    if (isOffline()) throw new ApiError(OFFLINE_MSG, 0, true, "OFFLINE");
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { ...opts, headers });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e;
      if (isOffline()) throw new ApiError(OFFLINE_MSG, 0, true, "OFFLINE");
      lastErr = new ApiError(NETWORK_MSG, 0, true, "NETWORK");
      continue;
    }
    if (res.status === 401 && token && !path.startsWith("/auth/")) {
      // Oturum suresi dolmus: kafa karistiran hata yerine giris sayfasina yonlendir, donunce ayni sayfaya gel
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next) + "&expired=1";
      }
      throw new ApiError("Oturum süresi doldu; yeniden giriş yapman gerekiyor.", 401, false, "SESSION_EXPIRED");
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* govde JSON degil */ }
      const errObj = (body as { error?: { code?: unknown; user_message?: unknown; retry_min?: unknown } } | null)?.error;
      const code = typeof errObj?.code === "string" ? errObj.code : undefined;
      const userMsg = typeof errObj?.user_message === "string" ? errObj.user_message : undefined;
      const retryMin = typeof errObj?.retry_min === "number" && errObj.retry_min > 0 ? Math.round(errObj.retry_min) : null;
      // Kodsuz 502/503/504: uygulama degil barindirma katmani cevap verdi (sunucu yeniden basliyor/uyaniyor).
      if (!code && (res.status === 502 || res.status === 503 || res.status === 504)) {
        lastErr = new ApiError(WAKING_MSG, res.status, true, "SERVER_WAKING");
        continue;
      }
      const detail = (body as { detail?: unknown } | null)?.detail;
      const msg = messageFor(code, userMsg, retryMin, looksLikeUserText(detail) ? detail : statusMessage(res.status));
      throw new ApiError(msg, res.status, false, code, retryMin);
    }
    return res.status === 204 ? null : res.json();
  }
  throw lastErr || new ApiError(NETWORK_MSG, 0, true, "NETWORK");
}

/** Token suresi 5 gunden az kaldiysa sessizce yeniler (uygulama acildikca). */
export async function refreshSessionIfNeeded() {
  const t = getToken();
  if (!t) return;
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const left = p.exp * 1000 - Date.now();
    if (left <= 0) return;                             // dolmus: ilk istek giris sayfasina goturur
    if (left > 5 * 24 * 3600 * 1000) return;
    const r = await api("/auth/refresh", { method: "POST" }, 1);
    if (r?.token) setToken(r.token);
  } catch { /* sessiz: yenileme olmazsa oturum suresi dolunca giris sayfasi acilir */ }
}
