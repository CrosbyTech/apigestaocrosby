module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        'barlow': ['Barlow', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
        'poppins': ['Poppins', 'sans-serif'],
        'roboto': ['Roboto', 'sans-serif'],
      },
      keyframes: {
        'slide-right': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        'slide-right-slow': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0%)' }
        },
        'slide-right-bounce': {
          '0%': { 
            transform: 'translateX(-100%) scale(0.8)',
            opacity: '0'
          },
          '50%': { 
            transform: 'translateX(0%) scale(1.1)',
            opacity: '1'
          },
          '100%': { 
            transform: 'translateX(0%) scale(1)',
            opacity: '1'
          }
        },
        'fade-in': {
          '0%': { 
            opacity: '0', 
            transform: 'scale(0.8) translateY(-10px)' 
          },
          '100%': { 
            opacity: '1', 
            transform: 'scale(1) translateY(0)' 
          }
        },
        'fade-in-smooth': {
          '0%': { 
            opacity: '0', 
            transform: 'scale(0.95) translateY(-2px)',
            filter: 'blur(1px)'
          },
          '100%': { 
            opacity: '1', 
            transform: 'scale(1) translateY(0)',
            filter: 'blur(0px)'
          }
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' }
        }
      },
      animation: {
        'slide-right': 'slide-right 3s ease-in-out',
        'slide-right-slow': 'slide-right-slow 4s ease-out',
        'slide-right-bounce': 'slide-right-bounce 2.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'fade-in': 'fade-in 0.8s ease-out',
        'fade-in-smooth': 'fade-in-smooth 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite'
      }
    },
  },
  plugins: [],
}