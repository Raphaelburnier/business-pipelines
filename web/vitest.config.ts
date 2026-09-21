import { defineConfig } from "vitest/config";

// Les tests du front ne touchent pas au DOM : ils vérifient les fixtures et la disposition,
// qui sont des fonctions pures. Pas d'environnement navigateur à simuler.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
