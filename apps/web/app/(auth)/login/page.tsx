"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border bg-surface p-8 shadow-soft">
        <h1 className="font-heading text-2xl mb-1">PDF Öğrenme Asistanı</h1>
        <p className="text-text-secondary text-sm mb-6">
          {mode === "login" ? "Hesabına giriş yap." : "Yeni hesap oluştur."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <input className="w-full rounded-md border bg-surface-muted px-3 py-2" placeholder="Ad"
                   value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <input className="w-full rounded-md border bg-surface-muted px-3 py-2" placeholder="E-posta" type="email"
                 value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded-md border bg-surface-muted px-3 py-2" placeholder="Şifre" type="password"
                 value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p className="text-danger text-sm">{err}</p>}
          <button disabled={busy}
                  className="w-full rounded-md bg-accent-purple py-2 text-white font-medium disabled:opacity-60">
            {busy ? "..." : mode === "login" ? "Giriş yap" : "Kayıt ol"}
          </button>
        </form>
        <button onClick={() => setMode(mode === "login" ? "register" : "login")}
                className="mt-4 text-sm text-accent-purple">
          {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </div>
  );
}
