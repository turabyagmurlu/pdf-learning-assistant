"use client";
/**
 * Podcast tarzı oynatıcı: tek ses dosyası için AudioQueuePlayer'ın ince sarmalayıcısı.
 * ±15 sn, hız, ilerleme, kaldığın yerden devam, kilit ekranı kontrolleri, iOS ses kilidi.
 * `text` verilirse çalan cümle vurgulanır (karakter-orantılı zamanlama) ve cümleye tıklayınca oraya atlanır.
 * Parça parça çalma için doğrudan `AudioQueuePlayer` kullan.
 */
import { useMemo } from "react";
import AudioQueuePlayer from "@/components/AudioQueuePlayer";

export default function PodcastPlayer({ src, title, subtitle, artwork, storageKey, autoPlay, text, duration, syncDocId }: {
  src: string; title: string; subtitle?: string; artwork?: string; storageKey: string; autoPlay?: boolean;
  text?: string; duration?: number; syncDocId?: string;
}) {
  const chunks = useMemo(() => [{ text: text || "", url: src, duration }], [src, text, duration]);
  return (
    <AudioQueuePlayer chunks={chunks} title={title} subtitle={subtitle} artwork={artwork}
                      storageKey={storageKey} autoPlay={autoPlay} showText={!!text} syncDocId={syncDocId} />
  );
}
