"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";
import { BrandMarkSvg, BrandScene } from "@/components/BrandMark";
import { useTheme } from "@/components/ThemeToggle";
import { ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { dark } = useTheme();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const body = mode === "register" ? { name, email, password } : { email, password };
      const r = await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      setToken(r.token);
      router.replace("/library");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const field = "w-full border-0 border-b bg-transparent px-0 py-3 text-[15px] outline-none placeholder:text-text-secondary/70 focus:border-text-primary transition-colors";

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* SOL: sahne */}
      <section className="relative h-[42vh] md:h-auto md:w-[52%] overflow-hidden">
        <BrandScene variant={dark ? "night" : "day"} className="absolute inset-0 h-full w-full" />
        {/* okunurluk icin alt karartma */}
        <div className="absolute inset-x-0 bottom-0 h-3/5"
             style={{ background: "linear-gradient(to top, rgba(20,10,5,0.78) 0%, rgba(20,10,5,0.45) 45%, rgba(20,10,5,0) 100%)" }} />
        <div className="absolute left-8 top-8 flex items-center gap-2.5 md:left-12 md:top-10">
          <BrandMarkSvg variant={dark ? "night" : "day"} size={30} />
          <span className="font-heading text-sm tracking-[0.35em] text-[#fff3dc]">TY PDF</span>
        </div>
        <div className="absolute bottom-8 left-8 right-8 md:bottom-14 md:left-12">
          <h2 className="font-heading text-[44px] leading-[1.02] text-[#fff3dc] md:text-[64px]"
              style={{ textShadow: "0 2px 18px rgba(0,0,0,0.45)" }}>
            Oku.<br />Sor.<br />Öğren.
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#fff3dc]/90 md:text-base"
             style={{ textShadow: "0 1px 10px rgba(0,0,0,0.5)" }}>
            Her belge bir kapıdır. PDF'lerini yükle; sorularını sor, kartlarla çalış, sesli dersle dinle.
          </p>
        </div>
      </section>

      {/* SAG: form */}
      <section className="flex flex-1 items-center justify-center bg-surface px-6 py-10 md:px-12">
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-3xl tracking-[0.18em]">TY PDF</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {mode === "login" ? "Hoş geldin. Devam etmek için giriş yap." : "Yeni bir hesap oluştur."}
          </p>

          <form onSubmit={submit} className="mt-10 space-y-6">
            {mode === "register" && (
              <label className="block">
                <span className="text-[11px] uppercase tracking-[0.2em] text-text-secondary">Ad</span>
                <input className={field} placeholder="Adın" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.2em] text-text-secondary">E-posta</span>
              <input className={field} placeholder="ornek@posta.com" type="email" autoComplete="email"
                     value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.2em] text-text-secondary">Şifre</span>
              <input className={field} placeholder="••••••••" type="password"
                     autoComplete={mode === "login" ? "current-password" : "new-password"}
                     value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>

            {err && <p className="text-sm text-danger">{err}</p>}

            <button disabled={busy}
                    className="group flex w-full items-center justify-between rounded-md bg-text-primary px-5 py-3.5 text-sm font-medium tracking-[0.18em] text-background disabled:opacity-60">
              <span>{mode === "login" ? "GİRİŞ" : "KAYIT OL"}</span>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm">
            {mode === "login" ? (
              <a href="/forgot" className="text-text-secondary hover:text-text-primary">Şifremi unuttum</a>
            ) : <span />}
            <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}
                    className="text-text-secondary hover:text-text-primary">
              {mode === "login" ? "Kayıt ol" : "Giriş yap"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
