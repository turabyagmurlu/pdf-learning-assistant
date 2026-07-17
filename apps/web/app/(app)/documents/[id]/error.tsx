"use client";

import { useEffect } from "react";

export default function DocumentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // pdf.js worker/transport soguk baslangicta hazir olmadan render olabilir; sinirli otomatik yeniden dene
    let n = 0;
    try { n = parseInt(sessionStorage.getItem("docErrRetry") || "0", 10) || 0; } catch {}
    if (n < 2) {
      try { sessionStorage.setItem("docErrRetry", String(n + 1)); } catch {}
      const t = setTimeout(() => { try { reset(); } catch {} }, 1200);
      return () => clearTimeout(t);
    }
  }, [reset]);

  function manual() {
    try { sessionStorage.removeItem("docErrRetry"); } catch {}
    reset();
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="max-w-sm">
        <h2 className="font-heading text-xl">Görüntüleyici hazırlanıyor…</h2>
        <p className="mt-2 text-sm text-text-secondary">PDF motoru bazen ilk açılışta biraz gecikir. Otomatik olarak yeniden deniyorum; olmazsa aşağıdan tekrar dene.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={manual} className="rounded-lg bg-accent-purple px-4 py-2 text-sm text-white">Tekrar dene</button>
        <a href="/library" className="rounded-lg border px-4 py-2 text-sm text-text-secondary">Kütüphaneye dön</a>
      </div>
    </div>
  );
}
