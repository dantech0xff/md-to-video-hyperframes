import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          // the engine host runs in an Electron utility process
          "engine-host": resolve("src/engine/host.ts"),
          // starts ACP adapters with Electron's Node
          "agent-launcher": resolve("src/main/agent-launcher.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") },
        // sandboxed preload scripts must be CommonJS
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: { rollupOptions: { input: { index: resolve("src/renderer/index.html") } } },
    plugins: [react()],
  },
});
