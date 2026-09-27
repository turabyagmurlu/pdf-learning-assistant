/**
 * Tuy kalem — ozgun el cizimi. Govde ve tuy telleri murekkeple (currentColor),
 * tuy yuzeyi altin varakla hafifce boyali (--gold), kagittaki iz kirmizi tebesir (--accent-coral).
 */
export type ArtProps = { size?: number; className?: string };

const VANE = "M37.9 86.5 C37.9 87.1 37.1 89.9 38 90.3 C38.8 90.7 41.3 89.4 43 88.8 C44.6 88.3 46.1 87.7 47.7 87 C49.2 86.4 50.7 85.7 52.2 85 C53.7 84.2 55.1 83.5 56.5 82.7 C58 81.9 59.4 81 60.8 80.2 C62.1 79.3 63.5 78.4 64.8 77.5 C66.1 76.5 67.4 75.5 68.7 74.5 C70 73.5 71.2 72.5 72.4 71.4 C73.6 70.3 74.8 69.2 76 68 C77.1 66.9 78.3 65.7 79.4 64.5 C80.5 63.2 81.5 62 82.6 60.7 C83.6 59.4 84.6 58 85.6 56.7 C86.6 55.3 87.5 53.9 88.5 52.5 C89.4 51.1 90.3 49.6 91.2 48.1 C92.1 46.6 92.9 45.1 93.7 43.5 C94.6 41.9 95.4 40.3 96.1 38.7 C96.9 37.1 97.7 35.4 98.4 33.7 C99.1 32.1 99.9 30.3 100.5 28.6 C101.2 26.8 101.6 26 102.5 23.2 C103.4 20.4 106.9 13.1 106 12 C105.1 10.9 99.3 15.1 96.9 16.3 C94.6 17.5 93.7 18.1 92.1 19 C90.5 19.9 89 20.8 87.4 21.8 C85.9 22.8 84.4 23.7 82.9 24.7 C81.4 25.7 79.9 26.8 78.5 27.8 C77.1 28.8 75.6 29.9 74.3 31 C72.9 32.1 71.5 33.2 70.2 34.3 C68.9 35.4 67.6 36.5 66.4 37.7 C65.1 38.9 63.9 40.1 62.7 41.3 C61.5 42.5 60.4 43.7 59.2 45 C58.1 46.2 57 47.5 56 48.8 C54.9 50.1 53.9 51.4 53 52.7 C52 54 51 55.3 50.1 56.7 C49.2 58.1 48.3 59.4 47.5 60.8 C46.7 62.2 45.8 63.6 45.1 65 C44.3 66.4 43.5 67.8 42.8 69.3 C42.1 70.7 41.4 72.1 40.7 73.6 C40.1 75 39.5 76.5 38.8 77.9 C38.2 79.4 37.6 80.9 37.1 82.3 C36.5 83.8 35.4 86.1 35.5 86.8 C35.7 87.5 37.5 86.5 37.9 86.5";
const BARBS = "M39.4 84.8Q39.7 86.4 38 90.6M42.3 81.6Q40.3 81.2 37.4 82M45.2 78.2Q47.4 81.5 47.4 87M48.2 74.8Q45.1 73.4 40.4 73.4M51.2 71.3Q54.9 75.9 56.2 82.8M54.3 67.8Q50.4 65.7 45.3 65.3M57.5 64.3Q62.1 69.7 64.5 77.6M60.6 60.7Q56 57.9 50.3 56.4M63.9 57.1Q69.2 63.1 72.7 71.8M67.1 53.4Q62.2 50.3 55.8 49.1M70.5 49.7Q75.9 56 79.3 64.4M73.8 46Q68.9 42.9 63.1 41.5M77.2 42.2Q82.4 48.3 85.3 56.6M80.7 38.5Q76.1 35.6 70.2 34.2M84.2 34.7Q88.7 40.3 90.9 47.9M87.7 30.9Q83.8 28.6 78.7 27.4M91.2 27.2Q94.7 31.8 96.2 38.7M94.9 23.4Q91.8 21.9 87.1 21.7M98.5 19.6Q100.6 23 100.6 28.6M102.2 15.8Q100.3 15.4 96.6 16.7";

export default function QuillSketch({ size = 96, className = "" }: ArtProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true" focusable="false" className={className}>
      {/* tuy yuzeyi: altin yikama */}
      <path d={VANE} style={{ fill: "var(--gold)" }} fillOpacity={0.14} stroke="currentColor" strokeOpacity={0.7}
            strokeWidth={1.1} strokeLinejoin="round" />
      {/* tuy telleri */}
      <path d={BARBS} stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8} strokeLinecap="round" />
      {/* govde (kalem sapi) */}
      <path d="M24.2 102.1 C46.3 78.4 73.6 44.3 106 12" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M23.4 101.2 C38 86.5 44 79 52.5 69" stroke="currentColor" strokeOpacity={0.4} strokeWidth={0.7} strokeLinecap="round" />
      {/* uc (yarik) */}
      <path d="M24.2 102.1 L17.6 109.4 L20.8 103.3 Z" style={{ fill: "var(--gold)" }} stroke="currentColor"
            strokeWidth={1} strokeLinejoin="round" />
      <path d="M20.3 105.6 L22.7 103.3" stroke="currentColor" strokeWidth={0.7} strokeLinecap="round" />
      {/* murekkep damlasi ve kagittaki kivrim */}
      <circle cx="16.4" cy="111.6" r="1.4" style={{ fill: "var(--accent-coral)" }} />
      <path d="M22 114.2 c6 -3.2 10.5 1.6 16.2 -0.9 s9.4 -4.2 14.8 -1.1 s8.4 1.7 12.2 -0.6"
            style={{ stroke: "var(--accent-coral)" }} strokeOpacity={0.8} strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  );
}
