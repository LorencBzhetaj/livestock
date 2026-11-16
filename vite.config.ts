import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { previewPush } from './server/previewPush.js'

export default defineConfig({
  plugins: [
    react(),
    previewPush(),
    tailwind(),
    VitePWA({
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: { globPatterns: ['**/*.{js,css,html,png}'] },
    }),
  ],
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
})
