/** @type {import('tailwindcss').Config} */
// Sageflight's own palette: sage green accent on green-cast charcoal.
// Familiar configurator layout, unmistakably not Betaflight yellow.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stack: {
          bg:     '#262b25',
          panel:  '#30362f',
          header: '#181b17',
          border: '#454d43',
          text:   '#e3e7df',
          muted:  '#9aa294',
          accent: '#a3c17e',
          ok:     '#79c26d',
          warn:   '#e0b13f',
          err:    '#e05d52',
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
