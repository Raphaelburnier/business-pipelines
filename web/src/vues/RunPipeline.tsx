// La page Run. /run liste les runs (ListeRuns) ; /run/:id montre un run : son en-tête, son
// graphe au centre, et un panneau à deux onglets. « Étape » détaille ce qui est choisi dans
// le graphe (une étape, un lien, ou le JSON avec « { } ») ; « Run » raconte le run entier
// (mission, attentes, livraison, revues, exécution).
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ActionConfirmee } from "../composants/ActionConfirmee";
import { Bouton } from "../composants/Bouton";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { Onglets } from "../composants/Onglets";
import { useToasts } from "../composants/Toasts";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import type { MembreEquipe } from "../donnees/equipe";
import { lireErreur } from "../donnees/erreurs";
import { construireGraphe, grapheJson, type EtatNoeud, type GraphePipeline, type LienPipeline, type NoeudPipeline } from "../donnees/pipelineGraphe";
import { idPipeline, nomPipeline, versionPipeline, type PipelineConnu, type Rattachement, type ReponsePipelines } from "../donnees/pipelines";
import { VIDE, depuis, duree, jetons, usd } from "../format";
import { Icone } from "../icones";
import type { RunDetailleAvecOutils } from "../types";
import { Erreur, Etat } from "../ui";
import { ControleRun } from "./ControleExecution";
import { ListeRuns } from "./ListeRuns";
import { CorpsRun } from "./Panneau";
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
          <rect x={CTX.x - 8} y={4} width={CTX.w + 16} height={hauteur - 12} rx={10} className="pl-couloir" />
          <text x={CTX.x} y={hauteur - 14} className="pl-couloir-titre">
            Contexte
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
                <rect className={`pl-paquet ${l.genre}`} width={7} height={7} x={-3.5} y={-3.5} rx={3.5}>
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
              <rect width={texte.length * 6 + 12} height={18} rx={4} />
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
                  <rect className="boite" width={b.w} height={H} rx={8} />
                  <text x={16} y={18} className="genre">
                    {{ input: "Entrée", output: "Sortie", script: "Script", ctx: "Lecture" }[n.genre]}
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
                  <rect className="boite" width={b.w} height={H} rx={8} />
                  <rect className="lisere" x={0} y={10} width={3} height={H - 20} rx={1.5} />
                  <g transform="translate(10 7)" className="visage">
                    {membre ? (
                      <foreignObject width={40} height={47}>
                        <Portrait membre={membre} largeur={40} />
                      </foreignObject>
                    ) : (
                      <>
                        <rect width={40} height={46} rx={6} className="sans-visage" />
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
                <g className="numero" transform={`translate(-16 ${H / 2 - 9})`}>
                  <rect width={14} height={18} rx={3} />
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

function InspecteurNoeud({ run, graphe, noeud, membres }: { run: RunDetailleAvecOutils; graphe: GraphePipeline; noeud: NoeudPipeline; membres: Map<string, MembreEquipe> }) {
  const { source } = useSource();
  const toasts = useToasts();
  const [envoye, setEnvoye] = useState(false);
  const entrees = graphe.liens.filter((l) => l.vers === noeud.id);
  const sorties = graphe.liens.filter((l) => l.de === noeud.id);
  const membre = noeud.membre ? membres.get(noeud.membre) : undefined;
  const cout = noeud.tentatives.reduce((s, t) => s + t.coutEquivalentUsd, 0);
  const jetonsTotal = noeud.tentatives.reduce((s, t) => s + t.tokens.entree + t.tokens.sortie, 0);
  const debut = noeud.tentatives[0]?.debut;
  const fin = noeud.tentatives[noeud.tentatives.length - 1]?.fin;
  const outils = [...new Set(noeud.tentatives.flatMap((t) => t.outils))];
  // Un changement de fournisseur entre deux tentatives : le remplaçant a pris l'étape.
  const fournisseurs = [...new Set(noeud.tentatives.map((t) => t.llm && `${t.llm.via}:${t.llm.model}`).filter((x): x is string => Boolean(x)))];
  // Une escalade (moteur src/escalade.js) change aussi de modèle : elle n'est pas un relais.
  const escalade = run.escalades?.filter((e) => e.noeud === noeud.id).at(-1);
  const relais = !escalade && new Set(noeud.tentatives.map((t) => t.llm?.via).filter(Boolean)).size > 1 ? fournisseurs.join(" → ") : null;
  const decidable = noeud.approbation?.statut === "pending" && run.statut === "waiting_approval";

  // Une erreur d'envoi remonte à la question, qui reste ouverte et l'affiche.
  async function decider(decision: "approved" | "rejected") {
    if (!noeud.approbation) return;
    await source.deciderRun(noeud.approbation.id, { decision });
    setEnvoye(true);
    if (decision === "approved") toasts.succes(`« ${noeud.titre} » validée : le run reprend.`);
    else toasts.succes(`Refus de « ${noeud.titre} » envoyé au moteur.`);
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
            {relais && (
              <>
                <dt>Relais</dt>
                <dd>{relais}</dd>
              </>
            )}
            {escalade && (
              <>
                <dt>Escalade</dt>
                <dd>
                  {escalade.de.model} → {escalade.vers.model} · {escalade.raison} ·{" "}
                  {{ "en-cours": "en cours", reussie: "réussie", echouee: "échouée" }[escalade.issue]}
                </dd>
              </>
            )}
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
      {decidable && !envoye && (
        <div className="pl-actions">
          <ActionConfirmee
            libelle="Valider l'étape"
            question={`Valider « ${noeud.titre} » ?`}
            details="Le run reprend à l'étape suivante."
            confirmer="Confirmer la validation"
            onConfirmer={() => decider("approved")}
          />
          <ActionConfirmee
            libelle="Refuser"
            declencheur="secondaire"
            variante="danger"
            question={`Refuser « ${noeud.titre} » ?`}
            details="Le moteur reçoit ton refus et applique la règle de ce point de validation."
            confirmer="Confirmer le refus"
            onConfirmer={() => decider("rejected")}
          />
        </div>
      )}
      {envoye && (
        <p className="pl-ok" role="status">
          <Icone nom="ok" taille={15} />
          Décision envoyée.
        </p>
      )}
      {noeud.genre === "output" && run.livraison?.prUrl && (
        <div className="pl-actions">
          <a className="ao-btn" href={run.livraison.prUrl} target="_blank" rel="noreferrer">
            <Icone nom="ouvrir" taille={16} />
            Ouvrir la PR
          </a>
        </div>
      )}
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

/** L'en-tête du run : son état, le nom de son pipeline (renommable), d'où il vient, et son arrêt. */
function EnTete({ run, connus, catalogue, renomme }: { run: RunDetailleAvecOutils; connus: ReadonlyMap<string, PipelineConnu>; catalogue: ReponsePipelines | null; renomme: () => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const maintenant = useHorloge(30_000);
  const id = idPipeline(run.pipeline);
  const connu = connus.get(id);
  const nom = nomPipeline(run.pipeline, connus);
  const [edition, setEdition] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer(valeur: string | null) {
    setErreur(null);
    try {
      await source.renommerPipeline(id, valeur);
      setEdition(null);
      renomme();
      toasts.succes(valeur ? `Pipeline renommé « ${valeur.trim()} ».` : "Le pipeline reprend le titre du registre.");
    } catch (err) {
      setErreur(lireErreur(err).message);
    }
  }

  return (
    <section className="pl-entete" aria-label="Run">
      <div className="pl-entete-haut">
        {edition === null ? (
          <div className="pl-titre">
            <Etat etat={run.statut} />
            <h2>{nom}</h2>
            <Bouton taille="petit" variante="fantome" onClick={() => setEdition(connu?.perso ? nom : "")}>
              Renommer
            </Bouton>
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
            <input id="pl-nom" className="ao-champ pl-champ" value={edition} maxLength={60} placeholder={connu?.titreRegistre ?? nom} onChange={(e) => setEdition(e.target.value)} autoFocus />
            <Bouton variante="primaire" disabled={!edition.trim()} onClick={() => (edition.trim() ? enregistrer(edition) : undefined)} libelleEnCours="Enregistrement…">
              Enregistrer
            </Bouton>
            {connu?.perso && (
              <Bouton onClick={() => enregistrer(null)} title="Revenir au titre du registre">
                Nom d'origine
              </Bouton>
            )}
            <Bouton variante="fantome" onClick={() => setEdition(null)}>
              Annuler
            </Bouton>
          </form>
        )}
        <ControleRun key={run.id} run={run} />
      </div>
      <p className="pl-sous">
        <span>{run.projet ?? "sans projet"}</span>
        <span>{run.debut ? <span title={new Date(run.debut).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })}>démarré il y a {depuis(run.debut, maintenant)}</span> : "pas encore démarré"}</span>
        {run.declencheur && <span>par {run.declencheur}</span>}
        <code>
          {id} {versionPipeline(run.pipeline)}
        </code>
        {connu && <span>{connu.projets.length ? `utilisé par ${connu.projets.join(", ")}` : "aucun projet"} · {connu.runs} run{connu.runs > 1 ? "s" : ""}</span>}
        <code title="Identifiant du run">{run.id}</code>
      </p>
      {erreur && <Erreur>{erreur}</Erreur>}
      {catalogue && <Rattacher id={id} connu={connu} catalogue={catalogue} change={renomme} />}
    </section>
  );
}

type OngletPanneau = "selection" | "run";

/** /run : la liste ; /run/:id : le run, son graphe et son panneau de détail. */
export function RunPipeline({ runId, aller }: { runId: string | null; aller: (href: string) => void }) {
  return runId ? <DetailRun key={runId} runId={runId} aller={aller} /> : <ListeRuns aller={aller} />;
}

function DetailRun({ runId, aller }: { runId: string; aller: (href: string) => void }) {
  // L'API répond null pour un run inconnu : l'envelopper distingue « introuvable » de « pas encore lu ».
  const { donnees: lu, erreur, detail, recharger } = useCharge((s) => s.run(runId).then((run) => ({ run })), [runId]);
  const { donnees: equipe } = useCharge((s) => s.equipe(), []);
  const [renommages, setRenommages] = useState(0);
  const relire = useCallback(() => setRenommages((n) => n + 1), []);
  const { donnees: catalogue } = useCharge((s) => s.pipelines(), [renommages]);
  const connus = useMemo(() => new Map((catalogue?.pipelines ?? []).map((p) => [p.id, p])), [catalogue]);
  const run = lu?.run ?? null;
  const graphe = useMemo(() => (run ? construireGraphe(run) : null), [run]);
  const membres = useMemo(() => new Map((equipe?.agents ?? []).map((m) => [m.id, m])), [equipe]);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [onglet, setOnglet] = useState<OngletPanneau>("selection");
  const maintenant = useHorloge(5_000);

  if (erreur && !lu) return <EtatErreur titre="Lecture du run impossible" message={erreur} detail={detail} onReessayer={recharger} />;
  if (!lu) return <Squelette lignes={8} libelle="Chargement du run…" className="rounded-xl border border-trait bg-surface p-4" />;
  if (!run || !graphe)
    return (
      <EtatVide
        icone="run"
        message="Run introuvable"
        detail={
          <>
            Aucun run ne porte l'identifiant <code className="font-mono">{runId}</code>. Il a pu être purgé, ou l'adresse est incomplète.
          </>
        }
        action={
          <Bouton variante="primaire" onClick={() => aller("/run")}>
            Voir tous les runs
          </Bouton>
        }
      />
    );

  // À l'ouverture, le panneau montre ce qui travaille, attend ou a échoué.
  const choixEffectif: Choix = choix ?? { type: "noeud", id: (graphe.noeuds.find((n) => n.etat === "run" || n.etat === "wait" || n.etat === "err") ?? graphe.noeuds[0]!).id };
  const choisir = (c: Choix) => {
    setChoix(c);
    setOnglet("selection");
  };
  const noeudChoisi = choixEffectif.type === "noeud" ? graphe.noeuds.find((n) => n.id === choixEffectif.id) : undefined;
  const lienChoisi = choixEffectif.type === "lien" ? graphe.liens[choixEffectif.index] : undefined;
  const travail = graphe.noeuds.filter((n) => n.genre === "agent" || n.genre === "script" || n.genre === "gate");
  const finies = travail.filter((n) => n.etat === "done").length;
  const transmis = run.etapes.reduce((s, e) => s + e.tokens.sortie, 0);
  const dureeRun = run.debut ? duree((run.fin ? Date.parse(run.fin) : maintenant) - Date.parse(run.debut)) : VIDE;
  const libelleSelection = choixEffectif.type === "lien" ? "Lien" : choixEffectif.type === "json" ? "JSON" : "Étape";

  return (
    <div className="pl-run">
      <EnTete run={run} connus={connus} catalogue={catalogue} renomme={relire} />
      {erreur && (
        <div className="pl-run-plein">
          <Erreur onReessayer={recharger}>Relecture du run impossible : {erreur}. Le run affiché date de la dernière lecture réussie.</Erreur>
        </div>
      )}

      <section className="pl-centre" aria-label="Graphe du run">
        <div className="ao-kpis pl-stats" role="group" aria-label="Indicateurs du run">
          <div className="ao-kpi">
            <span className="k">Étapes</span>
            <span className="v">
              {finies}/{travail.length}
            </span>
          </div>
          <div className="ao-kpi" title="Sur abonnement, un équivalent API, pas une dépense">
            <span className="k">Coût éq.</span>
            <span className="v">{usd(run.coutEquivalentUsd)}</span>
          </div>
          <div className="ao-kpi">
            <span className="k">Durée</span>
            <span className="v">{dureeRun}</span>
          </div>
          <div className="ao-kpi">
            <span className="k">Transmis</span>
            <span className="v">{jetons(transmis)} jetons</span>
          </div>
        </div>
        <div className="pl-defile">
          <Graphe graphe={graphe} membres={membres} choix={choixEffectif} choisir={choisir} />
        </div>
        <div className="pl-barre">
          <span className="pl-leg work">Travail</span>
          <span className="pl-leg ctx">Contexte</span>
          <span className="pl-leg loop">Retour</span>
          <span className="pl-leg wait">Ta décision</span>
          <button type="button" className="ao-bouton-icone pl-json" aria-pressed={choixEffectif.type === "json"} aria-label="Voir le JSON du pipeline" title="Voir le JSON du pipeline" onClick={() => choisir({ type: "json" })}>
            {"{ }"}
          </button>
        </div>
      </section>

      <aside className="pl-panneau" aria-label="Détail du run">
        <div className="pl-panneau-onglets">
          <Onglets<OngletPanneau>
            libelle="Détail du run"
            actif={onglet}
            onChoisir={setOnglet}
            onglets={[
              { cle: "selection", libelle: libelleSelection },
              { cle: "run", libelle: "Run" },
            ]}
          />
        </div>
        <div className="pl-panneau-corps" aria-live="polite">
          {onglet === "run" ? (
            <div className="flex flex-col gap-3 p-4">
              <CorpsRun run={run} />
            </div>
          ) : (
            <>
              {choixEffectif.type === "json" && (
                <div className="pl-insp">
                  <div className="pl-label">Pipeline en JSON</div>
                  <pre className="json">{grapheJson(run, graphe)}</pre>
                </div>
              )}
              {noeudChoisi && <InspecteurNoeud key={`${run.id}:${noeudChoisi.id}`} run={run} graphe={graphe} noeud={noeudChoisi} membres={membres} />}
              {lienChoisi && <InspecteurLien graphe={graphe} lien={lienChoisi} membres={membres} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
