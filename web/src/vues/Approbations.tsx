// Les dossiers d'approbation, ouverts dans la file des décisions. Les approbations métier ne
// sont pas celles des runs : elles tranchent un plan gelé et le serveur vérifie toujours son
// empreinte avant d'écrire la trace signée.
import { useEffect, useMemo, useState } from "react";
import { useSource } from "../donnees/contexte";
import { lireAction } from "../donnees/decisions";
import type { Decision, DemandeDecisionRun, DossierApprobation, RapportApprobationRun, ReponseApprobations } from "../donnees/decisions";
import { ActionConfirmee } from "../composants/ActionConfirmee";
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

// Le rapport d'impact d'une approbation de run : une rallonge de budget, ou ce qu'un nœud
// `approval` a demandé de peser. Chaque champ est facultatif, l'ordre est celui où on le lit.
function RapportRun({ rapport }: { rapport: RapportApprobationRun }) {
  const liste = (titre: string, valeurs?: string[]) =>
    valeurs && valeurs.length > 0 ? (
      <div>
        <strong>{titre}</strong>
        <ul>{valeurs.map((v, i) => <li key={i}>{v}</li>)}</ul>
      </div>
    ) : null;
  return (
    <div className="ao-approbation-rapport">
      {rapport.question && <h3>{rapport.question}</h3>}
      {rapport.resume && <p>{rapport.resume}</p>}
      {liste("Changements", rapport.changements)}
      {liste("Implications", rapport.implications)}
      {rapport.cout && <p className="font-mono text-[12px]">Coût : {rapport.cout}</p>}
      {liste("Risques", rapport.risques)}
      {rapport.recommandation && <p className="text-douce">Recommandation : {rapport.recommandation}</p>}
    </div>
  );
}

// Le brouillon d'un dossier survit à un rafraîchissement : il est gardé dans ce navigateur,
// par dossier ET par empreinte (un plan replanifié repart à zéro), et effacé après l'envoi.
// Le stockage peut être indisponible (navigation privée) : la page marche alors sans.
type Mode = "trancher" | "renvoyer";
interface BrouillonSauve {
  brouillon: Brouillon;
  reponse: string;
  verdictRun: "approved" | "rejected" | null;
  mode: Mode;
}
const cleBrouillon = (d: DossierApprobation) => `ao-brouillon:${d.dossier}:${d.empreinte}`;
function lireBrouillon(cle: string): BrouillonSauve | null {
  try {
    const brut = window.localStorage.getItem(cle);
    return brut ? (JSON.parse(brut) as BrouillonSauve) : null;
  } catch {
    return null;
  }
}
function ecrireBrouillon(cle: string, valeur: BrouillonSauve | null): void {
  try {
    if (valeur) window.localStorage.setItem(cle, JSON.stringify(valeur));
    else window.localStorage.removeItem(cle);
  } catch {
    // Sans stockage, le brouillon vit seulement le temps de la page.
  }
}

/** Le corps d'un dossier dans la file des décisions : le titre et l'attente sont sur sa ligne. */
export function CorpsDossier({ dossier, apres }: { dossier: DossierApprobation; apres: (message: string, regle: boolean) => void }) {
  const { source } = useSource();
  const cle = cleBrouillon(dossier);
  const sauve = useMemo(() => lireBrouillon(cle), [cle]);
  const initial = useMemo(() => ({ ...brouillonDu(dossier), ...(sauve?.brouillon ?? {}) }), [dossier, sauve]);
  const [brouillon, setBrouillon] = useState<Brouillon>(initial);
  const [reponse, setReponse] = useState(sauve?.reponse ?? "");
  const [mode, setMode] = useState<Mode>(sauve?.mode ?? "trancher");

  // Une approbation de run sans actions (rallonge de budget) se tranche d'un seul choix.
  const [verdictRun, setVerdictRun] = useState<"approved" | "rejected" | null>(sauve?.verdictRun ?? null);
  const run = dossier.source === "run";
  const renvoi = mode === "renvoyer";
  const nom = run ? `${dossier.projet ?? "run"} · ${dossier.nodeId}` : dossier.dossier;

  useEffect(() => {
    const vide = !reponse.trim() && !verdictRun && mode === "trancher" && Object.entries(brouillon).every(([id, b]) => {
      const a = dossier.actions.find((x) => x.id === id);
      return b.decision === (a?.decision ?? null) && b.motif === (a?.note ?? "");
    });
    ecrireBrouillon(cle, vide ? null : { brouillon, reponse, verdictRun, mode });
  }, [cle, brouillon, reponse, verdictRun, mode, dossier.actions]);

  const verrouille = dossier.plan_absent || dossier.tranche || dossier.reponse_posee !== null;
  const decisions = Object.entries(brouillon)
    .filter(([, valeur]) => valeur.decision !== null)
    .map(([action_id, valeur]) => ({ action_id, decision: valeur.decision as Decision["decision"], ...(valeur.motif.trim() ? { motif: valeur.motif.trim() } : {}) }));
  // Le moteur n'accepte d'approuver un plan de run que si chaque action est tranchée : une
  // décision partielle n'aurait nulle part où attendre la suite.
  const toutTranche = dossier.actions.length > 0 && decisions.length === dossier.actions.length;
  // Renvoyer n'approuve ni ne refuse rien : seule la consigne part (`oriented` pour un run,
  // `reponse` pour la boîte), les choix par action restent dans le brouillon.
  const demandeRun: DemandeDecisionRun | null = !run
    ? null
    : renvoi
      ? reponse.trim()
        ? { decision: "oriented", note: reponse.trim() }
        : null
      : dossier.actions.length === 0
        ? verdictRun
          ? { decision: verdictRun }
          : null
        : toutTranche
          ? { decision: "approved", actions: decisions.map(({ motif, ...d }) => ({ ...d, ...(motif ? { note: motif } : {}) })) }
          : null;
  const peutEnvoyer = !verrouille && (run ? demandeRun !== null : renvoi ? Boolean(reponse.trim()) : decisions.length > 0);
  // Ce que la confirmation redit : la changer referme une question déjà ouverte.
  const signature = JSON.stringify({ mode, reponse: reponse.trim(), verdictRun, decisions });

  function modifier(actionId: string, prochain: Partial<BrouillonAction>): void {
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
    if (run && dossier.approbationId && demandeRun) {
      await source.deciderRun(dossier.approbationId, demandeRun);
      const quoi =
        demandeRun.decision === "oriented"
          ? "renvoyé avec ta consigne, un nouveau tour repart"
          : demandeRun.decision === "rejected"
            ? "refus envoyé, le run reprend"
            : "décision envoyée, le run reprend";
      ecrireBrouillon(cle, null);
      apres(`${nom} : ${quoi}.`, true);
      return;
    }
    const resultat = await source.decider({
      dossier: dossier.dossier,
      empreinte: dossier.empreinte,
      decisions: renvoi ? [] : decisions,
      ...(renvoi && reponse.trim() ? { reponse: reponse.trim() } : {}),
    });
    ecrireBrouillon(cle, null);
    const texte = resultat.reponse ? "consigne enregistrée" : `${resultat.decisions.length} décision${resultat.decisions.length > 1 ? "s" : ""} enregistrée${resultat.decisions.length > 1 ? "s" : ""}`;
    // Le dossier ne quitte la file que s'il est réglé : une consigne, ou toutes les actions
    // décidées. Une décision partielle laisse les actions restantes à trancher.
    apres(`${dossier.dossier} : ${texte}.`, Boolean(resultat.reponse || dossier.actions.every((a) => brouillon[a.id]?.decision)));
  }

  const question = renvoi
    ? `Renvoyer ${nom} au pipeline avec ta consigne ?`
    : run
      ? demandeRun?.decision === "rejected"
        ? `Refuser ${dossier.reason === "budget" ? "la rallonge de budget" : "cette approbation"} pour ${nom} ?`
        : dossier.reason === "budget" && dossier.actions.length === 0
          ? `Accorder la rallonge de budget à ${nom} ?`
          : `Envoyer ta décision pour ${nom} ?`
      : `Enregistrer ${decisions.length} décision${decisions.length > 1 ? "s" : ""} pour ${dossier.dossier} ?`;
  const consequence = renvoi
    ? "Rien n'est approuvé ni refusé : le pipeline repart pour un nouveau tour avec cette consigne."
    : run
      ? "Le run reprend aussitôt avec ta décision."
      : `Elles portent sur le plan gelé ${dossier.empreinte} ; s'il a changé depuis l'affichage, le serveur refuse.`;
  const consigne = renvoi
    ? "Écris ce que le pipeline doit refaire."
    : run && dossier.actions.length === 0
      ? `Choisis ${dossier.reason === "budget" ? "Accorder" : "Approuver"} ou Refuser.`
      : run
        ? "Tranche chaque action : le run reprend avec le plan entier."
        : "Approuve ou refuse au moins une action.";

  return (
    <div className="flex flex-col gap-3">
      <div className="ao-approbation-meta">
        {run ? <span className="ao-liv-pastille">{dossier.reason === "budget" ? "rallonge de budget" : "approbation de run"}</span> : <Fraicheur dossier={dossier} />}
        <span className="font-mono text-[11px] text-douce">{run ? `Run ${dossier.runId?.slice(0, 8)}` : `Plan ${dossier.empreinte}`}</span>
        {dossier.appliquer_avec && <span className="font-mono text-[11px] text-douce">Pipeline : {dossier.appliquer_avec}</span>}
      </div>

      {dossier.plan_absent && <Erreur>Le plan gelé est introuvable. Décider à l’aveugle est refusé.</Erreur>}
      {dossier.rapport && <RapportRun rapport={dossier.rapport} />}
      {!verrouille && (
        <div className="ao-approbation-mode" role="radiogroup" aria-label="Que faire de ce plan">
          <button type="button" role="radio" aria-checked={!renvoi} className={`ao-btn ${!renvoi ? "primaire" : ""}`} onClick={() => setMode("trancher")}>
            Trancher
          </button>
          <button type="button" role="radio" aria-checked={renvoi} className={`ao-btn ${renvoi ? "primaire" : ""}`} onClick={() => setMode("renvoyer")}>
            Renvoyer au pipeline
          </button>
        </div>
      )}
      {!verrouille && renvoi && (
        <label className="ao-approbation-reponse">
          Ce qui ne va pas, et ce que le pipeline doit refaire
          <textarea
            value={reponse}
            maxLength={500}
            rows={4}
            placeholder="Une erreur de raisonnement, une hypothèse fausse, une question à traiter… Rien n'est approuvé ni refusé : le pipeline repart avec cette consigne."
            onChange={(event) => setReponse(event.target.value)}
          />
        </label>
      )}
      {!dossier.plan_absent && dossier.actions.length === 0 && !run && <Vide>Le plan ne contient aucune action à décider.</Vide>}
      {run && dossier.actions.length === 0 && !verrouille && !renvoi && (
        <fieldset className="ao-approbation-choix">
          <legend>Décision pour ce run</legend>
          <label>
            <input type="radio" name={`verdict-${dossier.dossier}`} checked={verdictRun === "approved"} onChange={() => setVerdictRun("approved")} />
            {dossier.reason === "budget" ? "Accorder" : "Approuver"}
          </label>
          <label>
            <input type="radio" name={`verdict-${dossier.dossier}`} checked={verdictRun === "rejected"} onChange={() => setVerdictRun("rejected")} />
            Refuser
          </label>
        </fieldset>
      )}
      {dossier.actions.map((action) => (
        <ActionPlan key={action.id} action={action} brouillon={brouillon[action.id] ?? { decision: null, motif: "" }} modifier={(prochain) => modifier(action.id, prochain)} verrouille={verrouille || renvoi} />
      ))}

      {!verrouille && (
        <div className="flex flex-col items-start gap-1.5">
          <ActionConfirmee
            key={signature}
            libelle={renvoi ? "Renvoyer avec cette consigne" : run ? "Envoyer la décision" : "Enregistrer la décision"}
            question={question}
            details={consequence}
            confirmer={renvoi ? "Confirmer le renvoi" : "Confirmer la décision"}
            desactive={!peutEnvoyer}
            onConfirmer={envoyer}
          />
          {!peutEnvoyer && <p className="text-[12.5px] text-douce">{consigne}</p>}
        </div>
      )}

    </div>
  );
}

/** Les modules du cockpit liés aux plans métier : où leurs effets se voient. */
export function Modules({ modules }: { modules: ReponseApprobations["modules"] }) {
  if (modules.erreur) return <Erreur>{modules.erreur}</Erreur>;
  if (!modules.apps.length) return null;
  return (
    <div className="ao-approbation-modules">
      {modules.apps.map((module) => (
        <article key={module.nom}>
          <h3>{module.nom}</h3>
          <p className="text-douce">{module.description ?? "Sans description."}</p>
          <p className="font-mono text-[11px] text-douce">{module.etat}{module.notes.length ? ` · ${module.notes.join(" · ")}` : ""}</p>
          {module.url && <a className="ao-btn" href={module.url}>{module.url.startsWith("/") ? "Ouvrir" : "Consulter"}</a>}
        </article>
      ))}
    </div>
  );
}
