import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // The page lives in src/web; the backend serves the build from dist/web.
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  test: {
    root: import.meta.dirname,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
