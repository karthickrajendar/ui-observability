/// <reference types='vitest' />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Tiny same-origin echo API so the demo can produce real fetch spans with
 * traceparent propagation without needing a backend service.
 */
function echoApiPlugin(): Plugin {
  return {
    name: 'demo-echo-api',
    configureServer(server) {
      server.middlewares.use('/api/echo', (req, res) => {
        const traceparent = req.headers['traceparent'] ?? null;
        setTimeout(() => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, receivedTraceparent: traceparent, ts: Date.now() }));
        }, 120);
      });
    },
  };
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/demo-app',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [react(), echoApiPlugin()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    // Source maps stay on the server side; never expose them publicly in production.
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@ui-observability/demo-app',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
