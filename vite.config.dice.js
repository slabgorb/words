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
    // @local/dice-lib is a file: dep with its own node_modules — without
    // dedupe, vite resolves react/three/@react-three/* through the lib's
    // copy AND the consumer's copy, producing two instances of each in
    // dice.js. Symptoms: "Multiple instances of Three.js" warning;
    // useRef bindings come back null; "R3F: Hooks can only be used within
    // the Canvas component" (rapier's hooks see one fiber context,
    // Canvas registers in the other).
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/rapier",
    ],
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
