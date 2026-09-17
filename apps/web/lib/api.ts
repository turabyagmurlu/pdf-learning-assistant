export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}
export function setToken(t: string) { localStorage.setItem("token", t); }
export function clearToken() { localStorage.removeItem("token"); }

export class ApiError extends Error {
  status: number; network: boolean;
  constructor(msg: string, status = 0, network = false) { super(msg); this.status = status; this.network = network; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sunucu (Render ucretsiz plan) uyuyor ya da yeniden basliyor olabilir:
 *  ag hatasi ve 502/503/504'te 3 kez, artan bekleyisle yeniden dener. */
export async function api(path: string, opts: RequestInit = {}, retries = 3) {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";

  let lastErr: ApiError | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await sleep(2500 * attempt);
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { ...opts, headers });
    } catch (e: any) {
      lastErr = new ApiError("Sunucuya ulaşılamadı. Uyanıyor olabilir; tekrar deneniyor…", 0, true);
      continue;
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      lastErr = new ApiError("Sunucu yeniden başlıyor; tekrar deneniyor…", res.status, true);
      continue;
    }
    if (!res.ok) {
      let msg = "İstek başarısız.";
      try { const j = await res.json(); msg = j?.error?.user_message || j?.detail || msg; } catch {}
      throw new ApiError(msg, res.status);
    }
    return res.status === 204 ? null : res.json();
  }
  throw lastErr || new ApiError("Sunucuya ulaşılamadı.", 0, true);
}
