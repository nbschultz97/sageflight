/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stack: {
          bg:    '#0a0e1a',
          panel: '#121829',
          border:'#1f2940',
          text:  '#d4deef',
          muted: '#7b8aa6',
          accent:'#4aa3ff',
          ok:    '#34d399',
          warn:  '#fbbf24',
          err:   '#f87171',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
