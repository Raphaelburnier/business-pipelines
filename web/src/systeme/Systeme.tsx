// La carte du système agentique : ce qui tourne où, comment une décision devient un run, et
// comment un run réussi arrive en production. Tout vient de carte.ts. Le graphe garde les
// briques à une taille de lecture et isole une famille de liaisons à la fois.
import "./systeme.css";
import { useEffect, useRef, useState } from "react";
import {
  BRIQUES,
  ETAPES,
  FAMILLES,
  GARDE_FOUS,
  JALONS,
  LIENS,
  OUVERTS,
  TRANSITIONS,
  type Brique,
  type Etape,
  type Famille,
  type Lien,
  type Statut,
  type ZoneCarte,
} from "./carte";
import { GrapheArchitecture } from "./GrapheArchitecture";

type Onglet = "architecture" | "boucle" | "garde-fous" | "chronologie";

const ONGLETS: Array<{ id: Onglet; nom: string }> = [
  { id: "architecture", nom: "Architecture" },
  { id: "boucle", nom: "Boucle d'un run" },
  { id: "garde-fous", nom: "Garde-fous" },
  { id: "chronologie", nom: "Chronologie" },
];

const MOT_STATUT: Record<Statut, string> = { actif: "en service", partiel: "partiel", arrete: "arrêté" };
const NOM_ZONE: Record<ZoneCarte["id"], string> = { interfaces: "Interfaces", nas: "NAS", pc: "PC", cloud: "Cloud" };
const MOT_GENRE_BRIQUE: Record<Brique["genre"], string> = {
  humain: "humain",
  service: "service",
  donnee: "donnée",
  moteur: "moteur",
  externe: "externe",
  app: "application",
};

const PAR_ID = new Map(BRIQUES.map((b) => [b.id, b]));
const FAMILLES_LISTE = Object.keys(FAMILLES) as Famille[];

// Sur un téléphone, la fiche vit sous le graphe : on l'amène sous les yeux au clic.
function useAmener(cle: string | null) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!cle || !ref.current) return;
    if (window.matchMedia("(max-width: 720px)").matches) ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [cle]);
  return ref;
}

// ---------- Architecture ----------

function Fiche({ id, onSelection, refFiche }: { id: string | null; onSelection: (id: string | null) => void; refFiche: React.RefObject<HTMLElement | null> }) {
  const b = id ? PAR_ID.get(id) : undefined;
  if (!b) {
    return (
      <aside className="sy-fiche vide" ref={refFiche}>
        <span className="kicker">Fiche</span>
        <p>Choisis un flux pour le suivre pas à pas, ou une brique pour lire son rôle, ses règles et ses liens.</p>
        <p className="text-douce">Lecture conseillée : Commande, de Raphaël jusqu'aux agents, puis Livraison, du run réussi jusqu'à la production.</p>
      </aside>
    );
  }
  const sortants = LIENS.filter((l) => l.de === b.id);
  const entrants = LIENS.filter((l) => l.vers === b.id);
  const ligne = (l: Lien, sens: "entrant" | "sortant") => {
    const autre = PAR_ID.get(sens === "entrant" ? l.de : l.vers);
    return (
      <li key={`${sens}-${l.de}-${l.vers}`}>
        <button type="button" className={`sy-puce ${l.famille}`} onClick={() => onSelection(autre?.id ?? null)}>
          <span className="sens">{sens === "entrant" ? "reçoit de" : "va vers"}</span>
          <strong>{autre?.titre}</strong>
          {l.libelle && <em>{l.libelle}</em>}
          {l.bloque && <em className="bloque">bloqué</em>}
        </button>
      </li>
    );
  };
  return (
    <aside className="sy-fiche" aria-live="polite" ref={refFiche}>
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">
          {NOM_ZONE[b.zone]} · {MOT_GENRE_BRIQUE[b.genre]}
        </span>
        <button type="button" className="ao-bouton-icone" onClick={() => onSelection(null)} aria-label="Fermer la fiche" title="Fermer la fiche">
          ×
        </button>
      </div>
      <h3>{b.titre}</h3>
      <div className="meta">
        <span className={`statut ${b.statut}`}>{MOT_STATUT[b.statut]}</span>
        <span>{b.sous}</span>
        {b.depuis && <span>depuis le {b.depuis}</span>}
        {b.depot && <span>dépôt {b.depot}</span>}
      </div>
      <p>{b.resume}</p>
      <ul className="faits">
        {b.faits.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {(entrants.length > 0 || sortants.length > 0) && (
        <ul className="liens">
          {entrants.map((l) => ligne(l, "entrant"))}
          {sortants.map((l) => ligne(l, "sortant"))}
        </ul>
      )}
    </aside>
  );
}

// Un flux, déroulé dans l'ordre où carte.ts le déclare : de qui, par quoi, vers qui.
function Parcours({ famille, selection, onSelection }: { famille: Famille; selection: string | null; onSelection: (id: string) => void }) {
  const liens = LIENS.filter((l) => l.famille === famille);
  return (
    <section className={`sy-parcours ${famille}`} aria-label={`Flux ${FAMILLES[famille].nom}`}>
      <header>
        <h3>{FAMILLES[famille].nom}</h3>
        <p>{FAMILLES[famille].detail}</p>
      </header>
      <ol>
        {liens.map((l, i) => {
          const de = PAR_ID.get(l.de);
          const vers = PAR_ID.get(l.vers);
          return (
            <li key={`${l.de}-${l.vers}`} className={l.bloque ? "bloque" : ""}>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <button type="button" aria-pressed={selection === l.de} onClick={() => onSelection(l.de)}>
                {de?.titre}
              </button>
              <span className="fleche">
                <i aria-hidden="true" />
                {l.libelle ?? "vers"}
                {l.bloque && " · bloqué"}
              </span>
              <button type="button" aria-pressed={selection === l.vers} onClick={() => onSelection(l.vers)}>
                {vers?.titre}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Architecture() {
  const [flux, setFlux] = useState<Famille | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const refFiche = useAmener(selection);

  return (
    <div className="sy-archi">
      <div className="sy-filtres" role="group" aria-label="Flux à suivre">
        <span className="kicker">Flux</span>
        <button type="button" className="sy-filtre tout" aria-pressed={flux === null} onClick={() => setFlux(null)}>
          Vue d'ensemble <small>{LIENS.length}</small>
        </button>
        {FAMILLES_LISTE.map((f) => (
          <button key={f} type="button" className={`sy-filtre ${f}`} aria-pressed={flux === f} onClick={() => setFlux(flux === f ? null : f)} title={FAMILLES[f].detail}>
            <i aria-hidden="true" />
            {FAMILLES[f].nom}
            <small>{LIENS.filter((l) => l.famille === f).length}</small>
          </button>
        ))}
      </div>
      <div className="sy-archi-corps">
        <div className="sy-graphe-resume" aria-live="polite">
          <span>
            {flux
              ? `${FAMILLES[flux].nom} · ${LIENS.filter((l) => l.famille === flux).length} liaisons isolées`
              : `${BRIQUES.length} briques · ${LIENS.length} liaisons colorées`}
          </span>
          <small>Glisser pour explorer · molette ou pincement pour zoomer · cliquer une brique pour isoler ses voisins</small>
        </div>
        <div className="sy-canevas">
          <GrapheArchitecture flux={flux} selection={selection} onSelection={setSelection} />
        </div>
        <div className={`sy-lecture-graphe ${flux ? "avec-parcours" : ""}`}>
          <Fiche id={selection} onSelection={setSelection} refFiche={refFiche} />
          {flux ? (
            <details className="sy-parcours-details">
              <summary>Lire le trajet {FAMILLES[flux].nom.toLowerCase()} étape par étape</summary>
              <Parcours famille={flux} selection={selection} onSelection={setSelection} />
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Boucle d'un run ----------

const ETAPE_PAR_ID = new Map(ETAPES.map((e) => [e.id, e]));

// Le chemin principal d'un run qui réussit ; le reste (quota, budget, échec, correction) se
// lit comme des embranchements, accrochés à l'étape d'où ils partent.
const PRINCIPAL = ["b-decision", "b-commande", "b-runner", "b-deps", "b-plan", "b-impl", "b-verify", "b-verdict", "b-livraison", "b-pr", "b-ci", "b-retour"];

const MOT_GENRE: Record<Etape["genre"], string> = {
  humain: "décision humaine",
  deterministe: "code déterministe, zéro token",
  agent: "agent, tours comptés",
  script: "script du pipeline",
  externe: "système externe",
};

function Boucle() {
  return (
    <div className="sy-boucle">
      <p className="sy-intro">
        Le trajet réel d'un run <b>improve-app@4</b> sur Steam TierList, de la décision jusqu'au retour de <code>main</code> sur le NAS. Budget : 3 $ par run,
        80 tours au total, 35 par agent. Le seul cycle, <code>correction</code>, couvre implement, verify et verdict avec <code>maxLoops: 1</code>.
      </p>
      <div className="sy-genres" aria-label="Nature des étapes">
        {(Object.keys(MOT_GENRE) as Etape["genre"][]).map((g) => (
          <span key={g} className={`sy-etape-mini ${g}`}>
            {MOT_GENRE[g]}
          </span>
        ))}
      </div>
      <ol className="sy-etapes">
        {PRINCIPAL.map((id, i) => {
          const e = ETAPE_PAR_ID.get(id);
          if (!e) return null;
          const precedente = PRINCIPAL[i - 1];
          const suivante = PRINCIPAL[i + 1];
          const entree = TRANSITIONS.find((t) => t.de === precedente && t.vers === id);
          const branches = TRANSITIONS.filter((t) => t.de === id && t.vers !== suivante);
          return (
            <li key={id} className={`sy-etape ${e.genre}`}>
              {entree?.libelle && <span className={`sy-passage ${entree.issue ?? "suite"}`}>{entree.libelle}</span>}
              <div className="tete">
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <span className="genre">{MOT_GENRE[e.genre]}</span>
              </div>
              <h3>{e.titre}</h3>
              <span className="sous">{e.sous}</span>
              <p>{e.detail}</p>
              {branches.map((t) => {
                const cible = ETAPE_PAR_ID.get(t.vers);
                if (!cible) return null;
                return (
                  <div key={`${t.de}-${t.vers}`} className={`sy-branche ${t.issue ?? "suite"}`}>
                    <strong>
                      {t.libelle ?? "ensuite"} → {cible.titre}
                    </strong>
                    <span className="sous">{cible.sous}</span>
                    <p>{cible.detail}</p>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Garde-fous, chronologie, points ouverts ----------

function GardeFous() {
  return (
    <div className="sy-grille">
      {GARDE_FOUS.map((g, i) => (
        <article key={g.titre} className="sy-regle">
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <h3>{g.titre}</h3>
          <p>{g.texte}</p>
          <span className="origine">{g.origine}</span>
        </article>
      ))}
    </div>
  );
}

const NOM_PROJET: Record<(typeof JALONS)[number]["projet"], string> = {
  saas: "Saas-generator",
  moteur: "agent-orchestrator",
  cockpit: "business-pipelines",
  registre: "agent-registry",
  modeles: "OmniRoute",
  runs: "runs",
};

function Chronologie() {
  return (
    <div className="sy-chrono-corps">
      <ol className="sy-chrono">
        {JALONS.map((j) => (
          <li key={`${j.date}-${j.titre}`} className={j.projet}>
            <time dateTime={j.date}>{j.date}</time>
            <div>
              <span className="projet">{NOM_PROJET[j.projet]}</span>
              <h3>{j.titre}</h3>
              <p>{j.texte}</p>
            </div>
          </li>
        ))}
      </ol>
      <aside className="sy-fiche sy-ouverts">
        <span className="kicker">Encore ouvert</span>
        <ul className="faits">
          {OUVERTS.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ---------- Page ----------

// Le registre relevé le 2026-09-30 (agent-registry d4cd157) : 23 agents en 25 versions, 5
// versions de pipeline. Les chiffres d'avant (26 et 6) ne correspondaient à aucun dépôt.
const CHIFFRES: Array<{ valeur: string; libelle: string }> = [
  { valeur: String(BRIQUES.filter((b) => b.genre === "service").length), libelle: "services" },
  { valeur: "23", libelle: "agents · 25 versions" },
  { valeur: "5", libelle: "versions de pipeline" },
  { valeur: String(GARDE_FOUS.length), libelle: "garde-fous" },
  { valeur: String(JALONS.length), libelle: "jalons depuis juillet" },
];

export function Systeme() {
  const [onglet, setOnglet] = useState<Onglet>("architecture");
  return (
    <section className="sy-page">
      <header className="sy-hero">
        <div>
          <span className="kicker">SYS//MAP · relevé du 2026-09-30</span>
          <h2>Les boucles agentiques, de bout en bout</h2>
          <p>
            Trois dépôts système (cockpit, moteur, registre), deux machines et un humain. Le NAS décide et stocke, le PC calcule, les agents travaillent
            dans des pipelines à gates de code, et un run réussi rejoint la production sans clé exposée.
          </p>
        </div>
        <dl className="sy-chiffres">
          {CHIFFRES.map((c) => (
            <div key={c.libelle}>
              <dt>{c.libelle}</dt>
              <dd>{c.valeur}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="sy-onglets" role="tablist" aria-label="Vues de la carte">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}>
            {o.nom}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {onglet === "architecture" && <Architecture />}
        {onglet === "boucle" && <Boucle />}
        {onglet === "garde-fous" && <GardeFous />}
        {onglet === "chronologie" && <Chronologie />}
      </div>
    </section>
  );
}
