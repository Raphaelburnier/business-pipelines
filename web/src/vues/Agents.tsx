// L'équipe d'agents présentée comme une équipe de personnages (design system AgenticOS, écran
// Agents) : une grille de portraits et la fiche du membre choisi, ou le roster dense.
//
// Les compétences de la fiche sont les notes publiques du modèle du membre, chacune avec son
// coût publié et sa source (`equipe/benchmarks.json`). Le nom et la photo se changent sur la
// fiche ; l'affectation à un projet reste celle d'avant, depuis la fiche ou le roster.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import type { Benchmark, Famille, MembreEquipe, ReponseEquipe } from "../donnees/equipe";
import { depuis, jetons, usd } from "../format";
import { Erreur, Titre, Vide } from "../ui";
import type { Selection } from "../topologie/Topologie";
import { Portrait, RARETES, rarete } from "./Portrait";

type Vue = "selection" | "roster";
type Filtre = "tous" | "libres" | "occupes" | Famille;

const FILTRES: Array<[Filtre, string]> = [
  ["tous", "Tous"],
  ["libres", "Libres"],
  ["occupes", "Occupés"],
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["libre", "Gratuits"],
];

const FAMILLES: Record<Famille, string> = { claude: "Claude", codex: "Codex", libre: "Gratuit" };

const NOUVEAU = "__nouveau__";

function garder(filtre: Filtre, a: MembreEquipe): boolean {
  if (filtre === "tous") return true;
  if (filtre === "libres") return !a.occupe;
  if (filtre === "occupes") return a.occupe;
  return a.famille === filtre;
}

/** Niveau = racine carrée des étapes réussies ce mois ; la barre montre le chemin vers le suivant. */
function niveau(a: MembreEquipe): { niveau: number; progression: number } {
  const racine = Math.sqrt(a.etapesMois.reussies);
  const n = Math.floor(racine);
  return { niveau: n, progression: Math.round((racine - n) * 100) };
}

export function Agents({ onSelection }: { onSelection: (s: Selection) => void }) {
  const [recharge, setRecharge] = useState(0);
  const { donnees, erreur } = useCharge((s) => s.equipe(), [recharge]);
  const [vue, setVue] = useState<Vue>("selection");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [choisi, setChoisi] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return <p className="text-sm text-douce">Lecture de l'équipe…</p>;

  const libres = donnees.agents.filter((a) => !a.occupe).length;
  const visibles = donnees.agents.filter((a) => garder(filtre, a));
  const fiche = visibles.find((a) => a.id === choisi) ?? visibles[0] ?? null;

  /** Toute écriture passe ici : une erreur s'affiche, un succès relit l'équipe. */
  async function ecrire(action: () => Promise<void>): Promise<boolean> {
    setEnvoi(true);
    setRefus(null);
    try {
      await action();
      setRecharge((n) => n + 1);
      return true;
    } catch (err) {
      setRefus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  const ouvrirFiche = (id: string) => {
    setChoisi(id);
    setVue("selection");
  };

  return (
    <section className="ao-agents">
      <div className="ao-agents-haut">
        <Titre compteur={donnees.agents.length}>Agents</Titre>
        <span className="ao-agents-compte">
          <span className="text-ok">{libres} libres</span> · <span className="text-alerte">{donnees.agents.length - libres} occupés</span>
        </span>
        <div className="ao-vues" role="tablist" aria-label="Mise en page">
          {(["selection", "roster"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vue === v} className={vue === v ? "on" : ""} onClick={() => setVue(v)}>
              {v === "selection" ? "Sélection" : "Roster"}
            </button>
          ))}
        </div>
      </div>

      <div className="ao-filtres" role="group" aria-label="Filtrer">
        <span className="ao-etiquette">Filtrer</span>
        {FILTRES.map(([f, libelle]) => (
          <button key={f} type="button" aria-pressed={filtre === f} className={`ao-puce ${filtre === f ? "on" : ""}`} onClick={() => setFiltre(f)}>
            {libelle}
          </button>
        ))}
      </div>

      {!donnees.mesure && <p className="text-xs text-douce">Event store indisponible : activité et consommation non mesurées.</p>}
      {refus && <Erreur>{refus}</Erreur>}

      {!visibles.length ? (
        <Vide>Aucun agent ne correspond.</Vide>
      ) : vue === "selection" ? (
        <div className="ao-selection">
          <div className="ao-grille">
            {visibles.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`ao-tuile r-${rarete(a)} ${fiche?.id === a.id ? "sel" : ""}`}
                aria-pressed={fiche?.id === a.id}
                aria-label={`${a.nom}, ${a.occupe ? "occupé" : "libre"}`}
                onClick={() => setChoisi(a.id)}
              >
                <Portrait membre={a} largeur={92} />
                <span className="nm">{a.nom}</span>
                <i className={`st ${a.enCours ? "run" : a.occupe ? "wait" : "ok"}`} />
              </button>
            ))}
          </div>
          {fiche && (
            <Fiche
              key={fiche.id}
              agent={fiche}
              projets={donnees.projets}
              envoi={envoi}
              onEcrire={ecrire}
              onOuvrirRun={(id) => onSelection({ type: "run", id })}
            />
          )}
        </div>
      ) : (
        <Roster agents={visibles} reponse={donnees} envoi={envoi} onEcrire={ecrire} onOuvrir={ouvrirFiche} />
      )}
    </section>
  );
}

/* ---------- Fiche : portrait, identité, compétences, budget, mission ---------- */

function Fiche({
  agent: a,
  projets,
  envoi,
  onEcrire,
  onOuvrirRun,
}: {
  agent: MembreEquipe;
  projets: string[];
  envoi: boolean;
  onEcrire: (action: () => Promise<void>) => Promise<boolean>;
  onOuvrirRun: (id: string) => void;
}) {
  const { source } = useSource();
  const maintenant = useHorloge(30_000);
  const r = rarete(a);
  const { niveau: n, progression } = niveau(a);
  const projetConnu = a.projet !== null && projets.includes(a.projet);

  return (
    <article className={`ao-fiche r-${r}`}>
      <PhotoModifiable agent={a} niveau={n} envoi={envoi} onChanger={(photo) => onEcrire(() => source.profil(a.id, { photo }))} />

      <div className="info">
        <div className="top">
          <span className="ao-rarete">{RARETES[r].libelle}</span>
          <span className="handle">@{a.id}</span>
          <span className="handle">{a.role}</span>
        </div>

        <NomModifiable agent={a} envoi={envoi} onRenommer={(nom) => onEcrire(() => source.profil(a.id, { nom }))} />

        <div className="modele">
          <code title={`${a.llm.via}:${a.llm.model}`}>{a.llm.model}</code>
          <span>
            {a.competences?.modele ?? FAMILLES[a.famille]} · via {a.llm.via}
          </span>
        </div>

        <div className="xp" role="meter" aria-valuenow={progression} aria-valuemin={0} aria-valuemax={100} aria-label={`Progression vers le niveau ${n + 1}`}>
          <span style={{ width: `${progression}%` }} />
        </div>
        <div className="xpk">
          {a.etapesMois.reussies} étapes réussies sur {a.etapesMois.total} ce mois · {progression} % vers le niveau {n + 1}
        </div>

        <div className="roles">
          {a.registre.map((ref) => (
            <span key={ref} className="ao-puce">
              {ref}
            </span>
          ))}
        </div>

        <Competences agent={a} />

        <div className="budget">
          <span className="ao-etiquette">Budget du mois</span>
          <Reste famille={a.famille} usage={a.usage} />
        </div>

        <div className="etat">
          <span className={`ao-dispo ${a.enCours ? "run" : a.occupe ? "wait" : "ok"}`}>
            <i />
            {a.enCours ? "En mission" : a.occupe ? "Affecté" : "Disponible"}
          </span>
          {a.projet && <span className="mission">{a.projet}{a.depuis ? ` · depuis ${depuis(a.depuis, maintenant)}` : ""}</span>}
          {a.enCours && (
            <button type="button" className="lien" onClick={() => onOuvrirRun(a.enCours!.run)}>
              au travail · {a.enCours.noeud}
            </button>
          )}
          {a.depuis && <span className={`mission ${projetConnu ? "text-ok" : ""}`}>{projetConnu ? "modèle appliqué aux runs" : "projet hors cockpit : sans effet sur les runs"}</span>}
        </div>

        <Affectation
          projets={projets}
          envoi={envoi}
          affecte={Boolean(a.depuis)}
          onAffecter={(projet) => onEcrire(() => source.affecter([a.id], projet))}
          onLiberer={() => onEcrire(() => source.affecter([a.id], null))}
        />
      </div>
    </article>
  );
}

/** Le portrait cliquable : une image choisie est recadrée en 120:140 dans le navigateur avant l'envoi. */
function PhotoModifiable({
  agent: a,
  niveau: n,
  envoi,
  onChanger,
}: {
  agent: MembreEquipe;
  niveau: number;
  envoi: boolean;
  onChanger: (photo: string | null) => Promise<boolean>;
}) {
  const entree = useRef<HTMLInputElement>(null);
  const [probleme, setProbleme] = useState<string | null>(null);

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setProbleme(null);
    try {
      await onChanger(await recadrer(fichier));
    } catch (err) {
      setProbleme(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="portrait">
      <button type="button" className="changer" disabled={envoi} onClick={() => entree.current?.click()} title="Changer la photo">
        <Portrait membre={a} largeur={220} />
        <span className="survol">Changer la photo</span>
        <span className="niv">NIV {n}</span>
      </button>
      <input ref={entree} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={choisir} />
      {a.photo && (
        <button type="button" className="lien retirer" disabled={envoi} onClick={() => onChanger(null)}>
          retirer la photo
        </button>
      )}
      {probleme && <p className="text-xs text-danger">{probleme}</p>}
    </div>
  );
}

const LARGEUR_PHOTO = 240;
const HAUTEUR_PHOTO = 280;

/** Recadre au centre en 240×280 et rend un JPEG en data URL : quelques dizaines de ko. */
async function recadrer(fichier: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(fichier.type)) throw new Error("image png, jpeg ou webp attendue");
  const image = await createImageBitmap(fichier);
  const echelle = Math.max(LARGEUR_PHOTO / image.width, HAUTEUR_PHOTO / image.height);
  const l = image.width * echelle;
  const h = image.height * echelle;
  const toile = document.createElement("canvas");
  toile.width = LARGEUR_PHOTO;
  toile.height = HAUTEUR_PHOTO;
  const ctx = toile.getContext("2d");
  if (!ctx) throw new Error("le navigateur ne sait pas redimensionner l'image");
  ctx.drawImage(image, (LARGEUR_PHOTO - l) / 2, (HAUTEUR_PHOTO - h) / 2, l, h);
  image.close();
  return toile.toDataURL("image/jpeg", 0.86);
}

/** Le nom en titre ; un clic sur « renommer » le passe en champ, Entrée enregistre, Échap annule. */
function NomModifiable({ agent: a, envoi, onRenommer }: { agent: MembreEquipe; envoi: boolean; onRenommer: (nom: string | null) => Promise<boolean> }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(a.nom);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (edition) champ.current?.select();
  }, [edition]);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    const nom = valeur.trim();
    if (!nom || nom === a.nom) return setEdition(false);
    if (await onRenommer(nom)) setEdition(false);
  }

  if (edition) {
    return (
      <form className="nom-edition" onSubmit={enregistrer}>
        <input
          ref={champ}
          value={valeur}
          maxLength={30}
          onChange={(e) => setValeur(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEdition(false)}
          aria-label="Nom de l'agent"
        />
        <button type="submit" className="ao-btn primaire" disabled={envoi || !valeur.trim()}>
          Enregistrer
        </button>
        <button type="button" className="ao-btn" onClick={() => setEdition(false)}>
          Annuler
        </button>
      </form>
    );
  }

  const [premier, ...reste] = a.nom.split(" ");
  return (
    <div className="nom">
      <h2>
        {premier} {reste.length > 0 && <span>{reste.join(" ")}</span>}
      </h2>
      <button
        type="button"
        className="lien"
        onClick={() => {
          setValeur(a.nom);
          setEdition(true);
        }}
      >
        renommer
      </button>
      {a.nom !== a.nomRoster && (
        <button type="button" className="lien" disabled={envoi} onClick={() => onRenommer(null)} title={`Revenir au nom du roster : ${a.nomRoster}`}>
          nom d'origine
        </button>
      )}
    </div>
  );
}

/* ---------- Compétences : la note de chaque benchmark et ce qu'il coûte ---------- */

const coutBenchmark = (b: Benchmark): string =>
  b.coutUsd === null ? "coût n/p" : `${b.coutUsd < 0.01 && b.coutUsd > 0 ? b.coutUsd.toFixed(3) : b.coutUsd.toFixed(2)} $${b.unite ? ` / ${b.unite}` : ""}`;

function Competences({ agent: a }: { agent: MembreEquipe }) {
  const c = a.competences;
  if (!c) {
    return (
      <div className="ao-competences">
        <div className="entete">
          <span className="titre">Competences</span>
        </div>
        <p className="aucune">
          {a.llm.via === "omniroute" && !a.llm.model.includes("/")
            ? "Combo OmniRoute : le modèle change d'un appel à l'autre, aucune note fixe à montrer."
            : "Aucune note publique relevée pour ce modèle (equipe/benchmarks.json)."}
        </p>
      </div>
    );
  }
  return (
    <div className="ao-competences">
      <div className="entete">
        <span className="titre">Competences</span>
        {c.prix && (
          <span className="prix" title="Prix public par million de jetons, entrée / sortie">
            {c.prix.entreeUsdParM === 0 && c.prix.sortieUsdParM === 0 ? "gratuit" : `${c.prix.entreeUsdParM} $ / ${c.prix.sortieUsdParM} $ par M jetons`}
          </span>
        )}
      </div>
      <ul>
        {c.benchmarks.map((b) => {
          const pleins = Math.round((b.score / b.max) * 10);
          return (
            <li key={b.nom} className="ao-stat">
              <span className="k" title={b.variante ? `variante ${b.variante}` : undefined}>
                {b.nom}
              </span>
              <span className="seg" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < pleins ? "on" : ""} />
                ))}
              </span>
              <span className="v">{b.max === 100 ? b.score : `${b.score}/${b.max}`}</span>
              <span className={`cout ${b.coutUsd === null ? "inconnu" : ""}`} title={b.coutUsd === null ? "La source ne publie pas le coût de ce benchmark" : "Coût publié par la source pour faire tourner le benchmark"}>
                {coutBenchmark(b)}
              </span>
              <span className={`mesure ${b.mesure}`}>
                {b.source ? (
                  <a href={b.source} target="_blank" rel="noreferrer" title={b.source}>
                    {b.mesure === "independant" ? "indép." : "éditeur"}
                  </a>
                ) : b.mesure === "independant" ? (
                  "indép."
                ) : (
                  "éditeur"
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {c.releve && <p className="releve">Notes relevées le {c.releve}. « éditeur » : chiffre annoncé par le fournisseur, non vérifié.</p>}
    </div>
  );
}

/* ---------- Affectation à un projet ---------- */

function Affectation({
  projets,
  envoi,
  affecte,
  onAffecter,
  onLiberer,
}: {
  projets: string[];
  envoi: boolean;
  affecte: boolean;
  onAffecter: (projet: string) => Promise<boolean>;
  onLiberer: () => void;
}) {
  const [cible, setCible] = useState("");
  const [nouveau, setNouveau] = useState("");
  const projet = cible === NOUVEAU ? nouveau.trim() : cible;

  return (
    <div className="actions">
      <ChoixProjet projets={projets} cible={cible} nouveau={nouveau} onCible={setCible} onNouveau={setNouveau} />
      <button
        type="button"
        className="ao-btn primaire"
        disabled={!projet || envoi}
        onClick={async () => {
          if (await onAffecter(projet)) {
            setCible("");
            setNouveau("");
          }
        }}
      >
        Assigner
      </button>
      {affecte && (
        <button type="button" className="ao-btn" disabled={envoi} onClick={onLiberer}>
          Libérer
        </button>
      )}
    </div>
  );
}

function ChoixProjet({
  projets,
  cible,
  nouveau,
  onCible,
  onNouveau,
}: {
  projets: string[];
  cible: string;
  nouveau: string;
  onCible: (v: string) => void;
  onNouveau: (v: string) => void;
}) {
  return (
    <>
      <select value={cible} onChange={(e) => onCible(e.target.value)} className="ao-champ" aria-label="Projet">
        <option value="">choisir un projet</option>
        {projets.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={NOUVEAU}>+ nouveau projet…</option>
      </select>
      {cible === NOUVEAU && (
        <input value={nouveau} onChange={(e) => onNouveau(e.target.value)} placeholder="nom du projet" maxLength={60} className="ao-champ" aria-label="Nom du nouveau projet" />
      )}
    </>
  );
}

/* ---------- Roster : une ligne par agent, affectation de plusieurs à la fois ---------- */

function Roster({
  agents,
  reponse,
  envoi,
  onEcrire,
  onOuvrir,
}: {
  agents: MembreEquipe[];
  reponse: ReponseEquipe;
  envoi: boolean;
  onEcrire: (action: () => Promise<void>) => Promise<boolean>;
  onOuvrir: (id: string) => void;
}) {
  const { source } = useSource();
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [cible, setCible] = useState("");
  const [nouveau, setNouveau] = useState("");
  const projet = cible === NOUVEAU ? nouveau.trim() : cible;

  const basculer = (id: string) =>
    setChoisis((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  return (
    <div className="ao-roster">
      {choisis.size > 0 && (
        <div className="ao-roster-lot">
          <span className="font-semibold">
            {choisis.size} agent{choisis.size > 1 ? "s" : ""} →
          </span>
          <ChoixProjet projets={reponse.projets} cible={cible} nouveau={nouveau} onCible={setCible} onNouveau={setNouveau} />
          <button
            type="button"
            className="ao-btn primaire"
            disabled={!projet || envoi}
            onClick={async () => {
              if (await onEcrire(() => source.affecter([...choisis], projet))) {
                setChoisis(new Set());
                setCible("");
                setNouveau("");
              }
            }}
          >
            Associer
          </button>
          <button type="button" className="lien" onClick={() => setChoisis(new Set())}>
            annuler
          </button>
        </div>
      )}
      <div className="ao-rentete" aria-hidden="true">
        <span />
        <span />
        <span>Agent</span>
        <span>Modèle</span>
        <span>Meilleure note</span>
        <span>Budget</span>
        <span>Disponibilité</span>
        <span>Niv.</span>
      </div>
      {agents.map((a) => {
        const r = rarete(a);
        const meilleure = a.competences?.benchmarks.reduce<Benchmark | null>((m, b) => (!m || b.score / b.max > m.score / m.max ? b : m), null) ?? null;
        return (
          <div key={a.id} className={`ao-rligne r-${r} ${choisis.has(a.id) ? "choisie" : ""}`}>
            <input type="checkbox" checked={choisis.has(a.id)} onChange={() => basculer(a.id)} aria-label={`Choisir ${a.nom}`} />
            <button type="button" className="pic" onClick={() => onOuvrir(a.id)} aria-label={`Ouvrir la fiche de ${a.nom}`}>
              <Portrait membre={a} largeur={48} />
            </button>
            <button type="button" className="qui" onClick={() => onOuvrir(a.id)}>
              <b>{a.nom}</b>
              <small>{a.role}</small>
            </button>
            <span className="mdl">
              <code title={`${a.llm.via}:${a.llm.model}`}>{a.llm.model}</code>
              <span className="ao-rarete">{RARETES[r].libelle}</span>
            </span>
            <span className="note">
              {meilleure ? (
                <>
                  <b>{meilleure.score}</b> <small>{meilleure.nom}</small>
                  <small>{coutBenchmark(meilleure)}</small>
                </>
              ) : (
                <small>pas de note</small>
              )}
            </span>
            <span>
              <Reste famille={a.famille} usage={a.usage} />
            </span>
            <span className="dispo">
              <span className={`ao-dispo ${a.enCours ? "run" : a.occupe ? "wait" : "ok"}`}>
                <i />
                {a.enCours ? "En mission" : a.occupe ? "Affecté" : "Disponible"}
              </span>
              {a.projet && <small>{a.projet}</small>}
            </span>
            <span className="niv">
              <b>{niveau(a).niveau}</b>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Le budget du mois qui reste, en équivalent API : ce n'est pas une dépense réelle sur abonnement. */
function Reste({ famille, usage }: { famille: Famille; usage: MembreEquipe["usage"] }) {
  if (famille === "codex") {
    return (
      <span className="text-[11px] text-douce" title="Codex sur abonnement ne publie pas de prix : seuls les jetons sont mesurés">
        abonnement Codex · <span className="tabular-nums text-encre">{jetons(usage.jetonsMois)}</span> jetons ce mois
      </span>
    );
  }
  if (usage.budgetMensuelUsd === null) {
    return <span className="text-[11px] text-ok">gratuit · illimité</span>;
  }
  const reste = usage.resteUsd ?? 0;
  const pourcent = usage.budgetMensuelUsd > 0 ? Math.round((reste / usage.budgetMensuelUsd) * 100) : 0;
  const niveauBudget = pourcent <= 10 ? "bg-danger" : pourcent <= 30 ? "bg-alerte" : "bg-ok";
  return (
    <div className="min-w-0 flex-1" title={`Consommé ce mois : ${usd(usage.consommeMoisUsd)} (équivalent API)`}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-douce">reste</span>
        <span className="tabular-nums">
          {usd(reste)} <span className="text-douce">/ {usd(usage.budgetMensuelUsd)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden bg-trait">
        <div className={`h-full ${niveauBudget}`} style={{ width: `${pourcent}%` }} />
      </div>
    </div>
  );
}
