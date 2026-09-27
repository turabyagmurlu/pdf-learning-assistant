import type { Config } from "tailwindcss";

/**
 * Token rengi: duz kullanımda `var(--x)`; saydamlik ekiyle (bg-data-1/15, hover:bg-accent-purple/90 ...)
 * `color-mix(in srgb, var(--x) N%, transparent)`. Boylece `/NN` ekleri CSS degiskenli renklerde de calisir
 * (Tailwind 3 duz `var()` renkte bu siniflari hic uretmiyordu). color-mix'i bilmeyen eski tarayicida
 * yalniz o saydam sinif yok sayilir — onceki davranisla ayni.
 */
function tok(name: string): string {
  const fn = ({ opacityValue }: { opacityValue?: string | number }) => {
    if (opacityValue === undefined || String(opacityValue).startsWith("var(")) return `var(${name})`;
    const n = Number(opacityValue);
    if (!Number.isFinite(n) || n >= 1) return `var(${name})`;
    return `color-mix(in srgb, var(${name}) ${Math.round(n * 1000) / 10}%, transparent)`;
  };
  // Tailwind renk olarak islev kabul eder; tip tanimi yalniz dizeyi bildirdigi icin donusturulur.
  return fn as unknown as string;
}

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./hooks/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        /** Dokunmatik cihaz (fare/hover yok) — `touch:` varyanti */
        touch: { raw: "(hover: none)" },
        /** Fareli cihaz (hover var) — `mouse:` varyanti */
        mouse: { raw: "(hover: hover)" },
      },
      colors: {
        background: tok("--bg"),
        surface: tok("--surface"),
        "surface-muted": tok("--surface-muted"),
        "surface-hover": tok("--surface-hover"),
        border: tok("--border"),
        "border-strong": tok("--border-strong"),
        "text-primary": tok("--text-primary"),
        "text-secondary": tok("--text-secondary"),
        "accent-purple": tok("--accent-purple"),
        "accent-teal": tok("--accent-teal"),
        "accent-amber": tok("--accent-amber"),
        "accent-coral": tok("--accent-coral"),
        success: tok("--success"),
        warning: tok("--warning"),
        danger: tok("--danger"),
        info: tok("--info"),
        /** Durum zeminleri (rozet, bilgi kutusu): metin rengiyle cift olusturur */
        "success-bg": tok("--success-bg"),
        "warning-bg": tok("--warning-bg"),
        "danger-bg": tok("--danger-bg"),
        "info-bg": tok("--info-bg"),
        /** Vurgu (mor) yumusak zemin: secili cip, rozet */
        "accent-soft": tok("--accent-soft"),
        /** Konu (veri) paleti — mor icermez; yalniz konu rengi icin */
        "data-1": tok("--data-1"),
        "data-2": tok("--data-2"),
        "data-3": tok("--data-3"),
        "data-4": tok("--data-4"),
        "data-5": tok("--data-5"),
        "data-6": tok("--data-6"),
        /** Dolgulu vurgu dugmesinin yazi rengi (acikta beyaz, koyuda koyu lacivert) */
        "on-accent": tok("--on-accent"),
        /** Sfumato: altin varak (sus: cizgi, buyuk yazi, ikon), yumusak altin zemin,
         *  kucuk altin yazi (>= 4.8:1) ve umber murekkep golgesi */
        gold: tok("--gold"),
        "gold-soft": tok("--gold-soft"),
        "gold-ink": tok("--gold-ink"),
        "ink-soft": tok("--ink-soft"),
      },
      /** Altin oran bosluk olcegi: 8 · 13 · 21 · 34 · 55 px (p-phi-3, gap-phi-2 ...) */
      spacing: {
        "phi-1": "8px",
        "phi-2": "13px",
        "phi-3": "21px",
        "phi-4": "34px",
        "phi-5": "55px",
      },
      transitionTimingFunction: {
        sfumato: tok("--ease-sfumato"),
      },
      // 12px en kucuk yazi boyutu (text-xs); daha kucugu kullanilmaz.
      // `2xs` ve `micro` geriye uyum icin tutulur ama artik 12px'tir (yeni kodda text-xs kullan).
      // 7 adimli olcek: display / title / heading / reading / body / small / micro.
      fontSize: {
        "2xs": ["12px", "16px"],
        micro: ["12px", { lineHeight: "16px", fontWeight: "500" }],
        small: ["12px", "16px"],
        body: ["14px", "20px"],
        reading: ["16px", "26px"],
        heading: ["17px", { lineHeight: "24px", fontWeight: "600" }],
        title: ["22px", "28px"],
        display: ["32px", "36px"],
      },
      borderRadius: { sm: "6px", md: "10px", lg: "14px", xl: "20px", "2xl": "24px" },
      boxShadow: {
        /** Sfumato golgeleri: degerler globals.css'teki token'lardan (acik/koyu ayri) */
        soft: tok("--shadow-soft"),
        medium: tok("--shadow-medium"),
      },
      fontFamily: {
        heading: ["var(--font-heading)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
