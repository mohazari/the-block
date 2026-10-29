/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin API in dev: no CORS config, and EventSource works unchanged.
    proxy: {
      '/api': {
        // The e2e run points this at its own isolated API instance.
        target: process.env.THE_BLOCK_API_URL ?? 'http://127.0.0.1:8000',
        configure: (proxy) => {
          // When the API goes away mid-response (a restart, a --reload), the proxy leaves the
          // browser's side open: a live stream then just goes quiet and never reconnects. End it
          // too, so EventSource sees the drop and reconnects to the new server.
          proxy.on('proxyRes', (upstream, _request, response) => {
            upstream.on('close', () => {
              if (!response.writableEnded) response.destroy()
            })
          })
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
