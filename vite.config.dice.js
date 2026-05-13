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
  resolve: {
    // stats-gl ships its own nested copy of three; if Rollup inlines both
    // alongside the top-level three the page ends up with two THREE
    // namespaces (one Canvas/scene context invisible to the other) and
    // React hook bindings come back null at consume time. Force every
    // three import to the project root's copy so the bundle has exactly
    // one — same for react/react-dom out of paranoia.
    dedupe: ["three", "react", "react-dom"],
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
