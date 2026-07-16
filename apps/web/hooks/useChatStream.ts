"use client";
import { useState, useCallback } from "react";
import { API, getToken } from "@/lib/api";

export type Citation = { n: number; page: number; section?: string; snippet: string };

export function useChatStream(sessionId: string) {
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (question: string) => {
    setAnswer(""); setCitations([]); setLoading(true);
    const token = getToken();
    const res = await fetch(`${API}/chat/sessions/${sessionId}/messages?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: question }),
    });
    if (!res.body) { setLoading(false); return; }
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
        const data = JSON.parse(dataLine);
        if (type === "token") setAnswer((a) => a + data.text);
        else if (type === "citation") setCitations((c) => [...c, data]);
        else if (type === "error") setAnswer((a) => a + `\n⚠️ ${data.message}`);
      }
    }
    setLoading(false);
  }, [sessionId]);

  return { answer, citations, loading, ask };
}
