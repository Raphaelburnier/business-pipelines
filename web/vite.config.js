import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// Le front est servi par le cockpit sous /app, pas à la racine : la page d'approbation
// garde la racine, et les deux cohabitent le temps que la seconde remplace la première.
//
// En développement, l'API est appelée sur le cockpit local (port 4600) : c'est lui qui
// tient l'event store et l'identité, et le dupliquer côté Vite donnerait une page qui
// marche en dev et pas en production.
export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwind()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:4600", changeOrigin: false },
    },
  },
});
