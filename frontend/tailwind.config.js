/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'tab-bar': 'calc(56px + env(safe-area-inset-bottom, 0px))',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      colors: {
        forest: {
          DEFAULT: 'var(--color-forest)',
          mid: 'var(--color-forest-mid)',
          light: 'var(--color-forest-light)',
        },
        sage: {
          DEFAULT: 'var(--color-sage)',
          light: 'var(--color-sage-light)',
        },
        terra: {
          DEFAULT: 'var(--color-terra)',
          light: 'var(--color-terra-light)',
        },
        cream: {
          DEFAULT: 'var(--color-cream)',
          dark: 'var(--color-cream-dark)',
        },
        'text-mid': 'var(--color-text-mid)',
        'text-muted': 'var(--color-text-muted)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      fontSize: {
        'display': ['var(--text-display)', { lineHeight: 'var(--leading-tight)' }],
        'hero': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)' }],
        'heading': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
      },
      borderRadius: {
        'mise-sm': 'var(--radius-sm)',
        'mise-md': 'var(--radius-md)',
        'mise-lg': 'var(--radius-lg)',
        'mise-xl': 'var(--radius-xl)',
      },
      boxShadow: {
        'card': 'var(--shadow-card)',
        'mise-sm': 'var(--shadow-sm)',
        'mise-md': 'var(--shadow-md)',
        'mise-lg': 'var(--shadow-lg)',
      },
      letterSpacing: {
        'widest-mise': 'var(--tracking-widest)',
      },
    },
  },
  plugins: [],
}
