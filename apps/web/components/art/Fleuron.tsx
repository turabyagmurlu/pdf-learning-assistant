/**
 * Fleuron — bolum ayraci: ortada ozgun el cizimi yaprak susu (❦ ruhunda), iki yanda sonen altin cizgi.
 * width verilmezse bulundugu satiri doldurur.
 */
export type FleuronProps = {
  /** Orta susun boyu (px) */
  size?: number;
  className?: string;
};

export default function Fleuron({ size = 20, className = "" }: FleuronProps) {
  return (
    <div className={"flex items-center gap-phi-2 " + className} aria-hidden="true">
      <span className="rule-gold flex-1" />
      <svg width={Math.round(size * 1.6)} height={size} viewBox="0 0 32 20" fill="none" focusable="false" className="shrink-0">
        {/* yaprak */}
        <path d="M16.1 16.4 C10.6 12.9 8.2 9.2 10 6.3 C11.6 3.9 14.6 4.4 16 7.3 C17.3 4.3 20.6 3.8 22.1 6.4 C23.8 9.4 21.3 13 16.1 16.4 Z"
              style={{ fill: "var(--gold)", stroke: "var(--gold)" }} fillOpacity={0.3} strokeWidth={1.1} strokeLinejoin="round" />
        <path d="M16 7.6 C15.8 10.4 15.9 13.1 16.1 16" style={{ stroke: "var(--gold)" }} strokeWidth={0.8} strokeLinecap="round" />
        {/* sap ve kivrimlar */}
        <path d="M16.1 16.4 C15.2 18.2 12.6 18.9 10.4 17.9 C8.6 17.1 8.3 15 9.7 14.6"
              style={{ stroke: "var(--gold)" }} strokeWidth={1} strokeLinecap="round" />
        <path d="M4.3 10.2 C6.2 9.1 7.6 10.7 6.5 11.8 M27.7 9.9 C25.8 8.9 24.3 10.5 25.5 11.6"
              stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8} strokeLinecap="round" />
        <circle cx="2" cy="10.4" r="0.9" style={{ fill: "var(--gold)" }} />
        <circle cx="30" cy="10.1" r="0.9" style={{ fill: "var(--gold)" }} />
      </svg>
      <span className="rule-gold flex-1" />
    </div>
  );
}
