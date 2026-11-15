// La navigation principale, décrite une fois : la barre latérale (PC, tablette), les onglets
// du bas et le menu « Plus » (téléphone) lisent la même liste. Une seule entrée est active.
import { useId, type MouseEvent } from "react";
import { Tiroir } from "../composants/Tiroir";
import { Icone, type NomIcone } from "../icones";
import { lienDemander } from "../navigation";
import type { CleNav } from "../routes";

interface Entree {
  cle: CleNav;
  libelle: string;
  icone: NomIcone;
  /** Une fonction quand l'adresse dépend de l'usage (la dernière conversation de Demander). */
  href: string | (() => string);
}

const E: Record<CleNav, Entree> = {
  accueil: { cle: "accueil", libelle: "Vue d'ensemble", icone: "accueil", href: "/" },
  decisions: { cle: "decisions", libelle: "Décisions", icone: "decision", href: "/decisions" },
  runs: { cle: "runs", libelle: "Runs", icone: "run", href: "/run" },
  planning: { cle: "planning", libelle: "Planning", icone: "calendrier", href: "/taskboard" },
  missions: { cle: "missions", libelle: "Missions", icone: "mission", href: "/missions" },
  pipelines: { cle: "pipelines", libelle: "Pipelines", icone: "pipeline", href: "/pipelines" },
  agents: { cle: "agents", libelle: "Agents", icone: "agent", href: "/agents" },
  finance: { cle: "finance", libelle: "Finance", icone: "finance", href: "/finance" },
  marketing: { cle: "marketing", libelle: "Marketing", icone: "marketing", href: "/marketing" },
  "ai-studio": { cle: "ai-studio", libelle: "AI Studio", icone: "studio", href: "/ai-studio" },
  demander: { cle: "demander", libelle: "Demander", icone: "demander", href: lienDemander },
  systeme: { cle: "systeme", libelle: "Système", icone: "systeme", href: "/systeme" },
};

const GROUPES: ReadonlyArray<{ titre: string | null; entrees: ReadonlyArray<Entree> }> = [
  { titre: null, entrees: [E.accueil, E.decisions] },
  { titre: "Pilotage", entrees: [E.runs, E.planning, E.missions] },
  { titre: "Configuration", entrees: [E.pipelines, E.agents] },
  { titre: "Métiers", entrees: [E.finance, E.marketing, E["ai-studio"]] },
];
const PIED: ReadonlyArray<Entree> = [E.demander, E.systeme];
/** Sur téléphone, les quatre destinations du quotidien ; le reste passe par « Plus ». */
const ONGLETS_BAS: ReadonlyArray<{ entree: Entree; libelle: string }> = [
  { entree: E.accueil, libelle: "Accueil" },
  { entree: E.decisions, libelle: "Décisions" },
  { entree: E.runs, libelle: "Runs" },
  { entree: E.planning, libelle: "Planning" },
];

const adresse = (entree: Entree): string => (typeof entree.href === "function" ? entree.href() : entree.href);

/** Le clic simple reste dans l'application ; Ctrl, Maj ou le clic molette ouvrent un onglet. */
export function suivreLien(aller: (href: string) => void, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    aller(href);
  };
}

interface PropsNav {
  active: CleNav | null;
  aller: (href: string) => void;
  /** Ce qui attend ta décision : le badge ambre de « Décisions ». */
  decisions: number;
}

function Lien({ entree, active, aller, decisions, libelle }: PropsNav & { entree: Entree; libelle?: string }) {
  const href = adresse(entree);
  const texte = libelle ?? entree.libelle;
  const compte = entree.cle === "decisions" && decisions > 0 ? decisions : null;
  return (
    <a href={href} onClick={suivreLien(aller, href)} aria-current={active === entree.cle ? "page" : undefined} title={texte} className="ao-lien">
      <Icone nom={entree.icone} />
      <span className="ao-txt">{texte}</span>
      {compte !== null && (
        <span className="ao-compte" aria-label={`${compte} en attente`}>
          {compte}
        </span>
      )}
    </a>
  );
}

function Groupes(props: PropsNav) {
  const base = useId();
  return (
    <>
      {GROUPES.map((groupe, i) => (
        <div key={groupe.titre ?? "tete"} className="ao-groupe">
          {groupe.titre && (
            <p id={`${base}-${i}`} className="ao-groupe-titre">
              {groupe.titre}
            </p>
          )}
          <ul aria-labelledby={groupe.titre ? `${base}-${i}` : undefined}>
            {groupe.entrees.map((entree) => (
              <li key={entree.cle}>
                <Lien {...props} entree={entree} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function BoutonTheme({ theme, basculer }: { theme: "nuit" | "jour"; basculer: () => void }) {
  const libelle = theme === "jour" ? "Thème sombre" : "Thème clair";
  return (
    <button type="button" className="ao-lien" aria-pressed={theme === "jour"} onClick={basculer} title={theme === "jour" ? "Passer au thème sombre" : "Passer au thème clair"}>
      <Icone nom={theme === "jour" ? "lune" : "soleil"} />
      <span className="ao-txt">{libelle}</span>
    </button>
  );
}

export function BarreLaterale(props: PropsNav & { theme: "nuit" | "jour"; basculer: () => void }) {
  const { theme, basculer, ...nav } = props;
  return (
    <aside className="ao-rail">
      <a href="/" onClick={suivreLien(nav.aller, "/")} className="ao-marque" aria-label="AgenticOS, vue d'ensemble">
        <span className="ao-monogramme" aria-hidden="true">
          AO
        </span>
        <b className="ao-txt">AgenticOS</b>
      </a>
      <nav className="ao-nav" aria-label="Navigation principale">
        <Groupes {...nav} />
        <ul className="ao-pied">
          {PIED.map((entree) => (
            <li key={entree.cle}>
              <Lien {...nav} entree={entree} />
            </li>
          ))}
          <li>
            <BoutonTheme theme={theme} basculer={basculer} />
          </li>
        </ul>
      </nav>
    </aside>
  );
}

export function OngletsBas({ active, aller, decisions, plusOuvert, onPlus }: PropsNav & { plusOuvert: boolean; onPlus: () => void }) {
  const dansLesOnglets = ONGLETS_BAS.some((o) => o.entree.cle === active);
  return (
    <nav className="ao-onglets-bas" aria-label="Navigation rapide">
      {ONGLETS_BAS.map(({ entree, libelle }) => (
        <Lien key={entree.cle} entree={entree} libelle={libelle} active={active} aller={aller} decisions={decisions} />
      ))}
      <button type="button" className="ao-lien" aria-haspopup="dialog" aria-expanded={plusOuvert} aria-current={!dansLesOnglets && active ? "page" : undefined} onClick={onPlus}>
        <Icone nom="plus" />
        <span className="ao-txt">Plus</span>
      </button>
    </nav>
  );
}

/** « Plus » sur téléphone : toutes les pages, groupées comme la barre latérale. */
export function MenuComplet(props: PropsNav & { ouvert: boolean; onFermer: () => void; theme: "nuit" | "jour"; basculer: () => void }) {
  const { ouvert, onFermer, theme, basculer, ...nav } = props;
  const aller = (href: string) => {
    onFermer();
    nav.aller(href);
  };
  return (
    <Tiroir ouvert={ouvert} onFermer={onFermer} titre="Toutes les pages">
      <nav className="ao-nav ao-nav-menu" aria-label="Toutes les pages">
        <Groupes {...nav} aller={aller} />
        <ul className="ao-pied">
          {PIED.map((entree) => (
            <li key={entree.cle}>
              <Lien {...nav} aller={aller} entree={entree} />
            </li>
          ))}
          <li>
            <BoutonTheme theme={theme} basculer={basculer} />
          </li>
        </ul>
      </nav>
      <p className="mt-6 text-xs text-douce">AgenticOS · NAS sur le tailnet</p>
    </Tiroir>
  );
}
