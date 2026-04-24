import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary (Blue)
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Neutral (Gray)
        neutral: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        // Success (Green)
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        // Warning (Yellow)
        warning: {
          50: '#fefce8',
          100: '#fef9c3',
          500: '#eab308',
          700: '#a16207',
        },
        // Error (Red)
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444',
          700: '#b91c1c',
        },
        // Info (Cyan)
        info: {
          50: '#ecfeff',
          100: '#cffafe',
          500: '#06b6d4',
          700: '#0e7490',
        },
        // Orange
        orange: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          700: '#c2410c',
        },
        // Purple
        purple: {
          50: '#faf5ff',
          100: '#f3e8ff',
          500: '#a855f7',
          700: '#7e22ce',
        },
        // Application Status Colors
        status: {
          saved: '#06b6d4', // Cyan/Info
          applied: '#eab308', // Yellow/Warning
          'phone-screen': '#f97316', // Orange
          interview: '#a855f7', // Purple
          offer: '#22c55e', // Green/Success
          rejected: '#ef4444', // Red/Error
          withdrawn: '#9ca3af', // Gray/Neutral
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      },
      fontSize: {
        display: ['3rem', { lineHeight: '1.2', fontWeight: '700' }], // 48px
        h1: ['2.25rem', { lineHeight: '1.25', fontWeight: '700' }], // 36px
        h2: ['1.875rem', { lineHeight: '1.3', fontWeight: '600' }], // 30px
        h3: ['1.5rem', { lineHeight: '1.4', fontWeight: '600' }], // 24px
        h4: ['1.25rem', { lineHeight: '1.4', fontWeight: '600' }], // 20px
        'body-lg': ['1.125rem', { lineHeight: '1.6' }], // 18px
        body: ['1rem', { lineHeight: '1.5' }], // 16px
        'body-sm': ['0.875rem', { lineHeight: '1.5' }], // 14px
        caption: ['0.75rem', { lineHeight: '1.4' }], // 12px
        overline: ['0.625rem', { lineHeight: '1.4', fontWeight: '600' }], // 10px
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      lineHeight: {
        tight: '1.25',
        normal: '1.5',
        relaxed: '1.75',
      },
      spacing: {
        0: '0',
        1: '0.25rem', // 4px
        2: '0.5rem', // 8px
        3: '0.75rem', // 12px
        4: '1rem', // 16px
        5: '1.25rem', // 20px
        6: '1.5rem', // 24px
        8: '2rem', // 32px
        10: '2.5rem', // 40px
        12: '3rem', // 48px
        16: '4rem', // 64px
        20: '5rem', // 80px
        24: '6rem', // 96px
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        DEFAULT:
          '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      },
      borderRadius: {
        none: '0',
        sm: '0.125rem', // 2px
        DEFAULT: '0.25rem', // 4px
        md: '0.375rem', // 6px
        lg: '0.5rem', // 8px
        xl: '0.75rem', // 12px
        '2xl': '1rem', // 16px
        full: '9999px',
      },
      zIndex: {
        0: '0',
        dropdown: '1000',
        sticky: '1100',
        'modal-backdrop': '1200',
        modal: '1300',
        popover: '1400',
        toast: '1500',
        tooltip: '1600',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '350ms',
      },
      transitionTimingFunction: {
        'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
        'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  },
  plugins: [typography],
} satisfies Config;
