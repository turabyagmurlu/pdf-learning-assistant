"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/notebooks" : "/login");
  }, [router]);
  return <div className="p-10 text-text-secondary">Yönlendiriliyor…</div>;
}
