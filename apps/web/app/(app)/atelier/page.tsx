"use client";
/** /atelier?scope=all|collection:<id>|document:<id>&mode=read|recall|listen */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Atelier from "@/components/atelier/Atelier";
import { isPractice, normalizeScope } from "@/hooks/useAtelier";

function AtelierFromUrl() {
  const sp = useSearchParams();
  const mode = sp?.get("mode");
  return <Atelier initialScope={normalizeScope(sp?.get("scope"))} initialPractice={isPractice(mode) ? mode : "recall"} />;
}

export default function AtelierPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" role="status" aria-label="Atölye açılıyor" />}>
      <AtelierFromUrl />
    </Suspense>
  );
}
