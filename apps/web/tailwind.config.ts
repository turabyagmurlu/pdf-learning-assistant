import type { Config } from "tailwindcss";
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
        background: "var(--bg)",
        surface: "var(--surface)",
        "surface-muted": "var(--surface-muted)",
        "surface-hover": "var(--surface-hover)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "accent-purple": "var(--accent-purple)",
        "accent-teal": "var(--accent-teal)",
        "accent-amber": "var(--accent-amber)",
        "accent-coral": "var(--accent-coral)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        /** Durum zeminleri (rozet, bilgi kutusu): metin rengiyle cift olusturur */
        "success-bg": "var(--success-bg)",
        "warning-bg": "var(--warning-bg)",
        "danger-bg": "var(--danger-bg)",
        "info-bg": "var(--info-bg)",
        /** Vurgu (mor) yumusak zemin: secili cip, rozet */
        "accent-soft": "var(--accent-soft)",
        /** Konu (veri) paleti — mor icermez; yalniz konu rengi icin */
        "data-1": "var(--data-1)",
        "data-2": "var(--data-2)",
        "data-3": "var(--data-3)",
        "data-4": "var(--data-4)",
        "data-5": "var(--data-5)",
        "data-6": "var(--data-6)",
        /** Dolgulu vurgu dugmesinin yazi rengi (acikta beyaz, koyuda koyu lacivert) */
        "on-accent": "var(--on-accent)",
      },
      // 11px en kucuk yazi boyutu (text-2xs); daha kucugu kullanilmaz.
      // 7 adimli olcek: display / title / heading / reading / body / small / micro (micro = 2xs).
      fontSize: {
        "2xs": ["11px", "16px"],
        micro: ["11px", { lineHeight: "16px", fontWeight: "500" }],
        small: ["12px", "16px"],
        body: ["14px", "20px"],
        reading: ["16px", "26px"],
        heading: ["17px", { lineHeight: "24px", fontWeight: "600" }],
        title: ["22px", "28px"],
        display: ["32px", "36px"],
      },
      borderRadius: { sm: "6px", md: "10px", lg: "14px", xl: "20px", "2xl": "24px" },
      boxShadow: {
        soft: "0 1px 2px rgba(20,25,40,.06), 0 2px 8px rgba(20,25,40,.05)",
        medium: "0 4px 16px rgba(20,25,40,.10)",
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
