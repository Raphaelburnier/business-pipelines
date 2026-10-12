// La page Décisions (docs/SPEC-livraison.md, §5) : la carte Livraison en tête, puis les
// approbations des pipelines, qui gardent leur page à part sous /decisions/pipelines.
//
// La carte ne livre rien elle-même : le clic dépose une commande signée que le service
// livreur exécute sur le NAS. Pendant la bascule, le cockpit redémarre : l'API ne répond plus
// quelques dizaines de secondes, la carte le dit, réessaie, puis affiche l'issue.
import { useEffect, useState } from "react";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import { depuis } from "../format";
import type { CommitLivraison, EtapeLivraison, Livraison, ReponseLivraison, VersionsLivraison } from "../types";
import { Erreur } from "../ui";
import { nomCourt, prsDeLaLivraison } from "../donnees/pullRequests";
import type { EtatPullRequests, PrLivree, PullRequestOuverte } from "../donnees/pullRequests";
import { Approbations } from "./Approbations";
import { confirmationLivraisonCourante, intervalleLivraison } from "../donnees/livraison";

const DEPOTS: Array<{ cle: keyof VersionsLivraison; nom: string }> = [
  { cle: "cockpit", nom: "cockpit" },
  { cle: "moteur", nom: "moteur" },
  { cle: "registre", nom: "registre" },
];

const ETAPES: Array<{ cle: EtapeLivraison; nom: string }> = [
  { cle: "verifier", nom: "vérifier" },
  { cle: "preparer", nom: "préparer" },
  { cle: "sauvegarder", nom: "sauvegarder" },
  { cle: "construire", nom: "construire" },
  { cle: "basculer", nom: "basculer" },
  { cle: "sante", nom: "santé" },
];

// Une issue récente reste affichée en tête de carte ; au-delà, elle ne vit plus que dans
// l'historique.
const ISSUE_RECENTE_MS = 30 * 60 * 1000;

const court = (sha: string | null) => (sha ? sha.slice(0, 7) : "inconnu");

function Commits({ nom, avant, apres, commits }: { nom: string; avant: string | null; apres: string; commits: CommitLivraison[] }) {
  if (avant === apres) {
    return (
      <div className="ao-liv-depot">
        <span className="nom">{nom}</span>
        <span className="font-mono text-douce">à jour</span>
      </div>
    );
  }
  return (
    <details className="ao-liv-depot" open={nom === "cockpit"}>
      <summary>
        <span className="nom">{nom}</span>
        <span className="font-mono">
          {court(avant)} → <span className="text-accent">{court(apres)}</span>
        </span>
        <span className="ml-auto font-mono text-douce">
          {commits.length ? `${commits.length} commit${commits.length > 1 ? "s" : ""}` : "commits inconnus"}
        </span>
      </summary>
      {commits.length > 0 && (
        <ul>
          {commits.map((c) => (
            <li key={c.sha}>
              <span className="font-mono text-douce">{c.sha.slice(0, 7)}</span> {c.titre}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Etapes({ etape, echec }: { etape: EtapeLivraison | null; echec: boolean }) {
  const rang = etape === "restaurer" ? ETAPES.length : ETAPES.findIndex((e) => e.cle === etape);
  return (
    <ol className="ao-liv-etapes" aria-label="Étapes de la livraison">
      {ETAPES.map((e, i) => {
        const classe = i < rang ? "fait" : i === rang ? (echec ? "echec" : "maintenant") : "";
        return (
          <li key={e.cle} className={classe} aria-current={i === rang ? "step" : undefined}>
            <i />
            <span>{e.nom}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Journal({ lignes }: { lignes: string[] }) {
  if (!lignes.length) return null;
  return <pre className="ao-liv-journal">{lignes.slice(-8).join("\n")}</pre>;
}

function Issue({ livraison }: { livraison: Livraison }) {
  const livree = livraison.issue === "livree";
  return (
    <div className={`ao-liv-issue ${livree ? "ok" : "err"}`} role="status">
      <strong>
        {livree
          ? "Livré"
          : livraison.issue === "restauree"
            ? "Échec après la bascule, version précédente restaurée"
            : `Échec${livraison.etape ? ` à l'étape « ${ETAPES.find((e) => e.cle === livraison.etape)?.nom ?? livraison.etape} »` : ""}, rien n'a été remplacé`}
      </strong>
      <span className="font-mono">{DEPOTS.map((d) => `${d.nom} ${court(livraison.cible[d.cle])}`).join(" · ")}</span>
      {!livree && livraison.raison && <span>{livraison.raison}</span>}
      {!livree && <Journal lignes={livraison.journal} />}
    </div>
  );
}

function CarteLivraison() {
  const { source } = useSource();
  const maintenant = useHorloge(5000);
  const [tic, setTic] = useState(0);
  const { donnees, erreur } = useCharge((s) => s.livraison(), [tic]);
  // Le relevé des PR nomme la livraison. Sans lui (publieur sans jeton), la carte reste celle
  // d'avant : les commits suffisent pour livrer.
  const { donnees: relevePR } = useCharge((s) => s.pullRequests().catch((): EtatPullRequests | null => null), [tic]);
  const [confirmation, setConfirmation] = useState<VersionsLivraison | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [attendue, setAttendue] = useState<string | null>(null);

  const enCours = donnees?.enCours ?? null;
  const propo = donnees?.proposition ?? null;
  const confirmationCourante = confirmationLivraisonCourante(confirmation, propo?.disponible);
  // La proposition vient d'un fichier, pas d'un événement SSE. La relire au repos aussi,
  // puis accélérer pendant la livraison et les redémarrages.
  const suivre = Boolean(enCours || attendue || erreur);
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), intervalleLivraison(suivre));
    return () => clearInterval(t);
  }, [suivre]);

  useEffect(() => {
    if (confirmation && !confirmationCourante) {
      setConfirmation(null);
      setErreurEnvoi("La proposition a changé. Vérifie les versions avant de confirmer.");
    }
  }, [confirmation, confirmationCourante]);

  const derniere = donnees?.historique[0] ?? null;
  useEffect(() => {
    if (attendue && derniere?.id === attendue && !enCours) setAttendue(null);
  }, [attendue, derniere, enCours]);

  async function livrer(cible: VersionsLivraison) {
    setEnvoi(true);
    setErreurEnvoi(null);
    try {
      const actuelle = await source.livraison();
      if (!confirmationLivraisonCourante(cible, actuelle.proposition?.disponible)) {
        setConfirmation(null);
        setTic((n) => n + 1);
        throw new Error("La proposition a changé. Vérifie les versions avant de confirmer.");
      }
      const commande = await source.livrer(cible);
      setAttendue(commande.id);
      setConfirmation(null);
      setTic((n) => n + 1);
    } catch (err) {
      setErreurEnvoi(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  const redemarrage = Boolean(erreur && (enCours || attendue));
  const prsLivrees = propo ? prsDeLaLivraison(relevePR ?? null, DEPOTS.flatMap((d) => propo.commits[d.cle])) : [];
  // Un échec reste en tête tant qu'il est récent. Un succès s'efface dès qu'une nouvelle
  // version est proposée : « Livré » au-dessus d'un nouveau bouton Livrer se lirait comme
  // l'issue de ce qui attend.
  const recente = Boolean(derniere && derniere.termineeLe && maintenant - Date.parse(derniere.termineeLe) < ISSUE_RECENTE_MS);
  const issueRecente =
    derniere && !enCours && recente && (derniere.issue !== "livree" || !propo?.disponible) ? derniere : null;

  return (
    <section className="ao-liv" aria-labelledby="titre-livraison">
      <header>
        <h2 id="titre-livraison">Livraison</h2>
        {propo && !enCours && (
          <span className={`ao-liv-etat ${propo.disponible ? "dispo" : ""}`}>{propo.disponible ? "disponible" : "production à jour"}</span>
        )}
        {enCours && <span className="ao-liv-etat encours">en cours</span>}
      </header>

      {redemarrage && (
        <p className="ao-liv-redemarrage" role="status">
          Cockpit en redémarrage, reconnexion…
        </p>
      )}
      {erreur && !redemarrage && <Erreur>{erreur}</Erreur>}
      {!donnees && !erreur && <p className="text-douce">Lecture de la livraison…</p>}
      {donnees?.erreur && <p className="text-douce">Le livreur ne propose rien pour l'instant : {donnees.erreur}</p>}

      {enCours && (
        <div className="ao-liv-bloc">
          <p>
            Demandée par <span className="font-mono">{enCours.par}</span> il y a {depuis(enCours.demandeeLe, maintenant)}
            {enCours.statut === "pending" && ", en attente du livreur"}
          </p>
          <ContenuLivraison prs={prsLivrees} />
          <Etapes etape={enCours.etape} echec={false} />
          <Journal lignes={enCours.journal} />
          <p className="text-[12px] text-douce">
            Rien à arrêter ici : interrompre une bascule serait pire que la laisser finir ou se restaurer.
          </p>
        </div>
      )}

      {issueRecente && <Issue livraison={issueRecente} />}

      {/* Rien à livrer : une ligne, la version en production. Les trois dépôts « à jour »
          n'apprenaient rien et faisaient passer la carte pour une décision en attente. */}
      {propo && !enCours && !propo.disponible && (
        <p className="ao-liv-versions">{DEPOTS.map((d) => `${d.nom} ${court(propo.enProduction[d.cle])}`).join(" · ")}</p>
      )}

      {propo && propo.disponible && !enCours && (
        <div className="ao-liv-bloc">
          <ContenuLivraison prs={prsLivrees} />
          {DEPOTS.map((d) => (
            <Commits
              key={d.cle}
              nom={d.nom}
              avant={propo.enProduction[d.cle]}
              apres={propo.disponible ? propo.disponible[d.cle] : propo.enProduction[d.cle] ?? ""}
              commits={propo.commits[d.cle]}
            />
          ))}
          {propo.disponible && donnees?.peutLivrer && !confirmationCourante && (
            <div className="ao-actions">
              <button type="button" className="ao-btn primaire" onClick={() => {
                setErreurEnvoi(null);
                if (propo.disponible) setConfirmation({ ...propo.disponible });
              }}>
                Livrer
              </button>
            </div>
          )}
          {propo.disponible && donnees?.peutLivrer && confirmationCourante && (
            <div className="ao-liv-confirmation" role="group" aria-label="Confirmer la livraison">
              <p>Livrer ces commits sur le NAS ? Le cockpit va redémarrer quelques dizaines de secondes.</p>
              <div className="ao-actions">
                <button type="button" className="ao-btn primaire" disabled={envoi} onClick={() => confirmation && livrer(confirmation)}>
                  {envoi ? "Envoi…" : "Confirmer"}
                </button>
                <button type="button" className="ao-btn" disabled={envoi} onClick={() => setConfirmation(null)}>
                  Annuler
                </button>
              </div>
            </div>
          )}
          {propo.disponible && donnees && !donnees.peutLivrer && (
            <p className="text-[12px] text-douce">Seule une identité tailnet autorisée peut livrer (specs/livraison.json sur le NAS).</p>
          )}
          {erreurEnvoi && <Erreur>{erreurEnvoi}</Erreur>}
        </div>
      )}

      {donnees && donnees.historique.length > 0 && <Historique livraisons={donnees.historique} maintenant={maintenant} />}
    </section>
  );
}

// Ce qu'une livraison apporte : ses PR, retrouvées par les commits proposés, chacune avec la
// première phrase de son « Pourquoi ». La plus récente donne son nom à la livraison.
function ContenuLivraison({ prs }: { prs: PrLivree[] }) {
  const principale = prs[0];
  if (!principale) return null;
  return (
    <div className="ao-liv-contenu">
      <p className="ao-liv-definition">{principale.pourquoi ?? principale.titre}</p>
      <ul>
        {prs.map((pr) => (
          <li key={`${pr.depot}#${pr.numero}`}>
            <a className="font-mono" href={pr.url} target="_blank" rel="noreferrer">
              {nomCourt(pr.depot, pr.numero)}
            </a>
            <span>{pr.pourquoi ?? pr.titre}</span>
            {pr.pourquoi && <span className="font-mono text-[11px] text-douce">{pr.titre}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const LIBELLES_CI: Record<string, string> = { verte: "CI verte", en_cours: "CI en cours", rouge: "CI rouge", absente: "sans CI" };

function PullRequest({ depot, pr, peutFusionner, fusionner, relancerCI }: { depot: string; pr: PullRequestOuverte; peutFusionner: boolean; fusionner: (pr: PullRequestOuverte) => Promise<void>; relancerCI: (pr: PullRequestOuverte) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    setConfirmation(false);
  }, [pr.sha, pr.baseSha, pr.raison, peutFusionner]);
  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await fusionner(pr);
      setConfirmation(false);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }
  async function relancer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await relancerCI(pr);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <li className="ao-pr">
      <div className="ao-pr-tete">
        <a className="font-mono" href={pr.url} target="_blank" rel="noreferrer">
          {nomCourt(depot, pr.numero)}
        </a>
        <span className={`ao-liv-pastille ${pr.ci.etat === "verte" ? "ok" : pr.ci.etat === "rouge" ? "err" : ""}`}>{LIBELLES_CI[pr.ci.etat]}</span>
        {pr.sensibles.length > 0 && (
          <span className="ao-liv-pastille err" title={pr.sensibles.join(", ")}>
            {pr.sensibles.length} fichier{pr.sensibles.length > 1 ? "s" : ""} sensible{pr.sensibles.length > 1 ? "s" : ""}
          </span>
        )}
        {pr.fusionEnCours && <span className="ao-liv-etat encours">fusion en cours</span>}
      </div>
      <p>{pr.pourquoi ?? pr.titre}</p>
      <p className="font-mono text-[11px] text-douce">
        {pr.titre} · {pr.branche} · {pr.fichiers} fichier{pr.fichiers > 1 ? "s" : ""}
      </p>
      {pr.raison && !pr.fusionEnCours && <p className="text-[12px] text-douce">Pas de fusion d'ici : {pr.raison}.</p>}
      {pr.ci.etat === "rouge" && peutFusionner && !pr.ciRelanceEnCours && (
        <div className="ao-actions">
          <button type="button" className="ao-btn" disabled={envoi || !pr.ci.runId || !pr.ci.tentative} onClick={relancer}>
            {envoi ? "Relance…" : "Relancer la CI"}
          </button>
        </div>
      )}
      {pr.ciRelanceEnCours && <p className="text-[12px] text-douce">Relance CI demandée ; en cas de nouvel échec, l’autofix CI transmettra les logs à l’agent de cette branche.</p>}
      {!pr.raison && !pr.fusionEnCours && peutFusionner && !confirmation && (
        <div className="ao-actions">
          <button type="button" className="ao-btn primaire" onClick={() => setConfirmation(true)}>
            Fusionner
          </button>
        </div>
      )}
      {confirmation && !pr.raison && peutFusionner && !pr.fusionEnCours && (
        <div className="ao-liv-confirmation" role="group" aria-label={`Confirmer la fusion de ${nomCourt(depot, pr.numero)}`}>
          <p>
            Fusionner {nomCourt(depot, pr.numero)} en squash sur {pr.base} ?
            {pr.sensibles.length > 0 && " Elle touche des fichiers sensibles : ton clic vaut fusion explicite."}
          </p>
          <div className="ao-actions">
            <button type="button" className="ao-btn primaire" disabled={envoi} onClick={confirmer}>
              {envoi ? "Envoi…" : "Confirmer"}
            </button>
            <button type="button" className="ao-btn" disabled={envoi} onClick={() => setConfirmation(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {erreur && <Erreur>{erreur}</Erreur>}
    </li>
  );
}

// Les PR ouvertes de chaque dépôt surveillé, relevées par le publieur. Fusionner dépose une
// commande que le publieur exécute après avoir tout revérifié sur GitHub.
function CartePullRequests() {
  const { source } = useSource();
  const maintenant = useHorloge(30_000);
  const [tic, setTic] = useState(0);
  const { donnees, erreur } = useCharge((s) => s.pullRequests(), [tic, maintenant]);
  const ouvertes = (donnees?.depots ?? []).flatMap((d) => d.ouvertes.map((pr) => ({ depot: d.depot, pr })));

  async function fusionner(depot: string, pr: PullRequestOuverte) {
    await source.fusionnerPR({ depot, numero: pr.numero, sha: pr.sha, baseSha: pr.baseSha });
    setTic((n) => n + 1);
  }

  async function relancerCI(depot: string, pr: PullRequestOuverte) {
    if (!pr.ci.runId) throw new Error("identifiant de la CI manquant ; actualise le relevé");
    if (!pr.ci.tentative) throw new Error("tentative CI manquante ; actualise le relevé");
    await source.relancerCIPR({ depot, numero: pr.numero, sha: pr.sha, runId: pr.ci.runId, tentative: pr.ci.tentative });
    setTic((n) => n + 1);
  }

  return (
    <section className="ao-liv" aria-labelledby="titre-pr">
      <header>
        <h2 id="titre-pr">Pull requests</h2>
        {donnees && <span className={`ao-liv-etat ${ouvertes.length ? "dispo" : ""}`}>{ouvertes.length ? `${ouvertes.length} ouverte${ouvertes.length > 1 ? "s" : ""}` : "aucune ouverte"}</span>}
      </header>
      {erreur && <Erreur>{erreur}</Erreur>}
      {donnees?.erreur && <p className="text-douce">Pas de relevé : {donnees.erreur}.</p>}
      {donnees && !donnees.erreur && donnees.perime && <p className="text-douce">Relevé ancien : le publieur ne tourne peut-être plus.</p>}
      {donnees && !donnees.peutFusionner && ouvertes.length > 0 && (
        <p className="text-[12px] text-douce">Seule une identité tailnet autorisée peut fusionner ou relancer la CI (specs/livraison.json sur le NAS).</p>
      )}
      {donnees?.depots.filter((d) => d.erreur).map((d) => (
        <p key={d.depot} className="text-[12px] text-douce">
          {d.depot} illisible : {d.erreur}
        </p>
      ))}
      {ouvertes.length > 0 && (
        <ul className="ao-pr-liste">
          {ouvertes.map(({ depot, pr }) => (
            <PullRequest key={`${depot}#${pr.numero}`} depot={depot} pr={pr} peutFusionner={Boolean(donnees?.peutFusionner && !donnees.perime && !donnees.erreur)} fusionner={(p) => fusionner(depot, p)} relancerCI={(p) => relancerCI(depot, p)} />
          ))}
        </ul>
      )}
      {donnees?.recentes.filter((r) => !r.ok).slice(0, 2).map((r) => (
        <p key={`${r.depot}#${r.numero}-${r.le}`} className="text-[12px] text-douce">
          Fusion de {nomCourt(r.depot, r.numero)} refusée : {r.raison}
        </p>
      ))}
    </section>
  );
}

function Historique({ livraisons, maintenant }: { livraisons: ReponseLivraison["historique"]; maintenant: number }) {
  return (
    <details className="ao-liv-historique">
      <summary>Dernières livraisons</summary>
      <ul>
        {livraisons.map((l) => (
          <li key={l.id}>
            <span className={`ao-liv-pastille ${l.issue === "livree" ? "ok" : "err"}`}>
              {l.issue === "livree" ? "livrée" : l.issue === "restauree" ? "restaurée" : "échec"}
            </span>
            <span className="font-mono">{court(l.cible.cockpit)}</span>
            <span className="text-douce">il y a {depuis(l.termineeLe ?? l.demandeeLe, maintenant)}</span>
            <span className="ml-auto truncate font-mono text-douce">{l.par}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Tout ce qui attend une décision de Raphaël, sur un seul écran : la livraison à gauche, les
// approbations des pipelines à droite (retour du 2026-09-30 : des fenêtres plus denses, sans
// aller-retour entre deux pages). Une seule colonne sur tablette et téléphone.
export function Decisions() {
  return (
    <div className="ao-decisions">
      <div className="ao-decisions-colonne" aria-label="Livraison">
        <CarteLivraison />
        <CartePullRequests />
      </div>
      <div className="ao-decisions-colonne" aria-label="Approbations">
        <Approbations integre />
      </div>
    </div>
  );
}
