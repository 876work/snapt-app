import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the Fastify mount point (/admin) — assets resolve as
// /admin/assets/…; the server SPA-fallbacks any other /admin/* GET.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    // `npm run dev` here + `npm run dev` in server/ = live UI against the
    // local API without a build step.
    proxy: { '/v1': 'http://127.0.0.1:4000' },
  },
});
