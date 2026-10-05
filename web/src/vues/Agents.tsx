// L'équipe d'agents : qui est libre, sur quel projet, et le budget du mois qui lui reste.
// On coche des agents, on choisit un projet (existant ou nouveau), et on les y associe.
// Le détail des étapes reste dans les runs, ouverts d'un clic sur « au travail ».
import { useState } from "react";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import type { Famille, MembreEquipe } from "../donnees/equipe";
import { CLASSES_TON, type Ton, depuis, usd } from "../format";
import { Erreur, Titre, Vide } from "../ui";
import type { Selection } from "../topologie/Topologie";

type Filtre = "tous" | "libres" | "occupes";

const FAMILLES: Record<Famille, { libelle: string; ton: Ton }> = {
  claude: { libelle: "Claude", ton: "accent" },
  codex: { libelle: "Codex", ton: "bleu" },
  libre: { libelle: "Gratuit", ton: "ok" },
};

const NOUVEAU = "__nouveau__";

export function Agents({ onSelection }: { onSelection: (s: Selection) => void }) {
  const { source } = useSource();
  const maintenant = useHorloge(30_000);
  const [recharge, setRecharge] = useState(0);
  const { donnees, erreur } = useCharge((s) => s.equipe(), [recharge]);
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [cible, setCible] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return <p className="text-sm text-douce">Lecture de l'équipe…</p>;

  const libres = donnees.agents.filter((a) => !a.occupe).length;
  const visibles = donnees.agents.filter((a) => filtre === "tous" || (filtre === "libres" ? !a.occupe : a.occupe));
  const projet = cible === NOUVEAU ? nouveau.trim() : cible;

  const basculer = (id: string) =>
    setChoisis((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  async function envoyer(ids: string[], vers: string | null) {
    setEnvoi(true);
    setRefus(null);
    try {
      await source.affecter(ids, vers);
      setChoisis(new Set());
      setNouveau("");
      setCible("");
      setRecharge((n) => n + 1);
    } catch (err) {
      setRefus(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Titre compteur={donnees.agents.length}>Agents</Titre>
        <span className="mb-2 text-xs text-douce">
          <span className="text-ok">{libres} libres</span> · <span className="text-alerte">{donnees.agents.length - libres} occupés</span>
        </span>
        <div className="mb-2 ml-auto flex overflow-hidden rounded-lg border border-trait text-xs" role="group" aria-label="Filtrer">
          {(["tous", "libres", "occupes"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltre(f)}
              className={`px-2.5 py-1 ${filtre === f ? "bg-accent text-sur-accent" : "bg-carte text-douce hover:text-encre"}`}
            >
              {f === "occupes" ? "occupés" : f}
            </button>
          ))}
        </div>
      </div>

      {!donnees.mesure && <p className="text-xs text-douce">Event store indisponible : activité et consommation non mesurées.</p>}

      {choisis.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-carte p-2 text-sm">
          <span className="font-semibold">
            {choisis.size} agent{choisis.size > 1 ? "s" : ""} →
          </span>
          <select
            value={cible}
            onChange={(e) => setCible(e.target.value)}
            className="rounded-lg border border-trait bg-surface px-2 py-1 text-xs"
            aria-label="Projet"
          >
            <option value="">choisir un projet</option>
            {donnees.projets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value={NOUVEAU}>+ nouveau projet…</option>
          </select>
          {cible === NOUVEAU && (
            <input
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              placeholder="nom du projet"
              maxLength={60}
              className="min-w-0 flex-1 rounded-lg border border-trait bg-surface px-2 py-1 text-xs"
              aria-label="Nom du nouveau projet"
            />
          )}
          <button
            type="button"
            disabled={!projet || envoi}
            onClick={() => envoyer([...choisis], projet)}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-sur-accent disabled:opacity-40"
          >
            Associer
          </button>
          <button type="button" onClick={() => setChoisis(new Set())} className="text-xs text-douce hover:text-encre">
            annuler
          </button>
        </div>
      )}
      {refus && <Erreur>{refus}</Erreur>}

      {!visibles.length ? (
        <Vide>Aucun agent ne correspond.</Vide>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-trait overflow-auto rounded-xl border border-trait">
          {visibles.map((a) => (
            <Ligne
              key={a.id}
              agent={a}
              choisi={choisis.has(a.id)}
              maintenant={maintenant}
              occupe={envoi}
              onChoisir={() => basculer(a.id)}
              onLiberer={() => envoyer([a.id], null)}
              onOuvrirRun={(id) => onSelection({ type: "run", id })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Ligne({
  agent: a,
  choisi,
  maintenant,
  occupe,
  onChoisir,
  onLiberer,
  onOuvrirRun,
}: {
  agent: MembreEquipe;
  choisi: boolean;
  maintenant: number;
  occupe: boolean;
  onChoisir: () => void;
  onLiberer: () => void;
  onOuvrirRun: (id: string) => void;
}) {
  const famille = CLASSES_TON[FAMILLES[a.famille].ton];
  const statut = CLASSES_TON[a.occupe ? "alerte" : "ok"];
  return (
    <li className={`grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,2fr)_7rem_minmax(0,1.5fr)_minmax(0,1.5fr)] ${choisi ? "bg-fond" : "bg-carte"}`}>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={choisi} onChange={onChoisir} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={`Choisir ${a.nom}`} />
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-bold ${famille.texte} ${famille.bordure} ${famille.fond}`}>
          {a.nom.slice(0, 1)}
        </span>
      </label>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{a.nom}</span>
          <span className="truncate text-xs text-douce">{a.role}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-douce" title={`${a.llm.via}:${a.llm.model}`}>
          <span className={famille.texte}>{FAMILLES[a.famille].libelle}</span> · {a.llm.model}
        </div>
      </div>

      <div className="col-start-2 sm:col-start-auto">
        <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${statut.texte} ${statut.fond} ${statut.bordure}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statut.plein} ${a.enCours ? "pulse-douce" : ""}`} />
          {a.occupe ? "occupé" : "libre"}
        </span>
        {a.enCours && (
          <button type="button" onClick={() => onOuvrirRun(a.enCours!.run)} className="mt-1 block text-[11px] text-accent hover:underline">
            au travail · {a.enCours.noeud}
          </button>
        )}
      </div>

      <div className="col-start-2 min-w-0 text-sm sm:col-start-auto">
        {a.projet ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="truncate">{a.projet}</div>
              {a.depuis && <div className="text-[11px] text-douce">depuis {depuis(a.depuis, maintenant)}</div>}
            </div>
            {a.depuis && (
              <button type="button" disabled={occupe} onClick={onLiberer} className="ml-auto shrink-0 text-[11px] text-douce hover:text-danger disabled:opacity-40">
                libérer
              </button>
            )}
          </div>
        ) : (
          <span className="text-douce">aucun projet</span>
        )}
      </div>

      <div className="col-start-2 sm:col-start-auto">
        <Reste usage={a.usage} />
      </div>
    </li>
  );
}

/** Le budget du mois qui reste, en équivalent API : ce n'est pas une dépense réelle sur abonnement. */
function Reste({ usage }: { usage: MembreEquipe["usage"] }) {
  if (usage.budgetMensuelUsd === null) {
    return <span className="text-[11px] text-ok">gratuit · illimité</span>;
  }
  const reste = usage.resteUsd ?? 0;
  const pourcent = usage.budgetMensuelUsd > 0 ? Math.round((reste / usage.budgetMensuelUsd) * 100) : 0;
  const niveau = pourcent <= 10 ? "bg-danger" : pourcent <= 30 ? "bg-alerte" : "bg-ok";
  return (
    <div title={`Consommé ce mois : ${usd(usage.consommeMoisUsd)} (équivalent API)`}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-douce">reste</span>
        <span className="tabular-nums">
          {usd(reste)} <span className="text-douce">/ {usd(usage.budgetMensuelUsd)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-trait">
        <div className={`h-full ${niveau}`} style={{ width: `${pourcent}%` }} />
      </div>
    </div>
  );
}
