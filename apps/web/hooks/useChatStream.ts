"use client";
import { useState, useCallback } from "react";
import { API, getToken } from "@/lib/api";

export type Citation = { n: number; page: number; section?: string; snippet: string };
export type ChatError = { code?: string; message: string };
export type ChatResult = { answer: string; citations: Citation[]; cached: boolean; error: ChatError | null };

/** Hata kodunu kullanicinin anlayacagi, "ne oldu + ne yapmali" metnine cevirir.
 *  Metne (ornegin "kota" kelimesine) degil `code` alanina bakar. */
export function chatErrorText(code?: string, serverMsg?: string): string {
  if (code === "USAGE_LIMIT") {
    // Sunucu "Bugünkü 60 kullanımın doldu; saat HH:MM'de yenilenir." gonderir; yoksa sade yedek.
    return serverMsg || "Bugünkü yapay zekâ kullanımın doldu; yarın yenilenir. Kayıtlı cevaplar, arama ve okuma çalışmaya devam ediyor.";
  }
  if (code === "AI_BUSY") return "Yapay zekâ şu an yoğun; birkaç dakika sonra tekrar dene.";
  if (code === "RATE_LIMIT") return "Çok hızlı soru gönderdin; birkaç saniye bekleyip tekrar dene.";
  if (code === "OFFLINE") return "İnternet bağlantın yok. Bağlanınca tekrar sor.";
  return serverMsg || "Cevap alınamadı; birazdan tekrar dene.";
}

export function useChatStream(sessionId: string) {
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);

  /** Soruyu gonderir; akarken durum gunceller, bitince sonucu DONDURUR
   *  (cagiran, React durumunun guncellenmesini beklemeden sohbete ekleyebilsin). */
  const ask = useCallback(async (question: string, sid?: string): Promise<ChatResult> => {
    setAnswer(""); setCitations([]); setCached(false); setError(null); setLoading(true);
    let full = "", wasCached = false, err: ChatError | null = null;
    const cites: Citation[] = [];
    const fail = (e: ChatError) => { err = e; setError(e); };
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        fail({ code: "OFFLINE", message: chatErrorText("OFFLINE") });
        return { answer: full, citations: cites, cached: wasCached, error: err };
      }
      const token = getToken();
      let res: Response;
      try {
        res = await fetch(`${API}/chat/sessions/${sid || sessionId}/messages?token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: question }),
        });
      } catch {
        const off = typeof navigator !== "undefined" && navigator.onLine === false;
        fail({ code: off ? "OFFLINE" : "NETWORK",
               message: off ? chatErrorText("OFFLINE") : "Sunucuya ulaşılamadı; birkaç saniye sonra tekrar sor." });
        return { answer: full, citations: cites, cached: wasCached, error: err };
      }
      if (!res.ok) {
        // akis baslamadan gelen hata: {"error":{"code","user_message"}}
        let code: string | undefined, msg: string | undefined;
        try { const j = await res.json(); code = j?.error?.code; msg = typeof j?.error?.user_message === "string" ? j.error.user_message : undefined; } catch {}
        if (!code && res.status === 429) code = "USAGE_LIMIT";
        if (!code && res.status === 503) code = "AI_BUSY";
        fail({ code, message: chatErrorText(code, msg) });
        return { answer: full, citations: cites, cached: wasCached, error: err };
      }
      if (!res.body) {
        fail({ message: chatErrorText() });
        return { answer: full, citations: cites, cached: wasCached, error: err };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() || "";
        for (const ev of events) {
          const lines = ev.split("\n");
          const type = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (!dataLine) continue;
          let data: any;
          try { data = JSON.parse(dataLine); } catch { continue; }
          if (type === "token") { full += data.text || ""; setAnswer(full); }
          else if (type === "citation") { cites.push(data); setCitations([...cites]); }
          else if (type === "done" && data.cached) { wasCached = true; setCached(true); }
          else if (type === "error") {
            const code: string | undefined = data.code || undefined;
            const msg: string | undefined = typeof data.message === "string" ? data.message
              : typeof data.user_message === "string" ? data.user_message : undefined;
            fail({ code, message: chatErrorText(code, msg) });
          }
        }
      }
    } catch {
      fail({ message: "Cevap yarıda kesildi; tekrar sor." });
    } finally {
      setLoading(false);
    }
    return { answer: full, citations: cites, cached: wasCached, error: err };
  }, [sessionId]);

  return { answer, citations, loading, cached, error, ask };
}
