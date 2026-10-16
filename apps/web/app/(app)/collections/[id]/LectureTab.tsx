"use client";
/**
 * Dinle (sesli özet) — P1. Uygulamanın baş özelliği; ölçüt Spotify / Apple Podcasts / NotebookLM.
 * Üç görünüm, her biri tek kart:
 *  1) Hazır özet var (cihazda ses ya da metin)  → büyük oynatıcı kartı (LecturePlayer). ▶'ye tek dokunuş çalar
 *     (tıklama anında primeAudio: iOS kilidi). Kendiliğinden ÇALMAZ (iOS izin vermez); ▶ büyük ve odaklı gelir.
 *     `?tab=sesli&play=1` ile gelindiyse ▶ vurgulanır ve odaklanır (parametre adresten silinir).
 *  2) Hazır özet yok → "Bu defterin sesli özetini hazırla": Süre (Kısa ~5 · Standart ~12 · Derin ~25 dk) +
 *     Biçim (Tek anlatıcı · Sohbet) + tek düğme "Hazırla ⚡N".
 *  3) Hazırlanıyor → gerçek ilerleme (yazılan metin / hazır ses kısımları), "İlk bölüm hazır olunca çalmaya başlar", İptal.
 * İkincil ayarlar tek "⋯ Ayarlar" altında: anlatıcı sesi (VoicePicker), süre/biçim + "Yeniden hazırla ⚡N",
 * "Cihaz sesiyle dinle (ücretsiz)". Cihaz sesi yalnız kota dolunca ya da çevrimdışıyken öne çıkar.
 *
 * Akış (değişmedi): metin AKIŞLA gelir; ilk paragraflar gelince ilk ses kısmı arkada hazırlanır (ön parça);
 * ses kısım kısım gelir, ilki hazır olunca çalar; tamamlanınca cihaz önbelleğine (typdf-audio) yazılır.
 * Ses kalıcıdır: oturum AudioProvider'da yaşar; başka sayfaya geçince MiniPlayer devralır.
 * Sunucu sözleşmesi (P2, varsa kullanılır): istek gövdesinde `length`; SSE meta/done `chapters [{title, char_start}]`;
 * iş yanıtında `chapter_chunks [{title, chunk_index}]`; yanıtta `cost`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, MoreHorizontal, RefreshCw, Smartphone, X } from "lucide-react";
import { api, API, getToken } from "@/lib/api";
import { VOICE_CHANGED_EVENT, loadVoice, requestVoicePicker } from "@/lib/audio";
import { useAudioSession } from "@/components/audio/AudioProvider";
import LecturePlayer, { Bolt, type ChapterHint, type SavedListen } from "@/components/audio/LecturePlayer";
import { CoverBadge } from "@/components/CoverPicker";
import { DEFAULT_CPS, primeAudio, type QueueChunk } from "@/hooks/useAudioQueue";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { isUsageLimit } from "@/components/CostBadge";
import type { ConfirmOptions } from "@/components/Confirm";

type Voice = { id: string; label: string; sample_ready?: boolean };
type Fmt = "solo" | "dialog";
type Len = "kisa" | "standart" | "derin";
type JobState = {
  job_id: string; status: "running" | "ready" | "error"; done: number; total: number;
  ready_chunks: number[]; durations: Record<string, number>; texts: string[]; mime: string;
  error?: string | null; quota?: boolean; note?: string; waiting?: number; cached?: boolean; resumed?: boolean;
  chapter_chunks?: { title: string; chunk_index: number }[]; cost?: number;
};
type Manifest = { v: 2; n: number; texts: string[]; durations: number[]; mime: string; chapters?: ChapterHint[] };

const LENGTHS: { id: Len; label: string; min: number; chars: number }[] = [
  { id: "kisa", label: "Kısa", min: 5, chars: 4800 },
  { id: "standart", label: "Standart", min: 12, chars: 11000 },
  { id: "derin", label: "Derin", min: 25, chars: 23000 },
];
const FORMATS: { id: Fmt; label: string }[] = [{ id: "solo", label: "Tek anlatıcı" }, { id: "dialog", label: "Sohbet" }];
const TEXT_CAP = 30000;            // sunucu kendi sınırını uygular
const PART_CHARS = 2600;           // bir ses kısmı ≈ 2600 karakter ≈ 1 kullanım
const ttsCost = (chars: number) => Math.max(1, Math.ceil(chars / PART_CHARS));

const SPEAKER_LINE = /^\s*(Ayşe|Ayse|Kerem)\s*:/i;
function isDialogText(t: string): boolean {
  const lines = t.split("\n").filter((l) => l.trim());
  const hits = lines.filter((l) => SPEAKER_LINE.test(l)).length;
  return lines.length >= 4 && hits >= 4 && hits * 2 >= lines.length;
}

/** Akan metnin başından ön parça seç: KISA tutulur (~450–700 karakter) ki ilk ses birkaç saniyede gelsin.
 *  En az 1 paragraf (sohbette 2 replik); yarım kalmış son parça asla alınmaz. */
function pickHead(text: string, dialog: boolean): string | null {
  const parts = dialog ? text.split("\n").filter((l) => l.trim()) : text.split(/\n\s*\n/).filter((p) => p.trim());
  const minParts = dialog ? 2 : 1;
  if (parts.length <= minParts) return null;
  let head = "", cnt = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = (head ? head + "\n" + (dialog ? "" : "\n") : "") + parts[i].trim();
    if (next.length > 700 && cnt >= minParts) break;
    head = next; cnt++;
    if (head.length >= 450 && cnt >= minParts) break;
  }
  return head.length >= 300 && cnt >= minParts ? head : null;
}

/** P2: SSE `chapters [{title, char_start}]` → metin oranı (eski sunucunun paragraf işaretleri kullanılmaz). */
function streamHints(chs: unknown, len: number): ChapterHint[] {
  if (!Array.isArray(chs) || len <= 0) return [];
  const out: ChapterHint[] = [];
  for (const c of chs as { title?: unknown; char_start?: unknown }[]) {
    if (typeof c?.title === "string" && typeof c?.char_start === "number")
      out.push({ title: c.title, frac: Math.min(1, Math.max(0, c.char_start / len)) });
  }
  return out;
}
function jobHints(j: JobState): ChapterHint[] {
  return Array.isArray(j.chapter_chunks)
    ? j.chapter_chunks.filter((c) => typeof c?.title === "string" && typeof c?.chunk_index === "number")
        .map((c) => ({ title: c.title, chunk: c.chunk_index }))
    : [];
}
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch {} };

/** Küçük seçim grubu (radyo): ≥44px. */
function Choice<T extends string>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-text-secondary">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex rounded-2xl border bg-surface-muted/40 p-1">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled}
                  onClick={() => onChange(o.id)}
                  className={"flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-xl px-2 text-sm leading-tight disabled:opacity-60 " +
                    (value === o.id ? "bg-surface font-semibold text-text-primary shadow-soft ring-1 ring-accent-purple/40" : "text-text-secondary hover:text-text-primary")}>
            <span>{o.label}</span>
            {o.hint && <span className="text-xs font-normal text-text-secondary">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LectureTab({ id, title, readyN, confirm, coverColor, coverIcon }: {
  id: string; title: string; readyN: number;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  coverColor?: string | null; coverIcon?: string | null;
}) {
  const LEC_KEY = "lecture.text." + id;
  const POS_KEY = "lecture.pos." + id;
  const HINTS_KEY = "lecture.hints." + id;
  const [lecBusy, setLecBusy] = useState(false);
  const [lecture, setLecture] = useState("");
  const [lecErr, setLecErr] = useState("");
  const [lecNote, setLecNote] = useState("");
  const [fmt, setFmt] = useState<Fmt>("solo");
  const [len, setLen] = useState<Len>("standart");
  const [voice, setVoice] = useState("");
  const [voice2, setVoice2] = useState("");
  const [voiceList, setVoiceList] = useState<Voice[]>([]);
  const [studentList, setStudentList] = useState<Voice[]>([]);
  const [quotaOut, setQuotaOut] = useState(false);
  const [useBrowserVoice, setUseBrowserVoice] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [online, setOnline] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hints, setHints] = useState<ChapterHint[]>([]);
  const [prepCost, setPrepCost] = useState<number | null>(null);
  const [cacheTotal, setCacheTotal] = useState(0);
  const [savedChaps, setSavedChaps] = useState<SavedListen | null>(null);
  const [resumeAt, setResumeAt] = useState(0);

  // Kalıcı oturum (AudioProvider): yalnız bu defterinki gösterilir
  const audio = useAudioSession();
  const mine = audio.session && audio.session.collectionId === id ? audio.session : null;
  const jobLost = !!mine?.lost;
  const live = !!mine && !!mine.chunks && !mine.busy && !mine.lost;
  const [audioReady, setAudioReady] = useState(false);
  const runId = useRef(0);
  const textAbort = useRef<AbortController | null>(null);
  const headRef = useRef<string>("");
  /** Erken dinleme: metin hâlâ yazılırken ilk parçanın sesi hazırsa çalmaya başlanır; tam iş aynı oturumu sürdürür. */
  const earlyRef = useRef<{ key: number; signal: AbortSignal; text: string; url: string; blob: Blob; duration?: number } | null>(null);
  const streamingRef = useRef(false);
  const [headOn, setHeadOn] = useState(false);
  const playedKey = useRef("");

  const lectureIsDialog = isDialogText(lecture);
  const dialogAudio = lecture ? lectureIsDialog : fmt === "dialog";
  const voiceKey = voice + (dialogAudio ? "+" + voice2 : "");
  const AUDIO_KEY = "/typdf-audio/lecture/" + id + (voiceKey ? "/" + voiceKey : "");
  const CHAPS_KEY = "lecture.chaps." + AUDIO_KEY;
  const keyFor = (text: string) => {
    const vk = voice + (isDialogText(text) ? "+" + voice2 : "");
    return "/typdf-audio/lecture/" + id + (vk ? "/" + vk : "");
  };
  const lenInfo = LENGTHS.find((l) => l.id === len) || LENGTHS[1];
  const prepareCost = 1 + ttsCost(lenInfo.chars);                   // metin + ses
  const listenCost = ttsCost(Math.min(lecture.length, TEXT_CAP));    // yalnız ses (metin hazır)
  const fmtMismatch = !!lecture && (lectureIsDialog !== (fmt === "dialog"));

  // ---- Açılış: tercihler, sesler, metin, adres parametresi ----
  useEffect(() => {
    setCanSpeak(browserVoiceSupported());
    const t = lsGet(LEC_KEY); if (t) setLecture(t);
    const v = loadVoice(); if (v) setVoice(v);
    const v2 = lsGet("lecture.voice2"); if (v2) setVoice2(v2);
    const f = lsGet("lecture.format"); if (f === "dialog" || f === "solo") setFmt(f);
    const l = lsGet("lecture.length"); if (l === "kisa" || l === "standart" || l === "derin") setLen(l);
    try { const h = JSON.parse(lsGet(HINTS_KEY) || "null"); if (Array.isArray(h)) setHints(h); } catch {}
    (async () => {
      try {
        const r = await api("/lecture/voices");
        setVoiceList(r.voices || []); setStudentList(r.student_voices || []);
        setVoice((x) => x || r.default || ""); setVoice2((x) => x || r.default_student || "");
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine !== false);
    up();
    window.addEventListener("online", up); window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);

  // Kaldığın yer: açılışta ve oturum kapanınca yeniden oku
  const sessionKey = mine?.key ?? 0;
  useEffect(() => {
    const v = parseFloat(lsGet(POS_KEY) || "0") || 0;
    setResumeAt(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sessionKey, live]);

  // Cihazda hazır mı? (manifestten toplam süre de alınır)
  useEffect(() => {
    let alive = true;
    (async () => {
      let ready = false, tot = 0;
      try {
        if ("caches" in window) {
          const c = await caches.open("typdf-audio");
          const hit = await c.match(AUDIO_KEY);
          ready = !!hit;
          if (hit && (hit.headers.get("Content-Type") || "").includes("json")) {
            const man = (await hit.json()) as Manifest;
            tot = (man.durations || []).reduce((a, b) => a + (b || 0), 0);
            if (Array.isArray(man.chapters) && man.chapters.length) setHints((h) => (h.length ? h : man.chapters as ChapterHint[]));
          }
        }
      } catch {}
      if (!alive) return;
      setAudioReady(ready); setCacheTotal(tot);
      try { const s = JSON.parse(lsGet(CHAPS_KEY) || "null"); setSavedChaps(s && typeof s.total === "number" ? s : null); } catch { setSavedChaps(null); }
    })();
    return () => { alive = false; };
  }, [AUDIO_KEY, CHAPS_KEY]);

  // ?play=1 (defter başlığındaki "Dinle"): ▶ büyük ve odaklı; kendiliğinden çalma YOK (iOS izin vermez)
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || "";
  const playRef = useRef<HTMLButtonElement>(null);
  const [emphasize, setEmphasize] = useState(false);
  const wantPlay = sp?.get("play") === "1";
  useEffect(() => {
    if (!wantPlay) return;
    setEmphasize(true);
    const p = new URLSearchParams(sp?.toString() || ""); p.delete("play");
    router.replace(pathname + (p.toString() ? "?" + p.toString() : ""), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlay]);
  const hasReady = !!lecture && !lecBusy;
  useEffect(() => {
    if (!hasReady || live) return;
    const t = setTimeout(() => { try { playRef.current?.focus({ preventScroll: true }); } catch {} }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasReady, emphasize]);
  useEffect(() => { if (live) setEmphasize(false); }, [live]);

  function stopAudio() { audio.stopIf(id); setHeadOn(false); earlyRef.current = null; }
  function stopText() { runId.current++; try { textAbort.current?.abort(); } catch {} }
  useEffect(() => () => { stopText(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  function saveHints(h: ChapterHint[]) { setHints(h); if (h.length) lsSet(HINTS_KEY, JSON.stringify(h)); else lsDel(HINTS_KEY); }

  // ---- Metin: akışla hazırla ----
  async function makeLecture(refresh = false) {
    if (refresh) {
      const ok = await confirm({
        title: fmtMismatch ? (fmt === "dialog" ? "Özet sohbet olarak yeniden hazırlansın mı?" : "Özet tek anlatıcıyla yeniden hazırlansın mı?")
                           : "Özet yeniden hazırlansın mı?",
        description: `Yepyeni bir metin yazılır ve seslendirilir (${lenInfo.label}, ~${lenInfo.min} dk). Bu yaklaşık ${prepareCost} kullanım harcar.`,
        losses: ["Şu anki özet metni ve sesi değişir", "Kaldığın yer sıfırlanır"],
        confirmLabel: "Yeniden hazırla",
      });
      if (!ok) return;
    }
    setLecBusy(true); setLecErr(""); setLecNote(""); stopAudio();
    setUseBrowserVoice(false); setQuotaOut(false); setPrepCost(null);
    if (refresh || !lecture) { setLecture(""); saveHints([]); }
    headRef.current = ""; earlyRef.current = null; streamingRef.current = true;
    stopText();
    const myRun = ++runId.current;
    const ac = new AbortController(); textAbort.current = ac;
    let full = "", finalText = "";
    let newHints: ChapterHint[] = [];
    try {
      const res = await fetch(`${API}/collections/${id}/lecture/stream?format=${fmt}${refresh ? "&refresh=1" : ""}`, {
        method: "POST", signal: ac.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ length: len, format: fmt }),
      });
      if (!res.ok || !res.body) {
        let code = "", msg = "Sesli özet hazırlanamadı; birazdan tekrar dene.";
        try { const j = await res.json(); code = j?.error?.code || ""; if (typeof j?.error?.user_message === "string") msg = j.error.user_message; } catch {}
        if (code === "USAGE_LIMIT" || res.status === 429 || res.status === 503) setQuotaOut(true);
        throw new Error(msg);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      let headStarted = false, isCached = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n"); buf = events.pop() || "";
        for (const ev of events) {
          const lines = ev.split("\n");
          const type = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (!dataLine) continue;
          let data: any; try { data = JSON.parse(dataLine); } catch { continue; }
          if (type === "token") {
            full += data.text || ""; setLecture(full);
            if (!headStarted && !isCached && runId.current === myRun) {
              const head = pickHead(full, fmt === "dialog");
              if (head) { headStarted = true; headRef.current = head; setHeadOn(true); void startHeadJob(head, myRun); }
            }
          } else if (type === "meta") {
            isCached = !!data.cached;
            if (typeof data.cost === "number") setPrepCost(data.cost);
          } else if (type === "done") {
            finalText = data.script || full;
            newHints = streamHints(data.chapters, finalText.length);
            if (typeof data.cost === "number") setPrepCost(data.cost);
          } else if (type === "note") { setLecNote(typeof data.message === "string" ? data.message : ""); }
          else if (type === "error") {
            if (data.code === "USAGE_LIMIT" || data.code === "AI_BUSY") setQuotaOut(true);
            throw new Error(typeof data.message === "string" ? data.message : "Sesli özet hazırlanamadı; birazdan tekrar dene.");
          }
        }
      }
      streamingRef.current = false;
      if (runId.current !== myRun) return;
      const s = (finalText || full).trim();
      if (!s) throw new Error("Sesli özet hazırlanamadı; birazdan tekrar dene.");
      setLecture(s);
      lsSet(LEC_KEY, s);
      saveHints(newHints);
      if (refresh) {
        setAudioReady(false); setSavedChaps(null);
        lsDel(POS_KEY); setResumeAt(0);
        try {
          if ("caches" in window) {
            const c = await caches.open("typdf-audio");
            await clearCached(c, AUDIO_KEY);
            if (keyFor(s) !== AUDIO_KEY) await clearCached(c, keyFor(s));
          }
        } catch {}
        lsDel(CHAPS_KEY); lsDel("lecture.chaps." + keyFor(s));
      }
      setLecBusy(false);
      void playLecture(s, headRef.current);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (isUsageLimit(e)) setQuotaOut(true);
      setLecture(lsGet(LEC_KEY) || "");          // yarım metin oynatıcıya düşmesin: kayıtlı metne dön
      setLecErr(e?.message || "Sesli özet hazırlanamadı; birazdan tekrar dene.");
    } finally { if (runId.current === myRun) { streamingRef.current = false; setLecBusy(false); setHeadOn(false); } }
  }

  /** Ön parça: ilk kısmın sesi metin yazılırken sunucuda hazırlanır; tam iş onu aynen kullanır. */
  async function startHeadJob(head: string, myRun: number) {
    try {
      let st: JobState = await api(`/collections/${id}/lecture/tts`, {
        method: "POST", body: JSON.stringify({ text: head, voice: voice || undefined, voice2: voice2 || undefined, format: fmt, head }),
      }, 1);
      // İlk parça hazır olunca, metin hâlâ yazılıyorsa hemen çalmaya başla (bekleme yok)
      for (let i = 0; i < 60 && runId.current === myRun && streamingRef.current; i++) {
        if (st.status === "error") return;
        if ((st.ready_chunks || []).includes(0)) break;
        await new Promise((r) => setTimeout(r, 1500));
        st = await api(`/tts/jobs/${st.job_id}/chunks`);
      }
      if (runId.current !== myRun || !streamingRef.current || !(st.ready_chunks || []).includes(0)) return;
      if (audio.session && audio.session.collectionId !== id) return;      // başka bir şey çalıyor: dokunma
      const res = await fetch(`${API}/tts/jobs/${st.job_id}/chunks/0`, { headers: { Authorization: "Bearer " + getToken() } });
      if (!res.ok) return;
      const blob = await res.blob();
      if (blob.size < 500 || runId.current !== myRun || !streamingRef.current) return;
      const url = URL.createObjectURL(blob);
      const text = st.texts?.[0] || head;
      const duration = st.durations?.["0"];
      lsDel(POS_KEY); setResumeAt(0);                 // yeni anlatım baştan
      const dialog = fmt === "dialog";
      const { key, signal } = audio.play({
        collectionId: id, title, artwork: "/icon", storageKey: POS_KEY, autoPlay: true,
        subtitle: `Sesli özet · ${dialog ? "Sohbet" : "Tek anlatıcı"}`,
        chunks: [{ text, url, duration }, { text: "" }], total: 2,
      });
      audio.update(key, { busy: false, note: "Devamı hazırlanıyor…" });
      earlyRef.current = { key, signal, text, url, blob, duration };
    } catch { /* tam iş zaten üretecek */ }
  }

  async function clearCached(c: Cache, key: string) {
    const m = await c.match(key);
    if (m) {
      try { if ((m.headers.get("Content-Type") || "").includes("json")) { const man = (await m.json()) as Manifest; for (let i = 0; i < man.n; i++) await c.delete(key + "/" + i); } } catch {}
      await c.delete(key);
    }
  }

  // ---- Ses: cihaz önbelleği ya da parçalı iş ----
  async function fromCache(cacheKey: string, text: string, key: number): Promise<QueueChunk[] | null> {
    const made: string[] = [];
    const mk = (b: Blob) => { const u = URL.createObjectURL(b); made.push(u); return u; };
    try {
      if (!("caches" in window)) return null;
      const c = await caches.open("typdf-audio");
      const hit = await c.match(cacheKey);
      if (!hit) return null;
      let out: QueueChunk[];
      if ((hit.headers.get("Content-Type") || "").includes("json")) {
        const man = (await hit.json()) as Manifest;
        out = [];
        for (let i = 0; i < man.n; i++) {
          const r = await c.match(cacheKey + "/" + i);
          if (!r) { made.forEach((u) => URL.revokeObjectURL(u)); return null; }
          out.push({ text: man.texts[i] || "", url: mk(await r.blob()), duration: man.durations[i] });
        }
        if (Array.isArray(man.chapters) && man.chapters.length) saveHints(man.chapters);
      } else {
        out = [{ text, url: mk(await hit.blob()) }];
      }
      if (!audio.isCurrent(key)) { made.forEach((u) => URL.revokeObjectURL(u)); return null; }
      return out;
    } catch { made.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} }); return null; }
  }

  async function playLecture(text = lecture, head = "") {
    if (!text) return;
    const dialog = isDialogText(text);
    const cacheKey = keyFor(text);
    playedKey.current = cacheKey;
    const early = earlyRef.current && audio.isCurrent(earlyRef.current.key) ? earlyRef.current : null;
    earlyRef.current = null;
    const { key, signal } = early ? { key: early.key, signal: early.signal } : audio.play({
      collectionId: id, title, artwork: "/icon", storageKey: POS_KEY, autoPlay: true,
      subtitle: `Sesli özet · ${dialog ? "Sohbet" : "Tek anlatıcı"}`,
    });
    setLecErr(""); setQuotaOut(false); setUseBrowserVoice(false);
    try {
      const cached = early ? null : await fromCache(cacheKey, text, key);
      if (!audio.isCurrent(key)) return;
      if (cached) { audio.update(key, { chunks: cached, total: cached.length, busy: false }); return; }
      const job: JobState = await api(`/collections/${id}/lecture/tts`, {
        method: "POST",
        body: JSON.stringify({ text: text.slice(0, TEXT_CAP), voice: voice || undefined, voice2: voice2 || undefined,
                               format: dialog ? "dialog" : "solo", head: head || undefined }),
      }, 1);
      const jh = jobHints(job);
      if (jh.length) saveHints(jh);
      if (typeof job.cost === "number") setPrepCost(job.cost);
      await followJob(job, key, signal, cacheKey, jh, early);
    } catch (e: any) {
      if (!audio.isCurrent(key)) return;
      if (e?.quota || isUsageLimit(e) || e?.code === "AI_BUSY") setQuotaOut(true);
      setLecErr(String(e?.message || "") || "Ses hazırlanamadı; biraz sonra tekrar dene.");
      audio.stop();
    }
  }

  async function followJob(first: JobState, key: number, signal: AbortSignal, cacheKey: string, jh: ChapterHint[],
                           early: { url: string; blob: Blob; text: string; duration?: number } | null = null) {
    const jid = first.job_id;
    const total = first.total || first.texts.length;
    const list: QueueChunk[] = first.texts.map((t) => ({ text: t }));
    const fetched = new Set<number>();
    const blobs: (Blob | null)[] = new Array(total).fill(null);
    // Erken çalan ilk parça aynı metinse aynı adresle kalır (çalma kesilmez)
    if (early && list[0] && list[0].text === early.text) {
      list[0] = { text: early.text, url: early.url, duration: early.duration };
      fetched.add(0); blobs[0] = early.blob;
    } else if (early) {
      // Eşleşmedi: baştan, tam işle devam et
      try { URL.revokeObjectURL(early.url); } catch {}
    }
    if (!audio.update(key, { chunks: [...list], total, ...(early ? { note: "" } : {}) })) return;
    let st: JobState = first;

    async function pull(n: number) {
      if (fetched.has(n)) return; fetched.add(n);
      const res = await fetch(`${API}/tts/jobs/${jid}/chunks/${n}`, { headers: { Authorization: "Bearer " + getToken() }, signal });
      if (!res.ok) { fetched.delete(n); return; }
      const b = await res.blob();
      if (b.size < 500) { fetched.delete(n); return; }
      if (!audio.isCurrent(key)) return;
      blobs[n] = b;
      const u = URL.createObjectURL(b);
      list[n] = { text: list[n].text, url: u, duration: st.durations?.[String(n)] };
      if (!audio.update(key, n === 0 ? { chunks: [...list], busy: false } : { chunks: [...list] })) URL.revokeObjectURL(u);
    }

    for (let i = 0; i < 600 && audio.isCurrent(key); i++) {
      for (const n of st.ready_chunks || []) await pull(n);
      audio.update(key, { note: st.note || "" });
      if (st.status === "error") {
        const err: any = new Error(st.error || "Ses şu an hazırlanamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.");
        err.quota = !!st.quota; throw err;
      }
      if (st.status === "ready" && fetched.size >= total) break;
      await new Promise((r) => setTimeout(r, 2000));
      if (!audio.isCurrent(key)) return;
      try { st = await api(`/tts/jobs/${jid}/chunks`); }
      catch (e: any) {
        if (e?.status === 404) { audio.update(key, { lost: true, busy: false, note: "" }); return; }
      }
    }
    if (!audio.isCurrent(key)) return;
    audio.update(key, { busy: false });
    if (blobs.every((b) => !!b)) {
      try {
        if ("caches" in window) {
          const c = await caches.open("typdf-audio");
          for (let n = 0; n < total; n++) await c.put(cacheKey + "/" + n, new Response(blobs[n] as Blob, { headers: { "Content-Type": (blobs[n] as Blob).type || st.mime || "audio/mpeg" } }));
          const man: Manifest = { v: 2, n: total, texts: list.map((x) => x.text), durations: list.map((x) => x.duration || 0), mime: st.mime,
                                  ...(jh.length ? { chapters: jh } : {}) };
          await c.put(cacheKey, new Response(JSON.stringify(man), { headers: { "Content-Type": "application/json" } }));
          setAudioReady(true);
          setCacheTotal(man.durations.reduce((a, b) => a + b, 0));
        }
      } catch {}
    }
  }

  function cancelAll() {
    const wasWriting = lecBusy;
    stopText(); stopAudio(); setLecBusy(false);
    if (wasWriting) setLecture(lsGet(LEC_KEY) || "");   // yarım metin kalmasın
  }

  /** Boştaki ▶ / bölüm / çubuk: tıklama anında SENKRON primeAudio (iOS), sonra başlat. */
  function startListening(at: number | null) {
    primeAudio();
    if (at === 0) { lsDel(POS_KEY); setResumeAt(0); }
    else if (at != null && at > 0) lsSet(POS_KEY, String(at));
    void playLecture();
  }

  // Ses başka yerden (VoicePicker) değişti
  useEffect(() => {
    const onChanged = (e: Event) => {
      const v = String((e as CustomEvent).detail?.voice || "");
      if (v && v !== "__device") setVoice((cur) => (cur === v ? cur : v));
    };
    window.addEventListener(VOICE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, onChanged);
  }, []);

  const onSaveChapters = useCallback((s: SavedListen) => {
    lsSet(CHAPS_KEY, JSON.stringify(s)); setSavedChaps(s);
  }, [CHAPS_KEY]);

  // ---- Görünüm ----
  // Cihazdaki ses yüklenirken (birkaç ms) hazırlık kartı yanıp sönmesin: oynatıcı kartı kalır
  const preparing = lecBusy || (!!mine && !live && !mine.lost && !audioReady);
  const view: "setup" | "prep" | "player" = preparing ? "prep" : (live || hasReady || jobLost) ? "player" : "setup";
  const deviceFirst = !!lecture && canSpeak && (quotaOut || (!online && !audioReady));
  const stale = live && !!playedKey.current && playedKey.current !== AUDIO_KEY;
  const voiceName = voiceList.find((v) => v.id === voice);
  const cover = { id, color: coverColor, icon: coverIcon };
  const idleSaved: SavedListen | null = savedChaps
    || (cacheTotal > 0 ? { total: cacheTotal, chapters: [] }
    : lecture ? { total: Math.min(lecture.length, TEXT_CAP) / DEFAULT_CPS, chapters: [], approx: true } : null);

  const setPref = {
    fmt: (k: Fmt) => { setFmt(k); lsSet("lecture.format", k); },
    len: (k: Len) => { setLen(k); lsSet("lecture.length", k); },
  };
  const lenOptions = LENGTHS.map((l) => ({ id: l.id, label: l.label, hint: `~${l.min} dk` }));

  const errorBox = (lecErr || deviceFirst) && (
    <div role={quotaOut || deviceFirst ? "status" : "alert"}
         className={"mt-3 rounded-2xl px-4 py-3 text-sm " + (quotaOut || deviceFirst ? "border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border border-danger/30 text-danger")}>
      <p>{lecErr || (!online ? "İnternet yok. Bu özetin sesi cihazında değil; cihaz sesiyle hemen dinleyebilirsin." : "")}</p>
      {deviceFirst && (
        <button type="button" onClick={() => { stopAudio(); setLecErr(""); setUseBrowserVoice(true); }}
                className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 font-medium text-white">
          <Smartphone size={16} aria-hidden /> Cihaz sesiyle dinle (ücretsiz)
        </button>
      )}
    </div>
  );

  const settings = (
    <div className="mt-3">
      <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}
              className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-sm text-text-secondary hover:bg-black/5 hover:text-text-primary">
        <MoreHorizontal size={18} aria-hidden /> Ayarlar
      </button>
      {settingsOpen && (
        <div className="mt-1 space-y-4 rounded-2xl border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-secondary">{dialogAudio ? "Ayşe'nin sesi (anlatan)" : "Anlatıcı sesi"}</p>
              <p className="truncate text-sm">{voiceName ? `${voiceName.id} · ${voiceName.label}` : voice || "Varsayılan"}</p>
            </div>
            <button type="button" onClick={requestVoicePicker}
                    className="min-h-[44px] shrink-0 rounded-xl border px-3 text-sm hover:bg-black/5">Değiştir</button>
          </div>
          {dialogAudio && studentList.length > 0 && (
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">Kerem'in sesi (soran)</span>
              <select value={voice2} onChange={(e) => { setVoice2(e.target.value); lsSet("lecture.voice2", e.target.value); }}
                      className="mt-1 min-h-[44px] w-full rounded-xl border bg-surface px-3 text-sm">
                {studentList.map((v) => <option key={v.id} value={v.id}>{v.id} · {v.label}</option>)}
              </select>
            </label>
          )}
          {lecture && (
            <>
              <Choice label="Süre" value={len} options={lenOptions} onChange={setPref.len} disabled={lecBusy} />
              <Choice label="Biçim" value={fmt} options={FORMATS} onChange={setPref.fmt} disabled={lecBusy} />
              <button type="button" onClick={() => { primeAudio(); void makeLecture(true); }} disabled={lecBusy}
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium hover:bg-black/5 disabled:opacity-60">
                <RefreshCw size={15} aria-hidden /> Yeniden hazırla <Bolt n={prepareCost} />
              </button>
            </>
          )}
          {lecture && canSpeak && !deviceFirst && (
            <button type="button" onClick={() => { stopAudio(); setUseBrowserVoice(true); setSettingsOpen(false); }}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm text-text-secondary hover:bg-black/5 hover:text-text-primary">
              <Smartphone size={15} aria-hidden /> Cihaz sesiyle dinle (ücretsiz)
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ---- 2) Hazır özet yok ----
  if (view === "setup") {
    return (
      <div className="mx-auto max-w-xl">
        <section className="rounded-3xl border bg-surface p-5 shadow-soft sm:p-6">
          <div className="flex items-center gap-3">
            <CoverBadge id={id} color={coverColor} icon={coverIcon} size={56} />
            <div className="min-w-0">
              <h2 className="font-heading text-xl leading-tight">Bu defterin sesli özetini hazırla</h2>
              <p className="mt-0.5 text-sm text-text-secondary">{readyN} kaynağı dinlenebilir bir anlatıma çeviririm; yolda dinlersin.</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <Choice label="Süre" value={len} options={lenOptions} onChange={setPref.len} />
            <Choice label="Biçim" value={fmt} options={FORMATS} onChange={setPref.fmt} />
          </div>
          <button type="button" onClick={() => { primeAudio(); void makeLecture(false); }}
                  className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent-purple px-5 text-base font-semibold text-white shadow-soft active:scale-[0.99]">
            Hazırla <Bolt n={prepareCost} onAccent />
          </button>
          <p className="mt-2 text-center text-xs text-text-secondary">
            İlk bölüm hazır olunca çalmaya başlar · yaklaşık {prepareCost} kullanım · hazır ses cihazında saklanır
          </p>
        </section>
        {errorBox}
        {settings}
      </div>
    );
  }

  // ---- 3) Hazırlanıyor ----
  if (view === "prep") {
    const totalParts = mine?.total || 0;
    const readyParts = mine?.chunks ? mine.chunks.filter((c) => !!c.url).length : 0;
    const textPct = lecBusy ? Math.min(0.95, lecture.length / lenInfo.chars) : 1;
    const audioPct = totalParts > 0 ? readyParts / totalParts : 0;
    const pct = Math.round(lecBusy ? textPct * 70 : 70 + Math.max(0.04, audioPct) * 30);
    return (
      <div className="mx-auto max-w-xl">
        <section aria-busy="true" className="rounded-3xl border bg-surface p-5 shadow-soft sm:p-6">
          <div className="flex items-center gap-3">
            <CoverBadge id={id} color={coverColor} icon={coverIcon} size={56} />
            <div className="min-w-0">
              <h2 className="font-heading text-xl leading-tight">Sesli özet hazırlanıyor</h2>
              <p className="mt-0.5 truncate text-sm text-text-secondary">{title}</p>
            </div>
          </div>
          <div className="mt-5" role="progressbar" aria-label="Hazırlık" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-accent-purple transition-[width] duration-500" style={{ width: pct + "%" }} />
            </div>
            <p className="mt-1 text-right text-xs tabular-nums text-text-secondary">%{pct}</p>
          </div>
          <ol className="mt-2 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              {lecBusy ? <Loader2 size={16} className="animate-spin text-accent-purple" aria-hidden /> : <Check size={16} className="text-accent-purple" aria-hidden />}
              <span>{lecBusy ? `Metin yazılıyor… (${Math.round(textPct * 100)}%)` : "Metin hazır"}</span>
            </li>
            <li className={"flex items-center gap-2 " + (lecBusy && !headOn ? "text-text-secondary" : "")}>
              {lecBusy && !headOn ? <span className="h-4 w-4 rounded-full border" aria-hidden /> : <Loader2 size={16} className="animate-spin text-accent-purple" aria-hidden />}
              <span>
                {lecBusy ? (headOn ? "İlk bölümün sesi şimdiden hazırlanıyor" : "Ses hazırlanacak")
                  : totalParts > 0 ? `İlk bölüm seslendiriliyor (${readyParts}/${totalParts} kısım hazır)` : "Ses hazırlanıyor…"}
              </span>
            </li>
          </ol>
          <p role="status" className="mt-4 rounded-2xl bg-accent-purple/10 px-4 py-3 text-sm text-text-primary">
            İlk bölüm hazır olunca çalmaya başlar. Bu sırada başka sayfaya geçebilirsin.
            {prepCost != null && <> <Bolt n={prepCost} /></>}
          </p>
          {lecNote && <p role="status" className="mt-2 text-sm text-text-secondary">{lecNote}</p>}
          {mine?.note && <p role="status" className="mt-2 text-sm text-text-secondary">{mine.note}</p>}
          <button type="button" onClick={cancelAll}
                  className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border px-4 text-sm text-text-secondary hover:bg-black/5">
            <X size={16} aria-hidden /> İptal
          </button>
          {lecture && (
            <details className="mt-3 rounded-2xl bg-surface-muted/40 px-4">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium">Yazılan metni göster</summary>
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap pb-4 text-sm leading-relaxed">
                {lecture}{lecBusy && <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded bg-accent-purple align-middle" aria-hidden />}
              </div>
            </details>
          )}
        </section>
      </div>
    );
  }

  // ---- 1) Oynatıcı ----
  const aside = (
    <>
      {jobLost && (
        <div role="status" className="mt-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <p>Ses hazırlığı yarıda kaldı. Hazır kısımlar saklandı; yeniden başlatınca hızlı tamamlanır.</p>
          <button type="button" onClick={() => startListening(null)} className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-white">
            <RefreshCw size={15} aria-hidden /> Yeniden başlat
          </button>
        </div>
      )}
      {errorBox}
      {useBrowserVoice && lecture && (
        <div className="mt-3"><BrowserVoice text={lecture} onClose={() => setUseBrowserVoice(false)} /></div>
      )}
      {settings}
    </>
  );

  return (
    <div className="max-w-5xl">
      <LecturePlayer
        live={live} stale={stale}
        title={title}
        subtitle={`Sesli özet · ${lectureIsDialog ? "Sohbet" : "Tek anlatıcı"}`}
        cover={cover}
        hints={hints}
        saved={idleSaved}
        onSaveChapters={onSaveChapters}
        resumeAt={live && !stale ? 0 : resumeAt}
        startCost={audioReady && !stale ? 0 : listenCost}
        onStart={startListening}
        text={lecture}
        dialog={lectureIsDialog}
        playRef={playRef}
        emphasize={emphasize}
        aside={aside}
      />
    </div>
  );
}
