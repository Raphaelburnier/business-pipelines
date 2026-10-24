// Le catalogue du registre : les runs sont rendus par RunPipeline (page Run, lot 10.1).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { derniereVersion, idPipeline, nomPipeline, pipelinesEnregistres, refPipeline, type PipelineConnu, type Rattachement, type ReponsePipelines } from "../donnees/pipelines";
import { VIDE, depuis } from "../format";
import { Erreur, Vide } from "../ui";
import "./pipelines.css";

const MOTS_RATTACHEMENT: Record<Rattachement["statut"], string> = { pending: "en file", taken: "PR en cours d'ouverture", done: "PR ouverte", refused: "refusé" };

function Rattacher({ pipeline, catalogue, change }: { pipeline: PipelineConnu; catalogue: ReponsePipelines; change: () => void }) {
  const { source } = useSource();
  const [ouvert, setOuvert] = useState(false);
  const [projet, setProjet] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const demandes = catalogue.rattachements.filter((r) => idPipeline(r.pipeline) === pipeline.id);
  const enAttente = demandes.some((r) => r.statut === "pending" || r.statut === "taken");
  const dejaDemandes = new Set(demandes.filter((r) => r.statut !== "refused" && r.ok !== false).map((r) => r.projet));
  const libres = catalogue.projets.filter((p) => !pipeline.projets.includes(p.id) && !dejaDemandes.has(p.id));

  useEffect(() => {
    if (!enAttente) return;
    const minuterie = setTimeout(change, 3000);
    return () => clearTimeout(minuterie);
  }, [enAttente, catalogue, change]);

  async function proposer() {
    setEnvoi(true); setErreur(null);
    try {
      await source.rattacherPipeline(refPipeline(pipeline), projet);
      setOuvert(false); setProjet(""); change();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally { setEnvoi(false); }
  }

  return <div className="pl-rattacher">
    {catalogue.peutRattacher && !ouvert && libres.length > 0 && <button type="button" className="ao-btn" onClick={() => setOuvert(true)}>Ajouter à un projet</button>}
    {ouvert && <form className="pl-titre" onSubmit={(event) => { event.preventDefault(); if (projet) void proposer(); }}>
      <label className="sr-only" htmlFor="pl-projet">Projet</label>
      <select id="pl-projet" className="pl-champ" value={projet} onChange={(e) => setProjet(e.target.value)}>
        <option value="">Choisir un projet…</option>
        {libres.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
      </select>
      <button type="submit" className="ao-btn primaire" disabled={envoi || !projet}>Proposer la PR</button>
      <button type="button" className="ao-btn" disabled={envoi} onClick={() => setOuvert(false)}>Annuler</button>
    </form>}
    {ouvert && <p className="pl-sous">La fiche du projet reçoit ce pipeline par une PR ; il apparaît dans Missions après sa fusion et la livraison du cockpit.</p>}
    {erreur && <Erreur>{erreur}</Erreur>}
    {demandes.length > 0 && <ul className="pl-demandes">{demandes.map((r) => <li key={r.id} className={r.ok === false ? "refus" : ""}>
      <span>{r.pipeline} → {r.projet}</span><small>{r.ok === false ? `refusé : ${r.raison}` : MOTS_RATTACHEMENT[r.statut]}{r.pr && <> · <a href={r.pr.url} target="_blank" rel="noreferrer">PR #{r.pr.numero}</a></>}</small>
    </li>)}</ul>}
  </div>;
}

function EnTete({ pipeline, catalogue, renomme }: { pipeline: PipelineConnu; catalogue: ReponsePipelines; renomme: () => void }) {
  const { source } = useSource();
  const [edition, setEdition] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const connus = useMemo(() => new Map(catalogue.pipelines.map((p) => [p.id, p])), [catalogue]);
  const nom = nomPipeline(pipeline.id, connus);
  async function enregistrer(valeur: string | null) {
    setEnvoi(true); setErreur(null);
    try { await source.renommerPipeline(pipeline.id, valeur); setEdition(null); renomme(); }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  return <div className="pl-entete">
    {edition === null ? <div className="pl-titre"><h2>{nom}</h2><button type="button" className="ao-btn" onClick={() => setEdition(pipeline.perso ? nom : "")}>Renommer</button></div> :
      <form className="pl-titre" onSubmit={(event) => { event.preventDefault(); if (edition.trim()) void enregistrer(edition); }}>
        <label className="sr-only" htmlFor="pl-nom">Nom du pipeline</label>
        <input id="pl-nom" className="pl-champ" value={edition} maxLength={60} placeholder={pipeline.titreRegistre ?? nom} onChange={(e) => setEdition(e.target.value)} autoFocus />
        <button type="submit" className="ao-btn primaire" disabled={envoi || !edition.trim()}>Enregistrer</button>
        {pipeline.perso && <button type="button" className="ao-btn" disabled={envoi} onClick={() => void enregistrer(null)}>Nom d'origine</button>}
        <button type="button" className="ao-btn" disabled={envoi} onClick={() => setEdition(null)}>Annuler</button>
      </form>}
    <p className="pl-sous"><code>{pipeline.id} v{derniereVersion(pipeline)}</code> · {pipeline.projets.length ? `utilisé par ${pipeline.projets.join(", ")}` : "aucun projet"} · {pipeline.runs} run{pipeline.runs > 1 ? "s" : ""}</p>
    {erreur && <Erreur>{erreur}</Erreur>}
    <Rattacher pipeline={pipeline} catalogue={catalogue} change={renomme} />
  </div>;
}

export function Pipelines({ pipelineId, aller }: { pipelineId: string | null; aller: (href: string) => void }) {
  const [relecture, setRelecture] = useState(0);
  const relire = useCallback(() => setRelecture((n) => n + 1), []);
  const { donnees: catalogue, erreur } = useCharge((s) => s.pipelines(), [relecture]);
  const enregistres = useMemo(() => pipelinesEnregistres(catalogue?.pipelines ?? []), [catalogue]);
  const connus = useMemo(() => new Map((catalogue?.pipelines ?? []).map((p) => [p.id, p])), [catalogue]);
  const choisi = enregistres.find((p) => p.id === pipelineId) ?? enregistres[0] ?? null;
  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!catalogue) return <p className="text-douce">Chargement du catalogue…</p>;
  if (!enregistres.length) return <Vide>Aucun pipeline enregistré : le registre ne publie encore aucune version.</Vide>;
  const versions = enregistres.reduce((total, pipeline) => total + pipeline.versions.length, 0);
  const projets = new Set(enregistres.flatMap((pipeline) => pipeline.projets)).size;
  return <div className="pl-ecran pl-catalogue">
    <p className="pl-resume">{enregistres.length} pipelines enregistrés · {versions} versions publiées · {projets} projets servis</p>
    <nav className="pl-liste" aria-label="Pipelines enregistrés">
      {enregistres.map((pipeline) => <a key={pipeline.id} href={`/pipelines/${encodeURIComponent(pipeline.id)}`} aria-current={pipeline.id === choisi?.id ? "page" : undefined} className={pipeline.id === choisi?.id ? "on" : ""} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); aller(`/pipelines/${encodeURIComponent(pipeline.id)}`);
      }}><b>{nomPipeline(pipeline.id, connus)}</b><small>{pipeline.projets.length ? `utilisé par ${pipeline.projets.join(", ")}` : "aucun projet"} · {pipeline.runs} run{pipeline.runs > 1 ? "s" : ""}</small><small className="pl-ref">{pipeline.id} v{derniereVersion(pipeline)}</small></a>)}
    </nav>
    {choisi && <section className="pl-centre" aria-label="Fiche du pipeline">
      <EnTete pipeline={choisi} catalogue={catalogue} renomme={relire} />
      <div className="ao-kpis pl-stats" role="group" aria-label="Indicateurs du pipeline">
        <div className="ao-kpi"><span className="k">Versions</span><span className="v pl-versions">{choisi.versions.map((v) => <span key={v} className={v === derniereVersion(choisi) ? "on" : ""}>v{v}</span>)}</span></div>
        <div className="ao-kpi"><span className="k">Projets</span><span className="v">{choisi.projets.length || VIDE}</span></div>
        <div className="ao-kpi"><span className="k">Runs</span><span className="v">{choisi.runs}</span></div>
        <div className="ao-kpi"><span className="k">Dernier run</span><span className="v">{choisi.dernierRun ? depuis(choisi.dernierRun) : VIDE}</span></div>
      </div>
    </section>}
  </div>;
}
