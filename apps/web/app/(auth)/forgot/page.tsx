"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: any) {
    e.preventDefault();
    setMsg("");
    if (pw.length < 6) { setMsg("Şifre en az 6 karakter olmalı."); return; }
    setBusy(true);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: email, new_password: pw, recovery_code: code }),
      });
      setOk(true);
      setMsg("Şifren güncellendi. Artık giriş yapabilirsin.");
    } catch (err: any) {
      setMsg(err && err.message ? err.message : "Bir hata oluştu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Şifremi unuttum</h1>
        <p className="text-text-secondary text-sm mb-6">E-postanı, yeni şifreni ve kurtarma kodunu gir.</p>
        <form onSubmit={submit} className="space-y-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="E-posta" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50" />
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" required placeholder="Yeni şifre (en az 6 karakter)" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50" />
          <input value={code} onChange={(e) => setCode(e.target.value)} type="text" required placeholder="Kurtarma kodu" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50" />
          <button disabled={busy} type="submit" className="w-full rounded-lg bg-accent-purple px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Gönderiliyor..." : "Şifreyi sıfırla"}</button>
        </form>
        {msg ? <p className={ok ? "mt-4 text-sm text-green-500" : "mt-4 text-sm text-red-400"}>{msg}</p> : null}
        <a href="/login" className="mt-6 block text-sm text-accent-purple hover:underline">Girişe dön</a>
      </div>
    </div>
  );
}
