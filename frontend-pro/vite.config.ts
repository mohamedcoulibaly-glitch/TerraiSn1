import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
const viteBase = process.env.VITE_BASE || "/";
const basePath = viteBase.endsWith("/") ? viteBase : `${viteBase}/`;

export default defineConfig(({ mode }) => ({
  // Domaine dédié : `/` — mono-host Render : `VITE_BASE=/pro/`
  base: viteBase,
  server: {
    host: "::",
    port: 5174,
    strictPort: true,
    // Autorise les tunnels ngrok / Cloudflare (sinon 403 Blocked request)
    allowedHosts: true,
    hmr: {
      overlay: false,
      // Derrière ngrok HTTPS
      protocol: process.env.NGROK_URL ? "wss" : undefined,
      clientPort: process.env.NGROK_URL ? 443 : undefined,
      host: process.env.NGROK_HOST || undefined,
    },
    proxy: {
      // Ne jamais réutiliser VITE_API_URL (/api) comme target → sinon 404 /api/api/*
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (String(req.url || '').includes('/events')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['connection'] = 'keep-alive';
              delete proxyRes.headers['content-length'];
            }
          });
        },
      },
      '/uploads': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/webhook': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'query': ['@tanstack/react-query'],
          'ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover'],
          'charts': ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'favicon.png',
        'apple-touch-icon.png',
        'icons/*.png',
        'placeholder.svg',
      ],
      manifest: {
        id: 'terrainsn-pro',
        name: 'TerrainSN Pro',
        short_name: 'TerSN Pro',
        description: 'Espace professionnel TerrainSN',
        theme_color: '#1A3FAA',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'any',
        scope: basePath,
        start_url: basePath,
        lang: 'fr',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        icons: [
          { src: `${basePath}icons/icon-72.png`, sizes: '72x72', type: 'image/png' },
          { src: `${basePath}icons/icon-96.png`, sizes: '96x96', type: 'image/png' },
          { src: `${basePath}icons/icon-128.png`, sizes: '128x128', type: 'image/png' },
          { src: `${basePath}icons/icon-144.png`, sizes: '144x144', type: 'image/png' },
          { src: `${basePath}icons/icon-152.png`, sizes: '152x152', type: 'image/png' },
          { src: `${basePath}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-384.png`, sizes: '384x384', type: 'image/png' },
          { src: `${basePath}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Tableau de bord gérant',
            short_name: 'Gérant',
            url: `${basePath}backoffice/gerant?source=shortcut`,
            icons: [{ src: `${basePath}icons/icon-96.png`, sizes: '96x96' }],
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      // Ne pas activer le SW en dev : il met en cache des modules Vite
      // et provoque souvent une page blanche après HMR / Ctrl+Shift+R.
      devOptions: {
        enabled: false,
      },
    }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
