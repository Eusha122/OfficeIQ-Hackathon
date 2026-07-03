/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0A0A0A',
        surface: {
          50: '#111111',
          100: '#171717',
          200: '#1E1E1E',
        },
        border: {
          50: '#262626',
          100: '#333333',
        },
        primary: '#3B82F6', // Blue 500
        status: {
          active: '#22C55E',   // Green 500
          idle: '#6B7280',     // Gray 500
          warning: '#F59E0B',  // Amber 500
          critical: '#EF4444', // Red 500
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
