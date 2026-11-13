import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      // `generateSW` não permite handlers próprios; push, Background Sync e
      // Periodic Sync exigem um service worker escrito por nós.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: [
        "favicon.svg",
        "favicon-32.png",
        "icon.svg",
        "apple-touch-icon.png",
      ],
      manifest: {
        id: "/",
        name: "Viva Bem",
        short_name: "VivaBem",
        description: "Finanças pessoais e hábitos no dia a dia",
        lang: "pt-BR",
        categories: ["finance", "productivity", "lifestyle"],
        start_url: "/#/dashboard",
        scope: "/",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        background_color: "#f8f6f2",
        theme_color: "#b86420",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // `sw.js` e o manifest não entram no precache: precisam chegar sempre
        // da rede para que a atualização do app seja detectada.
        globIgnores: ["sw.js", "manifest.webmanifest"],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
      "/health": "http://127.0.0.1:3000",
      "/ready": "http://127.0.0.1:3000",
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
      "/health": "http://127.0.0.1:3000",
      "/ready": "http://127.0.0.1:3000",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
