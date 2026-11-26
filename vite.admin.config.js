import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./admin", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL("./dist-admin", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "resources",
  },
});
