// Thème sombre (« nuit ») par défaut, clair (« jour ») sur demande. Les deux valeurs gardent
// leur nom d'origine pour respecter le choix déjà enregistré dans les navigateurs. Le choix
// vit dans le navigateur ; un stockage indisponible (navigation privée) laisse le sombre.
import { useCallback, useEffect, useState } from "react";

export type Theme = "nuit" | "jour";

const CLE = "cockpit.theme";

function lire(): Theme {
  try {
    return localStorage.getItem(CLE) === "jour" ? "jour" : "nuit";
  } catch {
    return "nuit";
  }
}

/** Applique le thème sur `<html data-theme>` et rend de quoi le basculer. */
export function useTheme(): { theme: Theme; basculer: () => void } {
  const [theme, setTheme] = useState<Theme>(lire);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "jour" ? "#f6f7f9" : "#0e1116");
  }, [theme]);

  const basculer = useCallback(() => {
    setTheme((avant) => {
      const apres: Theme = avant === "nuit" ? "jour" : "nuit";
      try {
        localStorage.setItem(CLE, apres);
      } catch {
        // Pas de stockage : le thème ne survivra pas au rechargement.
      }
      return apres;
    });
  }, []);

  return { theme, basculer };
}
