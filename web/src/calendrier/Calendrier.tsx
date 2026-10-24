// Lot 12.1 : les runs planifiés, par jour de la semaine. Le programmateur du cockpit crée la
// commande à l'heure dite et le moteur la démarre dès qu'un worker et son quota le permettent.
import "./calendrier.css";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LOTS } from "../avenir/feuille";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import { lignes } from "../donnees/missions";
import { InterrupteurPrioritaire } from "../InterrupteurPrioritaire";
import { sourceCalendrierApi, sourceCalendrierMaquette, type Catalogue, type Objectif, type Priorite, type Repetition, type SourceCalendrier } from "./api";
import { dateCivile, decaler, departEnRetard, departModifiable, departsFeuille, enRetard, etatDepartFeuille, etatEntree, FUSEAU, joursDeLaSemaine, lundi, MOT_REPETITION, semaine, type DepartFeuille, type Entree } from "./semaine";

const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const titreJour = new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", day: "numeric", month: "short" });
const jourLisible = (date: string) => titreJour.format(new Date(`${date}T12:00:00Z`));
const libelleMois = new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", month: "long", year: "numeric" });

function decalerMois(date: string, mois: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + mois);
  return d.toISOString().slice(0, 10);
}

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

export function Planifier({ source, aujourdhui, onPlanifie, onFermer }: { source: SourceCalendrier; aujourdhui: string; onPlanifie: () => void; onFermer: () => void }) {
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
    const priority: Priorite = f.get("prioritaire") === "on" ? "haute" : "normale";
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
      </div>
      <InterrupteurPrioritaire name="prioritaire" />
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
      <p>{MOT_REPETITION[objectif.repetition]} à {objectif.heure} · {objectif.active ? "active" : "en pause"}</p>
    </header>
    <div className="cal-actions">
      <button type="button" className="cal-action" disabled={envoi} onClick={() => void changer({ active: !objectif.active })}>{objectif.active ? "Mettre en pause" : "Activer"}</button>
      <InterrupteurPrioritaire checked={objectif.priority === "haute"} disabled={envoi} onChange={(prioritaire) => void changer({ priority: prioritaire ? "haute" : "normale" })} />
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

const ETAPES = new Map(LOTS.flatMap((lot) => lot.etapes.map((e) => [e.id, { lot: lot.id, titre: e.titre }] as const)));

/** Un objectif de la feuille de route planifié depuis À venir : son suivi reste là-bas. */
function CarteFeuille({ depart }: { depart: DepartFeuille }) {
  const etat = etatDepartFeuille(depart);
  const etape = ETAPES.get(depart.objectifId);
  return <li>
    <a className={`cal-carte feuille ${etat.ton}`} href={`/a-venir#av-etape-${depart.objectifId}`}>
      <span className="cal-heure">{depart.heure}</span>
      <strong>{depart.objectifId} · {etape?.titre ?? "Objectif de la feuille de route"}</strong>
      <small>{depart.projetId} · À venir, lot {etape?.lot ?? "?"}</small>
      <span className={`cal-etat ${etat.ton}`}>{etat.mot}</span>
    </a>
  </li>;
}

export function Calendrier({ integre = false }: { integre?: boolean } = {}) {
  const { source: principale } = useSource();
  const source = useMemo(() => (principale.nom === "maquette" ? sourceCalendrierMaquette() : sourceCalendrierApi), [principale.nom]);
  const { objectifs, erreur, recharger } = useCalendrier(source);
  const maintenant = useHorloge(60_000);
  const aujourdhui = dateCivile(maintenant).date;
  const [dateVue, setDateVue] = useState(aujourdhui);
  const [vue, setVue] = useState<"semaine" | "mois">("semaine");
  const [choisi, setChoisi] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState(false);

  const debut = lundi(dateVue);
  const debutMois = `${dateVue.slice(0, 7)}-01`;
  const debutGrilleMois = lundi(debutMois);
  const moisAffiche = dateVue.slice(0, 7);
  const parJour = useMemo(() => semaine(objectifs ?? [], debut), [objectifs, debut]);
  const { donnees: attributions } = useCharge((s) => s.attributionsAvenir(), [objectifs]);
  const feuilleParJour = useMemo(() => departsFeuille(attributions ?? [], debut), [attributions, debut]);
  const parJourMois = useMemo(() => {
    const resultats = new Map<string, Array<Entree | DepartFeuille>>();
    for (let semaineNo = 0; semaineNo < 6; semaineNo++) {
      const semaineDebut = decaler(debutGrilleMois, semaineNo * 7);
      const runs = semaine(objectifs ?? [], semaineDebut);
      const feuille = departsFeuille(attributions ?? [], semaineDebut);
      for (const jour of joursDeLaSemaine(semaineDebut)) {
        resultats.set(jour, [...(runs.get(jour) ?? []), ...(feuille.get(jour) ?? [])].sort((a, b) => a.heure.localeCompare(b.heure)));
      }
    }
    return resultats;
  }, [objectifs, attributions, debutGrilleMois]);
  const retards = (objectifs ?? []).filter((o) => enRetard(o, maintenant));
  const actifs = (objectifs ?? []).filter((o) => o.active && o.nextAt);
  const aujourdhuiEntrees = [...(semaine(objectifs ?? [], lundi(aujourdhui)).get(aujourdhui) ?? []), ...(departsFeuille(attributions ?? [], lundi(aujourdhui)).get(aujourdhui) ?? [])];
  const selection = objectifs?.find((o) => o.id === choisi) ?? null;
  const fin = decaler(debut, 6);
  const aujourdHuiDansLaPeriode = vue === "semaine"
    ? aujourdhui >= debut && aujourdhui <= fin
    : aujourdhui.slice(0, 7) === moisAffiche;
  const datePeriode = vue === "semaine" ? debut : debutMois;
  const changerPeriode = (sens: -1 | 1) => setDateVue((date) => vue === "semaine"
    ? decaler(date, sens * 7)
    : decalerMois(date, sens));

  return <div className={`cal-page ${integre ? "cal-embarque" : ""}`}>
    {!integre && <section className="cal-hero">
      <div>
        <p className="kicker">Lot 12 · heure de Zurich</p>
        <h2>Runs planifiés</h2>
        <p>Chaque départ prévu devient une commande à son heure ; le moteur la lance dès qu'un worker et son quota sont disponibles, après les reprises interrompues.</p>
        <p>Les objectifs de la feuille de route se planifient depuis <a href="/a-venir">À venir</a> ; ils apparaissent ici à leur date.</p>
      </div>
      <dl className="cal-chiffres">
        <div><dt>Aujourd'hui</dt><dd>{aujourdhuiEntrees.length}</dd></div>
        <div><dt>Programmations actives</dt><dd>{actifs.length}</dd></div>
        <div className={retards.length ? "alerte" : ""}><dt>En retard</dt><dd>{retards.length}</dd></div>
      </dl>
    </section>}
    {integre && <dl className="cal-chiffres cal-chiffres-compact">
      <div><dt>Aujourd’hui</dt><dd>{aujourdhuiEntrees.length}</dd></div>
      <div><dt>Programmations actives</dt><dd>{actifs.length}</dd></div>
      <div className={retards.length ? "alerte" : ""}><dt>En retard</dt><dd>{retards.length}</dd></div>
    </dl>}

    <div className="cal-barre">
      <button type="button" onClick={() => changerPeriode(-1)} aria-label={vue === "semaine" ? "Semaine précédente" : "Mois précédent"}>‹</button>
      <button type="button" onClick={() => setDateVue(aujourdhui)} disabled={aujourdHuiDansLaPeriode}>{vue === "semaine" ? "Cette semaine" : "Ce mois"}</button>
      <button type="button" onClick={() => changerPeriode(1)} aria-label={vue === "semaine" ? "Semaine suivante" : "Mois suivant"}>›</button>
      <span className="cal-periode">{vue === "semaine" ? `${jourLisible(debut)} au ${jourLisible(fin)}` : libelleMois.format(new Date(`${datePeriode}T12:00:00Z`))}</span>
      <div className="cal-vues" role="group" aria-label="Affichage du calendrier">
        <button type="button" aria-pressed={vue === "semaine"} onClick={() => setVue("semaine")}>Semaine</button>
        <button type="button" aria-pressed={vue === "mois"} onClick={() => setVue("mois")}>Mois</button>
      </div>
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
    {objectifs && vue === "semaine" && <ol className="cal-semaine">
      {joursDeLaSemaine(debut).map((jour, i) => {
        const cartes = [
          ...(parJour.get(jour) ?? []).map((e) => ({ cle: e.cle, heure: e.heure, carte: <Carte key={e.cle} entree={e} choisie={choisi === e.objectif.id} onChoisir={() => setChoisi(choisi === e.objectif.id ? null : e.objectif.id)} /> })),
          ...(feuilleParJour.get(jour) ?? []).map((d) => ({ cle: d.cle, heure: d.heure, carte: <CarteFeuille key={d.cle} depart={d} /> })),
        ].sort((a, b) => a.heure.localeCompare(b.heure));
        return <li key={jour} data-calendar-date={jour} className={`cal-jour ${jour === aujourdhui ? "aujourdhui" : ""} ${jour < aujourdhui ? "passe" : ""}`}>
          <h3><span>{JOURS[i]}</span> {jourLisible(jour)}</h3>
          {cartes.length ? <ul>{cartes.map((c) => c.carte)}</ul>
            : <p className="cal-vide">Rien de prévu</p>}
        </li>;
      })}
    </ol>}
    {objectifs && vue === "mois" && <ol className="cal-mois" aria-label="Calendrier du mois">
      {JOURS.map((jour) => <li key={`entete-${jour}`} className="cal-mois-entete">{jour}</li>)}
      {Array.from({ length: 42 }, (_, index) => decaler(debutGrilleMois, index)).map((jour) => {
        const cartes = (parJourMois.get(jour) ?? []).map((entree) => "objectifId" in entree
          ? { cle: entree.cle, heure: entree.heure, carte: <CarteFeuille key={entree.cle} depart={entree} /> }
          : { cle: entree.cle, heure: entree.heure, carte: <Carte key={entree.cle} entree={entree} choisie={choisi === entree.objectif.id} onChoisir={() => setChoisi(choisi === entree.objectif.id ? null : entree.objectif.id)} /> });
        return <li key={jour} data-calendar-date={jour} className={`cal-mois-jour ${jour.slice(0, 7) !== moisAffiche ? "hors-mois" : ""} ${jour === aujourdhui ? "aujourdhui" : ""}`}>
          <h3><b>{new Date(`${jour}T12:00:00Z`).getUTCDate()}</b></h3>
          {cartes.length > 0 && <ul>{cartes.slice(0, 3).map((c) => c.carte)}</ul>}
          {cartes.length > 3 && <span className="cal-plus">+{cartes.length - 3} autres</span>}
        </li>;
      })}
    </ol>}
    {objectifs && !objectifs.length && !(attributions ?? []).some((a) => a.prevuLe) && <p className="cal-aide">Aucun run planifié. « Planifier un run » choisit un pipeline, son objectif et son heure.</p>}
    {selection && <Detail objectif={selection} source={source} onChange={() => void recharger()} />}
  </div>;
}
