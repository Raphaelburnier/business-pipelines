// Les briques visuelles du cockpit. Rien ici ne décide : tout vient de l'API.
import { depuis, usd } from "./donnees";

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
  const vivant = statut === "running";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${ton} ${className}`}>
      {vivant && <span className="pulse-douce h-1.5 w-1.5 rounded-full bg-current" />}
      {mot(statut)}
    </span>
  );
}

export function Carte({ children, className = "" }) {
  return <div className={`rounded-2xl border border-trait bg-carte p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Titre({ children, compteur = null }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-(family-name:--font-titre) text-lg font-semibold">
      {children}
      {compteur !== null && (
        <span className="rounded-full border border-trait bg-carte px-2 py-0.5 text-xs font-semibold text-douce">{compteur}</span>
      )}
    </h2>
  );
}

export function Vide({ children }) {
  return <p className="rounded-2xl border border-dashed border-trait bg-carte p-6 text-center text-douce">{children}</p>;
}

export function Erreur({ children }) {
  return (
    <p className="rounded-r-2xl border-l-4 border-danger bg-danger-fond px-4 py-3 text-danger">{children}</p>
  );
}

// Une ligne de run : ce qu'on lit en diagonale pour savoir lequel ouvrir.
export function LigneRun({ run, onOuvrir, actif = false }) {
  const encours = run.etapes.parStatut.running || 0;
  return (
    <button
      type="button"
      onClick={() => onOuvrir(run.id)}
      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
        actif ? "border-accent bg-carte" : "border-trait bg-carte hover:border-accent"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-(family-name:--font-titre) text-base font-semibold">{run.projet || "sans projet"}</span>
        <span className="font-mono text-xs text-douce">{run.pipeline}</span>
        <Etat statut={run.statut} className="ml-auto" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-douce">
        <span>
          {run.etapes.total} étape{run.etapes.total > 1 ? "s" : ""}
          {encours > 0 && <span className="text-accent"> · {encours} en cours</span>}
        </span>
        <span title="Sur abonnement, ce coût est un équivalent API, pas une dépense">{usd(run.coutEquivalentUsd)} équivalent</span>
        <span>démarré il y a {depuis(run.debut)}</span>
      </div>
    </button>
  );
}

// La topologie d'un run : ses nœuds dans l'ordre où ils ont tourné, la machine qui les a
// exécutés, et le lien de dépendance entre eux. Les boucles de correction se voient au
// numéro de tour, qui est ce que le moteur compte réellement.
export function Topologie({ etapes }) {
  if (!etapes.length) return <Vide>Aucune étape pour l'instant.</Vide>;
  return (
    <ol className="flex flex-col gap-2">
      {etapes.map((etape, i) => (
        <li key={etape.id} className="relative pl-6">
          {i > 0 && <span className="absolute left-2 -top-2 h-2 w-px bg-trait" aria-hidden="true" />}
          <span
            className={`absolute left-0 top-4 h-4 w-4 rounded-full border-2 ${
              etape.statut === "running" ? "pulse-douce border-accent bg-accent" : "border-trait bg-carte"
            }`}
            aria-hidden="true"
          />
          <Carte className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{etape.noeud}</span>
              <span className="rounded border border-trait px-1.5 py-0.5 font-mono text-[11px] text-douce">{etape.type}</span>
              {etape.tour > 0 && <span className="text-xs text-alerte">tour {etape.tour + 1}</span>}
              <Etat statut={etape.statut} className="ml-auto" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-douce">
              <span className="font-mono text-xs">{etape.machine}</span>
              {etape.llm && (
                <span className="font-mono text-xs">
                  {etape.llm.via}:{etape.llm.model}
                </span>
              )}
              {etape.coutEquivalentUsd > 0 && <span>{usd(etape.coutEquivalentUsd)}</span>}
              {etape.tokens.entree > 0 && (
                <span>
                  {etape.tokens.entree} → {etape.tokens.sortie} jetons
                </span>
              )}
              {etape.outcome && <span className="text-encre">issue : {etape.outcome}</span>}
              {etape.checkpoint && <span className="font-mono text-xs">{etape.checkpoint.slice(0, 7)}</span>}
            </div>
          </Carte>
        </li>
      ))}
    </ol>
  );
}

export function Machines({ machines }) {
  if (!machines.length) return <Vide>Aucune machine connue.</Vide>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {machines.map((m) => (
        <Carte key={m.machine} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{m.nom || m.machine}</div>
            <div className="text-sm text-douce">
              {m.depuisSecondes === null ? "jamais vue" : `vue il y a ${depuis(m.dernierHeartbeat)}`}
            </div>
          </div>
          <Etat statut={m.etat} />
        </Carte>
      ))}
    </div>
  );
}

// Le journal live. Il ne remplace pas la topologie : il dit ce qui vient d'arriver, pendant
// que ça arrive, ce qu'un état figé ne montre jamais.
export function Journal({ evenements }) {
  if (!evenements.length) return <Vide>Rien depuis l'ouverture de la page.</Vide>;
  return (
    <ul className="flex flex-col gap-1 font-mono text-xs">
      {evenements.map((e) => (
        <li key={e.id} className="flex gap-2 rounded-lg border border-trait bg-carte px-2 py-1">
          <span className="text-douce">{new Date(e.at).toLocaleTimeString("fr-FR")}</span>
          <span className="font-semibold">{e.type}</span>
          <span className="min-w-0 flex-1 truncate text-douce">{resume(e.payload)}</span>
        </li>
      ))}
    </ul>
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
    parts.push(`${cle}=${texte.length > 80 ? `${texte.slice(0, 80)}…` : texte}`);
    if (parts.length === 4) break;
  }
  return parts.join(" ");
}

export function Approbations({ approbations }) {
  if (!approbations.length) return null;
  return (
    <Carte className="border-alerte/50 bg-alerte-fond">
      <div className="mb-2 font-semibold text-alerte">
        {approbations.length} décision{approbations.length > 1 ? "s" : ""} attend
        {approbations.length > 1 ? "ent" : ""}
      </div>
      <ul className="flex flex-col gap-2">
        {approbations.map((a) => (
          <li key={a.id} className="text-sm">
            <div className="font-medium">{a.question || `nœud ${a.noeud}`}</div>
            <div className="text-douce">
              {a.projet ? `${a.projet} · ` : ""}
              {a.actions > 0 ? `${a.actions} action${a.actions > 1 ? "s" : ""} à trancher · ` : ""}
              ouverte il y a {depuis(a.ouverteLe)}
            </div>
          </li>
        ))}
      </ul>
      <a className="mt-3 inline-block text-sm font-semibold text-accent underline" href="/">
        Aller décider
      </a>
    </Carte>
  );
}
