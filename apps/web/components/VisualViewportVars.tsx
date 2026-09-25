"use client";
/** Kok duzende bir kez: --vvh / --kb degiskenleri her sayfada hazir olsun (T-2). */
import { useVisualViewport } from "@/hooks/useVisualViewport";

export default function VisualViewportVars() {
  useVisualViewport();
  return null;
}
