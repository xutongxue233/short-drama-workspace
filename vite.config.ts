import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));
function port(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${name} 必须是 1–65535 的整数端口`);
  }
  return number;
}

export default defineConfig(() => {
  // npm scripts load the same .env for Node and Vite. Mode-specific frontend
  // files must not change the API proxy independently of the API process.
  const env = process.env;
  return {
    root,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: port(env.WEB_PORT, 5173, "WEB_PORT"),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${port(env.API_PORT, 3001, "API_PORT")}` },
    },
    build: {
      outDir: "dist",
      rollupOptions: {
        output: { manualChunks: { markdown: ["react-markdown", "remark-gfm"] } },
      },
    },
  };
});
