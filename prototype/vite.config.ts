import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react(), tailwind()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: Number(process.env.PORT || 5173),
  },
});