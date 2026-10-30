/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/observability-web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: 'localhost',
    port: 4201,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4202' },
  },
  preview: {
    host: 'localhost',
    port: 4301,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4202' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    name: 'observability-web',
    environment: 'jsdom',
    globals: true,
    watch: false,
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
