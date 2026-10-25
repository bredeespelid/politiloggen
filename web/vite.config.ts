/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Replit og andre forhåndsvisninger kjører appen bak en proxy med eget vertsnavn.
    allowedHosts: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
