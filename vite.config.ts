import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    // multiplayer rooms only admit identical builds (the lockstep sim must match bit for bit)
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
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
