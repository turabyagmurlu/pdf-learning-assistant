"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, clearToken, errorMessage } from "@/lib/api";
import { Loader2 } from "lucide-react";

const MIN_PW = 8;

export default function ResetPage() {
  const router = useRouter();
  const [token, setTokenValue] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    if (t) {
      setTokenValue(t);
      // Token'ı adres çubuğundan ve tarayıcı geçmişinden kaldır (paylaşılan ekran / geçmiş sızıntısı).
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      // StrictMode'da etki iki kez çalışır: ilk çalışmada okunan token'ı ezme.
      setTokenValue((prev) => prev ?? "");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    setErr("");
    if (pw.length < MIN_PW) { setErr(`Şifre en az ${MIN_PW} karakter olmalı.`); return; }
    if (pw !== pw2) { setErr("İki şifre aynı değil; tekrar yaz."); return; }
    setBusy(true);
    try {
      await api("/auth/reset", { method: "POST", body: JSON.stringify({ token, password: pw }) });
      clearToken();                    // eski oturumlar sunucuda geçersiz oldu
      router.replace("/login?reset=1");
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === "RESET_INVALID") setInvalid(true);
      else setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50";

  const noToken = token !== null && !token;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 font-heading text-2xl">Yeni şifre belirle</h1>

        {noToken || invalid ? (
          <div role="alert" className="mt-4 space-y-3 text-sm leading-relaxed">
            <p>
              {noToken
                ? "Bu sayfaya e-postadaki bağlantıyla gelmen gerekiyor."
                : "Bu bağlantı geçersiz ya da süresi dolmuş. Bağlantılar 30 dakika geçerli ve yalnız bir kez kullanılabilir."}
            </p>
            <a href="/forgot" className="inline-flex min-h-[44px] items-center font-medium text-accent-purple hover:underline">
              Yeni bir sıfırlama bağlantısı iste
            </a>
          </div>
        ) : (
          <>
            <p className="mb-6 text-sm text-text-secondary">
              Yeni şifreni iki kez yaz. Şifren değişince açık olan diğer oturumların kapanır.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Yeni şifre</span>
                <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" required minLength={MIN_PW}
                       autoComplete="new-password" aria-describedby="pw-hint" className={input} />
                <span id="pw-hint" className="mt-1 block text-xs text-text-secondary">En az {MIN_PW} karakter.</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Yeni şifre (tekrar)</span>
                <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" required minLength={MIN_PW}
                       autoComplete="new-password" className={input} />
              </label>
              <button disabled={busy || token === null} type="submit" aria-busy={busy}
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-accent-purple px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {busy ? "Kaydediliyor…" : "Şifremi değiştir"}
              </button>
            </form>
            {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
          </>
        )}

        <a href="/login" className="mt-6 inline-flex min-h-[44px] items-center text-sm text-accent-purple hover:underline">Girişe dön</a>
      </div>
    </main>
  );
}
