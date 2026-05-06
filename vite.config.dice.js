import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  plugins: [react()],
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
