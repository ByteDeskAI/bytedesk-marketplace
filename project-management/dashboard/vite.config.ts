import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          atlaskit_core: [
            '@atlaskit/lozenge',
            '@atlaskit/badge',
            '@atlaskit/avatar',
            '@atlaskit/progress-bar',
          ],
          atlaskit_table: ['@atlaskit/dynamic-table'],
          xterm: ['xterm', 'xterm-addon-fit'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7964',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:7964',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:7964',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
