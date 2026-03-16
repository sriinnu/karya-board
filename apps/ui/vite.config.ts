import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = Number(process.env.VITE_DEV_PORT ?? 9631);
const apiPort = Number(process.env.VITE_KARYA_API_PORT ?? 9630);

/**
 * Resolves local HTTPS certs if present.
 * Looks for mkcert-generated certs in the project certs/ directory.
 */
function resolveHttpsOptions(): { cert: Buffer; key: Buffer } | false {
  const certPath = process.env.KARYA_SSL_CERT
    ?? path.resolve(__dirname, '../../certs/localhost+2.pem');
  const keyPath = process.env.KARYA_SSL_KEY
    ?? path.resolve(__dirname, '../../certs/localhost+2-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }
  return false;
}

const httpsOptions = resolveHttpsOptions();

/**
 * Vite configuration for the Karya UI application.
 * Auto-detects local certs and enables HTTPS when available.
 * Note: API proxy always uses HTTP since the Karya API server runs on HTTP.
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
    ...(httpsOptions ? { https: httpsOptions } : {}),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
