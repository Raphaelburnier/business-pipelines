// Le cockpit : deux vues (topologie, agents), une barre commune, un panneau latéral.
//
// L'éditeur de pipelines est la troisième vue de la spec ; il arrive en phase 6 et n'a pas
// d'onglet d'ici là. Un onglet qui ne mène nulle part apprendrait à se méfier des autres.
//
// La vue et la sélection vivent dans le fragment d'URL : recharger la page, ou envoyer le
// lien depuis le téléphone, garde ce qu'on regardait.
import { useCallback, useEffect, useState } from "react";
import { FournisseurSource } from "./donnees/contexte";
import { Topologie, type Selection } from "./topologie/Topologie";
import { Agents } from "./vues/Agents";
import { Barre } from "./vues/Barre";
import { Panneau } from "./vues/Panneau";

type Vue = "topologie" | "agents";

function lireAdresse(): { vue: Vue; selection: Selection | null } {
  const [vue, type, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  const v: Vue = vue === "agents" ? "agents" : "topologie";
  if ((type === "projet" || type === "run" || type === "machine") && id) {
    return { vue: v, selection: { type, id: decodeURIComponent(id) } };
  }
  return { vue: v, selection: null };
}

function ecrireAdresse(vue: Vue, selection: Selection | null) {
  const suite = selection ? `/${selection.type}/${encodeURIComponent(selection.id)}` : "";
  const cible = `#/${vue}${suite}`;
  if (window.location.hash !== cible) window.location.hash = cible;
}

function Cockpit() {
  const [etat, setEtat] = useState(lireAdresse);
  useEffect(() => {
    const suivre = () => setEtat(lireAdresse());
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, []);

  const choisir = useCallback((selection: Selection | null) => ecrireAdresse(etat.vue, selection), [etat.vue]);
  const changerVue = (vue: Vue) => ecrireAdresse(vue, etat.selection);

  return (
    <div className="flex h-dvh flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-trait pb-2">
        <h1 className="text-lg font-bold">Cockpit</h1>
        <nav className="flex gap-1" aria-label="Vues">
          {(["topologie", "agents"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changerVue(v)}
              aria-current={etat.vue === v ? "page" : undefined}
              className={`rounded-lg px-3 py-1 text-sm font-semibold ${etat.vue === v ? "bg-carte text-encre" : "text-douce hover:text-encre"}`}
            >
              {v === "topologie" ? "Topologie" : "Agents"}
            </button>
          ))}
        </nav>
        {/* Sur téléphone, la barre prend sa propre ligne : tassée à côté des onglets, chaque
            libellé passait à la ligne. */}
        <div className="w-full min-w-0 lg:w-auto lg:flex-1">
          <Barre />
        </div>
      </header>

      {/* Le panneau ne recouvre jamais la vue (§11.2) : à côté sur grand écran, dessous sur
          téléphone, l'arbre restant visible au-dessus. */}
      <main className={`grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 ${etat.selection ? "grid-rows-[55%_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-1" : ""}`}>
        <div className="min-h-0 min-w-0">
          {etat.vue === "topologie" ? <Topologie selection={etat.selection} onSelection={choisir} /> : <Agents onSelection={choisir} />}
        </div>
        {etat.selection && <Panneau key={`${etat.selection.type}:${etat.selection.id}`} selection={etat.selection} onSelection={choisir} onFermer={() => choisir(null)} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <FournisseurSource>
      <Cockpit />
    </FournisseurSource>
  );
}
