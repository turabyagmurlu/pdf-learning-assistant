"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API, api, errorMessage, setToken } from "@/lib/api";
import { AuthArtPanel, AuthMobileHeader } from "../_components/AuthArt";
import { ArrowRight, Loader2 } from "lucide-react";

const MIN_PW = 8;
const WAKE_AFTER_MS = 4000;
const WAKE_MSG = "Sunucu uyanıyor, ilk açılış ~30 sn sürebilir…";

/**
 * Giris ekrani. Tek kullanicili kurulumda (GET /auth/config -> registration_open=false)
 * yalniz e-posta, sifre ve "Giris" cizilir; kayit modu, kayit metinleri ve
 * "kayitlar kapali" satiri hic render edilmez. Kayit acilirsa (ALLOW_REGISTRATION=true)
 * ayni sayfa kayit modunu da sunar.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);     // ön-ısıtma 4 sn'den uzun sürdü
  const [slowSubmit, setSlowSubmit] = useState(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [mailOn, setMailOn] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    fetch(`${API}/auth/config`, { cache: "no-store" }).then((r) => r.json())
      .then((c) => {
        setRegOpen(!!c?.registration_open);
        setMailOn(!!c?.mail_enabled);
        if (c?.registration_open && q.get("mode") === "register") setMode("register");
      })
      .catch(() => {});
    if (q.get("expired")) setInfo("Oturumun kapandı; kaldığın yere dönmek için tekrar giriş yap.");
    if (q.get("reset")) setInfo("Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.");
    if (q.get("deleted")) setInfo("Hesabın ve tüm verilerin silindi.");

    // Ön-ısıtma: sunucu uyuyorsa kullanıcı formu doldururken uyanmaya başlasın.
    let done = false;
    const t = setTimeout(() => { if (!done) setWaking(true); }, WAKE_AFTER_MS);
    fetch(`${API}/health`, { cache: "no-store" })
      .catch(() => { /* sessiz: gerçek istek hatayı gösterir */ })
      .finally(() => { done = true; clearTimeout(t); setWaking(false); });
    return () => { done = true; clearTimeout(t); };
  }, []);

  function switchMode(m: "login" | "register") {
    if (m === "register" && !regOpen) return;
    setMode(m); setErr(""); setInfo("");
    const url = new URL(window.location.href);
    if (m === "register") url.searchParams.set("mode", "register"); else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url.toString());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(""); setInfo("");
    const cleanEmail = email.trim().toLowerCase();
    const registering = mode === "register" && regOpen;
    if (registering && password.length < MIN_PW) {
      setErr(`Şifre en az ${MIN_PW} karakter olmalı.`);
      return;
    }
    setBusy(true);
    slowTimer.current = setTimeout(() => setSlowSubmit(true), WAKE_AFTER_MS);
    try {
      const body = registering
        ? { name: name.trim(), email: cleanEmail, password }
        : { email: cleanEmail, password };
      const r = await api(`/auth/${registering ? "register" : "login"}`, { method: "POST", body: JSON.stringify(body) });
      setToken(r.token);
      // oturum dolup buraya yönlendirildiysek kalınan sayfaya geri dön
      const next = new URLSearchParams(window.location.search).get("next") || "";
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/today");
    } catch (e: unknown) {
      setErr(errorMessage(e));
    } finally {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setSlowSubmit(false);
      setBusy(false);
    }
  }

  const field = "w-full border-0 border-b bg-transparent px-0 py-3 text-[15px] outline-none placeholder:text-text-secondary focus:border-accent-purple transition-colors";
  const label = "text-xs font-medium text-text-secondary";
  const showWake = waking || slowSubmit;
  const registering = mode === "register" && regOpen;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* SOL (masaüstü): sanat eseri karşılama — çizilerek beliren altın spiral, Fraunces "TY PDF", epigraf */}
      <AuthArtPanel />

      {/* SAĞ: form */}
      <main className="flex flex-1 items-center justify-center px-6 py-10 md:px-12">
        <div className="w-full max-w-sm">
          <AuthMobileHeader />
          <h1 className="font-heading text-[34px] leading-tight tracking-[0.06em]">
            <span className="md:hidden">TY PDF</span>
            <span className="hidden md:inline">Hoş geldin</span>
          </h1>
          <span className="rule-gold rule-gold-start mt-phi-2 w-24" aria-hidden="true" />
          <p className="font-heading-italic mt-phi-2 text-[16px] text-text-secondary">
            {registering ? "Hesabını oluştur." : "Hoş geldin. Devam etmek için giriş yap."}
          </p>

          {info && <p role="status" className="mt-6 rounded-lg border border-border bg-gold-soft px-3 py-2 text-sm text-text-primary">{info}</p>}

          <form onSubmit={submit} className="mt-8 space-y-6">
            {registering && (
              <label className="block">
                <span className={label}>Ad</span>
                <input className={field} placeholder="Adın" value={name} autoComplete="name"
                       onChange={(e) => setName(e.target.value)} required maxLength={80} />
              </label>
            )}
            <label className="block">
              <span className={label}>E-posta</span>
              <input className={field} placeholder="ornek@posta.com" type="email" autoComplete="email"
                     inputMode="email" autoCapitalize="none" spellCheck={false}
                     value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block">
              <span className={label}>Şifre</span>
              <input className={field} placeholder="••••••••" type="password"
                     autoComplete={registering ? "new-password" : "current-password"}
                     minLength={registering ? MIN_PW : undefined}
                     aria-describedby={registering ? "pw-hint" : undefined}
                     value={password} onChange={(e) => setPassword(e.target.value)} required />
              {registering && (
                <span id="pw-hint" className="mt-1.5 block text-xs text-text-secondary">
                  En az {MIN_PW} karakter.{mailOn ? " Unutursan e-postana gelen bağlantıyla yenileyebilirsin." : ""}
                </span>
              )}
            </label>

            {err && <p role="alert" className="text-sm text-danger">{err}</p>}

            <button type="submit" disabled={busy} aria-busy={busy}
                    className="btn-lapis group flex min-h-[48px] w-full items-center justify-between rounded-xl px-5 py-3.5 text-sm font-medium disabled:opacity-60">
              <span>{registering ? "Kayıt ol" : "Giriş yap"}</span>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />}
            </button>

            {showWake && (
              <p role="status" className="text-xs text-text-secondary">{WAKE_MSG}</p>
            )}

            {registering && (
              <p className="text-xs leading-relaxed text-text-secondary">
                Sorularını ve kaynak metinlerini yanıt üretmek için Google Gemini&apos;ye gönderiyoruz.
                Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli/kişisel belge yükleme.{" "}
                <a href="/gizlilik" className="font-medium text-text-primary underline underline-offset-2">Verilerin nasıl işlenir?</a>
              </p>
            )}
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 text-sm">
            {registering ? (
              <>
                <a href="/gizlilik" className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">Gizlilik</a>
                <button type="button" onClick={() => switchMode("login")}
                        className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">
                  Hesabın var mı?&nbsp;<span className="font-medium text-text-primary underline underline-offset-2">Giriş yap</span>
                </button>
              </>
            ) : (
              <>
                <a href="/forgot" className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">Şifremi unuttum</a>
                {regOpen && (
                  <button type="button" onClick={() => switchMode("register")}
                          className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">
                    Hesabın yok mu?&nbsp;<span className="font-medium text-text-primary underline underline-offset-2">Kayıt ol</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
