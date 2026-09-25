"use client";
/**
 * Yapay zekâ kullanımı göstergesi (kenar çubuğu + pencere).
 *  - Herkes: kendi bugünkü kullanımı ("12/60 kullanım"), yenilenme saati (Türkiye saati, me.reset_local),
 *    servis durumu (aktif / yoğun / doldu; model adı vermeden).
 *  - Yalnız sahip (owner): uygulama geneli sayaçlar ve model listesi.
 *  - "Verilerin": verilerimi indir, hesabımı sil (DELETE /auth/me {password}), gizlilik bağlantısı.
 * Renk kişisel duruma göre; servis doluysa/yoğunsa o öne çıkar.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Gauge, Download, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { API, api, clearToken, errorMessage, getToken, ApiError } from "@/lib/api";
import { toast } from "@/components/Toast";
import Modal from "@/components/Modal";

type M = { model: string; status: string; requests: number };
type Me = { used: number; limit: number; owner: boolean; reset_local?: string };
type U = {
  day: string; reset_at: string;
  kinds: Record<string, { requests: number; tokens: number }>;
  text_models: M[]; tts_models: M[];
  embed: { model: string; status: string } | unknown[];
  service?: "aktif" | "yogun" | "doldu";
  me?: Me;
};

const KIND: Record<string, string> = {
  metin: "Soru-cevap ve özetler", dizin: "Kaynak hazırlama", ses: "Seslendirme", video: "Video dökümü",
  "ses-dokum": "Ses kaydı dökümü", ocr: "Taranmış sayfa okuma", arama: "Web araması",
};
const ST: Record<string, { t: string; c: string }> = {
  aktif: { t: "çalışıyor", c: "bg-green-500/15 text-green-800 dark:text-green-300" },
  dakikalik_dolu: { t: "kısa süre dolu", c: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  gunluk_doldu: { t: "bugün doldu", c: "bg-red-500/15 text-red-800 dark:text-red-300" },
};

/** "10:00" -> "10:00'da", "13:00" -> "13:00'te" (Türkçe bulunma eki; API'deki at_time ile aynı kural). */
export function atTime(hhmm: string): string {
  const DIG: Record<number, string> = { 0: "da", 1: "de", 2: "de", 3: "te", 4: "te", 5: "te", 6: "da", 7: "de", 8: "de", 9: "da" };
  const TENS: Record<number, string> = { 1: "da", 2: "de", 3: "da", 4: "ta", 5: "de" };
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const n = m || h;
  const sfx = n === 0 ? "da" : n % 10 ? DIG[n % 10] : TENS[Math.floor(n / 10)] || "da";
  return `${hhmm}'${sfx}`;
}

type Level = "ok" | "warn" | "full";
function personalLevel(me?: Me): Level {
  if (!me || me.owner || !me.limit) return "ok";
  if (me.used >= me.limit) return "full";
  if (me.used >= me.limit * 0.8) return "warn";
  return "ok";
}
function serviceLevel(u: U | null): Level {
  if (!u) return "ok";
  if (u.service === "doldu") return "full";
  if (u.service === "yogun") return "warn";
  return "ok";
}
const worst = (a: Level, b: Level): Level => (a === "full" || b === "full" ? "full" : a === "warn" || b === "warn" ? "warn" : "ok");

export default function QuotaMeter({ compact }: { compact?: boolean }) {
  const [u, setU] = useState<U | null>(null);
  const [open, setOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [dl, setDl] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  const pwId = useId();

  async function download() {
    setDl(true);
    try {
      const r = await fetch(API + "/me/export", { headers: { Authorization: "Bearer " + getToken() } });
      if (!r.ok) throw new Error();
      const b = await r.blob(); const url = URL.createObjectURL(b); const a = document.createElement("a");
      a.href = url; a.download = `typdf-verilerim-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      toast.error(typeof navigator !== "undefined" && navigator.onLine === false
        ? "İnternet bağlantın yok. Bağlantın gelince tekrar dene."
        : "Verilerin indirilemedi. Birkaç saniye sonra tekrar dene.");
    } finally { setDl(false); }
  }

  async function deleteAccount() {
    if (!pw) { setDelErr("Hesabını silmek için şifreni yaz."); return; }
    setDelBusy(true); setDelErr("");
    try {
      await api("/auth/me", { method: "DELETE", body: JSON.stringify({ password: pw }) });
      clearToken();
      window.location.href = "/login?deleted=1";
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setDelErr(code === "BAD_PASSWORD" ? "Şifre yanlış; hesabın silinmedi. Şifreni kontrol edip tekrar dene." : errorMessage(e));
      setDelBusy(false);
    }
  }

  async function load() { try { setU(await api("/usage", {}, 1)); } catch { /* gosterge sessizce eski degerde kalir */ } }
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  useEffect(() => {
    if (!open) return;
    load();
    api("/me/backup-status", {}, 1).then((r) => setLastBackup(r?.last_backup ?? null)).catch(() => setLastBackup(null));
  }, [open]);

  const me = u?.me;
  const owner = !!me?.owner;
  const pl = personalLevel(me);
  const sl = serviceLevel(u);
  const lv = worst(pl, sl);
  const dot = lv === "full" ? "bg-red-500" : lv === "warn" ? "bg-amber-500" : "bg-green-500";
  const resetHM = me?.reset_local
    || (u ? new Date(u.reset_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "");
  const resetAt = resetHM ? atTime(resetHM) : "";
  const unlimited = owner || !me?.limit;
  const short = !me ? "…" : unlimited ? `sınırsız · bugün ${me.used}` : `${me.used}/${me.limit} kullanım`;
  const spoken = !me ? "Yapay zekâ kullanımı" : unlimited
    ? `Yapay zekâ kullanımı: sınırsız, bugün ${me.used}`
    : `Yapay zekâ kullanımı: bugün ${me.used}/${me.limit}`;
  const total = u ? Object.values(u.kinds || {}).reduce((a, k) => a + (k?.requests || 0), 0) : 0;
  const embed = u && !Array.isArray(u.embed) ? (u.embed as { model: string; status: string }) : null;

  const band = !u ? null
    : pl === "full" ? { c: "bg-red-500/10 text-red-800 dark:text-red-300", t: `Bugünkü ${me!.limit} kullanımın doldu; saat ${resetAt} yenilenir. Kayıtlı cevaplar, arama ve okuma çalışmaya devam ediyor.` }
    : sl === "full" ? { c: "bg-red-500/10 text-red-800 dark:text-red-300", t: `Yapay zekâ şu an yoğun; birkaç dakika sonra tekrar dene. Sürerse saat ${resetAt} sonrası düzelir.` }
    : sl === "warn" ? { c: "bg-amber-500/10 text-amber-900 dark:text-amber-300", t: "Yapay zekâ şu an yoğun; cevaplar biraz gecikebilir. Birkaç dakika sonra tekrar dene." }
    : pl === "warn" ? { c: "bg-amber-500/10 text-amber-900 dark:text-amber-300", t: `Bugünkü kullanımın bitmek üzere (${me!.used}/${me!.limit}). Saat ${resetAt} yenilenir.` }
    : { c: "bg-green-500/10 text-green-900 dark:text-green-300", t: "Yapay zekâ çalışıyor." };

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={spoken} title={spoken}
                className="relative flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted">
          <Gauge size={18} aria-hidden="true" /><span className={"absolute right-2 top-2 h-2 w-2 rounded-full " + dot} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={spoken}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-secondary hover:bg-surface-muted">
          <Gauge size={18} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Yapay zekâ</span>
            <span className="block text-xs">{short}</span>
          </span>
          <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + dot} aria-hidden="true" />
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Yapay zekâ kullanımı" size="md">
        {!u ? <p className="text-sm text-text-secondary" role="status">Yükleniyor…</p> : (
          <>
            {band && <p className={"rounded-xl px-3 py-2 text-sm " + band.c} role="status">{band.t}</p>}

            {me && (
              <div className="mt-3 rounded-xl border p-3">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">Bugünkü kullanımın</span>
                  <span className="text-text-secondary">
                    {unlimited ? `${me.used} kullanım · sınırsız` : `Bugün ${me.used} / ${me.limit} kullanım`}
                  </span>
                </div>
                {!unlimited && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted" role="progressbar"
                       aria-valuemin={0} aria-valuemax={me.limit} aria-valuenow={Math.min(me.used, me.limit)}
                       aria-label="Bugünkü yapay zekâ kullanımı">
                    <div className={"h-full rounded-full " + (pl === "full" ? "bg-red-500" : pl === "warn" ? "bg-amber-500" : "bg-accent-purple")}
                         style={{ width: Math.min(100, (me.used / me.limit) * 100) + "%" }} />
                  </div>
                )}
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                  {owner && <>Uygulamayı kullanan herkesin ayrı günlük yapay zekâ kullanımı var; başkalarının kullanımı seninkinden düşmez. </>}
                  {!unlimited && <>Kalan: <b className="text-text-primary">{Math.max(0, me.limit - me.used)}</b> · her gün saat {resetAt} yenilenir. </>}
                  <span className="whitespace-nowrap rounded bg-accent-purple/10 px-1 font-medium text-accent-purple">⚡1</span> rozetli düğmeler 1 kullanım harcar.
                  Kayıtlı cevaplar, arama ve okuma ücretsiz.
                </p>
              </div>
            )}

            {owner && (
              <>
                <h3 className="mb-1.5 mt-4 text-xs font-semibold text-text-secondary">Bugün tüm uygulamada · {total} kullanım (yalnız sen görürsün)</h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.keys(KIND).map((k) => (
                    <div key={k} className="rounded-xl border p-2.5">
                      <p className="text-xs text-text-secondary">{KIND[k]}</p>
                      <p className="text-lg font-medium">{u.kinds?.[k]?.requests || 0}</p>
                    </div>
                  ))}
                </div>

                {u.text_models.length > 0 && (
                  <>
                    <h3 className="mb-1.5 mt-4 text-xs font-semibold text-text-secondary">Metin modelleri (sırayla denenir)</h3>
                    <ul className="space-y-1">
                      {u.text_models.map((m, i) => (
                        <li key={m.model} className="flex items-center gap-2 text-sm">
                          <span className="w-4 text-right text-xs text-text-secondary">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.model}</span>
                          <span className="text-xs text-text-secondary">{m.requests}</span>
                          <span className={"rounded-full px-2 py-0.5 text-xs " + (ST[m.status]?.c || "")}>{ST[m.status]?.t || m.status}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {u.tts_models.length > 0 && (
                  <>
                    <h3 className="mb-1.5 mt-4 text-xs font-semibold text-text-secondary">Ses modelleri</h3>
                    <ul className="space-y-1">
                      {u.tts_models.map((m) => (
                        <li key={m.model} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.model}</span>
                          <span className="text-xs text-text-secondary">{m.requests}</span>
                          <span className={"rounded-full px-2 py-0.5 text-xs " + (ST[m.status]?.c || "")}>{ST[m.status]?.t || m.status}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {embed && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{embed.model} (kaynak hazırlama)</span>
                    <span className={"rounded-full px-2 py-0.5 text-xs " + (ST[embed.status]?.c || "")}>{ST[embed.status]?.t || embed.status}</span>
                  </div>
                )}
              </>
            )}

            <section className="mt-4 rounded-xl border p-3" aria-labelledby={pwId + "-data"}>
              <h3 id={pwId + "-data"} className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck size={15} aria-hidden="true" className="text-accent-purple" /> Verilerin
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Sorularını ve kaynak metinlerini yanıt üretmek için Google Gemini&apos;ye gönderiyoruz.
                Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli ya da kişisel belge yükleme.{" "}
                <Link href="/gizlilik" className="text-accent-purple underline underline-offset-2" onClick={() => setOpen(false)}>Gizlilik</Link>
              </p>
              <p className="mt-1.5 text-xs text-text-secondary">
                Verilerin haftada bir otomatik yedeklenir{lastBackup ? ` · son yedek: ${new Date(lastBackup).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : lastBackup === null ? " · ilk yedek birkaç dakika içinde alınır" : ""}.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={download} disabled={dl}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:border-accent-purple/50 hover:text-accent-purple disabled:opacity-60">
                  {dl ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Verilerimi indir
                </button>
                {!owner && (
                  <button type="button" onClick={() => { setPw(""); setDelErr(""); setDelOpen(true); }}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-danger/40 px-3 text-sm text-danger hover:bg-danger/10">
                    <Trash2 size={14} aria-hidden="true" /> Hesabımı sil
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-text-secondary">
                İndirilen dosya (JSON) defterlerini, notlarını, sohbetlerini, taslaklarını ve kaynak metinlerini içerir; yüklediğin orijinal dosyalar içinde yer almaz.
              </p>
              {owner && <p className="mt-1.5 text-xs text-text-secondary">Uygulama sahibinin hesabı buradan silinemez.</p>}
            </section>

            <p className="mt-4 text-xs leading-relaxed text-text-secondary">
              Tasarruf için: aynı ya da çok benzer soru tekrar sorulursa kayıtlı cevap gelir (ücretsiz), aynı metin ikinci kez
              hazırlanmaz, üretilen sesler saklanır.
            </p>
          </>
        )}
      </Modal>

      <Modal open={delOpen} onClose={() => { if (!delBusy) setDelOpen(false); }} title="Hesabını sil" size="sm">
        <p className="text-sm text-text-secondary">
          Hesabın ve tüm verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.
        </p>
        <ul className="mt-3 space-y-1 rounded-xl bg-surface-muted/60 p-3 text-sm">
          <li className="text-danger">• Tüm defterlerin ve kaynakların (dosyalar dahil)</li>
          <li className="text-danger">• Notların, vurguların, sohbet geçmişin ve taslakların</li>
          <li className="text-danger">• Hesabın; aynı e-postayla yeniden kayıt olman gerekir</li>
          <li className="text-text-secondary">• Daha önce indirdiğin veri dosyaları bilgisayarında kalır</li>
        </ul>
        <p className="mt-2 text-xs text-text-secondary">
          Önce <button type="button" onClick={download} className="text-accent-purple underline underline-offset-2">verilerini indirmek</button> isteyebilirsin.
          Haftalık yedeklerdeki kopyalar bir süre sonra kendiliğinden silinir.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); deleteAccount(); }} className="mt-3">
          <label htmlFor={pwId} className="block text-sm font-medium">Onaylamak için şifreni yaz</label>
          <input id={pwId} type="password" autoComplete="current-password" data-autofocus="" value={pw}
                 onChange={(e) => { setPw(e.target.value); setDelErr(""); }}
                 aria-invalid={!!delErr} aria-describedby={delErr ? pwId + "-err" : undefined}
                 className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-danger" />
          {delErr && <p id={pwId + "-err"} role="alert" className="mt-1.5 text-sm text-danger">{delErr}</p>}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDelOpen(false)} disabled={delBusy}
                    className="min-h-[44px] rounded-xl border px-4 text-sm hover:bg-surface-muted sm:min-h-[40px]">Vazgeç</button>
            <button type="submit" disabled={delBusy || !pw}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-danger px-4 text-sm font-medium text-on-accent disabled:opacity-50 sm:min-h-[40px]">
              {delBusy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Hesabımı kalıcı olarak sil
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
