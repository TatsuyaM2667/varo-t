import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
  },
  server: { port: 5173 },
});
