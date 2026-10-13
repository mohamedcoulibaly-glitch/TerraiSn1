import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  // Dark mode piloté par la classe `.dark` sur `<html>` (ThemeProvider / Phase thème joueur)
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ["Sora", "sans-serif"],
        body: ["Plus Jakarta Sans", "sans-serif"],
        sans: ["Plus Jakarta Sans", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--s-border))",
        input: "hsl(var(--s-input))",
        ring: "hsl(var(--s-ring))",
        background: "hsl(var(--s-background))",
        foreground: "hsl(var(--s-foreground))",
        primary: {
          DEFAULT: "hsl(var(--s-primary))",
          foreground: "hsl(var(--s-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--s-secondary))",
          foreground: "hsl(var(--s-secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--s-destructive))",
          foreground: "hsl(var(--s-destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--s-muted))",
          foreground: "hsl(var(--s-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--s-accent))",
          foreground: "hsl(var(--s-accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--s-popover))",
          foreground: "hsl(var(--s-popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--s-card))",
          foreground: "hsl(var(--s-card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--s-sidebar-background))",
          foreground: "hsl(var(--s-sidebar-foreground))",
          primary: "hsl(var(--s-sidebar-primary))",
          "primary-foreground": "hsl(var(--s-sidebar-primary-foreground))",
          accent: "hsl(var(--s-sidebar-accent))",
          "accent-foreground": "hsl(var(--s-sidebar-accent-foreground))",
          border: "hsl(var(--s-sidebar-border))",
          ring: "hsl(var(--s-sidebar-ring))",
        },
        success: "hsl(var(--s-success))",
        warning: "hsl(var(--s-warning))",
        info: "hsl(var(--s-info))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
