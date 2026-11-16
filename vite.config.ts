import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        id: './',
        start_url: './',
        scope: './',
        name: 'LivestockOS',
        short_name: 'LivestockOS',
        description: 'Menaxhimi i fermës në këtë pajisje',
        lang: 'sq',
        display: 'standalone',
        background_color: '#f8f5eb',
        theme_color: '#164b36',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { skipWaiting: false, clientsClaim: true, globPatterns: ['**/*.{js,css,html,png}'] },
    }),
  ],
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
})
