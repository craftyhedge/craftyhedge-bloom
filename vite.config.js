import { defineConfig } from 'vite';

const ddevHostname = process.env.DDEV_HOSTNAME || 'craftyhedge-spa.ddev.site';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: 'wss',
      host: ddevHostname,
      clientPort: 5173,
    },
  },
});
