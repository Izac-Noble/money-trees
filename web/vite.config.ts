/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { robotsMeta } from "./robots";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), robotsMeta(env.APP_ENV)],
    server: {
      proxy: {
        "/health": env.VITE_API_PROXY_TARGET || "http://localhost:8000",
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/setupTests.ts"],
    },
  };
});
