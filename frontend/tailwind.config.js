/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canopy: {
          50: "#eefbf3",
          100: "#d6f5e0",
          200: "#b0eac5",
          300: "#7dd8a3",
          400: "#45bd7b",
          500: "#20a15e",
          600: "#13814b",
          700: "#10673d",
          800: "#115234",
          900: "#0f432c",
          950: "#052617",
        },
        bloom: {
          400: "#f472b6",
          500: "#ec4899",
        },
      },
      fontFamily: {
        display: ["'Clash Display'", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(69, 189, 123, 0.55)",
        card: "0 10px 40px -12px rgba(0, 0, 0, 0.45)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
