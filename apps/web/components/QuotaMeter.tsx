"use client";
/**
 * Gemini durum göstergesi (TK-3, tek kullanıcı / sahip).
 *  - Normalde küçük bir nokta (yeşil). Gemini yoğun ya da doluysa nokta sarı/kırmızı olur ve
 *    yanında "Gemini yoğun, ~N dk" yazar (üst çubukta yer kaplamaz).
 *  - Sahip kişisel kullanım sınırından muaf: "günlük hakkın", "herkes" gibi metinler YOK.
 *  - Pencere: bugünkü çağrı sayıları (tür tür), model durumları, "Verilerin" (indir, gizlilik).
 * `/usage` yanıtındaki `service` ya eski biçimde metin ("aktif" | "yogun" | "doldu") ya da
 * yeni biçimde `{ state, retry_min }` gelir; ikisi de desteklenir.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { API, api, getToken } from "@/lib/api";
import { toast } from "@/components/Toast";
import Modal from "@/components/Modal";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

type M = { model: string; status: string; requests: number };
type Me = { used: number; limit: number; owner: boolean; reset_local?: string };
type ServiceState = "aktif" | "yogun" | "doldu";
type Service = ServiceState | { state: ServiceState; retry_min?: number | null } | undefined;
type U = {
  day: string; reset_at: string;
  kinds: Record<string, { requests: number; tokens: number }>;
  text_models: M[]; tts_models: M[];
  embed: { model: string; status: string } | unknown[];
  service?: Service;
  me?: Me;
};

const KIND: Record<string, string> = {
  metin: "Soru-cevap ve özetler", dizin: "Kaynak hazırlama", ses: "Seslendirme", video: "Video dökümü",
  "ses-dokum": "Ses kaydı dökümü", ocr: "Taranmış sayfa okuma", arama: "Web araması",
};
const ST: Record<string, { t: string; tone: BadgeTone }> = {
  aktif: { t: "çalışıyor", tone: "success" },
  dakikalik_dolu: { t: "kısa süre dolu", tone: "warning" },
  gunluk_doldu: { t: "bugün doldu", tone: "danger" },
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

/** `service` alanını tek biçime indirger. */
function readService(s: Service): { state: ServiceState; retryMin: number | null } {
  if (!s) return { state: "aktif", retryMin: null };
  if (typeof s === "string") return { state: s, retryMin: null };
  const r = typeof s.retry_min === "number" && s.retry_min > 0 ? Math.ceil(s.retry_min) : null;
  return { state: s.state || "aktif", retryMin: r };
}

export default function QuotaMeter({ compact }: { compact?: boolean }) {
  const [u, setU] = useState<U | null>(null);
  const [open, setOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [dl, setDl] = useState(false);
  const hid = useId();

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
  const { state, retryMin } = readService(u?.service);
  const busy = state !== "aktif";
  const dot = state === "doldu" ? "bg-danger" : state === "yogun" ? "bg-warning" : "bg-success";
  const resetHM = me?.reset_local
    || (u ? new Date(u.reset_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "");
  const resetAt = resetHM ? atTime(resetHM) : "";
  const wait = retryMin ? `~${retryMin} dk` : state === "doldu" && resetAt ? `saat ${resetAt}` : "birkaç dk";
  /** Üst çubuk / kenar menü metni: normalde yok, yoğunken kısa uyarı. */
  const short = !u ? "" : state === "doldu" ? `Gemini dolu, ${wait}` : state === "yogun" ? `Gemini yoğun, ${wait}` : "";
  const spoken = !u ? "Gemini durumu" : busy ? short : "Gemini çalışıyor";
  const total = u ? Object.values(u.kinds || {}).reduce((a, k) => a + (k?.requests || 0), 0) : 0;
  const todayUsed = me?.used ?? total;
  const embed = u && !Array.isArray(u.embed) ? (u.embed as { model: string; status: string }) : null;

  const band = !u ? null
    : state === "doldu" ? { c: "bg-danger-bg text-danger", t: `Gemini bugün doldu; ${retryMin ? `yaklaşık ${retryMin} dk sonra` : `saat ${resetAt} sonrası`} tekrar dene. Kayıtlı cevaplar, arama ve okuma çalışmaya devam ediyor.` }
    : state === "yogun" ? { c: "bg-warning-bg text-warning", t: `Gemini şu an yoğun; cevaplar gecikebilir. ${retryMin ? `Yaklaşık ${retryMin} dk sonra` : "Birkaç dakika sonra"} tekrar dene.` }
    : { c: "bg-success-bg text-success", t: "Gemini çalışıyor." };

  const StatusPill = ({ status }: { status: string }) => {
    const s = ST[status];
    return <Badge tone={s?.tone || "neutral"}>{s?.t || status}</Badge>;
  };

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={spoken} title={spoken}
                className="relative flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover">
          <span className={"h-2.5 w-2.5 rounded-full " + dot} aria-hidden="true" />
          {busy && <span className="sr-only">{short}</span>}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={spoken}
                className="flex min-h-[40px] items-center gap-2 rounded-md px-3 py-2 text-left text-text-secondary hover:bg-surface-hover">
          <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + dot} aria-hidden="true" />
          <span className={"min-w-0 flex-1 truncate text-small " + (busy ? "text-text-primary" : "")}>
            {busy ? short : "Gemini"}
          </span>
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Gemini kullanımı" size="md">
        {!u ? <p className="text-sm text-text-secondary" role="status">Yükleniyor…</p> : (
          <>
            {band && <p className={"rounded-xl px-3 py-2 text-sm " + band.c} role="status">{band.t}</p>}

            <div className="mt-3 rounded-xl border p-3">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">Bugünkü çağrılar</span>
                <span className="text-text-secondary">{todayUsed} çağrı{resetAt ? ` · sayaç saat ${resetAt} sıfırlanır` : ""}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                <Badge tone="accent" size="xs" title="1 Gemini çağrısı" aria-label="1 Gemini çağrısı">⚡1</Badge>{" "}
                rozetli düğmeler 1 Gemini çağrısı yapar. Kayıtlı cevaplar, arama ve okuma Gemini&apos;ye gitmez.
              </p>
            </div>

            {owner && (
              <>
                <h3 className="mb-1.5 mt-4 text-xs font-semibold text-text-secondary">Bugün tür tür · {total} çağrı</h3>
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
                          <StatusPill status={m.status} />
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
                          <StatusPill status={m.status} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {embed && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{embed.model} (kaynak hazırlama)</span>
                    <StatusPill status={embed.status} />
                  </div>
                )}
              </>
            )}

            <section className="mt-4 rounded-xl border p-3" aria-labelledby={hid + "-data"}>
              <h3 id={hid + "-data"} className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck size={15} aria-hidden="true" className="text-accent-purple" /> Verilerin
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Soruların ve kaynak metinlerin yanıt üretmek için Google Gemini&apos;ye gönderilir.
                Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli ya da kişisel belge yükleme.{" "}
                <Link href="/gizlilik" className="text-accent-purple underline underline-offset-2" onClick={() => setOpen(false)}>Gizlilik</Link>
              </p>
              <p className="mt-1.5 text-xs text-text-secondary">
                Verilerin haftada bir otomatik yedeklenir{lastBackup ? ` · son yedek: ${new Date(lastBackup).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : lastBackup === null ? " · ilk yedek birkaç dakika içinde alınır" : ""}.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={download} disabled={dl}>
                  {dl ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Verilerimi indir
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-text-secondary">
                İndirilen dosya (JSON) defterlerini, notlarını, sohbetlerini, taslaklarını ve kaynak metinlerini içerir; yüklediğin orijinal dosyalar içinde yer almaz.
              </p>
            </section>

            <p className="mt-4 text-xs leading-relaxed text-text-secondary">
              Tasarruf için: aynı ya da çok benzer soru tekrar sorulursa kayıtlı cevap gelir (çağrı yapılmaz), aynı metin ikinci kez
              hazırlanmaz, üretilen sesler saklanır.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
