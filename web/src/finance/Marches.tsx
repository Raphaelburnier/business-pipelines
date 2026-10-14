import { useState } from "react";
import { Macro } from "./Macro";
import { Cours } from "./Cours";
export function Marches({ maquette }: { maquette: boolean }) {
  const [space, setSpace] = useState("economy");
  return (
    <>
      <nav className="fin-tabs fin-market-tabs" aria-label="Données de marché">
        <button
          type="button"
          aria-pressed={space === "economy"}
          onClick={() => setSpace("economy")}
        >
          Économie mondiale
        </button>
        <button
          type="button"
          aria-pressed={space === "prices"}
          onClick={() => setSpace("prices")}
        >
          Cours & suivi
        </button>
      </nav>
      {space === "economy" ? (
        <Macro maquette={maquette} />
      ) : (
        <Cours maquette={maquette} />
      )}
    </>
  );
}
