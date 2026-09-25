"use client";
import { useEffect, useState } from "react";
import { API, ApiError, api, errorMessage } from "@/lib/api";
import { Loader2 } from "lucide-react";

const CMD = "python -m app.scripts.set_owner_password --email SENIN_ADRESIN --password YENI_SIFRE";

/**
 * Sifremi unuttum.
 * - E-posta ile sifirlama etkinse (GET /auth/config -> mail_enabled) adres formu.
 * - Kapaliysa (tek kullanicili kurulum): form yok; sahibe sunucu kabugunda calisacak
 *   kurtarma komutu anlatilir (apps/api/app/scripts/set_owner_password.py).
 */
export default function ForgotPage() {
  const [mailOn, setMailOn] = useState<boolean | null>(null);   // null: henüz bilinmiyor
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/auth/config`, { cache: "no-store" }).then((r) => r.json())
      .then((c) => setMailOn(!!c?.mail_enabled))
      .catch(() => setMailOn(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await api("/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSent(true);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === "MAIL_NOT_CONFIGURED") setMailOn(false);
      else setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50";

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 font-heading text-2xl">Şifremi unuttum</h1>

        {mailOn === null ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Yükleniyor…
          </p>
        ) : !mailOn ? (
          <div className="mt-4 space-y-3 text-sm leading-relaxed">
            <p>
              Bu kurulumda e-postayla şifre sıfırlama kapalı. Şifreni, uygulamanın çalıştığı sunucunun
              kabuğunda (Render → Shell) şu komutla yenileyebilirsin:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs leading-relaxed">
              <code>{CMD}</code>
            </pre>
            <p className="text-text-secondary">
              Komut yeni şifreyi kaydeder ve açık olan diğer oturumları kapatır; sonra buradan yeni şifrenle giriş yaparsın.
              Adımlar depodaki README&apos;nin &quot;Şifremi unuttum (sahip)&quot; bölümünde de yazıyor.
            </p>
          </div>
        ) : sent ? (
          <div role="status" className="mt-4 space-y-3 text-sm leading-relaxed">
            <p>
              <strong>{email.trim().toLowerCase()}</strong> adresine ait bir hesap varsa, şifre sıfırlama bağlantısını
              gönderdik. Gelen kutunu (ve gereksiz/spam klasörünü) kontrol et.
            </p>
            <p className="text-text-secondary">Bağlantı 30 dakika geçerli ve yalnız bir kez kullanılabilir.</p>
            <button type="button" onClick={() => setSent(false)}
                    className="inline-flex min-h-[44px] items-center text-accent-purple hover:underline">
              E-posta gelmedi mi? Tekrar gönder
            </button>
          </div>
        ) : (
          <>
            <p className="mb-6 text-sm text-text-secondary">
              Hesabının e-posta adresini yaz. Yeni şifre belirlemen için sana bir bağlantı gönderelim.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">E-posta</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
                       autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
                       placeholder="ornek@posta.com" className={input} />
              </label>
              <button disabled={busy} type="submit" aria-busy={busy}
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-accent-purple px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {busy ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
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
