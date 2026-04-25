import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      // Ignore co-located test files inside `__tests__/` folders. Without this,
      // the plugin scans `*.test.tsx` looking for `createFileRoute` calls,
      // can't find them, and (worse) "auto-corrects" the path string in
      // sibling route files to match filenames — silently undoing
      // `/-/review` overrides on every dev/build cycle.
      routeFileIgnorePattern: "\\.test\\.|__tests__",
    }),
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
    VitePWA({
      srcDir: "src",
      filename: "sw.ts",
      strategies: "injectManifest",
      injectRegister: false,
      manifest: false,
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Exclude @lexical/code from dep pre-bundling. esbuild's code splitting
  // breaks Prism.js language component execution order: it puts prism-objectivec
  // (which extends "c") in a chunk that runs before prism-c is loaded.
  // Serving @lexical/code as original ESM preserves correct import ordering.
  optimizeDeps: {
    exclude: ["@lexical/code"],
  },

  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("/react-dom/") || id.includes("/react/")) {
              return "vendor-react";
            }
            if (
              id.includes("/@tanstack/react-router/") ||
              id.includes("/@tanstack/react-query/")
            ) {
              return "vendor-router";
            }
            if (id.includes("/lexical/") || id.includes("/@lexical/")) {
              return "lexical-editor";
            }
            if (id.includes("/@emoji-mart/")) {
              return "emoji-mart";
            }
            if (id.includes("/@dnd-kit/")) {
              return "dnd-kit";
            }
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
