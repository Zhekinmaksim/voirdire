import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'app',
  publicDir: '../public',
  build: {
    outDir: '../dist', emptyOutDir: true,
    rollupOptions: { input: {
      home: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      application: fileURLToPath(new URL('./app/app/index.html', import.meta.url)),
    } },
  },
});
