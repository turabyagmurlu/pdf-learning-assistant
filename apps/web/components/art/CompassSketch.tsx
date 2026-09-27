/**
 * Pergel — ozgun el cizimi. Pergel murekkeple (currentColor), mafsal altin (--gold),
 * masadaki daire (perspektifte elips) kirmizi tebesirle (--accent-coral) yari cizilmis.
 */
import type { ArtProps } from "./QuillSketch";

export default function CompassSketch({ size = 96, className = "" }: ArtProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true" focusable="false" className={className}>
      {/* cizilmis yay: kirmizi tebesir */}
      <path d="M88.2 93.6 C87.4 100.6 69 106.9 46.3 107 C23.8 107.1 5.1 101.2 4.2 94.2 C3.6 87.3 21.5 81.2 44.8 80.9"
            style={{ stroke: "var(--accent-coral)" }} strokeWidth={1.3} strokeLinecap="round" />
      {/* cizilecek kismi: noktali, soluk */}
      <path d="M44.8 80.9 C67.4 80.7 86.8 85.9 88.2 93.1" style={{ stroke: "var(--accent-coral)" }} strokeOpacity={0.4}
            strokeWidth={0.9} strokeDasharray="1.5 3" strokeLinecap="round" />
      {/* merkez ve yaricap olcusu */}
      <path d="M46.3 94.1 L87.6 93.4" stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.7} strokeDasharray="2 2.4" />
      <path d="M44.2 92 L48.4 96.2 M48.3 92 L44.3 96.1" stroke="currentColor" strokeOpacity={0.55} strokeWidth={0.8} strokeLinecap="round" />
      {/* sol bacak (sivri uc, merkezde) */}
      <path d="M64.2 20.6 L46.6 93.4 L63.5 29.4" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d="M67.8 21.2 L50.6 84.2" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} strokeLinecap="round" />
      {/* sag bacak (kalem ucu, yay uzerinde) */}
      <path d="M68.2 20.8 L84.6 86.3 L80.7 86.9 L64.6 26.2" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d="M84.6 86.3 L87.9 93.2 L80.7 86.9" style={{ fill: "var(--accent-coral)" }} stroke="currentColor"
            strokeWidth={0.9} strokeLinejoin="round" />
      {/* ayar kolu */}
      <path d="M56.3 52.1 C62.4 50.3 68.6 50.1 74.6 51.6" stroke="currentColor" strokeOpacity={0.6} strokeWidth={0.9} strokeLinecap="round" />
      {/* mafsal ve sap: altin */}
      <circle cx="66.1" cy="20.4" r="5.6" style={{ fill: "var(--gold)" }} fillOpacity={0.25} stroke="currentColor" strokeWidth={1.1} />
      <circle cx="66.1" cy="20.4" r="1.5" style={{ fill: "var(--gold)" }} />
      <path d="M66 14.8 L66.3 5.6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M63.4 5.4 C65 4.2 67.4 4.3 68.9 5.6" style={{ stroke: "var(--gold)" }} strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  );
}
