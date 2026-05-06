import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  plugins: [react()],
  define: {
    // Lib mode does not auto-replace process.env.NODE_ENV; without this,
    // bundled deps (React etc.) reference `process` and crash in browsers.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: "es2022",
    outDir: "public/shared",
    emptyOutDir: false, // preserve dice-assets/
    sourcemap: true,
    lib: {
      entry: resolve(process.cwd(), "src/shared/dice/index.tsx"),
      formats: ["es"],
      fileName: () => "dice.js",
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
