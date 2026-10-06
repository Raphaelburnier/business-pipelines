// Le panneau « En cours » (AgenticOS) : une ligne de 40px par run vivant, le détail au clic,
// une seule ligne ouverte à la fois. Ordre : à valider, en cours, en pause.
//
// Les actions ne proposent que les chemins qui existent côté serveur : ouvrir le run, et
// aller décider pour une validation. Pause, Arrêter et Relancer arriveront avec leurs routes ;
// un bouton qui ne fait rien apprendrait à se méfier des autres.
import { useMemo, useState } from "react";
import { useCharge, useHorloge } from "../donnees/contexte";
import { depuis, usd } from "../format";
import { naviguer } from "../navigation";
import type { Run } from "../types";
import { Etat } from "../ui";

type Genre = "wait" | "run" | "pause";

const GENRES: Partial<Record<Run["statut"], Genre>> = {
  waiting_approval: "wait",
  running: "run",
  queued: "run",
  paused: "pause",
  waiting_quota: "pause",
  waiting_auth: "pause",
  waiting_machine: "pause",
};

const RANG: Record<Genre, number> = { wait: 0, run: 1, pause: 2 };

function aDroite(run: Run, genre: Genre, faites: number): { texte: string; alerte: boolean } {
  if (genre === "wait") return { texte: "à valider", alerte: true };
  if (run.statut === "waiting_quota") return { texte: "quota", alerte: false };
  if (run.statut === "waiting_auth") return { texte: "connexion requise", alerte: true };
  if (run.statut === "waiting_machine") return { texte: "machine", alerte: false };
  if (genre === "pause") return { texte: "pause", alerte: false };
  if (run.statut === "queued") return { texte: "en file", alerte: false };
  return { texte: `${faites}/${run.etapes.total}`, alerte: false };
}

export function EnCours() {
  const maintenant = useHorloge(5000);
  const { donnees, erreur } = useCharge((s) => s.runs({ limite: 30 }), []);
  // Une livraison du cockpit en cours se suit aussi d'ici ; le détail est sur Décisions.
  const { donnees: livraison } = useCharge((s) => s.livraison(), []);
  const livraisonEnCours = livraison?.enCours ?? null;
  const [ouverte, setOuverte] = useState<string | null | undefined>(undefined);

  const lignes = useMemo(
    () =>
      (donnees ?? [])
        .flatMap((run) => {
          const genre = GENRES[run.statut];
          return genre ? [{ run, genre }] : [];
        })
        .sort((a, b) => RANG[a.genre] - RANG[b.genre] || Date.parse(b.run.debut ?? "") - Date.parse(a.run.debut ?? "")),
    [donnees]
  );

  // Par défaut, la première ligne est ouverte : en pratique celle qui attend ta décision.
  const idOuverte = ouverte === undefined ? (lignes[0]?.genre === "wait" ? lignes[0].run.id : null) : ouverte;

  return (
    <aside className="ao-encours" aria-label="En cours">
      <header>
        <h2>En cours</h2>
        <span className="n">{lignes.length + (livraisonEnCours ? 1 : 0)}</span>
      </header>
      {erreur && <p className="ao-vide text-danger">{erreur}</p>}
      {!erreur && !donnees && <p className="ao-vide">Lecture des runs…</p>}
      {donnees && !lignes.length && <p className="ao-vide">Rien ne tourne. Lance un run depuis un projet du graphe.</p>}
      <ul>
        {livraisonEnCours && (
          <li className="ao-ligne run">
            <button type="button" onClick={() => naviguer("/decisions")} title="Suivre la livraison sur Décisions">
              <span className="point" aria-hidden="true" />
              <span className="ttl">livraison du cockpit</span>
              <span className="r">{livraisonEnCours.etape ?? "en file"}</span>
            </button>
          </li>
        )}
        {lignes.map(({ run, genre }) => {
          const faites = run.etapes.parStatut.succeeded ?? 0;
          const total = run.etapes.total;
          const droite = aDroite(run, genre, faites);
          const estOuverte = run.id === idOuverte;
          const titre = run.projet ?? "sans projet";
          return (
            <li key={run.id} className={`ao-ligne ${genre} ${estOuverte ? "ouverte" : ""}`}>
              <button type="button" aria-expanded={estOuverte} onClick={() => setOuverte(estOuverte ? null : run.id)}>
                <span className="point" aria-hidden="true" />
                <span className="ttl" title={`${titre} · ${run.pipeline}`}>
                  {titre}
                </span>
                <span className={`r ${droite.alerte ? "alerte" : ""}`}>{droite.texte}</span>
              </button>
              {!estOuverte && total > 0 && (
                <span className="filet" aria-hidden="true">
                  <i style={{ width: `${(faites / total) * 100}%` }} />
                </span>
              )}
              {estOuverte && (
                <div className="ao-detail">
                  <div className="flex items-center gap-2">
                    <Etat etat={run.statut} />
                    <span className="ml-auto font-mono text-[11px] text-douce" title="Sur abonnement, un équivalent API, pas une dépense">
                      {usd(run.coutEquivalentUsd)} · {depuis(run.debut, maintenant)}
                    </span>
                  </div>
                  <div className="meta">
                    <span>{run.pipeline}</span>
                    {run.declencheur && <span>· {run.declencheur}</span>}
                  </div>
                  {total > 0 && (
                    <div className="ao-etapes" aria-label={`Étape ${Math.min(faites + 1, total)} sur ${total}`}>
                      {Array.from({ length: total }, (_, i) => (
                        <i key={i} className={i < faites ? "fait" : i === faites && genre !== "pause" ? "maintenant" : ""} />
                      ))}
                    </div>
                  )}
                  <div className="ao-actions">
                    {genre === "wait" && (
                      <a className="ao-btn primaire" href="/decisions">
                        Décider
                      </a>
                    )}
                    <button type="button" className="ao-btn" onClick={() => naviguer(`/runs/${encodeURIComponent(run.id)}`)}>
                      Ouvrir le run
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
