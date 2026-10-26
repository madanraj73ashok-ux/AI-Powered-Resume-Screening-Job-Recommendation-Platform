/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f4fa',
          100: '#dce5f3',
          200: '#bccbe8',
          300: '#93a9d9',
          400: '#6582c5',
          500: '#4564b1',
          600: '#344d95',
          700: '#2c3f79',
          800: '#273763',
          900: '#1b2647',
          950: '#111830',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
