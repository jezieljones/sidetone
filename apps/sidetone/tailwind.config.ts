import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background-hsl))",
        foreground: "hsl(var(--foreground-hsl))",
        card: "hsl(var(--card-hsl))",
        "card-foreground": "hsl(var(--card-foreground-hsl))",
        muted: {
          DEFAULT: "hsl(var(--muted-hsl))",
          foreground: "hsl(var(--muted-foreground-hsl))"
        },
        primary: {
          DEFAULT: "hsl(var(--primary-hsl))",
          foreground: "hsl(var(--primary-foreground-hsl))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary-hsl))",
          foreground: "hsl(var(--secondary-foreground-hsl))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent-hsl))",
          foreground: "hsl(var(--accent-foreground-hsl))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive-hsl))",
          foreground: "hsl(var(--destructive-foreground-hsl))"
        },
        border: "hsl(var(--border-hsl))",
        input: "hsl(var(--input-hsl))",
        ring: "hsl(var(--ring-hsl))",
        success: {
          DEFAULT: "hsl(var(--success-hsl))",
          foreground: "hsl(var(--success-foreground-hsl))"
        },
        warning: {
          DEFAULT: "hsl(var(--warning-hsl))",
          foreground: "hsl(var(--warning-foreground-hsl))"
        },
        navy: {
          50: "#e8ecf1",
          100: "#c7d0dc",
          200: "#9acabe",
          300: "#6e83a0",
          400: "#4a6383",
          500: "#2c4a6f",
          600: "#1c3658",
          700: "#122742",
          800: "#0a192f",
          900: "#050d1a"
        },
        cream: {
          50: "#fcf9f2",
          100: "#f6efe2",
          200: "#ede4d1",
          300: "#ddd0b6",
          400: "#c68594",
          500: "#ab9670",
          600: "#8c794f",
          700: "#6b5c39",
          800: "#4d4129",
          900: "#202616"
        },
        crimson: {
          50: "#fbe8e8",
          100: "#f5c5c5",
          200: "#ee9e9e",
          300: "#e47373",
          400: "#da4e4e",
          500: "#d22b2b",
          600: "#b11d1d",
          700: "#8e1414",
          800: "#6b0e0e",
          900: "#480808"
        },
        amber: {
          50: "#fdf6e1",
          100: "#fae983",
          200: "#f5d080",
          300: "#efc65a",
          400: "#e9bc4a",
          500: "#e3b23c",
          600: "#c49222",
          700: "#9c7414",
          800: "#74570d",
          900: "#403a06"
        },
        slate: {
          50: "#eaf1f6",
          100: "#c9dee7",
          200: "#9ec0d3",
          300: "#74a4bd",
          400: "#5c95b2",
          500: "#4c86a8",
          600: "#3c6e8c",
          700: "#2d5670",
          800: "#1f3d54",
          900: "#122738"
        },
        coral: {
          50: "#ffede4",
          100: "#fcd0ca",
          200: "#f888a6",
          300: "#f58e81",
          400: "#f2693b",
          500: "#f26b5b",
          600: "#d04a3b",
          700: "#8c2519",
          800: "#62170f",
          900: "#380c07"
        },
        sage: {
          50: "#f7f7f3",
          100: "#eeeeea",
          200: "#d9d9cd",
          300: "#d6d9cd",
          400: "#adab9d",
          500: "#919081",
          600: "#757466",
          700: "#5a5946",
          800: "#3f3f35",
          900: "#252410"
        },
        steel: {
          50: "#f0f2f3",
          100: "#d9dee0",
          200: "#b9c2c6",
          300: "#9ba7ac",
          400: "#6a7c82",
          500: "#829399",
          600: "#54656a",
          700: "#404e53",
          800: "#2c383c",
          900: "#1a2225"
        }
      },
      borderRadius: {
        none: "0",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "16px",
        "3xl": "16px",
        full: "9999px"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "monospace"],
        display: ["var(--font-fraunces)", "Fraunces", "serif"]
      },
      fontSize: {
        "display-xl": ["72px", { lineHeight: "80px", fontWeight: "700" }],
        "display-lg": ["56px", { lineHeight: "64px", fontWeight: "700" }],
        "display-md": ["40px", { lineHeight: "48px", fontWeight: "700" }],
        "ui-label": ["13px", { lineHeight: "16px", fontWeight: "600", letterSpacing: "0.04em" }]
      },
      spacing: {
        "space-1": "4px",
        "space-2": "8px",
        "space-3": "12px",
        "space-4": "16px",
        "space-5": "24px",
        "space-6": "32px",
        "space-7": "48px",
        "space-8": "64px",
        "space-9": "96px",
        "space-10": "128px"
      },
      boxShadow: {
        electric: "0 0 24px rgba(227, 178, 60, 0.28)",
        panel: "0 18px 60px rgba(5, 13, 26, 0.34)",
        "card-cream": "0 1px 3px rgba(10, 25, 47, 0.06)",
        "card-cream-lift": "0 1px 3px rgba(10, 25, 47, 0.06), 0 8px 24px rgba(10, 25, 47, 0.08)"
      },
      backgroundImage: {
        "gradient-sunset": "linear-gradient(90deg, #D22B2B 0%, #E3B23C 100%)",
        "gradient-studio-depth": "linear-gradient(180deg, #122742 0%, #050D1A 100%)",
        "gradient-warm-wash": "linear-gradient(90deg, #E3B23C 0%, #F6EFE2 100%)",
        "gradient-cool-support": "linear-gradient(180deg, #4C86A8 0%, #0A192F 100%)",
        "gradient-live-signal": "linear-gradient(180deg, #FF4D4D 0%, #D22B2B 100%)"
      }
    }
  },
  plugins: [tailwindcssAnimate]
};

export default config;
