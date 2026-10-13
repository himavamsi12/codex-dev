import react from "@vitejs/plugin-react";
import codexDev from "codex-dev-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [codexDev(), react()] });
