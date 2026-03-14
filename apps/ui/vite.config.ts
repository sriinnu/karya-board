import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = Number(process.env.VITE_DEV_PORT ?? 9631);
const apiPort = Number(process.env.VITE_KARYA_API_PORT ?? 9630);

/**
 * Vite configuration for the Karya UI application.
 * Configures React plugin, aliases for workspace packages, and build settings.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@karya/core': path.resolve(__dirname, '../../packages/core/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    open: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
