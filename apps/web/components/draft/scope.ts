/**
 * Taslak kapsamı: defter taslağı (collection) ya da belge taslağı (document). Aynı editör, iki uç takımı.
 *  - defter:  GET /collections/{id}/draft · PATCH /collections/{id} {draft, draft_rev} (çakışmada 200 + conflict:true)
 *  - belge:   GET /documents/{id}/draft  · PATCH /documents/{id}/draft {draft, draft_rev} (çakışmada 409 + {draft, draft_rev})
 * İkisinde de: POST …/draft/blocks, POST …/draft/import-highlights.
 */
import { api, API, getToken, ApiError, isOffline } from "@/lib/api";

export type DraftScope = { kind: "collection" | "document"; id: string };

const base = (s: DraftScope) => (s.kind === "collection" ? `/collections/${s.id}` : `/documents/${s.id}`);

export const draftUrl = (s: DraftScope) => `${base(s)}/draft`;
export const saveUrl = (s: DraftScope) => (s.kind === "collection" ? `/collections/${s.id}` : `/documents/${s.id}/draft`);
export const blocksUrl = (s: DraftScope) => `${base(s)}/draft/blocks`;
export const importUrl = (s: DraftScope) => `${base(s)}/draft/import-highlights`;
/** Yerel yedek anahtarları. Defterde eski anahtarlar korunur (yarım kalmış kayıtlar kaybolmasın). */
export const backupKey = (s: DraftScope) => (s.kind === "collection" ? "draft.pending." + s.id : "draft.pending.doc." + s.id);
export const baseKey = (s: DraftScope) => (s.kind === "collection" ? "draft.base." + s.id : "draft.base.doc." + s.id);

export type RemoteDraft = { draft: string | null; draft_rev: number };

export async function fetchDraft(s: DraftScope): Promise<RemoteDraft> {
  const r = await api(draftUrl(s), {}, 2);
  return { draft: r?.draft ?? null, draft_rev: typeof r?.draft_rev === "number" ? r.draft_rev : 0 };
}

export type SaveResult = { ok: true; draft_rev?: number } | { ok: false; conflict: true; draft: string | null; draft_rev: number };

/**
 * Taslağı koşullu kaydeder. Çakışmayı (defterde 200 + conflict, belgede 409) tek biçimde döndürür;
 * diğer hatalar fırlatılır (çağıran yeniden dener).
 */
export async function saveDraft(s: DraftScope, draft: string, rev: number): Promise<SaveResult> {
  if (isOffline()) throw new ApiError("İnternet bağlantın yok.", 0, true, "OFFLINE");
  const payload: { draft: string; draft_rev?: number } = { draft };
  if (rev >= 0) payload.draft_rev = rev;
  let res: Response;
  try {
    res = await fetch(`${API}${saveUrl(s)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() || "") },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError("Sunucuya ulaşılamadı.", 0, true, "NETWORK");
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* govde yok */ }
  if (res.status === 409 || body?.conflict) {
    let draftStr: string | null | undefined = body?.draft ?? body?.error?.draft;
    let r: number | undefined = typeof body?.draft_rev === "number" ? body.draft_rev : body?.error?.draft_rev;
    if (draftStr === undefined || typeof r !== "number") {
      const cur = await fetchDraft(s);
      draftStr = cur.draft; r = cur.draft_rev;
    }
    return { ok: false, conflict: true, draft: draftStr ?? null, draft_rev: r as number };
  }
  if (!res.ok) throw new ApiError("Taslak kaydedilemedi.", res.status, res.status >= 502, undefined);
  return { ok: true, draft_rev: typeof body?.draft_rev === "number" ? body.draft_rev : undefined };
}

/** Sayfadan çıkarken son deneme (keepalive). */
export function beaconSave(s: DraftScope, draft: string, rev: number) {
  try {
    fetch(`${API}${saveUrl(s)}`, {
      method: "PATCH", keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() || "") },
      body: JSON.stringify(rev >= 0 ? { draft, draft_rev: rev } : { draft }),
    });
  } catch { /* sessiz */ }
}
