import { defineConfig } from 'vite';

const ddevHostname = process.env.DDEV_HOSTNAME || 'craftyhedge-spa.ddev.site';

export default defineConfig({
  // Served from a GitHub Pages project subpath (craftyhedge.github.io/craftyhedge-bloom/),
  // so assets must be referenced relative to that base rather than the domain root —
  // otherwise the built /assets/* URLs resolve to the root and 404. Local dev (where the
  // app is served from /) keeps the root base.
  base: process.env.GITHUB_ACTIONS ? '/craftyhedge-bloom/' : '/',
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
