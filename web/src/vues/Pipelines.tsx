// L'écran Pipelines (design system AgenticOS, composant Pipelines) : les runs à gauche, le
// graphe du run choisi au centre, l'inspecteur à droite. Un clic sur une étape, un lien ou
// son étiquette ouvre son détail ; « { } » montre le JSON du graphe.
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import type { MembreEquipe } from "../donnees/equipe";
import { construireGraphe, grapheJson, trierRuns, type EtatNoeud, type GraphePipeline, type LienPipeline, type NoeudPipeline } from "../donnees/pipelineGraphe";
import { idPipeline, nomPipeline, versionPipeline, type PipelineConnu, type Rattachement, type ReponsePipelines } from "../donnees/pipelines";
import { VIDE, depuis, duree, jetons, usd } from "../format";
import { Icone } from "../icones";
import type { RunDetailleAvecOutils } from "../types";
import { Erreur, Etat, Vide } from "../ui";
import { Portrait } from "./Portrait";
import "./pipelines.css";

type Choix = { type: "noeud"; id: string } | { type: "lien"; index: number } | { type: "json" };

const LARGEUR = 760;
const H = 60;
const PAS = 90;
const CTX = { x: 24, w: 196 };
const CENTRE = { gauche: 260, droite: 700 };

const motEtat = (n: Pick<NoeudPipeline, "etat" | "genre">) => (n.genre === "gate" && n.etat === "wait" ? "Attend ta décision" : MOTS[n.etat]);

const MOTS: Record<EtatNoeud, string> = { done: "Terminé", run: "En cours", wait: "En attente", err: "Échoué", pending: "À venir" };

interface Boite {
  x: number;
  y: number;
  w: number;
}

function disposer(graphe: GraphePipeline): { boites: Map<string, Boite>; hauteur: number } {
  const boites = new Map<string, Boite>();
  const parRang = new Map<number, NoeudPipeline[]>();
  for (const n of graphe.noeuds) if (n.genre !== "ctx") parRang.set(n.rang, [...(parRang.get(n.rang) ?? []), n]);
  for (const [rang, noeuds] of parRang) {
    const k = noeuds.length;
    const espace = CENTRE.droite - CENTRE.gauche;
    const w = Math.min(236, (espace - (k - 1) * 12) / k);
    const total = k * w + (k - 1) * 12;
    const x0 = (CENTRE.gauche + CENTRE.droite) / 2 - total / 2;
    noeuds.forEach((n, i) => boites.set(n.id, { x: x0 + i * (w + 12), y: 16 + rang * PAS, w }));
  }
  // Plusieurs outils au même rang s'empilent sans se chevaucher.
  let bas = Number.NEGATIVE_INFINITY;
  for (const n of graphe.noeuds.filter((x) => x.genre === "ctx").sort((a, b) => a.rang - b.rang)) {
    const y = Math.max(16 + n.rang * PAS, bas + 12);
    boites.set(n.id, { x: CTX.x, y, w: CTX.w });
    bas = y + H;
  }
  const hauteur = Math.max(...[...boites.values()].map((b) => b.y + H)) + 16;
  return { boites, hauteur };
}

function chemin(lien: LienPipeline, a: Boite, b: Boite): { d: string; etiquette: { x: number; y: number } | null } {
  if (lien.genre === "ctx") {
    const x1 = a.x + a.w;
    const y1 = a.y + H / 2;
    const x2 = b.x;
    const y2 = b.y + H / 2 + (y1 < b.y + H / 2 ? -10 : y1 > b.y + H / 2 ? 10 : 0);
    const mx = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, etiquette: null };
  }
  if (lien.genre === "loop") {
    const rx = Math.max(a.x + a.w, b.x + b.w);
    const ya = a.y + H / 2;
    const yb = b.y + H / 2;
    return { d: `M${a.x + a.w} ${ya} C${rx + 70} ${ya} ${rx + 70} ${yb} ${b.x + b.w + 6} ${yb}`, etiquette: { x: rx + 58, y: (ya + yb) / 2 - 9 } };
  }
  const x1 = a.x + a.w / 2;
  const x2 = b.x + b.w / 2;
  const y1 = a.y + H;
  const y2 = b.y - 4;
  const d = x1 === x2 ? `M${x1} ${y1} V${y2}` : `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  return { d, etiquette: { x: Math.max(x1, x2) + 10, y: (y1 + y2) / 2 - 9 } };
}

function texteLien(l: LienPipeline): string {
  return l.jetons ? `${l.quoi}  ·  ${jetons(l.jetons)} tok` : l.quoi;
}

const activer = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const requete = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!requete) return;
    const suivre = () => setReduit(requete.matches);
    requete.addEventListener("change", suivre);
    return () => requete.removeEventListener("change", suivre);
  }, []);
  return reduit;
}

function Graphe({ graphe, membres, choix, choisir }: { graphe: GraphePipeline; membres: Map<string, MembreEquipe>; choix: Choix | null; choisir: (c: Choix) => void }) {
  const { boites, hauteur } = useMemo(() => disposer(graphe), [graphe]);
  const reduit = useMouvementReduit();
  const parId = useMemo(() => new Map(graphe.noeuds.map((n) => [n.id, n])), [graphe]);
  const travail = graphe.noeuds.filter((n) => n.genre !== "ctx" && n.genre !== "input");
  const aContexte = graphe.noeuds.some((n) => n.genre === "ctx");
  // Sans lecture relevée, le couloir contexte resterait vide : le cadre commence après lui.
  const origine = aContexte ? 0 : CTX.x + CTX.w + 16;
  const rangEtat: Record<EtatNoeud, number> = { pending: 0, done: 1, err: 1, wait: 2, run: 3 };
  const liens = graphe.liens.map((l, index) => ({ l, index })).sort((a, b) => rangEtat[a.l.etat] - rangEtat[b.l.etat]);

  return (
    <svg className={`pl-graphe ${aContexte ? "avec-contexte" : ""}`} viewBox={`${origine} 0 ${LARGEUR - origine} ${hauteur}`} preserveAspectRatio="xMidYMin meet" role="group" aria-label="Graphe du pipeline">
      <defs>
        {(["done", "run", "wait", "pending", "err", "c"] as const).map((k) => (
          <marker key={k} id={`pl-fleche-${k}`} viewBox="0 0 8 8" refX={6} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8Z" className={`pl-fleche ${k}`} />
          </marker>
        ))}
      </defs>
      {aContexte && (
        <>
          <rect x={CTX.x - 8} y={4} width={CTX.w + 16} height={hauteur - 12} className="pl-couloir" />
          <text x={CTX.x} y={hauteur - 14} className="pl-couloir-titre">
            CONTEXTE
          </text>
        </>
      )}

      <g>
        {liens.map(({ l, index }) => {
          const a = boites.get(l.de);
          const b = boites.get(l.vers);
          if (!a || !b) return null;
          const { d } = chemin(l, a, b);
          const sel = choix?.type === "lien" && choix.index === index;
          const anime = !reduit && (l.etat === "run" || (l.genre === "ctx" && parId.get(l.vers)?.etat === "run"));
          return (
            <g key={index}>
              <path id={`pl-lien-${index}`} d={d} className={`pl-lien ${l.genre} ${l.etat} ${sel ? "sel" : ""}`} markerEnd={`url(#pl-fleche-${l.genre === "ctx" ? "c" : l.etat})`} />
              <path
                d={d}
                className="pl-zone"
                tabIndex={0}
                role="button"
                aria-label={`${l.genre === "ctx" ? "Contexte" : l.genre === "loop" ? "Retour" : "Travail"} : ${l.quoi}`}
                onClick={() => choisir({ type: "lien", index })}
                onKeyDown={activer(() => choisir({ type: "lien", index }))}
              />
              {anime && (
                <rect className={`pl-paquet ${l.genre}`} width={7} height={7} x={-3.5} y={-3.5}>
                  <animateMotion dur={l.genre === "ctx" ? "2.4s" : "1.6s"} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#pl-lien-${index}`} />
                  </animateMotion>
                </rect>
              )}
            </g>
          );
        })}
      </g>

      <g>
        {liens.map(({ l, index }) => {
          const a = boites.get(l.de);
          const b = boites.get(l.vers);
          if (!a || !b || !l.quoi) return null;
          const { etiquette } = chemin(l, a, b);
          // Entre deux rangs parallèles, une étiquette par lien deviendrait illisible.
          const seul = graphe.liens.filter((x) => x.genre === "work" && (x.de === l.de || x.vers === l.vers)).length <= 2;
          if (!etiquette || (l.genre === "work" && !seul)) return null;
          const texte = texteLien(l);
          return (
            <g key={index} className={`pl-etiquette ${l.etat} ${l.genre}`} transform={`translate(${etiquette.x} ${etiquette.y})`} onClick={() => choisir({ type: "lien", index })}>
              <rect width={texte.length * 6 + 12} height={18} />
              <text x={6} y={12}>
                {texte}
              </text>
            </g>
          );
        })}
      </g>

      <g>
        {graphe.noeuds.map((n) => {
          const b = boites.get(n.id);
          if (!b) return null;
          const sel = choix?.type === "noeud" && choix.id === n.id;
          const membre = n.membre ? membres.get(n.membre) : undefined;
          const numero = travail.indexOf(n) + 1;
          const etiquette = `${n.titre} : ${motEtat(n)}`;
          return (
            <g
              key={n.id}
              className={`pl-noeud ${n.genre} ${n.etat} ${sel ? "sel" : ""}`}
              transform={`translate(${b.x} ${b.y})`}
              tabIndex={0}
              role="button"
              aria-label={etiquette}
              aria-pressed={sel}
              onClick={() => choisir({ type: "noeud", id: n.id })}
              onKeyDown={activer(() => choisir({ type: "noeud", id: n.id }))}
            >
              <title>{etiquette}</title>
              {n.genre === "gate" ? (
                <>
                  <path className="boite" d={`M16 0H${b.w - 16}L${b.w} ${H / 2}L${b.w - 16} ${H}H16L0 ${H / 2}Z`} />
                  <path className="losange" d={`M28 ${H / 2 - 9}l9 9-9 9-9-9Z`} />
                  <text x={48} y={26} className="nom">
                    {couper(n.titre, b.w - 64, 8)}
                  </text>
                  <text x={48} y={43} className="sous">
                    {couper(n.sousTitre, b.w - 64, 6)}
                  </text>
                </>
              ) : n.genre === "input" || n.genre === "output" || n.genre === "script" || n.genre === "ctx" ? (
                <>
                  <path className="boite" d={`M0 0H${b.w - 12}L${b.w} 12V${H}H0Z`} />
                  <text x={16} y={18} className="genre">
                    {{ input: "ENTRÉE", output: "SORTIE", script: "SCRIPT", ctx: "LECTURE" }[n.genre]}
                  </text>
                  <text x={16} y={37} className="nom">
                    {couper(n.titre, b.w - 40, 8)}
                  </text>
                  <text x={16} y={52} className="sous">
                    {couper(n.sousTitre, b.w - 40, 6)}
                  </text>
                </>
              ) : (
                <>
                  <path className="boite" d={`M0 0H${b.w - 12}L${b.w} 12V${H}H0Z`} />
                  <rect className="lisere" x={0} y={0} width={3} height={H} />
                  <g transform="translate(10 7)" className="visage">
                    {membre ? (
                      <foreignObject width={40} height={47}>
                        <Portrait membre={membre} largeur={40} />
                      </foreignObject>
                    ) : (
                      <>
                        <rect width={40} height={46} className="sans-visage" />
                        <text x={20} y={29} textAnchor="middle" className="initiale">
                          {n.titre.slice(0, 1).toUpperCase()}
                        </text>
                      </>
                    )}
                  </g>
                  <text x={60} y={22} className="nom">
                    {couper(n.titre, b.w - 84, 8)}
                  </text>
                  <text x={60} y={39} className="qui">
                    {couper(membre?.nom ?? n.sousTitre, b.w - 84, 6.5)}
                  </text>
                  <text x={60} y={53} className="sous">
                    {couper(n.modele ?? VIDE, b.w - 84, 6)}
                  </text>
                </>
              )}
              {n.genre !== "ctx" && n.genre !== "input" && (
                <g className="numero" transform={`translate(-14 ${H / 2 - 9})`}>
                  <rect width={14} height={18} />
                  <text x={7} y={13} textAnchor="middle">
                    {String(numero).padStart(2, "0")}
                  </text>
                </g>
              )}
              <circle className={`pastille ${n.etat}`} cx={b.w - 18} cy={H - 14} r={4} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Coupe un texte SVG à la largeur disponible, à une chasse moyenne près. */
function couper(texte: string, largeur: number, chasse: number): string {
  const max = Math.max(4, Math.floor(largeur / chasse));
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

function nomNoeud(graphe: GraphePipeline, id: string, membres: Map<string, MembreEquipe>): string {
  const n = graphe.noeuds.find((x) => x.id === id);
  if (!n) return id;
  return (n.membre && membres.get(n.membre)?.nom) || n.titre;
}

function InspecteurLien({ graphe, lien, membres }: { graphe: GraphePipeline; lien: LienPipeline; membres: Map<string, MembreEquipe> }) {
  const source = graphe.noeuds.find((n) => n.id === lien.de);
  const derniere = source?.tentatives[source.tentatives.length - 1];
  return (
    <div className="pl-insp">
      <div className="pl-label">{lien.genre === "ctx" ? "Contexte lu" : lien.genre === "loop" ? "Retour de travail" : "Travail transmis"}</div>
      <div className="pl-flux">
        <span className="pl-puce">{nomNoeud(graphe, lien.de, membres)}</span>
        <span className={`pl-fl ${lien.genre}`} aria-hidden="true">
          {lien.genre === "ctx" ? "⋯▸" : "━▸"}
        </span>
        <span className="sr-only">vers</span>
        <span className="pl-puce">{nomNoeud(graphe, lien.vers, membres)}</span>
      </div>
      <h3>{lien.quoi || VIDE}</h3>
      <dl>
        <dt>Taille</dt>
        <dd>{lien.jetons ? `${jetons(lien.jetons)} jetons` : VIDE}</dd>
        <dt>Transmis</dt>
        <dd>{lien.le ? `il y a ${depuis(lien.le)}` : VIDE}</dd>
        <dt>État</dt>
        <dd>{MOTS[lien.etat]}</dd>
      </dl>
      {derniere && derniere.outils.length > 0 && <pre>{`outils de ${source!.titre} :\n${derniere.outils.join("\n")}`}</pre>}
    </div>
  );
}

function InspecteurNoeud({
  run,
  graphe,
  noeud,
  membres,
  aller,
}: {
  run: RunDetailleAvecOutils;
  graphe: GraphePipeline;
  noeud: NoeudPipeline;
  membres: Map<string, MembreEquipe>;
  aller: (href: string) => void;
}) {
  const { source } = useSource();
  const [confirmer, setConfirmer] = useState<"approved" | "rejected" | null>(null);
  const [envoi, setEnvoi] = useState<"idle" | "envoi" | "fait">("idle");
  const [erreur, setErreur] = useState<string | null>(null);
  const entrees = graphe.liens.filter((l) => l.vers === noeud.id);
  const sorties = graphe.liens.filter((l) => l.de === noeud.id);
  const membre = noeud.membre ? membres.get(noeud.membre) : undefined;
  const cout = noeud.tentatives.reduce((s, t) => s + t.coutEquivalentUsd, 0);
  const jetonsTotal = noeud.tentatives.reduce((s, t) => s + t.tokens.entree + t.tokens.sortie, 0);
  const debut = noeud.tentatives[0]?.debut;
  const fin = noeud.tentatives[noeud.tentatives.length - 1]?.fin;
  const outils = [...new Set(noeud.tentatives.flatMap((t) => t.outils))];
  const decidable = noeud.approbation?.statut === "pending" && run.statut === "waiting_approval";

  async function decider(decision: "approved" | "rejected") {
    if (!noeud.approbation) return;
    setEnvoi("envoi");
    setErreur(null);
    try {
      await source.deciderRun(noeud.approbation.id, { decision });
      setEnvoi("fait");
      setConfirmer(null);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
      setEnvoi("idle");
    }
  }

  const liste = (liens: LienPipeline[], sens: "de" | "vers") =>
    liens.length ? (
      liens.map((l, i) => (
        <li key={i} className={l.genre}>
          <span>{l.quoi || VIDE}</span>
          <small>
            {sens} {nomNoeud(graphe, sens === "de" ? l.de : l.vers, membres)}
          </small>
        </li>
      ))
    ) : (
      <li className="aucun">{VIDE}</li>
    );

  return (
    <div className="pl-insp">
      <div className="pl-label">
        {{ ctx: "Lecture de contexte", gate: "Point de validation", agent: "Étape d'agent", script: "Étape scriptée", input: "Entrée", output: "Sortie" }[noeud.genre]}
      </div>
      <div className="pl-qui">
        {membre && <Portrait membre={membre} largeur={56} />}
        <div>
          <b>{membre?.nom ?? noeud.titre}</b>
          <code>{noeud.modele ?? noeud.sousTitre}</code>
        </div>
      </div>
      <h3>{noeud.titre}</h3>
      <dl>
        <dt>État</dt>
        <dd>{motEtat(noeud)}</dd>
        {noeud.tentatives.length > 0 && (
          <>
            <dt>Durée</dt>
            <dd>{debut ? duree((fin ? Date.parse(fin) : Date.now()) - Date.parse(debut)) : VIDE}</dd>
            <dt>Coût éq.</dt>
            <dd>{usd(cout)}</dd>
            <dt>Jetons</dt>
            <dd>{jetons(jetonsTotal)}</dd>
            <dt>Tours</dt>
            <dd>{noeud.tentatives.length}</dd>
            <dt>Machine</dt>
            <dd>{noeud.tentatives[noeud.tentatives.length - 1]!.machine ?? VIDE}</dd>
          </>
        )}
        {noeud.genre === "output" && run.livraison?.ci && (
          <>
            <dt>CI</dt>
            <dd>{run.livraison.ci}</dd>
          </>
        )}
      </dl>
      {noeud.approbation?.question && <pre>{noeud.approbation.question}</pre>}
      <div className="pl-io">
        <div>
          <span className="pl-label">Reçoit</span>
          <ul>{liste(entrees, "de")}</ul>
        </div>
        <div>
          <span className="pl-label">Transmet</span>
          <ul>{liste(sorties, "vers")}</ul>
        </div>
      </div>
      {outils.length > 0 && <pre>{outils.join("\n")}</pre>}
      {erreur && <Erreur>{erreur}</Erreur>}
      <div className="pl-actions">
        {decidable && envoi !== "fait" && !confirmer && (
          <>
            <button type="button" className="ao-btn primaire" onClick={() => setConfirmer("approved")}>
              Valider
            </button>
            <button type="button" className="ao-btn" onClick={() => setConfirmer("rejected")}>
              Refuser
            </button>
          </>
        )}
        {decidable && confirmer && (
          <>
            <button type="button" className={`ao-btn ${confirmer === "approved" ? "primaire" : ""}`} disabled={envoi === "envoi"} onClick={() => decider(confirmer)}>
              {confirmer === "approved" ? "Confirmer la validation" : "Confirmer le refus"}
            </button>
            <button type="button" className="ao-btn" onClick={() => setConfirmer(null)}>
              Annuler
            </button>
          </>
        )}
        {envoi === "fait" && <span className="pl-ok">Décision envoyée, le run reprend.</span>}
        {noeud.genre === "output" && run.livraison?.prUrl && (
          <a className="ao-btn" href={run.livraison.prUrl} target="_blank" rel="noreferrer">
            <Icone nom="ouvrir" taille={16} />
            Ouvrir la PR
          </a>
        )}
        <button type="button" className="ao-btn" onClick={() => aller(`/runs/${encodeURIComponent(run.id)}`)}>
          Voir le run
        </button>
      </div>
    </div>
  );
}

const MOTS_RATTACHEMENT: Record<Rattachement["statut"], string> = { pending: "en file", taken: "PR en cours d'ouverture", done: "PR ouverte", refused: "refusé" };

/**
 * Ajouter ce pipeline à un autre projet. Le cockpit n'écrit pas la fiche : le publieur ouvre
 * une PR sur `projects/<id>/project.json`, que la CI valide et que l'auto-merge fusionne.
 */
function Rattacher({ id, connu, catalogue, change }: { id: string; connu: PipelineConnu | undefined; catalogue: ReponsePipelines; change: () => void }) {
  const { source } = useSource();
  const [ouvert, setOuvert] = useState(false);
  const [projet, setProjet] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const demandes = catalogue.rattachements.filter((r) => idPipeline(r.pipeline) === id);
  const enAttente = demandes.some((r) => r.statut === "pending" || r.statut === "taken");
  const dejaDemandes = new Set(demandes.filter((r) => r.statut !== "refused" && r.ok !== false).map((r) => r.projet));
  const libres = catalogue.projets.filter((p) => !connu?.projets.includes(p.id) && !dejaDemandes.has(p.id));

  // Le publieur sert la commande en quelques secondes ; la page relit jusqu'à la PR.
  useEffect(() => {
    if (!enAttente) return;
    const minuterie = setTimeout(change, 3000);
    return () => clearTimeout(minuterie);
  }, [enAttente, catalogue, change]);

  async function proposer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await source.rattacherPipeline(id, projet);
      setOuvert(false);
      setProjet("");
      change();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="pl-rattacher">
      {catalogue.peutRattacher && !ouvert && libres.length > 0 && (
        <button type="button" className="ao-btn" onClick={() => setOuvert(true)}>
          Ajouter à un projet
        </button>
      )}
      {ouvert && (
        <form
          className="pl-titre"
          onSubmit={(event) => {
            event.preventDefault();
            if (projet) void proposer();
          }}
        >
          <label className="sr-only" htmlFor="pl-projet">
            Projet
          </label>
          <select id="pl-projet" className="pl-champ" value={projet} onChange={(e) => setProjet(e.target.value)}>
            <option value="">Choisir un projet…</option>
            {libres.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
          <button type="submit" className="ao-btn primaire" disabled={envoi || !projet}>
            Proposer la PR
          </button>
          <button type="button" className="ao-btn" disabled={envoi} onClick={() => setOuvert(false)}>
            Annuler
          </button>
        </form>
      )}
      {ouvert && <p className="pl-sous">La fiche du projet reçoit ce pipeline par une PR ; il apparaît dans Missions après sa fusion et la livraison du cockpit.</p>}
      {erreur && <Erreur>{erreur}</Erreur>}
      {demandes.length > 0 && (
        <ul className="pl-demandes">
          {demandes.map((r) => (
            <li key={r.id} className={r.ok === false ? "refus" : ""}>
              <span>
                {r.pipeline} → {r.projet}
              </span>
              <small>
                {r.ok === false ? `refusé : ${r.raison}` : MOTS_RATTACHEMENT[r.statut]}
                {r.pr && (
                  <>
                    {" · "}
                    <a href={r.pr.url} target="_blank" rel="noreferrer">
                      PR #{r.pr.numero}
                    </a>
                  </>
                )}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Le nom du pipeline du run, ce qu'il est sous le capot, les projets qui s'en servent, et son renommage. */
function EnTete({ refPipeline, connus, catalogue, renomme }: { refPipeline: string; connus: ReadonlyMap<string, PipelineConnu>; catalogue: ReponsePipelines | null; renomme: () => void }) {
  const { source } = useSource();
  const id = idPipeline(refPipeline);
  const connu = connus.get(id);
  const nom = nomPipeline(refPipeline, connus);
  const [edition, setEdition] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer(valeur: string | null) {
    setEnvoi(true);
    setErreur(null);
    try {
      await source.renommerPipeline(id, valeur);
      setEdition(null);
      renomme();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="pl-entete">
      {edition === null ? (
        <div className="pl-titre">
          <h2>{nom}</h2>
          <button type="button" className="ao-btn" onClick={() => setEdition(connu?.perso ? nom : "")}>
            Renommer
          </button>
        </div>
      ) : (
        <form
          className="pl-titre"
          onSubmit={(event) => {
            event.preventDefault();
            if (edition.trim()) void enregistrer(edition);
          }}
        >
          <label className="sr-only" htmlFor="pl-nom">
            Nom du pipeline
          </label>
          <input id="pl-nom" className="pl-champ" value={edition} maxLength={60} placeholder={connu?.titreRegistre ?? nom} onChange={(e) => setEdition(e.target.value)} autoFocus />
          <button type="submit" className="ao-btn primaire" disabled={envoi || !edition.trim()}>
            Enregistrer
          </button>
          {connu?.perso && (
            <button type="button" className="ao-btn" disabled={envoi} onClick={() => void enregistrer(null)} title="Revenir au titre du registre">
              Nom d'origine
            </button>
          )}
          <button type="button" className="ao-btn" disabled={envoi} onClick={() => setEdition(null)}>
            Annuler
          </button>
        </form>
      )}
      <p className="pl-sous">
        <code>
          {id} {versionPipeline(refPipeline)}
        </code>
        {connu && (
          <>
            {" · "}
            {connu.projets.length ? `utilisé par ${connu.projets.join(", ")}` : "aucun projet"}
            {" · "}
            {connu.runs} run{connu.runs > 1 ? "s" : ""}
          </>
        )}
      </p>
      {erreur && <Erreur>{erreur}</Erreur>}
      {catalogue && <Rattacher id={id} connu={connu} catalogue={catalogue} change={renomme} />}
    </div>
  );
}

export function Pipelines({ runId, aller }: { runId: string | null; aller: (href: string) => void }) {
  const { donnees: runs, erreur } = useCharge((s) => s.runs({ limite: 30 }), []);
  const { donnees: equipe } = useCharge((s) => s.equipe(), []);
  const [renommages, setRenommages] = useState(0);
  const relire = useCallback(() => setRenommages((n) => n + 1), []);
  const { donnees: catalogue } = useCharge((s) => s.pipelines(), [renommages]);
  const connus = useMemo(() => new Map((catalogue?.pipelines ?? []).map((p) => [p.id, p])), [catalogue]);
  const tries = useMemo(() => trierRuns(runs ?? []), [runs]);
  const actif = runId ?? tries[0]?.id ?? null;
  const { donnees: run, erreur: erreurRun } = useCharge((s) => (actif ? s.run(actif) : Promise.resolve(null)), [actif]);
  const graphe = useMemo(() => (run ? construireGraphe(run) : null), [run]);
  const membres = useMemo(() => new Map((equipe?.agents ?? []).map((m) => [m.id, m])), [equipe]);
  const [choix, setChoix] = useState<Choix | null>(null);

  // À l'ouverture d'un run, l'inspecteur montre ce qui travaille ou attend.
  useEffect(() => setChoix(null), [actif]);
  const choixEffectif: Choix | null =
    choix ?? (graphe ? { type: "noeud", id: (graphe.noeuds.find((n) => n.etat === "run" || n.etat === "wait" || n.etat === "err") ?? graphe.noeuds[0]!).id } : null);

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!runs) return <p className="text-douce">Chargement des pipelines…</p>;
  if (!tries.length) return <Vide>Aucun run enregistré : lance une mission pour voir son pipeline ici.</Vide>;

  const enCours = tries.filter((r) => r.statut === "running" || r.statut === "queued").length;
  const attente = tries.filter((r) => r.statut.startsWith("waiting")).length;
  const noeudChoisi = choixEffectif?.type === "noeud" ? graphe?.noeuds.find((n) => n.id === choixEffectif.id) : undefined;
  const lienChoisi = choixEffectif?.type === "lien" ? graphe?.liens[choixEffectif.index] : undefined;
  const travail = graphe?.noeuds.filter((n) => n.genre === "agent" || n.genre === "script" || n.genre === "gate") ?? [];
  const finies = travail.filter((n) => n.etat === "done").length;
  const transmis = run?.etapes.reduce((s, e) => s + e.tokens.sortie, 0) ?? 0;
  const dureeRun = run?.debut ? duree((run.fin ? Date.parse(run.fin) : Date.now()) - Date.parse(run.debut)) : VIDE;

  return (
    <div className="pl-ecran">
      <p className="pl-resume">
        {tries.length} runs · {enCours} en cours · {attente} en attente
      </p>
      <nav className="pl-liste" aria-label="Runs">
        {tries.map((r) => (
          <a
            key={r.id}
            href={`/pipelines/${encodeURIComponent(r.id)}`}
            aria-current={r.id === actif ? "page" : undefined}
            className={r.id === actif ? "on" : ""}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              aller(`/pipelines/${encodeURIComponent(r.id)}`);
            }}
          >
            <Etat etat={r.statut} />
            <b>{nomPipeline(r.pipeline, connus)}</b>
            <small>
              {r.projet ?? "sans projet"} · {r.debut ? `il y a ${depuis(r.debut)}` : "pas démarré"}
            </small>
            <small className="pl-ref">
              {idPipeline(r.pipeline)} {versionPipeline(r.pipeline)}
            </small>
          </a>
        ))}
      </nav>

      <section className="pl-centre" aria-label="Graphe du run">
        {erreurRun && <Erreur>{erreurRun}</Erreur>}
        {run && graphe ? (
          <>
            <EnTete refPipeline={run.pipeline} connus={connus} catalogue={catalogue} renomme={relire} />
            <div className="ao-kpis pl-stats" role="group" aria-label="Indicateurs du run">
              <div className="ao-kpi">
                <span className="k">Étape</span>
                <span className="v">
                  {finies}/{travail.length}
                </span>
              </div>
              <div className="ao-kpi">
                <span className="k">Coût éq.</span>
                <span className="v">{usd(run.coutEquivalentUsd)}</span>
              </div>
              <div className="ao-kpi">
                <span className="k">Durée</span>
                <span className="v">{dureeRun}</span>
              </div>
              <div className="ao-kpi">
                <span className="k">Transmis</span>
                <span className="v">{jetons(transmis)} tok</span>
              </div>
            </div>
            <div className="pl-defile">
              <Graphe graphe={graphe} membres={membres} choix={choixEffectif} choisir={setChoix} />
            </div>
            <div className="pl-barre">
              <span className="pl-leg work">Travail</span>
              <span className="pl-leg ctx">Contexte</span>
              <span className="pl-leg loop">Retour</span>
              <span className="pl-leg wait">Ta décision</span>
              <button
                type="button"
                className="ao-bouton-icone pl-json"
                aria-pressed={choixEffectif?.type === "json"}
                aria-label="Voir le JSON du pipeline"
                title="Voir le JSON du pipeline"
                onClick={() => setChoix({ type: "json" })}
              >
                {"{ }"}
              </button>
            </div>
          </>
        ) : (
          !erreurRun && <p className="text-douce">Chargement du run…</p>
        )}
      </section>

      <aside className="pl-inspecteur" aria-label="Inspecteur" aria-live="polite">
        {run && graphe && choixEffectif?.type === "json" && (
          <div className="pl-insp">
            <div className="pl-label">Pipeline · JSON</div>
            <pre className="json">{grapheJson(run, graphe)}</pre>
          </div>
        )}
        {run && graphe && noeudChoisi && <InspecteurNoeud key={`${run.id}:${noeudChoisi.id}`} run={run} graphe={graphe} noeud={noeudChoisi} membres={membres} aller={aller} />}
        {graphe && lienChoisi && <InspecteurLien graphe={graphe} lien={lienChoisi} membres={membres} />}
      </aside>
    </div>
  );
}
