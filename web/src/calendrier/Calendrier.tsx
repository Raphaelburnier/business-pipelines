// Lot 12.1 : les runs planifiés, par jour de la semaine. Le programmateur du cockpit crée la
// commande à l'heure dite et le moteur la démarre dès qu'un worker et son quota le permettent.
import "./calendrier.css";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useHorloge, useSource } from "../donnees/contexte";
import { lignes } from "../donnees/missions";
import { sourceCalendrierApi, sourceCalendrierMaquette, type Catalogue, type Objectif, type Priorite, type Repetition, type SourceCalendrier } from "./api";
import { dateCivile, decaler, departEnRetard, departModifiable, enRetard, etatEntree, FUSEAU, joursDeLaSemaine, lundi, MOT_REPETITION, semaine, type Entree } from "./semaine";

const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const MOT_PRIORITE: Record<Priorite, string> = { haute: "haute", normale: "normale", basse: "basse" };
const titreJour = new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", day: "numeric", month: "short" });
const jourLisible = (date: string) => titreJour.format(new Date(`${date}T12:00:00Z`));

function useCalendrier(source: SourceCalendrier) {
  const [objectifs, setObjectifs] = useState<Objectif[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const recharger = useCallback(async () => {
    try { setObjectifs(await source.objectifs()); setErreur(null); }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
  }, [source]);
  useEffect(() => {
    void recharger();
    // Les départs changent d'état sans action ici : run lancé, quota épuisé, run terminé.
    const minuterie = window.setInterval(() => void recharger(), 30_000);
    return () => window.clearInterval(minuterie);
  }, [recharger]);
  return { objectifs, erreur, recharger };
}

function Planifier({ source, aujourdhui, onPlanifie, onFermer }: { source: SourceCalendrier; aujourdhui: string; onPlanifie: () => void; onFermer: () => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [projet, setProjet] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Un même envoi rejoué après une coupure réseau garde son identifiant : pas de doublon.
  const tentative = useRef<{ empreinte: string; requestId: string } | null>(null);
  useEffect(() => {
    source.catalogue().then((c) => { setCatalogue(c); setProjet((p) => p || c.projets[0]?.id || ""); }, (err: unknown) => setErreur(err instanceof Error ? err.message : String(err)));
  }, [source]);
  const modeles = catalogue?.modeles.filter((m) => m.projectId === projet) ?? [];

  async function envoyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const modele = modeles.find((m) => m.id === f.get("modele"));
    const criteres = lignes(String(f.get("criteres") || ""));
    const objectif = String(f.get("objectif") || "").trim();
    if (!modele) { setErreur("Choisis le pipeline à lancer."); return; }
    if (!objectif || !criteres.length) { setErreur("Décris l'objectif et au moins un critère de réussite."); return; }
    const calendrier = { date: String(f.get("date")), heure: String(f.get("heure") || "00:00"), repetition: String(f.get("repetition")) as Repetition, active: f.get("active") === "on" };
    const brouillon = { projectId: modele.projectId, graph: modele.graph, assignments: modele.assignments, baseRef: modele.baseRef };
    const priority = String(f.get("priorite")) as Priorite;
    const empreinte = JSON.stringify({ brouillon, objectif, criteres, priority, calendrier });
    if (tentative.current?.empreinte !== empreinte) tentative.current = { empreinte, requestId: crypto.randomUUID() };
    setErreur(null); setEnvoi(true);
    try {
      await source.planifier({ requestId: tentative.current.requestId, brouillon, objectif, criteres, priority, calendrier });
      tentative.current = null;
      onPlanifie();
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }

  const prochaineHeure = `${String((Number(dateCivile(Date.now()).heure.slice(0, 2)) + 1) % 24).padStart(2, "0")}:00`;
  return <form className="cal-form" onSubmit={envoyer}>
    <header><h3>Planifier un run</h3><button type="button" className="cal-lien" onClick={onFermer}>Fermer</button></header>
    {!catalogue && !erreur && <p className="cal-aide">Chargement des projets et pipelines…</p>}
    {catalogue && <>
      <div className="cal-champs">
        <label>Projet<select name="projet" value={projet} onChange={(e) => setProjet(e.target.value)}>
          {catalogue.projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select></label>
        <label>Pipeline<select name="modele" key={projet}>
          {modeles.map((m) => <option key={`${m.id}@${m.version}`} value={m.id}>{m.graph.title || m.graph.name}{m.origine === "personnel" ? " (personnel)" : ""}</option>)}
        </select></label>
        <label>Priorité<select name="priorite" defaultValue="normale">
          <option value="haute">Haute</option><option value="normale">Normale</option><option value="basse">Basse</option>
        </select></label>
      </div>
      {!modeles.length && <p className="cal-aide">Aucun pipeline rattaché à ce projet.</p>}
      <label>Objectif<textarea name="objectif" rows={2} required placeholder="Ce que le run doit produire" /></label>
      <label>Critères de réussite<textarea name="criteres" rows={2} required placeholder="Un critère par ligne" /></label>
      <div className="cal-champs">
        <label>Date<input type="date" name="date" defaultValue={aujourdhui} min={aujourdhui} required /></label>
        <label>Heure ({FUSEAU}, facultative : minuit si vide)<input type="time" name="heure" defaultValue={prochaineHeure} /></label>
        <label>Répétition<select name="repetition" defaultValue="none">
          {(Object.keys(MOT_REPETITION) as Repetition[]).map((r) => <option key={r} value={r}>{MOT_REPETITION[r]}</option>)}
        </select></label>
      </div>
      <label className="cal-case"><input type="checkbox" name="active" defaultChecked /> Activer : le moteur lancera le run à l'heure dite</label>
      {!!catalogue.erreurs.length && <details className="cal-aide"><summary>{catalogue.erreurs.length} élément(s) du registre illisible(s)</summary><ul>{catalogue.erreurs.map((e) => <li key={e}>{e}</li>)}</ul></details>}
      <button type="submit" className="cal-action" disabled={envoi || !modeles.length}>{envoi ? "Planification…" : "Planifier"}</button>
    </>}
    {erreur && <p className="cal-erreur" role="alert">{erreur}</p>}
  </form>;
}

function Detail({ objectif, source, onChange }: { objectif: Objectif; source: SourceCalendrier; onChange: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const instant = departModifiable(objectif);
  const prochain = instant ? dateCivile(instant) : null;
  async function changer(changement: Omit<Parameters<SourceCalendrier["modifier"]>[1], "revision">) {
    setErreur(null); setEnvoi(true);
    try { await source.modifier(objectif.id, { revision: objectif.revision, ...changement }); onChange(); }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); onChange(); }
    finally { setEnvoi(false); }
  }
  function deplacer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void changer({ date: String(f.get("date")), heure: String(f.get("heure")) });
  }
  return <section className="cal-detail" aria-label={`Détail de ${objectif.titre}`}>
    <header>
      <p className="kicker">{objectif.projectId} · {objectif.brouillon.graph.title || objectif.brouillon.graph.name}</p>
      <h3>{objectif.titre}</h3>
      <p>{MOT_REPETITION[objectif.repetition]} à {objectif.heure} · priorité {MOT_PRIORITE[objectif.priority]} · {objectif.active ? "active" : "en pause"}</p>
    </header>
    <div className="cal-actions">
      <button type="button" className="cal-action" disabled={envoi} onClick={() => void changer({ active: !objectif.active })}>{objectif.active ? "Mettre en pause" : "Activer"}</button>
      <label>Priorité<select value={objectif.priority} disabled={envoi} onChange={(e) => void changer({ priority: e.target.value as Priorite })}>
        <option value="haute">Haute</option><option value="normale">Normale</option><option value="basse">Basse</option>
      </select></label>
    </div>
    {prochain && <form className="cal-champs" onSubmit={deplacer} key={objectif.revision}>
      <label>Prochain départ<input type="date" name="date" defaultValue={prochain.date} required /></label>
      <label>Heure<input type="time" name="heure" defaultValue={prochain.heure} required /></label>
      <button type="submit" className="cal-lien" disabled={envoi}>Déplacer</button>
    </form>}
    {!prochain && <p className="cal-aide">Plus aucun départ prévu.</p>}
    {erreur && <p className="cal-erreur" role="alert">{erreur}</p>}
    <h4>Critères</h4>
    <ul>{objectif.criteres.map((c) => <li key={c}>{c}</li>)}</ul>
    <h4>Départs</h4>
    {!objectif.occurrences.length && <p className="cal-aide">Aucun départ pour l'instant.</p>}
    <ul className="cal-historique">{objectif.occurrences.map((o) => {
      const quand = dateCivile(o.scheduledAt);
      const etat = etatEntree({ cle: o.id, objectif, date: quand.date, heure: quand.heure, genre: "lance", occurrence: o });
      return <li key={o.id}>
        <span>{jourLisible(quand.date)} {quand.heure}</span>
        <span className={`cal-etat ${etat.ton}`}>{etat.mot}</span>
        {o.runId ? <a href={`/runs/${encodeURIComponent(o.runId)}`}>Run {o.runId.slice(0, 8)}</a> : <span>Commande {o.commandId.slice(0, 8)}</span>}
        {o.raison && <span className="cal-raison">{o.raison}</span>}
        {o.attente?.prochaineReprise && <span className="cal-raison">reprise prévue {new Date(o.attente.prochaineReprise).toLocaleString("fr-CH", { timeZone: FUSEAU })}</span>}
        {o.attente?.raisonManuelle && <span className="cal-raison">{o.attente.raisonManuelle}</span>}
      </li>;
    })}</ul>
  </section>;
}

function Carte({ entree, choisie, onChoisir }: { entree: Entree; choisie: boolean; onChoisir: () => void }) {
  const etat = etatEntree(entree);
  return <li>
    <button type="button" className={`cal-carte ${etat.ton} ${entree.genre}`} aria-pressed={choisie} onClick={onChoisir}>
      <span className="cal-heure">{entree.heure}</span>
      <strong>{entree.objectif.titre}</strong>
      <small>{entree.objectif.projectId}{entree.objectif.repetition !== "none" ? ` · ${MOT_REPETITION[entree.objectif.repetition]}` : ""}</small>
      <span className={`cal-etat ${etat.ton}`}>{etat.mot}</span>
      {entree.occurrence?.raison && <small className="cal-raison">{entree.occurrence.raison}</small>}
    </button>
  </li>;
}

export function Calendrier() {
  const { source: principale } = useSource();
  const source = useMemo(() => (principale.nom === "maquette" ? sourceCalendrierMaquette() : sourceCalendrierApi), [principale.nom]);
  const { objectifs, erreur, recharger } = useCalendrier(source);
  const maintenant = useHorloge(60_000);
  const aujourdhui = dateCivile(maintenant).date;
  const [debut, setDebut] = useState(() => lundi(aujourdhui));
  const [choisi, setChoisi] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState(false);

  const parJour = useMemo(() => semaine(objectifs ?? [], debut), [objectifs, debut]);
  const retards = (objectifs ?? []).filter((o) => enRetard(o, maintenant));
  const actifs = (objectifs ?? []).filter((o) => o.active && o.nextAt);
  const aujourdhuiEntrees = semaine(objectifs ?? [], lundi(aujourdhui)).get(aujourdhui) ?? [];
  const selection = objectifs?.find((o) => o.id === choisi) ?? null;
  const fin = decaler(debut, 6);

  return <div className="cal-page">
    <section className="cal-hero">
      <div>
        <p className="kicker">Lot 12 · heure de Zurich</p>
        <h2>Runs planifiés</h2>
        <p>Chaque départ prévu devient une commande à son heure ; le moteur la lance dès qu'un worker et son quota sont disponibles, après les reprises interrompues.</p>
      </div>
      <dl className="cal-chiffres">
        <div><dt>Aujourd'hui</dt><dd>{aujourdhuiEntrees.length}</dd></div>
        <div><dt>Programmations actives</dt><dd>{actifs.length}</dd></div>
        <div className={retards.length ? "alerte" : ""}><dt>En retard</dt><dd>{retards.length}</dd></div>
      </dl>
    </section>

    <div className="cal-barre">
      <button type="button" onClick={() => setDebut(decaler(debut, -7))} aria-label="Semaine précédente">‹</button>
      <button type="button" onClick={() => setDebut(lundi(aujourdhui))} disabled={debut === lundi(aujourdhui)}>Cette semaine</button>
      <button type="button" onClick={() => setDebut(decaler(debut, 7))} aria-label="Semaine suivante">›</button>
      <span className="cal-periode">{jourLisible(debut)} au {jourLisible(fin)}</span>
      <button type="button" className="cal-action" onClick={() => setFormulaire((v) => !v)} aria-expanded={formulaire}>Planifier un run</button>
    </div>

    {formulaire && <Planifier source={source} aujourdhui={aujourdhui} onFermer={() => setFormulaire(false)} onPlanifie={() => { setFormulaire(false); void recharger(); }} />}
    {erreur && <p className="cal-erreur" role="alert">Calendrier indisponible : {erreur}</p>}
    {!!retards.length && <section className="cal-retards" aria-label="Départs en retard">
      <h3>En retard</h3>
      <p className="cal-aide">L'heure prévue est passée et le travail attend encore son résultat. Ouvre son détail pour voir son état et ses blocages.</p>
      <ul>{retards.map((o) => <li key={o.id}><button type="button" className="cal-lien" onClick={() => setChoisi(o.id)}>{o.titre}</button> prévu {new Date(departEnRetard(o, maintenant)!).toLocaleString("fr-CH", { timeZone: FUSEAU })}</li>)}</ul>
    </section>}

    {objectifs === null && !erreur && <p className="cal-aide">Chargement du calendrier…</p>}
    {objectifs && <ol className="cal-semaine">
      {joursDeLaSemaine(debut).map((jour, i) => {
        const entrees = parJour.get(jour) ?? [];
        return <li key={jour} className={`cal-jour ${jour === aujourdhui ? "aujourdhui" : ""} ${jour < aujourdhui ? "passe" : ""}`}>
          <h3><span>{JOURS[i]}</span> {jourLisible(jour)}</h3>
          {entrees.length ? <ul>{entrees.map((e) => <Carte key={e.cle} entree={e} choisie={choisi === e.objectif.id} onChoisir={() => setChoisi(choisi === e.objectif.id ? null : e.objectif.id)} />)}</ul>
            : <p className="cal-vide">Rien de prévu</p>}
        </li>;
      })}
    </ol>}
    {objectifs && !objectifs.length && <p className="cal-aide">Aucun run planifié. « Planifier un run » choisit un pipeline, son objectif et son heure.</p>}
    {selection && <Detail objectif={selection} source={source} onChange={() => void recharger()} />}
  </div>;
}
