"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API, api, errorMessage, setToken } from "@/lib/api";
import { BrandMarkSvg, BrandScene } from "@/components/BrandMark";
import { useTheme } from "@/components/ThemeToggle";
import { ArrowRight, Loader2 } from "lucide-react";

const MIN_PW = 8;
const WAKE_AFTER_MS = 4000;
const WAKE_MSG = "Sunucu uyanıyor, ilk açılış ~30 sn sürebilir…";

export default function LoginPage() {
  const router = useRouter();
  const { dark } = useTheme();
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

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    fetch(`${API}/auth/config`, { cache: "no-store" }).then((r) => r.json())
      .then((c) => { setRegOpen(!!c?.registration_open); if (c?.registration_open && q.get("mode") === "register") setMode("register"); })
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
    if (mode === "register" && password.length < MIN_PW) {
      setErr(`Şifre en az ${MIN_PW} karakter olmalı.`);
      return;
    }
    setBusy(true);
    slowTimer.current = setTimeout(() => setSlowSubmit(true), WAKE_AFTER_MS);
    try {
      const body = mode === "register"
        ? { name: name.trim(), email: cleanEmail, password }
        : { email: cleanEmail, password };
      const r = await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      setToken(r.token);
      // oturum dolup buraya yönlendirildiysek kalınan sayfaya geri dön
      const next = new URLSearchParams(window.location.search).get("next") || "";
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/notebooks");
    } catch (e: unknown) {
      setErr(errorMessage(e));
    } finally {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setSlowSubmit(false);
      setBusy(false);
    }
  }

  const field = "w-full border-0 border-b bg-transparent px-0 py-3 text-[15px] outline-none placeholder:text-text-secondary/70 focus:border-text-primary transition-colors";
  const label = "text-xs font-medium text-text-secondary";
  const showWake = waking || slowSubmit;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* SOL: sahne */}
      <section className="relative h-[42vh] md:h-auto md:w-[52%] overflow-hidden" aria-hidden="true">
        <BrandScene variant={dark ? "night" : "day"} className="absolute inset-0 h-full w-full" />
        {/* okunurluk için alt karartma */}
        <div className="absolute inset-x-0 bottom-0 h-3/5"
             style={{ background: "linear-gradient(to top, rgba(20,10,5,0.78) 0%, rgba(20,10,5,0.45) 45%, rgba(20,10,5,0) 100%)" }} />
        <div className="absolute left-8 top-8 flex items-center gap-2.5 md:left-12 md:top-10">
          <BrandMarkSvg variant={dark ? "night" : "day"} size={30} />
          <span className="font-heading text-sm tracking-[0.35em] text-[#fff3dc]">TY PDF</span>
        </div>
        <div className="absolute bottom-8 left-8 right-8 md:bottom-14 md:left-12">
          <p className="font-heading text-[44px] leading-[1.02] text-[#fff3dc] md:text-[64px]"
             style={{ textShadow: "0 2px 18px rgba(0,0,0,0.45)" }}>
            Oku.<br />Sor.<br />Öğren.
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#fff3dc]/90 md:text-base"
             style={{ textShadow: "0 1px 10px rgba(0,0,0,0.5)" }}>
            Her belge bir kapıdır. Kaynaklarını yükle; soru sor, atıflı not al, taslağını yaz.
          </p>
        </div>
      </section>

      {/* SAĞ: form */}
      <main className="flex flex-1 items-center justify-center bg-surface px-6 py-10 md:px-12">
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-3xl tracking-[0.18em]">TY PDF</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {mode === "login" ? "Hoş geldin. Devam etmek için giriş yap." : "Ücretsiz hesabını oluştur."}
          </p>

          {info && <p role="status" className="mt-6 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-primary">{info}</p>}

          <form onSubmit={submit} className="mt-8 space-y-6">
            {mode === "register" && (
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
                     autoComplete={mode === "login" ? "current-password" : "new-password"}
                     minLength={mode === "register" ? MIN_PW : undefined}
                     aria-describedby={mode === "register" ? "pw-hint" : undefined}
                     value={password} onChange={(e) => setPassword(e.target.value)} required />
              {mode === "register" && (
                <span id="pw-hint" className="mt-1.5 block text-xs text-text-secondary">
                  En az {MIN_PW} karakter. Unutursan e-postana gelen bağlantıyla yenileyebilirsin.
                </span>
              )}
            </label>

            {err && <p role="alert" className="text-sm text-danger">{err}</p>}

            <button type="submit" disabled={busy} aria-busy={busy}
                    className="group flex min-h-[48px] w-full items-center justify-between rounded-md bg-text-primary px-5 py-3.5 text-sm font-medium text-background disabled:opacity-60">
              <span>{mode === "login" ? "Giriş yap" : "Kayıt ol"}</span>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />}
            </button>

            {showWake && (
              <p role="status" className="text-xs text-text-secondary">{WAKE_MSG}</p>
            )}

            {mode === "register" && (
              <p className="text-xs leading-relaxed text-text-secondary">
                Sorularını ve kaynak metinlerini yanıt üretmek için Google Gemini&apos;ye gönderiyoruz.
                Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli/kişisel belge yükleme.{" "}
                <a href="/gizlilik" className="font-medium text-text-primary underline underline-offset-2">Verilerin nasıl işlenir?</a>
              </p>
            )}
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 text-sm">
            {mode === "login" ? (
              <>
                <a href="/forgot" className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">Şifremi unuttum</a>
                {regOpen ? (
                  <button type="button" onClick={() => switchMode("register")}
                          className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">
                    Hesabın yok mu?&nbsp;<span className="font-medium text-text-primary underline underline-offset-2">Ücretsiz kayıt ol</span>
                  </button>
                ) : (
                  <span className="inline-flex min-h-[44px] items-center text-text-secondary">Yeni kayıtlar şu an kapalı</span>
                )}
              </>
            ) : (
              <>
                <a href="/gizlilik" className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">Gizlilik</a>
                <button type="button" onClick={() => switchMode("login")}
                        className="inline-flex min-h-[44px] items-center text-text-secondary hover:text-text-primary">
                  Hesabın var mı?&nbsp;<span className="font-medium text-text-primary underline underline-offset-2">Giriş yap</span>
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
