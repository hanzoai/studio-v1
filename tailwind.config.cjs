/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: {
    files: [
      './index.html',
      './src/**/*.{js,ts,jsx,tsx,css}',
    ],
    extract: {
      css: (content) => {
        const matches = content.match(/@apply\s+([^;]+);/g) || [];
        return matches.flatMap((match) =>
          match
            .replace(/@apply|;/g, '')
            .trim()
            .split(/\s+/)
        );
      },
    },
  },
  theme: {
    extend: {
      colors: {
        primary: '#f55036',
        'user-message-bg': '#222326',
        'custom-dark-bg': '#121418',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};