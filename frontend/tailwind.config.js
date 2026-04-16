/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'hw-bg': 'rgb(var(--hw-bg-rgb) / <alpha-value>)',
        'hw-surface': 'rgb(var(--hw-surface-rgb) / <alpha-value>)',
        'hw-surface-hover': 'rgb(var(--hw-surface-hover-rgb) / <alpha-value>)',
        'hw-border': 'rgb(var(--hw-border-rgb) / <alpha-value>)',
        'hw-text': 'rgb(var(--hw-text-rgb) / <alpha-value>)',
        'hw-text-secondary': 'rgb(var(--hw-text-secondary-rgb) / <alpha-value>)',
        'hw-muted': 'rgb(var(--hw-muted-rgb) / <alpha-value>)',
        'hw-accent': 'rgb(var(--hw-accent-rgb) / <alpha-value>)',
        'hw-accent-hover': '#ea580c',
        'hw-accent-soft': 'rgba(249, 115, 22, 0.09)',
        'hw-orange': '#ef4444',
        zinc: { 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b', 600: '#52525b', 500: '#71717a', 400: '#a1a1aa', 300: '#d4d4d8', 200: '#e4e4e7', 100: '#f4f4f5' },
        emerald: { 400: '#34d399', 500: '#10b981', 900: '#064e3b', 950: '#022c22' },
        yellow: { 300: '#fde047', 400: '#facc15', 500: '#eab308', 900: '#713f12' },
        amber: { 300: '#fcd34d', 400: '#fbbf24', 700: '#b45309', 900: '#78350f' },
        blue: { 300: '#93c5fd', 400: '#60a5fa', 900: '#1e3a5f' },
        violet: { 400: '#a78bfa', 600: '#7c3aed', 700: '#6d28d9', 900: '#4c1d95' },
        red: { 900: '#7f1d1d', 950: '#450a0a' },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-out-right': 'slideOutRight 0.3s ease-in',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 1.5s infinite',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        'shimmer-gradient': 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
      },
    },
  },
  plugins: [],
}
