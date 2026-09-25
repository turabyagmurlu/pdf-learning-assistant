"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/api";

/** Oturumun suresi dolmus mu? (JWT exp; cozulemezse gecerli sayilir, ilk istek zaten dogrular) */
function expired(t: string): boolean {
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p.exp === "number" && p.exp * 1000 <= Date.now();
  } catch { return false; }
}

/** Giris: oturum varsa Defterler'e, yoksa (ya da suresi dolmussa) giris sayfasina. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const t = getToken();
    if (t && expired(t)) { clearToken(); router.replace("/login?expired=1"); return; }
    router.replace(t ? "/notebooks" : "/login");
  }, [router]);
  return (
    <div className="flex min-h-dvh items-center justify-center p-10 text-sm text-text-secondary" role="status">
      Açılıyor…
    </div>
  );
}
