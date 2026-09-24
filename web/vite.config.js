import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// Le front est désormais le cockpit principal, servi à la racine. Les décisions restent
// disponibles sur /decisions : une seule origine, une navigation claire.
//
// En développement, l'API est appelée sur le cockpit local (port 4600) : c'est lui qui
// tient l'event store et l'identité, et le dupliquer côté Vite donnerait une page qui
// marche en dev et pas en production.
export default defineConfig({
  base: "/",
  plugins: [react(), tailwind()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:4600", changeOrigin: false },
    },
  },
});
