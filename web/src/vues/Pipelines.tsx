// Le catalogue du registre : la liste des pipelines enregistrés à gauche, la fiche du pipeline
// choisi à droite (nom, rattachement à un projet, versions, résultats par version). Les runs
// eux-mêmes sont rendus par la page Run.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bouton } from "../composants/Bouton";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { Tableau, type Colonne } from "../composants/Tableau";
import { useToasts } from "../composants/Toasts";
import { suivreLien } from "../coquille/Navigation";
import { useCharge, useSource } from "../donnees/contexte";
import { lireErreur } from "../donnees/erreurs";
import { derniereVersion, idPipeline, nomPipeline, pipelinesEnregistres, refPipeline, type PipelineConnu, type Rattachement, type ReponsePipelines } from "../donnees/pipelines";
import { VIDE, depuis } from "../format";
import type { ResultatVersion } from "../types";
import { Erreur } from "../ui";
import "./pipelines.css";

const MOTS_RATTACHEMENT: Record<Rattachement["statut"], string> = { pending: "en file", taken: "PR en cours d'ouverture", done: "PR ouverte", refused: "refusé" };

function Rattacher({ pipeline, catalogue, change }: { pipeline: PipelineConnu; catalogue: ReponsePipelines; change: () => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const [ouvert, setOuvert] = useState(false);
  const [projet, setProjet] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const demandes = catalogue.rattachements.filter((r) => idPipeline(r.pipeline) === pipeline.id);
  const enAttente = demandes.some((r) => r.statut === "pending" || r.statut === "taken");
  const dejaDemandes = new Set(demandes.filter((r) => r.statut !== "refused" && r.ok !== false).map((r) => r.projet));
  const libres = catalogue.projets.filter((p) => !pipeline.projets.includes(p.id) && !dejaDemandes.has(p.id));

  // Le publieur sert la commande en quelques secondes ; la fiche relit jusqu'à la PR.
  useEffect(() => {
    if (!enAttente) return;
    const minuterie = setTimeout(change, 3000);
    return () => clearTimeout(minuterie);
  }, [enAttente, catalogue, change]);

  async function proposer() {
    setErreur(null);
    try {
      await source.rattacherPipeline(refPipeline(pipeline), projet);
      toasts.succes(`Rattachement à ${catalogue.projets.find((p) => p.id === projet)?.nom ?? projet} demandé : le publieur ouvre la PR.`);
      setOuvert(false);
      setProjet("");
      change();
    } catch (err) {
      setErreur(lireErreur(err).message);
    }
  }

  return (
    <div className="pl-rattacher">
      {catalogue.peutRattacher && !ouvert && libres.length > 0 && <Bouton onClick={() => setOuvert(true)}>Ajouter à un projet</Bouton>}
      {ouvert && (
        <form
          className="pl-titre"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="sr-only" htmlFor="pl-projet">
            Projet
          </label>
          <select id="pl-projet" className="ao-champ pl-champ" value={projet} onChange={(e) => setProjet(e.target.value)}>
            <option value="">Choisir un projet…</option>
            {libres.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
          <Bouton variante="primaire" disabled={!projet} libelleEnCours="Envoi…" onClick={() => proposer()}>
            Proposer la PR
          </Bouton>
          <Bouton variante="fantome" onClick={() => setOuvert(false)}>
            Annuler
          </Bouton>
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

function EnTete({ pipeline, catalogue, renomme }: { pipeline: PipelineConnu; catalogue: ReponsePipelines; renomme: () => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const [edition, setEdition] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const connus = useMemo(() => new Map(catalogue.pipelines.map((p) => [p.id, p])), [catalogue]);
  const nom = nomPipeline(pipeline.id, connus);

  async function enregistrer(valeur: string | null) {
    setErreur(null);
    try {
      await source.renommerPipeline(pipeline.id, valeur);
      setEdition(null);
      renomme();
      toasts.succes(valeur ? `Pipeline renommé « ${valeur.trim()} ».` : "Le pipeline reprend le titre du registre.");
    } catch (err) {
      setErreur(lireErreur(err).message);
    }
  }

  return (
    <div className="pl-entete">
      {edition === null ? (
        <div className="pl-titre">
          <h2>{nom}</h2>
          <Bouton taille="petit" variante="fantome" onClick={() => setEdition(pipeline.perso ? nom : "")}>
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
          <input id="pl-nom" className="ao-champ pl-champ" value={edition} maxLength={60} placeholder={pipeline.titreRegistre ?? nom} onChange={(e) => setEdition(e.target.value)} autoFocus />
          <Bouton variante="primaire" disabled={!edition.trim()} libelleEnCours="Enregistrement…" onClick={() => (edition.trim() ? enregistrer(edition) : undefined)}>
            Enregistrer
          </Bouton>
          {pipeline.perso && (
            <Bouton onClick={() => enregistrer(null)} title="Revenir au titre du registre">
              Nom d'origine
            </Bouton>
          )}
          <Bouton variante="fantome" onClick={() => setEdition(null)}>
            Annuler
          </Bouton>
        </form>
      )}
      <p className="pl-sous">
        <code>
          {pipeline.id} v{derniereVersion(pipeline)}
        </code>
        <span>{pipeline.projets.length ? `utilisé par ${pipeline.projets.join(", ")}` : "aucun projet"}</span>
        <span>
          {pipeline.runs} run{pipeline.runs > 1 ? "s" : ""}
        </span>
      </p>
      {erreur && <Erreur>{erreur}</Erreur>}
      <Rattacher pipeline={pipeline} catalogue={catalogue} change={renomme} />
    </div>
  );
}

const POURCENT = new Intl.NumberFormat("fr-CH", { style: "percent", maximumFractionDigits: 0 });
const DOLLARS = new Intl.NumberFormat("fr-CH", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const numeroVersion = (v: ResultatVersion) => Number(v.pipeline.match(/@(\d+)$/)?.[1] ?? 0);
/** Un nombre absent passe après tous les autres, dans les deux sens de tri. */
const parNombre = (f: (v: ResultatVersion) => number | null) => (a: ResultatVersion, b: ResultatVersion) => (f(a) ?? -Infinity) - (f(b) ?? -Infinity);

const COLONNES_RESULTATS: ReadonlyArray<Colonne<ResultatVersion>> = [
  { cle: "version", titre: "Version", rendu: (v) => <b>v{numeroVersion(v) || "?"}</b>, tri: parNombre(numeroVersion) },
  {
    cle: "runs",
    titre: "Runs",
    rendu: (v) => (
      <span>
        {v.runs}
        <small className="block text-[12px] text-douce">
          {v.reussis} réussi{v.reussis > 1 ? "s" : ""}, {v.echecs} en échec{v.annules ? `, ${v.annules} annulé${v.annules > 1 ? "s" : ""}` : ""}
          {v.enCours ? `, ${v.enCours} en cours` : ""}
        </small>
      </span>
    ),
    tri: parNombre((v) => v.runs),
  },
  { cle: "reussite", titre: "Réussite", alignement: "droite", rendu: (v) => (v.tauxReussite === null ? VIDE : POURCENT.format(v.tauxReussite)), tri: parNombre((v) => v.tauxReussite) },
  { cle: "duree", titre: "Durée médiane", alignement: "droite", rendu: (v) => (v.dureeMedianeMinutes === null ? VIDE : `${Math.round(v.dureeMedianeMinutes)} min`), tri: parNombre((v) => v.dureeMedianeMinutes) },
  {
    cle: "corrections",
    titre: "Corrections",
    alignement: "droite",
    rendu: (v) => (v.correctionsMoyennes === null ? VIDE : v.correctionsMoyennes.toLocaleString("fr-CH", { maximumFractionDigits: 1 })),
    tri: parNombre((v) => v.correctionsMoyennes),
  },
  { cle: "cout", titre: "Coût moyen", alignement: "droite", rendu: (v) => (v.coutEquivalentMoyenUsd === null ? VIDE : DOLLARS.format(v.coutEquivalentMoyenUsd)), tri: parNombre((v) => v.coutEquivalentMoyenUsd) },
];

// Une ligne par version du pipeline choisi : de quoi dire si la dernière fait mieux que la
// précédente. Le taux ignore les runs annulés ; durée, corrections et coût ne portent que sur
// les runs terminés.
function ResultatsParVersion({ pipelineId }: { pipelineId: string }) {
  const { donnees, erreur, detail, recharger } = useCharge((s) => s.resultatsPipelines(), []);
  const lignes = (donnees?.versions ?? []).filter((v) => v.pipeline.replace(/@\d+$/, "") === pipelineId);
  return (
    <section className="pl-resultats" aria-label="Résultats par version">
      <h3>
        Résultats par version {donnees && <small>sur {donnees.jours} jours</small>}
      </h3>
      {erreur && !donnees ? (
        <EtatErreur titre="Résultats illisibles" message={erreur} detail={detail} onReessayer={recharger} />
      ) : !donnees ? (
        <Squelette lignes={3} libelle="Chargement des résultats…" />
      ) : (
        <Tableau
          libelle="Résultats par version"
          colonnes={COLONNES_RESULTATS}
          lignes={lignes}
          cleLigne={(v) => v.pipeline}
          triInitial={{ cle: "version", sens: "decroissant" }}
          vide={<EtatVide message="Aucun run de ce pipeline sur la période" detail="Les résultats apparaissent après le premier run terminé." />}
        />
      )}
      <p className="pl-sous">Taux calculé sans les runs annulés. Coût en équivalent API, pas en dépense.</p>
    </section>
  );
}

export function Pipelines({ pipelineId, aller }: { pipelineId: string | null; aller: (href: string) => void }) {
  const [relecture, setRelecture] = useState(0);
  const relire = useCallback(() => setRelecture((n) => n + 1), []);
  const { donnees: catalogue, erreur, detail, recharger } = useCharge((s) => s.pipelines(), [relecture]);
  const enregistres = useMemo(() => pipelinesEnregistres(catalogue?.pipelines ?? []), [catalogue]);
  const connus = useMemo(() => new Map((catalogue?.pipelines ?? []).map((p) => [p.id, p])), [catalogue]);
  // Sans identifiant dans l'adresse, la fiche montre le premier pipeline lu, et le garde :
  // renommer un pipeline change l'ordre de la liste, pas la fiche ouverte.
  const premier = useRef<string | null>(null);
  if (!premier.current && enregistres[0]) premier.current = enregistres[0].id;
  const choisi = enregistres.find((p) => p.id === pipelineId) ?? enregistres.find((p) => p.id === premier.current) ?? enregistres[0] ?? null;
  if (erreur && !catalogue) return <EtatErreur titre="Lecture du catalogue impossible" message={erreur} detail={detail} onReessayer={recharger} />;
  if (!catalogue) return <Squelette lignes={6} libelle="Chargement du catalogue…" className="rounded-xl border border-trait bg-surface p-4" />;
  if (!enregistres.length) return <EtatVide icone="pipeline" message="Aucun pipeline enregistré" detail="Le registre ne publie encore aucune version. Un pipeline apparaît ici dès sa première version publiée." />;
  const versions = enregistres.reduce((total, pipeline) => total + pipeline.versions.length, 0);
  const projets = new Set(enregistres.flatMap((pipeline) => pipeline.projets)).size;
  return (
    <div className="pl-ecran pl-catalogue">
      <p className="pl-resume">
        {enregistres.length} pipelines enregistrés · {versions} versions publiées · {projets} projets servis
      </p>
      <nav className="pl-liste" aria-label="Pipelines enregistrés">
        {enregistres.map((pipeline) => {
          const href = `/pipelines/${encodeURIComponent(pipeline.id)}`;
          return (
            <a key={pipeline.id} href={href} aria-current={pipeline.id === choisi?.id ? "page" : undefined} className={pipeline.id === choisi?.id ? "on" : ""} onClick={suivreLien(aller, href)}>
              <b>{nomPipeline(pipeline.id, connus)}</b>
              <small>
                {pipeline.projets.length ? `utilisé par ${pipeline.projets.join(", ")}` : "aucun projet"} · {pipeline.runs} run{pipeline.runs > 1 ? "s" : ""}
              </small>
              <small className="pl-ref">
                {pipeline.id} v{derniereVersion(pipeline)}
              </small>
            </a>
          );
        })}
      </nav>
      {choisi && (
        <section className="pl-centre" aria-label="Fiche du pipeline">
          <EnTete pipeline={choisi} catalogue={catalogue} renomme={relire} />
          <div className="ao-kpis pl-stats" role="group" aria-label="Indicateurs du pipeline">
            <div className="ao-kpi">
              <span className="k">Versions</span>
              <span className="v pl-versions">
                {choisi.versions.map((v) => (
                  <span key={v} className={v === derniereVersion(choisi) ? "on" : ""}>
                    v{v}
                  </span>
                ))}
              </span>
            </div>
            <div className="ao-kpi">
              <span className="k">Projets</span>
              <span className="v">{choisi.projets.length || VIDE}</span>
            </div>
            <div className="ao-kpi">
              <span className="k">Runs</span>
              <span className="v">{choisi.runs}</span>
            </div>
            <div className="ao-kpi">
              <span className="k">Dernier run</span>
              <span className="v">{choisi.dernierRun ? `il y a ${depuis(choisi.dernierRun)}` : VIDE}</span>
            </div>
          </div>
          <ResultatsParVersion pipelineId={choisi.id} />
        </section>
      )}
    </div>
  );
}
