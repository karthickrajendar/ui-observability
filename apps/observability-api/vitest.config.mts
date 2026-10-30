import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'observability-api',
    environment: 'node',
    globals: true,
    watch: false,
    include: ['src/**/*.spec.ts'],
  },
});
