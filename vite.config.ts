import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build target: a single self-contained index.html (JS + CSS inlined), so the
// same artifact works as a local file, a static host, and a CSP-locked Artifact.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: false,
  },
});
