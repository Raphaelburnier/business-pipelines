// La vue d'ensemble, page d'accueil : les deux questions du matin, « qu'est-ce qui
// m'attend ? » et « où en est le système ? », lisibles en trois secondes. Quatre chiffres,
// la file des décisions, la santé, puis ce qui tourne. Le détail est à un clic.
import type { ReactNode } from "react";
import { Carte } from "../composants/Carte";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { Tableau, type Colonne } from "../composants/Tableau";
import { ListeSante, type EvaluationSante } from "../coquille/Sante";
import { suivreLien } from "../coquille/Navigation";
import type { ADecider, GenreDecision } from "../donnees/aDecider";
import { useCharge, useHorloge } from "../donnees/contexte";
import { attente } from "../donnees/decisions";
import { CLASSES_TON, depuis, VIDE, type Ton } from "../format";
import { Icone, type NomIcone } from "../icones";
import type { Run } from "../types";
import { Etat } from "../ui";
import type { Activite } from "./EnCours";

const JOUR_MS = 24 * 3_600_000;
const DECISIONS_MONTREES = 5;
const GENRES: Record<GenreDecision, string> = { run: "Run", pr: "PR", livraison: "Livraison", plan: "Plan" };

type Aller = (href: string) => void;

function LienInterne({ href, aller, className, children }: { href: string; aller: Aller; className?: string; children: ReactNode }) {
  return (
    <a href={href} onClick={suivreLien(aller, href)} className={className}>
      {children}
    </a>
  );
}

function Tuile({ libelle, valeur, detail, ton, icone, href, aller }: { libelle: string; valeur: ReactNode; detail: ReactNode; ton: Ton; icone: NomIcone; href?: string; aller: Aller }) {
  const contenu = (
    <>
      <span className="ao-indicateur-tete">
        <Icone nom={icone} taille={16} className={CLASSES_TON[ton].texte} />
        {libelle}
      </span>
      <span className="ao-indicateur-valeur">{valeur}</span>
      <span className="ao-indicateur-detail">{detail}</span>
    </>
  );
  return href ? (
    <LienInterne href={href} aller={aller} className="ao-indicateur ao-indicateur-lien">
      {contenu}
    </LienInterne>
  ) : (
    <div className="ao-indicateur">{contenu}</div>
  );
}

function heure(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" }) : null;
}

function Tuiles({ decisions, activite, aller }: { decisions: ADecider; activite: Activite; aller: Aller }) {
  const maintenant = useHorloge(30_000);
  const { donnees: usage } = useCharge((s) => s.usage(), []);
  const echecs = useCharge((s) => s.runs({ status: "failed", limite: 50 }), []);

  const n = decisions.elements.length;
  const plusAncien = decisions.elements.reduce<string | null>((min, e) => (e.depuis && (!min || Date.parse(e.depuis) < Date.parse(min)) ? e.depuis : min), null);

  const recents = echecs.donnees?.filter((r) => maintenant - Date.parse(r.fin ?? r.debut ?? "") < JOUR_MS) ?? null;
  const dernierEchec = recents?.[0] ? recents[0].fin ?? recents[0].debut : null;

  const enAttente = activite.lignes.filter((l) => l.genre === "pause").length;
  const fenetre = usage?.quota?.cinqHeures ?? null;
  const quota = fenetre?.utilisation ?? null;
  const reset = heure(fenetre?.reinitialisation);

  return (
    <section aria-label="Indicateurs" className="ao-indicateurs">
      <Tuile
        libelle="À décider"
        valeur={decisions.chargement && !n ? VIDE : n}
        detail={n ? `le plus ancien depuis ${plusAncien ? attente(plusAncien, maintenant) : VIDE}` : decisions.chargement ? "lecture…" : "rien ne t'attend"}
        ton={n ? "alerte" : "ok"}
        icone={n ? "decision" : "ok"}
        href="/decisions"
        aller={aller}
      />
      <Tuile
        libelle="Runs actifs"
        valeur={usage?.runsActifs ?? VIDE}
        detail={enAttente ? `${enAttente} en attente d'une ressource` : "aucun en attente"}
        ton="bleu"
        icone="run"
        href="/run"
        aller={aller}
      />
      <Tuile
        libelle="Échecs sur 24 h"
        valeur={recents ? recents.length : echecs.erreur ? "?" : VIDE}
        detail={echecs.erreur ? "lecture impossible" : recents?.length ? `le dernier ${depuis(dernierEchec, maintenant)}` : recents ? "aucun échec" : "lecture…"}
        ton={recents?.length || echecs.erreur ? "danger" : "ok"}
        icone={recents?.length || echecs.erreur ? "echec" : "ok"}
        href="/run"
        aller={aller}
      />
      <Tuile
        libelle="Quota Claude · 5 h"
        valeur={quota === null ? VIDE : `${Math.round(quota)} %`}
        detail={quota === null ? "aucune mesure récente" : reset ? `réinitialisé à ${reset}` : "heure de réinitialisation inconnue"}
        ton={quota === null ? "doux" : quota >= 90 ? "danger" : quota >= 70 ? "alerte" : "ok"}
        icone="horloge"
        aller={aller}
      />
    </section>
  );
}

function Decisions({ decisions, aller }: { decisions: ADecider; aller: Aller }) {
  const { elements, chargement, erreurs } = decisions;
  const visibles = elements.slice(0, DECISIONS_MONTREES);
  const reste = elements.length - visibles.length;
  let contenu: ReactNode;
  if (!elements.length && erreurs.length === 3) {
    contenu = <EtatErreur titre="Décisions illisibles" message="Ni la livraison, ni les PR, ni les approbations n'ont répondu." onReessayer={decisions.recharger} />;
  } else if (!elements.length && chargement) {
    contenu = <Squelette lignes={3} libelle="Lecture des décisions…" />;
  } else if (!elements.length) {
    contenu = (
      <EtatVide
        icone="ok"
        message="Rien n'attend ta décision."
        detail="Les validations de runs, les PR sensibles, les livraisons et les plans métier apparaissent ici dès qu'ils t'attendent."
      />
    );
  } else {
    contenu = (
      <ul className="flex flex-col">
        {visibles.map((e) => (
          <li key={e.cle} className="ao-decision">
            <span className={`ao-decision-genre ${e.genre}`}>{GENRES[e.genre]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-encre" title={e.titre}>
                {e.titre}
              </div>
              <div className="truncate text-[13px] text-douce" title={e.detail}>
                {e.detail}
              </div>
            </div>
            <LienInterne href={e.href} aller={aller} className={`ao-btn ${e.genre === "run" ? "primaire" : ""}`}>
              {e.action}
            </LienInterne>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Carte
      titre="À décider maintenant"
      sousTitre={elements.length ? `${elements.length} en attente, les runs bloqués d'abord` : undefined}
      className="ao-ensemble-decisions"
      actions={
        <LienInterne href="/decisions" aller={aller} className="ao-lien-carte">
          {reste > 0 ? `Tout voir (${elements.length})` : "Tout voir"}
          <Icone nom="suite" taille={14} />
        </LienInterne>
      }
    >
      {erreurs.length > 0 && erreurs.length < 3 && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          Liste incomplète : {erreurs.join(", ")} sans réponse.
        </p>
      )}
      {contenu}
    </Carte>
  );
}

function Sante({ sante, aller }: { sante: EvaluationSante; aller: Aller }) {
  return (
    <Carte
      titre="Santé"
      sousTitre={sante.problemes ? `${sante.problemes} point${sante.problemes > 1 ? "s" : ""} à surveiller` : sante.niveau === "inconnu" ? "Lecture…" : "Tout répond"}
      actions={
        <LienInterne href="/systeme" aller={aller} className="ao-lien-carte">
          Système
          <Icone nom="suite" taille={14} />
        </LienInterne>
      }
    >
      {sante.niveau === "inconnu" && sante.lignes.length <= 1 ? <Squelette lignes={4} libelle="Lecture de la santé…" /> : <ListeSante lignes={sante.lignes} />}
    </Carte>
  );
}

function EnCours({ activite, aller }: { activite: Activite; aller: Aller }) {
  const maintenant = useHorloge(5000);
  const colonnes: ReadonlyArray<Colonne<{ run: Run }>> = [
    {
      cle: "projet",
      titre: "Projet",
      rendu: ({ run }) => (
        <LienInterne href={`/run/${encodeURIComponent(run.id)}`} aller={aller} className="font-medium text-encre hover:text-accent hover:underline">
          {run.projet ?? "Sans projet"}
        </LienInterne>
      ),
      tri: (a, b) => (a.run.projet ?? "").localeCompare(b.run.projet ?? "", "fr"),
    },
    { cle: "statut", titre: "Statut", rendu: ({ run }) => <Etat etat={run.statut} /> },
    {
      cle: "etape",
      titre: "Étape",
      rendu: ({ run }) => (run.etapes.total ? `${run.etapes.parStatut.succeeded ?? 0} / ${run.etapes.total}` : VIDE),
      alignement: "droite",
    },
    {
      cle: "lance",
      titre: "Lancé",
      rendu: ({ run }) => <span className="whitespace-nowrap text-douce">{depuis(run.debut, maintenant)}</span>,
      tri: (a, b) => Date.parse(a.run.debut ?? "") - Date.parse(b.run.debut ?? ""),
    },
    { cle: "pipeline", titre: "Pipeline", rendu: ({ run }) => <span className="font-mono text-xs text-douce">{run.pipeline}</span> },
  ];

  let contenu: ReactNode;
  if (activite.erreur && !activite.lignes.length) contenu = <EtatErreur titre="Runs illisibles" message={activite.erreur} detail={activite.detail} onReessayer={activite.recharger} />;
  else if (activite.chargement) contenu = <Squelette lignes={4} libelle="Lecture des runs…" />;
  else
    contenu = (
      <Tableau
        libelle="Runs en cours"
        colonnes={colonnes}
        lignes={activite.lignes}
        cleLigne={({ run }) => run.id}
        vide={
          <EtatVide
            icone="activite"
            message="Rien ne tourne en ce moment."
            detail="Prépare une mission pour lancer un pipeline sur un projet."
            action={
              <LienInterne href="/missions" aller={aller} className="ao-btn">
                Préparer une mission
              </LienInterne>
            }
          />
        }
      />
    );

  return (
    <Carte
      titre="En cours"
      sousTitre={activite.lignes.length ? `${activite.lignes.length} run${activite.lignes.length > 1 ? "s" : ""} vivant${activite.lignes.length > 1 ? "s" : ""}` : undefined}
      actions={
        <LienInterne href="/run" aller={aller} className="ao-lien-carte">
          Tous les runs
          <Icone nom="suite" taille={14} />
        </LienInterne>
      }
    >
      {contenu}
    </Carte>
  );
}

export function VueEnsemble({ decisions, activite, sante, aller }: { decisions: ADecider; activite: Activite; sante: EvaluationSante; aller: Aller }) {
  return (
    <div className="ao-ensemble">
      <Tuiles decisions={decisions} activite={activite} aller={aller} />
      <div className="ao-ensemble-grille">
        <Decisions decisions={decisions} aller={aller} />
        <Sante sante={sante} aller={aller} />
      </div>
      <EnCours activite={activite} aller={aller} />
    </div>
  );
}
