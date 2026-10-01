// Les approbations métier ne sont pas celles des runs : elles tranchent un plan gelé et le
// serveur vérifie toujours son empreinte avant d'écrire la trace signée.
import { useMemo, useState } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { attente, lireAction, nomModele } from "../donnees/decisions";
import type { ConseilAction, Decision, DossierApprobation, EtatConseiller, FilConseil, SourceConseil } from "../donnees/decisions";
import { Erreur, Vide } from "../ui";

type BrouillonAction = { decision: Decision["decision"] | null; motif: string };
type Brouillon = Record<string, BrouillonAction>;

function brouillonDu(dossier: DossierApprobation): Brouillon {
  return Object.fromEntries(dossier.actions.map((action) => [action.id, { decision: action.decision, motif: action.note ?? "" }]));
}

function dateLisible(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("fr-FR");
}

function Fraicheur({ dossier }: { dossier: DossierApprobation }) {
  const { fraicheur } = dossier;
  const classe = fraicheur.verdict === "frais" ? "ok" : fraicheur.verdict === "perime" ? "err" : "";
  const libelle =
    fraicheur.verdict === "frais"
      ? "données fraîches"
      : fraicheur.verdict === "perime"
        ? "données périmées"
        : "fraîcheur inconnue";
  const age = fraicheur.age_heures === null ? null : `${fraicheur.age_heures.toFixed(1)} h`;
  return (
    <span className={`ao-liv-pastille ${classe}`} title={fraicheur.reference ?? undefined}>
      {libelle}{age ? `, ${age}` : ""}{fraicheur.max_heures === null ? "" : ` sur ${fraicheur.max_heures} h`}
    </span>
  );
}

function SourcesConseil({ sources }: { sources: SourceConseil[] }) {
  if (!sources.length) return null;
  return (
    <ul className="ao-conseil-sources" aria-label="Sources du conseiller">
      {sources.map((source) => (
        <li key={source.id}>
          <span>{source.id}</span>
          {source.titre}
          {source.chemin ? `, ${source.chemin}` : source.run ? `, ${source.run}` : ""}
        </li>
      ))}
    </ul>
  );
}

function Conseil({ conseil }: { conseil: ConseilAction }) {
  const probleme = conseil.classement === "probleme";
  return (
    <aside className={`ao-conseil ${probleme ? "probleme" : "suggestion"}`} aria-label={probleme ? "Problème détecté par le conseiller" : "Suggestion du conseiller"}>
      <header>
        <span className="ao-auteur ia">{nomModele(conseil.modele)}</span>
        <strong>{probleme ? "Problème détecté" : "Suggestion"}</strong>
        {dateLisible(conseil.le) && <time dateTime={conseil.le}>{dateLisible(conseil.le)}</time>}
      </header>
      <p>{conseil.texte}</p>
      <SourcesConseil sources={conseil.sources} />
    </aside>
  );
}

function BadgeDecision({ action }: { action: DossierApprobation["actions"][number] }) {
  if (!action.decision) return null;
  const auteur = action.decision_par ?? "identité inconnue";
  const date = dateLisible(action.decision_le);
  return (
    <div className="ao-decisions-action">
      <span className={`ao-liv-pastille ${action.decision === "approuve" ? "ok" : "err"}`}>{action.decision === "approuve" ? "approuvée" : "refusée"}</span>
      <span className="ao-auteur humain" title={date ?? undefined}>Humain · {auteur}</span>
    </div>
  );
}

function ActionPlan({ action, brouillon, modifier, verrouille }: { action: DossierApprobation["actions"][number]; brouillon: BrouillonAction; modifier: (prochain: Partial<BrouillonAction>) => void; verrouille: boolean }) {
  // Une question se lit d'abord, son rapport l'explique ; un changement de prix se lit en
  // écart chiffré. Le JSON brut ne reste que pour une forme que la page ne connaît pas.
  const lecture = lireAction(action);
  return (
    <article className="ao-approbation-action">
      <header>
        <div>
          <h3>{lecture.forme === "question" ? lecture.question : action.type}</h3>
          {action.cible && (lecture.forme !== "question" || lecture.question !== action.cible) && <p className="font-mono text-douce">{action.cible}</p>}
          <p className="font-mono text-[11px] text-douce">{action.id}</p>
        </div>
        <BadgeDecision action={action} />
      </header>
      {lecture.forme === "prix" && <p className="ao-approbation-ecart">{lecture.ecart}</p>}
      {lecture.forme === "brut"
        ? lecture.lignes.map((ligne, i) => <pre key={i} className="ao-liv-journal">{ligne}</pre>)
        : lecture.lignes.length > 0 && (
            <div className="ao-approbation-rapport">
              {lecture.lignes.map((ligne, i) => (
                <p key={i}>{ligne}</p>
              ))}
            </div>
          )}
      {lecture.forme === "question" && action.justification && <p className="text-douce">{action.justification}</p>}
      {action.sources && action.sources.length > 0 && <p className="font-mono text-[11px] text-douce">Sources : {action.sources.join(" · ")}</p>}
      {action.conseil && <Conseil conseil={action.conseil} />}
      {!verrouille && (
        <fieldset className="ao-approbation-choix">
          <legend>Décision pour cette action</legend>
          <label>
            <input type="radio" name={`decision-${action.id}`} checked={brouillon.decision === "approuve"} onChange={() => modifier({ decision: "approuve" })} />
            Approuver
          </label>
          <label>
            <input type="radio" name={`decision-${action.id}`} checked={brouillon.decision === "refuse"} onChange={() => modifier({ decision: "refuse" })} />
            Refuser
          </label>
          <button
            type="button"
            className="ao-btn"
            onClick={() => modifier({ decision: action.decision, motif: action.note ?? "" })}
            disabled={brouillon.decision === action.decision && brouillon.motif === (action.note ?? "")}
          >
            Réinitialiser
          </button>
          {brouillon.decision && (
            <label className="ao-approbation-note">
              Note facultative
              <textarea value={brouillon.motif} maxLength={500} rows={2} onChange={(event) => modifier({ motif: event.target.value })} />
            </label>
          )}
        </fieldset>
      )}
      {verrouille && action.note && <p className="ao-approbation-note-lue">Note : {action.note}</p>}
    </article>
  );
}

function EtatConseillerBadge({ conseiller }: { conseiller: EtatConseiller }) {
  if (conseiller.disponible) return <span className="ao-auteur ia">{nomModele(conseiller.modele)} connecté</span>;
  const vu = dateLisible(conseiller.vuLe);
  return <span className="ao-auteur indisponible" title={vu ?? undefined}>PC endormi{vu ? `, vu ${vu}` : ""}</span>;
}

function DiscussionConseiller({ dossier, conseiller }: { dossier: string; conseiller: EtatConseiller }) {
  const { source } = useSource();
  const [ouverte, setOuverte] = useState(false);
  const [revision, setRevision] = useState(0);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const { donnees, erreur: erreurLecture } = useCharge(
    (source) => (ouverte ? source.filConseil(dossier) : Promise.resolve<FilConseil | null>(null)),
    [dossier, ouverte, revision]
  );
  const fil = donnees;
  const etat = fil?.conseiller ?? conseiller;

  async function envoyer(): Promise<void> {
    const question = texte.trim();
    if (!question || !etat.disponible) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await source.poserConseil(dossier, question);
      setTexte("");
      setRevision((courant) => courant + 1);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <details className="ao-discussion" open={ouverte} onToggle={(event) => setOuverte(event.currentTarget.open)}>
      <summary>Discuter avec le conseiller <EtatConseillerBadge conseiller={etat} /></summary>
      {ouverte && (
        <div className="ao-discussion-contenu">
          {erreurLecture && <Erreur>{erreurLecture}</Erreur>}
          {!fil && !erreurLecture && <p className="text-douce">Lecture du fil…</p>}
          {fil?.messages.length === 0 && <p className="text-douce">Aucun échange pour ce dossier.</p>}
          {fil?.messages.map((message) => (
            <article key={message.id} className={`ao-message ${message.auteur}`}>
              <header>
                <span className={`ao-auteur ${message.auteur === "conseiller" ? "ia" : "humain"}`}>
                  {message.auteur === "conseiller" ? nomModele(message.modele) : `Humain · ${message.par ?? "identité inconnue"}`}
                </span>
                <time dateTime={message.creeLe}>{dateLisible(message.creeLe)}</time>
              </header>
              <p>{message.texte}</p>
              <SourcesConseil sources={message.sources} />
            </article>
          ))}
          {!etat.disponible && <p className="ao-discussion-indisponible">Le PC est endormi. La question ne sera pas mise en attente.</p>}
          <label className="ao-discussion-saisie">
            Question au conseiller
            <textarea value={texte} rows={3} maxLength={2000} disabled={!etat.disponible || envoi} placeholder={etat.disponible ? "Demander une vérification liée à ce dossier." : "PC endormi"} onChange={(event) => setTexte(event.target.value)} />
          </label>
          {erreur && <Erreur>{erreur}</Erreur>}
          <div className="ao-actions">
            <button type="button" className="ao-btn" disabled={!etat.disponible || !texte.trim() || envoi} onClick={envoyer}>{envoi ? "Envoi…" : "Envoyer la question"}</button>
          </div>
        </div>
      )}
    </details>
  );
}

function Dossier({ dossier, conseiller, recharger, traite }: { dossier: DossierApprobation; conseiller: EtatConseiller; recharger: () => void; traite: (message: string) => void }) {
  const { source } = useSource();
  const initial = useMemo(() => brouillonDu(dossier), [dossier]);
  const [brouillon, setBrouillon] = useState<Brouillon>(initial);
  const [reponse, setReponse] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const verrouille = dossier.plan_absent || dossier.tranche || dossier.reponse_posee !== null;
  const decisions = Object.entries(brouillon)
    .filter(([, valeur]) => valeur.decision !== null)
    .map(([action_id, valeur]) => ({ action_id, decision: valeur.decision as Decision["decision"], ...(valeur.motif.trim() ? { motif: valeur.motif.trim() } : {}) }));
  const peutEnvoyer = !verrouille && (decisions.length > 0 || Boolean(reponse.trim()));

  function modifier(actionId: string, prochain: Partial<BrouillonAction>): void {
    setConfirmation(false);
    setSucces(null);
    setBrouillon((courant): Brouillon => {
      const precedent = courant[actionId] ?? { decision: null, motif: "" };
      return {
        ...courant,
        [actionId]: {
          decision: "decision" in prochain ? prochain.decision ?? null : precedent.decision,
          motif: "motif" in prochain ? prochain.motif ?? "" : precedent.motif,
        },
      };
    });
  }

  async function envoyer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const resultat = await source.decider({
        dossier: dossier.dossier,
        empreinte: dossier.empreinte,
        decisions,
        ...(reponse.trim() ? { reponse: reponse.trim() } : {}),
      });
      const texte = resultat.reponse ? "Consigne enregistrée." : `${resultat.decisions.length} décision${resultat.decisions.length > 1 ? "s" : ""} enregistrée${resultat.decisions.length > 1 ? "s" : ""}.`;
      setSucces(texte);
      setConfirmation(false);
      // Le dossier ne disparaît que s'il est réglé : une consigne, ou toutes les actions
      // décidées. Une décision partielle laisse les actions restantes à trancher.
      if (resultat.reponse || dossier.actions.every((a) => brouillon[a.id]?.decision)) traite(`${dossier.dossier} : ${texte}`);
      recharger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="ao-liv ao-approbation" aria-labelledby={`titre-${dossier.dossier}`}>
      <header>
        <div>
          <h2 id={`titre-${dossier.dossier}`}>{dossier.dossier}</h2>
          <p className="font-mono text-[11px] text-douce">Plan {dossier.empreinte} · en attente depuis <span title={dossier.depuis}>{attente(dossier.depuis)}</span></p>
        </div>
        {dossier.tranche ? <span className="ao-liv-etat">tranché</span> : dossier.reponse_posee ? <span className="ao-liv-etat encours">consigne envoyée</span> : <span className="ao-liv-etat dispo">à trancher</span>}
      </header>

      <div className="ao-approbation-meta">
        <Fraicheur dossier={dossier} />
        {dossier.appliquer_avec && <span className="font-mono text-[11px] text-douce">Pipeline : {dossier.appliquer_avec}</span>}
        {dossier.tranche && dossier.note_vault && <span className={`ao-liv-pastille ${dossier.note_vault === "fait" ? "ok" : ""}`}>Note vault : {dossier.note_vault}</span>}
      </div>

      {dossier.plan_absent && <Erreur>Le plan gelé est introuvable. Décider à l’aveugle est refusé.</Erreur>}
      {dossier.reponse_posee && (
        <div className="ao-liv-issue ok" role="status">
          <strong>Consigne déjà enregistrée</strong>
          <span>{dossier.reponse_posee.consigne}</span>
          <span className="font-mono text-douce">{dossier.reponse_posee.par ?? "identité inconnue"}{dossier.reponse_posee.le ? ` · ${dateLisible(dossier.reponse_posee.le)}` : ""}</span>
        </div>
      )}

      {!dossier.plan_absent && dossier.actions.length === 0 && <Vide>Le plan ne contient aucune action à décider.</Vide>}
      {dossier.actions.map((action) => (
        <ActionPlan key={action.id} action={action} brouillon={brouillon[action.id] ?? { decision: null, motif: "" }} modifier={(prochain) => modifier(action.id, prochain)} verrouille={verrouille} />
      ))}

      <DiscussionConseiller dossier={dossier.dossier} conseiller={conseiller} />

      {!verrouille && (
        <label className="ao-approbation-reponse">
          Consigne au pipeline, facultative
          <textarea value={reponse} maxLength={500} rows={3} placeholder="Demander une autre proposition plutôt que trancher action par action." onChange={(event) => { setConfirmation(false); setSucces(null); setReponse(event.target.value); }} />
        </label>
      )}

      {erreur && <Erreur>{erreur}</Erreur>}
      {succes && <div className="ao-liv-issue ok" role="status"><strong>{succes}</strong></div>}
      {!verrouille && peutEnvoyer && !confirmation && (
        <div className="ao-actions">
          <button type="button" className="ao-btn primaire" onClick={() => setConfirmation(true)}>Enregistrer la décision</button>
        </div>
      )}
      {!verrouille && confirmation && (
        <div className="ao-liv-confirmation" role="group" aria-label={`Confirmer la décision pour ${dossier.dossier}`}>
          <p>Enregistrer {decisions.length ? `${decisions.length} décision${decisions.length > 1 ? "s" : ""}` : "la consigne"} pour ce plan gelé ?</p>
          <div className="ao-actions">
            <button type="button" className="ao-btn primaire" disabled={envoi} onClick={envoyer}>{envoi ? "Envoi…" : "Confirmer"}</button>
            <button type="button" className="ao-btn" disabled={envoi} onClick={() => setConfirmation(false)}>Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** `integre` : dans une colonne de la page Décisions, sans largeur propre ni centrage. */
export function Approbations({ integre = false }: { integre?: boolean }) {
  const [revision, setRevision] = useState(0);
  // Un dossier réglé quitte la liste dès l'envoi réussi, sans attendre la relecture : le
  // serveur garde les dossiers tranchés pour relecture, la page ne les montre plus.
  const [traites, setTraites] = useState<Set<string>>(new Set());
  const [dernier, setDernier] = useState<string | null>(null);
  const { donnees, erreur } = useCharge((source) => source.approbations(), [revision]);
  const cle = (d: DossierApprobation) => `${d.dossier}:${d.empreinte}`;
  const tous = donnees?.etat.dossiers ?? [];
  const dossiers = tous.filter((d) => !d.tranche && !d.reponse_posee && !traites.has(cle(d)));
  const tranches = tous.filter((d) => d.tranche);
  const conseiller: EtatConseiller = donnees?.conseiller ?? { disponible: false, vuLe: null, modele: null, vault: null };

  return (
    <div className={integre ? "flex min-w-0 flex-col gap-4" : "mx-auto flex w-full max-w-4xl flex-col gap-4 overflow-y-auto"}>
      <section className="ao-liv" aria-labelledby="titre-approbations">
        <header>
          <h2 id="titre-approbations">Approbations des pipelines</h2>
          {donnees && <span className={`ao-liv-etat ${dossiers.length ? "dispo" : ""}`}>{dossiers.length ? `${dossiers.length} à trancher` : "rien à trancher"}</span>}
        </header>
        {dernier && <div className="ao-liv-issue ok" role="status"><strong>{dernier}</strong></div>}
        <p className="text-douce">Valider, refuser ou renvoyer un plan métier avant son exécution. Chaque écriture reste liée à l’empreinte du plan affiché.</p>
        {donnees && <p className="font-mono text-[11px] text-douce">Identité : {donnees.qui.nom ?? donnees.qui.par} · {donnees.qui.canal}</p>}
        {donnees && <div className="ao-conseiller-etat"><EtatConseillerBadge conseiller={conseiller} />{conseiller.vault && <span className="font-mono text-[11px] text-douce">Vault : {conseiller.vault.fichiers} fichiers indexés</span>}</div>}
        {erreur && <Erreur>{erreur}</Erreur>}
        {!donnees && !erreur && <p className="text-douce">Lecture des approbations…</p>}
      </section>

      {donnees && !dossiers.length && <Vide>Aucun plan métier ne demande de décision.</Vide>}
      {dossiers.map((dossier) => (
        <Dossier
          key={cle(dossier)}
          dossier={dossier}
          conseiller={conseiller}
          recharger={() => setRevision((courant) => courant + 1)}
          traite={(message) => {
            setDernier(message);
            setTraites((courant) => new Set(courant).add(cle(dossier)));
          }}
        />
      ))}

      {tranches.length > 0 && (
        <section className="ao-approbations-tranchees" aria-labelledby="titre-tranchees">
          <header><h2 id="titre-tranchees">Tranchés récemment</h2><span>{tranches.length}</span></header>
          {tranches.map((dossier) => <Dossier key={cle(dossier)} dossier={dossier} conseiller={conseiller} recharger={() => setRevision((courant) => courant + 1)} traite={() => undefined} />)}
        </section>
      )}

      {donnees?.modules.erreur && <Erreur>{donnees.modules.erreur}</Erreur>}
      {donnees && donnees.modules.apps.length > 0 && (
        <section className="ao-liv" aria-labelledby="titre-modules">
          {/* Cyberpunk n'a que A–Z a–z : un titre sans accent. */}
          <header><h2 id="titre-modules">Modules</h2></header>
          <div className="ao-approbation-modules">
            {donnees.modules.apps.map((module) => (
              <article key={module.nom}>
                <h3>{module.nom}</h3>
                <p className="text-douce">{module.description ?? "Sans description."}</p>
                <p className="font-mono text-[11px] text-douce">{module.etat}{module.notes.length ? ` · ${module.notes.join(" · ")}` : ""}</p>
                {module.url && <a className="ao-btn" href={module.url}>{module.url.startsWith("/") ? "Ouvrir" : "Consulter"}</a>}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
