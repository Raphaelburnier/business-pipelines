// Les briques visuelles du cockpit. Rien ici ne décide : tout vient de l'API.
import { useMemo, useState } from "react";
import { depuis, duree, jetons, usd } from "./donnees";

// Les couleurs disent l'état sans qu'on ait à lire le mot : vert ce qui a abouti, rouge ce
// qui a échoué, ambre ce qui attend quelqu'un, accent ce qui tourne en ce moment.
const TONS = {
  succeeded: "text-ok bg-ok-fond border-ok/40",
  running: "text-accent bg-carte border-accent/50",
  failed: "text-danger bg-danger-fond border-danger/40",
  cancelled: "text-douce bg-fond border-trait",
  waiting_approval: "text-alerte bg-alerte-fond border-alerte/40",
  waiting_quota: "text-alerte bg-alerte-fond border-alerte/40",
  waiting_machine: "text-alerte bg-alerte-fond border-alerte/40",
  queued: "text-douce bg-fond border-trait",
  paused: "text-douce bg-fond border-trait",
  online: "text-ok bg-ok-fond border-ok/40",
  busy: "text-accent bg-carte border-accent/50",
  sleeping: "text-bleu bg-fond border-bleu/40",
  waking: "text-alerte bg-alerte-fond border-alerte/40",
  offline: "text-danger bg-danger-fond border-danger/40",
  error: "text-danger bg-danger-fond border-danger/40",
};

// La couleur d'une barre de timeline : pleine, sans bordure, pour se lire de loin.
const BARRES = {
  succeeded: "bg-ok/70",
  running: "bg-accent pulse-douce",
  failed: "bg-danger/80",
  cancelled: "bg-douce/40",
  waiting_approval: "bg-alerte/70",
  waiting_quota: "bg-alerte/70",
  waiting_machine: "bg-alerte/70",
};

// Les statuts de la base sont en anglais (§9) ; l'écran, lui, parle français.
const MOTS = {
  succeeded: "terminé",
  running: "en cours",
  failed: "échoué",
  cancelled: "arrêté",
  waiting_approval: "décision attendue",
  waiting_quota: "quota atteint",
  waiting_machine: "machine attendue",
  queued: "en file",
  paused: "en pause",
  online: "en ligne",
  busy: "occupée",
  sleeping: "en veille",
  waking: "réveil",
  offline: "injoignable",
  error: "en erreur",
};

export const mot = (statut) => MOTS[statut] || statut;

export function Etat({ statut, className = "" }) {
  const ton = TONS[statut] || "text-douce bg-fond border-trait";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${ton} ${className}`}>
      {statut === "running" && <span className="pulse-douce h-1.5 w-1.5 rounded-full bg-current" />}
      {mot(statut)}
    </span>
  );
}

export function Carte({ children, className = "" }) {
  return <div className={`rounded-xl border border-trait bg-carte p-4 ${className}`}>{children}</div>;
}

export function Titre({ children, compteur = null, action = null }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="font-(family-name:--font-titre) text-sm font-bold uppercase tracking-wider text-douce">{children}</h2>
      {compteur !== null && <span className="text-sm font-semibold tabular-nums text-douce">{compteur}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function Vide({ children }) {
  return <p className="rounded-xl border border-dashed border-trait bg-carte p-5 text-center text-sm text-douce">{children}</p>;
}

export function Erreur({ children }) {
  return <p className="rounded-r-xl border-l-4 border-danger bg-danger-fond px-4 py-3 text-danger">{children}</p>;
}

// Le bandeau de chiffres : ce qu'on lit avant tout le reste. Un tableau de bord qui commence
// par des cartes molles oblige à chercher l'information ; ici elle est en haut, en gros, et
// en chiffres alignés.
export function Metrique({ valeur, libelle, detail = null, ton = "text-encre" }) {
  return (
    <div className="rounded-xl border border-trait bg-carte px-3 py-2.5">
      <div className={`font-(family-name:--font-titre) text-2xl font-bold tabular-nums leading-none ${ton}`}>{valeur}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-douce">{libelle}</div>
      {detail && <div className="text-[11px] text-douce">{detail}</div>}
    </div>
  );
}

export function Connexion({ connecte }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${connecte ? "text-ok" : "text-danger"}`}>
      <span className={`h-2 w-2 rounded-full ${connecte ? "bg-ok pulse-douce" : "bg-danger"}`} />
      {connecte ? "en direct" : "flux interrompu"}
    </span>
  );
}

// Une ligne de run : lisible en diagonale, avec l'avancement des étapes en barre plutôt
// qu'en compteur — un compteur demande de faire la division soi-même.
export function LigneRun({ run, onOuvrir, actif = false, maintenant }) {
  const parStatut = run.etapes.parStatut || {};
  const finies = parStatut.succeeded || 0;
  const encours = parStatut.running || 0;
  const ratees = (parStatut.failed || 0) + (parStatut.cancelled || 0);
  const total = Math.max(run.etapes.total, 1);
  const fin = run.fin ? Date.parse(run.fin) : maintenant;

  return (
    <button
      type="button"
      onClick={() => onOuvrir(run.id)}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        actif ? "border-accent bg-carte" : "border-trait bg-carte hover:border-accent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold">{run.projet || "sans projet"}</span>
        <span className="truncate font-mono text-[11px] text-douce">{run.pipeline}</span>
        <Etat statut={run.statut} className="ml-auto" />
      </div>

      <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-fond">
        {finies > 0 && <span className="bg-ok/70" style={{ width: `${(finies / total) * 100}%` }} />}
        {encours > 0 && <span className="bg-accent pulse-douce" style={{ width: `${(encours / total) * 100}%` }} />}
        {ratees > 0 && <span className="bg-danger/70" style={{ width: `${(ratees / total) * 100}%` }} />}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-douce tabular-nums">
        <span>
          {finies}/{run.etapes.total} étapes
        </span>
        <span title="Sur abonnement, ce coût est un équivalent API, pas une dépense">{usd(run.coutEquivalentUsd)}</span>
        <span>{duree(fin - Date.parse(run.debut))}</span>
        <span>il y a {depuis(run.debut, maintenant)}</span>
      </div>
    </button>
  );
}

// La timeline : une voie par machine, une barre par étape, à l'échelle du run. C'est là que
// se voit ce qu'une liste cache — deux agents lancés ensemble, une étape qui a pris dix
// fois plus de temps que les autres, un trou d'attente entre deux lots.
export function Timeline({ lecture, etapes, selection, onSelection }) {
  if (!etapes.length) return <Vide>Aucune étape pour l'instant.</Vide>;
  const graduations = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-xl border border-trait bg-carte p-3">
      <div className="relative mb-1 h-4 text-[10px] text-douce">
        {graduations.map((g) => (
          <span
            key={g}
            className={`absolute tabular-nums ${g === 0 ? "" : g === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${g * 100}%` }}
          >
            {g === 0 ? "0 s" : duree(lecture.total * g)}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {lecture.voies.map((voie) => (
          <div key={voie.machine}>
            <div className="mb-1 font-mono text-[11px] text-douce">{voie.machine}</div>
            <div className="relative rounded-lg bg-fond p-1">
              {graduations.slice(1, -1).map((g) => (
                <span key={g} className="absolute top-0 h-full w-px bg-trait/60" style={{ left: `${g * 100}%` }} />
              ))}
              {voie.lignes.map((ligne, i) => (
                <div key={i} className="relative h-5 first:mt-0 [&:not(:first-child)]:mt-1">
                  {ligne.map((barre) => (
                    <button
                      key={barre.id}
                      type="button"
                      onClick={() => onSelection(barre.id === selection ? null : barre.id)}
                      title={`${barre.noeud} · ${duree(barre.finMs - barre.debutMs)}`}
                      className={`absolute top-0 h-5 min-w-[4px] overflow-hidden rounded px-1.5 text-left text-[11px] font-semibold text-encre/90 ${
                        BARRES[barre.statut] || "bg-douce/40"
                      } ${barre.id === selection ? "ring-2 ring-accent" : ""}`}
                      style={{ left: `${barre.gauche * 100}%`, width: `${barre.largeur * 100}%` }}
                    >
                      <span className="block truncate">{barre.noeud}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// La liste des étapes, dense, sélectionnable. Elle double la timeline pour les cas où les
// durées sont trop courtes pour être cliquables.
export function Etapes({ etapes, selection, onSelection }) {
  return (
    <ul className="flex flex-col gap-1">
      {etapes.map((etape) => (
        <li key={etape.id}>
          <button
            type="button"
            onClick={() => onSelection(etape.id === selection ? null : etape.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
              etape.id === selection ? "border-accent bg-carte" : "border-trait bg-carte hover:border-accent"
            }`}
          >
            <span className="truncate font-medium">{etape.noeud}</span>
            <span className="rounded border border-trait px-1 py-0.5 font-mono text-[10px] text-douce">{etape.type}</span>
            {etape.tour > 0 && <span className="text-[11px] text-alerte">tour {etape.tour + 1}</span>}
            <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-douce">
              {etape.coutEquivalentUsd > 0 && <span>{usd(etape.coutEquivalentUsd)}</span>}
              <Etat statut={etape.statut} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Le détail d'une étape, avec les événements qu'elle a produits : c'est le panneau qu'on
// ouvre quand une étape a mal tourné, et il doit répondre sans qu'on aille lire ailleurs.
export function DetailEtape({ etape, evenements, onFermer }) {
  if (!etape) {
    return (
      <Carte className="text-sm text-douce">
        Choisir une étape, dans la timeline ou la liste, pour voir son détail : machine, modèle, jetons, commit et
        événements.
      </Carte>
    );
  }
  const lignes = [
    ["machine", etape.machine],
    ["type", etape.type],
    ["modèle", etape.llm ? `${etape.llm.via}:${etape.llm.model}` : "—"],
    ["issue", etape.outcome || "—"],
    ["coût équivalent", usd(etape.coutEquivalentUsd)],
    ["jetons", `${jetons(etape.tokens.entree)} → ${jetons(etape.tokens.sortie)}`],
    ["session", etape.session || "—"],
    ["checkpoint", etape.checkpoint ? etape.checkpoint.slice(0, 10) : "—"],
    ["début", etape.debut ? new Date(etape.debut).toLocaleTimeString("fr-FR") : "—"],
    ["durée", etape.fin ? duree(Date.parse(etape.fin) - Date.parse(etape.debut)) : "en cours"],
  ];

  return (
    <Carte className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-(family-name:--font-titre) text-base font-bold">{etape.noeud}</span>
        <Etat statut={etape.statut} />
        <button type="button" onClick={onFermer} className="ml-auto text-xs text-douce hover:text-accent">
          fermer
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {lignes.map(([cle, valeur]) => (
          <div key={cle} className="contents">
            <dt className="text-douce">{cle}</dt>
            <dd className="truncate font-mono text-[12px]" title={String(valeur)}>
              {valeur}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-douce">
          Événements ({evenements.length})
        </div>
        {evenements.length ? (
          <ul className="max-h-64 overflow-auto rounded-lg border border-trait">
            {evenements.map((e) => (
              <li key={e.id} className="border-b border-trait/60 px-2 py-1 font-mono text-[11px] last:border-0">
                <span className="text-douce">{new Date(e.at).toLocaleTimeString("fr-FR")} </span>
                <span className="font-semibold">{e.type}</span>
                <span className="text-douce"> {resume(e.payload)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-douce">Aucun événement reçu pour cette étape depuis l'ouverture de la page.</p>
        )}
      </div>
    </Carte>
  );
}

// Le coût par modèle : la question « qu'est-ce qui coûte » a une réponse chiffrée, pas une
// intuition. C'est aussi ce qui dit si router un agent ailleurs valait la peine.
export function ParModele({ lignes, total }) {
  if (!lignes.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {lignes.map((l) => (
        <div key={l.modele}>
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="truncate font-mono">{l.modele}</span>
            <span className="ml-auto tabular-nums">{usd(l.cout)}</span>
            <span className="tabular-nums text-douce">
              {jetons(l.entree)} → {jetons(l.sortie)}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-fond">
            <span className="block h-full bg-accent/70" style={{ width: `${total > 0 ? (l.cout / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Machines({ machines, maintenant }) {
  if (!machines.length) return <Vide>Aucune machine connue.</Vide>;
  return (
    <ul className="flex flex-col gap-1">
      {machines.map((m) => (
        <li key={m.machine} className="flex items-center gap-2 rounded-lg border border-trait bg-carte px-3 py-1.5">
          <span className="truncate text-sm font-medium">{m.nom || m.machine}</span>
          <span className="ml-auto text-[11px] tabular-nums text-douce">
            {m.depuisSecondes === null ? "jamais vue" : depuis(m.dernierHeartbeat, maintenant)}
          </span>
          <Etat statut={m.etat} />
        </li>
      ))}
    </ul>
  );
}

// Le journal live, borné et filtrable. Sans filtre, une étape bavarde noie tout le reste :
// c'est exactement ce que faisait la première version, où `step.progress` remplissait l'écran.
export function Journal({ evenements, hauteur = "max-h-80" }) {
  const [filtre, setFiltre] = useState("");
  const [type, setType] = useState("");

  const types = useMemo(() => [...new Set(evenements.map((e) => e.type))].sort(), [evenements]);
  const visibles = useMemo(
    () =>
      evenements.filter((e) => {
        if (type && e.type !== type) return false;
        if (!filtre) return true;
        const texte = `${e.type} ${JSON.stringify(e.payload)}`.toLowerCase();
        return texte.includes(filtre.toLowerCase());
      }),
    [evenements, filtre, type]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-trait bg-carte px-2 py-1 text-xs"
        >
          <option value="">tous les types ({types.length})</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="filtrer…"
          className="min-w-0 flex-1 rounded-lg border border-trait bg-carte px-2 py-1 text-xs"
        />
        <span className="self-center text-[11px] tabular-nums text-douce">
          {visibles.length}/{evenements.length}
        </span>
      </div>

      {visibles.length ? (
        <ul className={`${hauteur} overflow-auto rounded-xl border border-trait`}>
          {visibles.map((e) => (
            <li key={e.id} className="flex gap-2 border-b border-trait/60 px-2 py-1 font-mono text-[11px] last:border-0">
              <span className="shrink-0 text-douce">{new Date(e.at).toLocaleTimeString("fr-FR")}</span>
              <span className="shrink-0 font-semibold">{e.type}</span>
              <span className="min-w-0 flex-1 truncate text-douce">{resume(e.payload)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Vide>Rien ne correspond.</Vide>
      )}
    </div>
  );
}

// Un événement porte une charge libre : on en montre ce qui tient sur une ligne, sans
// jamais rendre du texte de modèle autrement que comme du texte (React échappe pour nous).
function resume(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [cle, valeur] of Object.entries(payload)) {
    if (valeur === null || valeur === undefined || valeur === "") continue;
    const texte = typeof valeur === "object" ? JSON.stringify(valeur) : String(valeur);
    parts.push(`${cle}=${texte.length > 60 ? `${texte.slice(0, 60)}…` : texte}`);
    if (parts.length === 4) break;
  }
  return parts.join(" ");
}

// Une décision qui attend est la seule chose de cette page qui réclame quelqu'un : elle est
// donc la plus visible, et elle mène au seul endroit où on peut agir.
export function Decisions({ approbations, maintenant }) {
  if (!approbations.length) return null;
  return (
    <div className="rounded-xl border-l-4 border-alerte bg-alerte-fond p-3">
      <div className="mb-1.5 text-sm font-bold text-alerte">
        {approbations.length} décision{approbations.length > 1 ? "s" : ""} en attente
      </div>
      <ul className="flex flex-col gap-2">
        {approbations.map((a) => (
          <li key={a.id} className="text-sm">
            <div className="font-medium">{a.question || `nœud ${a.noeud}`}</div>
            <div className="text-[11px] text-douce">
              {a.projet ? `${a.projet} · ` : ""}
              {a.actions > 0 ? `${a.actions} action${a.actions > 1 ? "s" : ""} · ` : ""}
              depuis {depuis(a.ouverteLe, maintenant)}
            </div>
          </li>
        ))}
      </ul>
      <a className="mt-2 inline-block text-sm font-semibold text-accent underline" href="/">
        Aller décider
      </a>
    </div>
  );
}
