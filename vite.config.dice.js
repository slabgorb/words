import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
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
        inlineDynamicImports: true,
      },
    },
  },
  esbuild: {
    target: "es2022",
  },
});
