import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { iconCatalog } from "./scripts/icon-catalog.mjs";

export default defineConfig({
  root: fileURLToPath(new URL("./admin", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [
    vue(),
    {
      name: "admin-icon-catalog",
      resolveId(id) {
        if (id === "virtual:admin-icons") return "\0virtual:admin-icons";
      },
      load(id) {
        if (id === "\0virtual:admin-icons") return "export default " + JSON.stringify(iconCatalog());
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL("./dist-admin", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "resources",
  },
});
