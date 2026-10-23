import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14221c',
        paper: '#f3f0e7',
        pine: '#1f6f54',
        moss: '#e5f2eb',
        copper: '#c46b3a',
        line: '#d9d3c5',
      },
      fontFamily: {
        serif: ['Iowan Old Style', 'Palatino', 'Palatino Linotype', 'Georgia', 'serif'],
        sans: ['Avenir Next', 'Segoe UI', 'Helvetica Neue', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
