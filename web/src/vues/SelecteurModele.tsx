// Le choix du modèle au lancement d'un run. Déplié dans le panneau, jamais en modale.
//
// Il montre le dernier relevé poussé par le PC, avec son âge : le cockpit ne joint pas
// OmniRoute et ne prétend pas savoir mieux que ce relevé. Un modèle que le runner ne peut
// pas prendre reste visible, grisé, avec sa raison ; il ne se choisit pas.
import { useMemo, useState } from "react";
import { useCharge, useHorloge } from "../donnees/contexte";
import { classer } from "../donnees/modeles";
import { duree } from "../format";
import type { Llm, Modele } from "../types";
import { Erreur } from "../ui";

// Au-delà, la liste ne s'affiche plus en entier : chercher va plus vite que défiler.
const LIMITE = 60;

const MENTION_ETAT: Partial<Record<Modele["etat"], { texte: string; classe: string }>> = {
  limite: { texte: "quota bas", classe: "text-alerte" },
  inconnu: { texte: "quota inconnu", classe: "text-douce" },
};

function capacites(m: Modele): string {
  const c = [m.capacites.vision && "vision", m.capacites.raisonnement && "raisonnement"].filter(Boolean);
  if (m.contexte) c.push(`${Math.round(m.contexte / 1000)}k`);
  return c.join(" · ");
}

export function SelecteurModele({ choix, onChoix, desactive = false }: { choix: Llm | null; onChoix: (llm: Llm | null) => void; desactive?: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [tour, setTour] = useState(0);
  const maintenant = useHorloge(30_000);
  const { donnees, erreur } = useCharge((s) => s.modeles(), [tour]);
  const classement = useMemo(() => (donnees ? classer(donnees, recherche) : null), [donnees, recherche]);

  const choisir = (llm: Llm | null) => {
    onChoix(llm);
    setOuvert(false);
  };
  const actif = (m: Modele) => choix?.via === m.llm.via && choix.model === m.llm.model;
  const libelleChoix = choix ? (donnees?.catalogue?.modeles.find((m) => m.llm.via === choix.via && m.llm.model === choix.model)?.nom ?? choix.model) : "défaut du pipeline";

  let restants = LIMITE;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={desactive}
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex items-center gap-2 rounded-lg border border-trait bg-carte px-3 py-1.5 text-left text-sm hover:border-accent disabled:opacity-60"
      >
        <span className="text-douce">Modèle</span>
        <span className="truncate font-semibold">{libelleChoix}</span>
        <span className="ml-auto text-xs text-douce">{ouvert ? "fermer" : "changer"}</span>
      </button>

      {ouvert && (
        <div className="flex flex-col gap-2 rounded-lg border border-trait bg-carte p-2">
          {erreur && <Erreur>{erreur}</Erreur>}
          {!donnees && !erreur && <p className="text-xs text-douce">Lecture du relevé…</p>}
          {donnees && (
            <>
              <div className="flex items-center gap-2 text-[11px] text-douce">
                {donnees.catalogue ? (
                  <span>
                    relevé sur {donnees.catalogue.machine} il y a {duree((donnees.ageSecondes ?? 0) * 1000)}
                  </span>
                ) : (
                  <span>{donnees.raison}</span>
                )}
                <button type="button" onClick={() => setTour((t) => t + 1)} className="ml-auto rounded px-1.5 hover:text-accent">
                  relire
                </button>
              </div>
              {donnees.catalogue && donnees.perime && <p className="text-[11px] text-alerte">Relevé périmé : le PC dort ou le minuteur est arrêté. La liste peut être fausse.</p>}
              {donnees.catalogue?.passerelle.etat !== undefined && donnees.catalogue.passerelle.etat !== "ok" && (
                <Erreur>
                  OmniRoute {donnees.catalogue.passerelle.etat === "refus" ? "refuse la clé" : "ne répond pas"} : {donnees.catalogue.passerelle.detail}
                </Erreur>
              )}
              {donnees.catalogue?.quotas === "scope_absent" && (
                <p className="text-[11px] text-douce">Quotas non relevés : la clé n'a pas le scope self:account-quota, la liste n'est pas filtrée.</p>
              )}

              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="sonnet, codex, vision…"
                aria-label="Chercher un modèle"
                className="rounded border border-trait bg-surface px-2 py-1 text-sm"
              />

              <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                <li>
                  <button type="button" onClick={() => choisir(null)} className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-surface ${choix ? "" : "font-semibold text-accent"}`}>
                    Défaut du pipeline <span className="text-[11px] font-normal text-douce">chaque nœud garde son modèle</span>
                  </button>
                </li>
                {classement?.utilisables.map(([fournisseur, liste]) => {
                  if (restants <= 0) return null;
                  const visibles = liste.slice(0, restants);
                  restants -= visibles.length;
                  return (
                    <li key={fournisseur}>
                      <p className="mt-1 px-2 text-[10px] font-bold uppercase tracking-wider text-douce">{fournisseur === "combo" ? "combos (avec repli)" : fournisseur}</p>
                      <ul>
                        {visibles.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              onClick={() => choisir(m.llm)}
                              className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-surface ${actif(m) ? "font-semibold text-accent" : ""}`}
                            >
                              <span className="max-w-[65%] shrink-0 truncate">{m.nom}</span>
                              <span className="min-w-0 truncate text-[11px] text-douce">{capacites(m)}</span>
                              {MENTION_ETAT[m.etat] && <span className={`ml-auto whitespace-nowrap text-[11px] ${MENTION_ETAT[m.etat]?.classe}`}>{MENTION_ETAT[m.etat]?.texte}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
                {restants <= 0 && <li className="px-2 py-1 text-[11px] text-douce">Liste tronquée : affine la recherche.</li>}
                {classement && classement.total === 0 && <li className="px-2 py-1 text-[11px] text-douce">Aucun modèle ne correspond.</li>}
              </ul>

              {classement && classement.indisponibles.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-douce">Indisponibles {classement.indisponibles.length}</summary>
                  <ul className="mt-1 flex max-h-60 flex-col gap-0.5 overflow-y-auto">
                    {classement.indisponibles.slice(0, LIMITE).map(({ modele: m, raison }) => (
                      <li key={m.id} className="flex items-baseline gap-2 px-2 py-0.5 text-douce" aria-disabled="true">
                        <span className="truncate line-through decoration-trait">{m.nom}</span>
                        <span className="ml-auto whitespace-nowrap text-[11px]">
                          {raison}
                          {m.resetAt && Date.parse(m.resetAt) > maintenant && ` · reprise dans ${duree(Date.parse(m.resetAt) - maintenant)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
