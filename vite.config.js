import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: '../ui-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5179,
    strictPort: true,
  },
});
