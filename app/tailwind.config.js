/** @type {import('tailwindcss').Config} */
// Palette modeled on Betaflight Configurator's dark theme: charcoal surfaces,
// BF-yellow accent, dark-on-yellow primary buttons.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stack: {
          bg:     '#2e2e2e',
          panel:  '#3b3b3b',
          header: '#1b1b1b',
          border: '#4a4a4a',
          text:   '#e0e0e0',
          muted:  '#9e9e9e',
          accent: '#ffbb00',
          ok:     '#7ec43b',
          warn:   '#ff9800',
          err:    '#f0392e',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'Menlo', 'monospace'],
        sans: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
