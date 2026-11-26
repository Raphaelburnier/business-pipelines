// La page Décisions (docs/SPEC-livraison.md, §5) : une seule file, triée par urgence, de tout
// ce qui attend Raphaël. Les runs bloqués d'abord, puis les PR sensibles, la livraison et les
// plans métier ; le plus ancien en tête dans chaque groupe. C'est la même liste que le badge
// et la vue d'ensemble (donnees/aDecider.ts). Chaque élément s'ouvre sur place, et chaque
// action passe par la même confirmation en deux temps, suivie d'un toast.
//
// Sous la file, ce qui avance sans lui : une livraison en cours, les autres PR, la production.
// La livraison ne livre rien elle-même : le clic dépose une commande signée que le service
// livreur exécute sur le NAS. Pendant la bascule, le cockpit redémarre : l'API ne répond plus
// quelques dizaines de secondes, la carte le dit, réessaie, puis affiche l'issue.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionConfirmee } from "../composants/ActionConfirmee";
import { Bouton } from "../composants/Bouton";
import { Carte } from "../composants/Carte";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { Sensible, Statut } from "../composants/Statut";
import { useToasts } from "../composants/Toasts";
import { NOM_GENRE, type ADecider, type ElementDecision } from "../donnees/aDecider";
import { useHorloge, useSource } from "../donnees/contexte";
import { attente, type DossierApprobation } from "../donnees/decisions";
import { confirmationLivraisonCourante } from "../donnees/livraison";
import { nomCourt, prsDeLaLivraison, type PrLivree, type PullRequestOuverte } from "../donnees/pullRequests";
import { depuis } from "../format";
import { Icone } from "../icones";
import type { CommitLivraison, EtapeLivraison, Livraison, ReponseLivraison, VersionsLivraison } from "../types";
import { CorpsDossier, Modules } from "./Approbations";

type Aller = (href: string) => void;

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

// Une issue récente reste affichée en tête de page ; au-delà, elle ne vit plus que dans
// l'historique.
const ISSUE_RECENTE_MS = 30 * 60 * 1000;

const court = (sha: string | null) => (sha ? sha.slice(0, 7) : "inconnu");
const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? "s" : ""}`;

// ---------------------------------------------------------------------------------------
// Livraison

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
        <span className="ml-auto font-mono text-douce">{commits.length ? pluriel(commits.length, "commit") : "commits inconnus"}</span>
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

/** La livraison proposée, dans la file : ce qu'elle apporte, ses commits, et « Livrer ». */
function CorpsLivraison({ aDecider, regle }: { aDecider: ADecider; regle: () => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const donnees = aDecider.livraison.donnees;
  const propo = donnees?.proposition ?? null;
  // Les trois versions figées au premier clic : c'est ce que la question montre, et ce qui part.
  const [cible, setCible] = useState<VersionsLivraison | null>(null);
  const [changee, setChangee] = useState(false);

  useEffect(() => {
    if (cible && !confirmationLivraisonCourante(cible, propo?.disponible)) {
      setCible(null);
      setChangee(true);
    }
  }, [cible, propo]);

  if (!donnees || !propo?.disponible) return null;
  const disponible = propo.disponible;
  const commits = DEPOTS.reduce((n, d) => n + propo.commits[d.cle].length, 0);
  const prs = prsDeLaLivraison(aDecider.prs.donnees, DEPOTS.flatMap((d) => propo.commits[d.cle]));

  async function livrer() {
    if (!cible) throw new Error("Les versions à livrer ne sont plus figées. Annule, puis relance « Livrer ».");
    // La proposition a pu changer depuis l'affichage : elle est relue juste avant l'envoi.
    const actuelle = await source.livraison();
    if (!confirmationLivraisonCourante(cible, actuelle.proposition?.disponible)) {
      aDecider.relire("livraison");
      throw new Error("La proposition a changé. Vérifie les versions avant de confirmer.");
    }
    const commande = await source.livrer(cible);
    aDecider.attendreLivraison(commande.id);
    setCible(null);
    toasts.info("Livraison demandée : le cockpit va redémarrer quelques dizaines de secondes.");
    regle();
  }

  return (
    <>
      <ContenuLivraison prs={prs} />
      <div>
        {DEPOTS.map((d) => (
          <Commits key={d.cle} nom={d.nom} avant={propo.enProduction[d.cle]} apres={disponible[d.cle]} commits={propo.commits[d.cle]} />
        ))}
      </div>
      {changee && (
        <p role="status" className="flex items-start gap-1.5 text-[13px] text-alerte">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          La proposition a changé. Vérifie les versions avant de confirmer.
        </p>
      )}
      {donnees.peutLivrer ? (
        <div className="flex flex-col items-start">
          <ActionConfirmee
            key={DEPOTS.map((d) => disponible[d.cle]).join(":")}
            libelle="Livrer"
            question={commits ? `Livrer ces ${pluriel(commits, "commit")} sur le NAS ?` : "Livrer cette version sur le NAS ?"}
            details="Le cockpit redémarre quelques dizaines de secondes, puis la page se reconnecte et affiche l'issue. La proposition est relue juste avant l'envoi."
            confirmer="Confirmer la livraison"
            onOuvrir={() => {
              setChangee(false);
              setCible({ ...disponible });
            }}
            onConfirmer={livrer}
          />
        </div>
      ) : (
        <p className="text-[12.5px] text-douce">Seule une identité tailnet autorisée peut livrer (specs/livraison.json sur le NAS).</p>
      )}
    </>
  );
}

/** Une livraison qui avance, ou son issue récente : en tête de page, avant la file. */
function SuiviLivraison({ aDecider }: { aDecider: ADecider }) {
  const maintenant = useHorloge(5000);
  const { donnees, erreur } = aDecider.livraison;
  const enCours = donnees?.enCours ?? null;
  const redemarrage = Boolean(erreur && (enCours || aDecider.livraisonAttendue));
  const derniere = donnees?.historique[0] ?? null;
  // Un échec reste en tête tant qu'il est récent. Un succès s'efface dès qu'une nouvelle
  // version est proposée : « Livré » au-dessus d'un nouveau bouton Livrer se lirait comme
  // l'issue de ce qui attend.
  const recente = Boolean(derniere && derniere.termineeLe && maintenant - Date.parse(derniere.termineeLe) < ISSUE_RECENTE_MS);
  const issue = derniere && !enCours && recente && (derniere.issue !== "livree" || !donnees?.proposition?.disponible) ? derniere : null;
  if (!enCours && !redemarrage && !issue) return null;
  const prs = enCours ? prsDeLaLivraison(aDecider.prs.donnees, DEPOTS.flatMap((d) => donnees?.proposition?.commits[d.cle] ?? [])) : [];

  return (
    <Carte
      titre="Livraison"
      actions={enCours || redemarrage ? <Statut ton="bleu" vivant>en cours</Statut> : issue?.issue === "livree" ? <Statut ton="ok">livrée</Statut> : <Statut ton="danger">échec</Statut>}
    >
      {redemarrage && (
        <p className="ao-liv-redemarrage" role="status">
          Cockpit en redémarrage, reconnexion…
        </p>
      )}
      {enCours && (
        <div className="ao-liv-bloc">
          <p className="m-0">
            Demandée par <span className="font-mono">{enCours.par}</span> il y a {depuis(enCours.demandeeLe, maintenant)}
            {enCours.statut === "pending" && ", en attente du livreur"}
          </p>
          <ContenuLivraison prs={prs} />
          <Etapes etape={enCours.etape} echec={false} />
          <Journal lignes={enCours.journal} />
          <p className="m-0 text-[12px] text-douce">Rien à arrêter ici : interrompre une bascule serait pire que la laisser finir ou se restaurer.</p>
        </div>
      )}
      {issue && <Issue livraison={issue} />}
    </Carte>
  );
}

function Historique({ livraisons, maintenant }: { livraisons: ReponseLivraison["historique"]; maintenant: number }) {
  return (
    <details className="ao-liv-historique">
      <summary>Dernières livraisons</summary>
      <ul>
        {livraisons.map((l) => (
          <li key={l.id}>
            <span className={`ao-liv-pastille ${l.issue === "livree" ? "ok" : "err"}`}>{l.issue === "livree" ? "livrée" : l.issue === "restauree" ? "restaurée" : "échec"}</span>
            <span className="font-mono">{court(l.cible.cockpit)}</span>
            <span className="text-douce">il y a {depuis(l.termineeLe ?? l.demandeeLe, maintenant)}</span>
            <span className="ml-auto truncate font-mono text-douce">{l.par}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** La version en production et les livraisons passées. */
function CarteProduction({ aDecider }: { aDecider: ADecider }) {
  const maintenant = useHorloge(30_000);
  const { donnees, erreur } = aDecider.livraison;
  if (erreur || !donnees) return null;
  const propo = donnees.proposition;
  return (
    <Carte titre="Production" sousTitre={propo?.disponible ? "Une nouvelle version attend dans la file." : "À jour : rien à livrer."}>
      {donnees.erreur && <p className="m-0 text-[13px] text-douce">Le livreur ne propose rien pour l'instant : {donnees.erreur}</p>}
      {propo && <p className="ao-liv-versions">{DEPOTS.map((d) => `${d.nom} ${court(propo.enProduction[d.cle])}`).join(" · ")}</p>}
      {donnees.historique.length > 0 && <Historique livraisons={donnees.historique} maintenant={maintenant} />}
    </Carte>
  );
}

// ---------------------------------------------------------------------------------------
// Pull requests

const LIBELLES_CI: Record<string, string> = { verte: "CI verte", en_cours: "CI en cours", rouge: "CI rouge", absente: "sans CI" };

/** Une PR ouverte : dans la file si elle est sensible et prête, sinon dans le suivi. */
function DetailPR({ aDecider, depot, pr, peutAgir, dansLaFile, regle }: { aDecider: ADecider; depot: string; pr: PullRequestOuverte; peutAgir: boolean; dansLaFile: boolean; regle?: () => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const nom = nomCourt(depot, pr.numero);
  const [erreurCI, setErreurCI] = useState<string | null>(null);

  async function fusionner() {
    await source.fusionnerPR({ depot, numero: pr.numero, sha: pr.sha, baseSha: pr.baseSha });
    toasts.succes(`Fusion de ${nom} demandée : le publieur revérifie tout sur GitHub, puis fusionne.`);
    if (regle) regle();
    else aDecider.relire("prs");
  }

  async function relancerCI() {
    setErreurCI(null);
    try {
      if (!pr.ci.runId) throw new Error("identifiant de la CI manquant ; actualise le relevé");
      if (!pr.ci.tentative) throw new Error("tentative CI manquante ; actualise le relevé");
      await source.relancerCIPR({ depot, numero: pr.numero, sha: pr.sha, runId: pr.ci.runId, tentative: pr.ci.tentative });
      toasts.succes(`Relance de la CI demandée pour ${nom}.`);
      aDecider.relire("prs");
    } catch (err) {
      setErreurCI(err instanceof Error ? err.message : String(err));
    }
  }

  const sensibles = pr.sensibles.length;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="ao-pr-tete">
        {!dansLaFile && (
          <a className="font-mono" href={pr.url} target="_blank" rel="noreferrer">
            {nom}
          </a>
        )}
        <Statut ton={pr.ci.etat === "verte" ? "ok" : pr.ci.etat === "rouge" ? "danger" : pr.ci.etat === "en_cours" ? "bleu" : "doux"} vivant={pr.ci.etat === "en_cours"}>
          {LIBELLES_CI[pr.ci.etat] ?? pr.ci.etat}
        </Statut>
        {sensibles > 0 && (
          <span title={pr.sensibles.join(", ")}>
            <Sensible>{`${sensibles} sensible${sensibles > 1 ? "s" : ""}`}</Sensible>
          </span>
        )}
        {pr.fusionEnCours && <Statut ton="bleu" vivant>fusion en cours</Statut>}
      </div>
      {!dansLaFile && <p className="m-0">{pr.pourquoi ?? pr.titre}</p>}
      <p className="m-0 font-mono text-[11.5px] text-douce [overflow-wrap:anywhere]">
        {pr.titre} · {pr.branche} · {pluriel(pr.fichiers, "fichier")}
      </p>
      {dansLaFile && sensibles > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-[12px] text-douce">
          {pr.sensibles.map((f) => (
            <li key={f} className="[overflow-wrap:anywhere]">
              {f}
            </li>
          ))}
        </ul>
      )}
      {pr.raison && !pr.fusionEnCours && <p className="m-0 text-[12.5px] text-douce">Pas de fusion d'ici : {pr.raison}.</p>}
      {pr.ciRelanceEnCours && (
        <p className="m-0 text-[12.5px] text-douce">
          Relance CI demandée (la branche est d'abord mise à jour si la branche par défaut a avancé) ; en cas de nouvel échec, l'autofix CI transmettra les logs à l'agent de cette branche.
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {!pr.raison && !pr.fusionEnCours && peutAgir && (
          <ActionConfirmee
            key={`${pr.sha}:${pr.baseSha}`}
            libelle={`Fusionner ${nom.split(" ").pop() ?? ""}`}
            declencheur={dansLaFile ? "primaire" : "secondaire"}
            question={`Fusionner ${nom} en squash sur ${pr.base} ?`}
            details={
              sensibles > 0
                ? `Elle touche ${pluriel(sensibles, "fichier")} sensible${sensibles > 1 ? "s" : ""} : ton clic vaut fusion explicite. Le publieur revérifie tout sur GitHub avant de fusionner.`
                : "Sans fichier sensible, la fusion automatique s'en chargerait aussi. Le publieur revérifie tout sur GitHub avant de fusionner."
            }
            confirmer="Confirmer la fusion"
            onConfirmer={fusionner}
          />
        )}
        {(pr.ci.etat === "rouge" || pr.ci.basePerimee) && peutAgir && !pr.ciRelanceEnCours && (
          <Bouton icone="reessayer" disabled={!pr.ci.runId || !pr.ci.tentative} libelleEnCours="Relance…" onClick={relancerCI}>
            {pr.ci.basePerimee ? "Mettre à jour la branche" : "Relancer la CI"}
          </Bouton>
        )}
        {dansLaFile && (
          <a className="ao-lien-carte min-h-8" href={pr.url} target="_blank" rel="noreferrer">
            Voir sur GitHub
            <Icone nom="ouvrir" taille={14} />
          </a>
        )}
      </div>
      {erreurCI && (
        <p role="alert" className="m-0 flex items-start gap-1.5 text-[13px] text-danger">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          {erreurCI}
        </p>
      )}
    </div>
  );
}

/** Les PR ouvertes qui n'attendent pas Raphaël : CI en cours ou rouge, fusion automatique, fusion demandée. */
function CarteAutresPR({ aDecider, dansLaFile }: { aDecider: ADecider; dansLaFile: ReadonlySet<string> }) {
  const { donnees, erreur, detail } = aDecider.prs;
  if (erreur) return <EtatErreur titre="Pull requests illisibles" message={erreur} detail={detail} onReessayer={() => aDecider.relire("prs")} />;
  if (!donnees) return null;
  const peutAgir = Boolean(donnees.peutFusionner && !donnees.perime && !donnees.erreur);
  const autres = donnees.depots.flatMap((d) => d.ouvertes.filter((pr) => !dansLaFile.has(`pr:${d.depot}#${pr.numero}`)).map((pr) => ({ depot: d.depot, pr })));
  const refusees = donnees.recentes.filter((r) => !r.ok).slice(0, 2);
  const remarques = [
    donnees.erreur && `Pas de relevé : ${donnees.erreur}.`,
    !donnees.erreur && donnees.perime && "Relevé ancien : le publieur ne tourne peut-être plus. Fusion impossible d'ici tant qu'il n'est pas relu.",
    !donnees.peutFusionner && "Seule une identité tailnet autorisée peut fusionner ou relancer la CI (specs/livraison.json sur le NAS).",
    ...donnees.depots.filter((d) => d.erreur).map((d) => `${d.depot} illisible : ${d.erreur}`),
    ...refusees.map((r) => `Fusion de ${nomCourt(r.depot, r.numero)} refusée : ${r.raison}`),
  ].filter((r): r is string => Boolean(r));
  if (!autres.length && !remarques.length) return null;

  return (
    <Carte titre="Pull requests en cours" sousTitre={autres.length ? `${pluriel(autres.length, "PR ouverte")} sans décision à prendre` : undefined}>
      {remarques.map((r) => (
        <p key={r} className="m-0 text-[12.5px] text-douce">
          {r}
        </p>
      ))}
      {autres.length > 0 && (
        <ul className="ao-pr-liste">
          {autres.map(({ depot, pr }) => (
            <li key={`${depot}#${pr.numero}`} className="ao-pr">
              <DetailPR aDecider={aDecider} depot={depot} pr={pr} peutAgir={peutAgir} dansLaFile={false} />
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
}

// ---------------------------------------------------------------------------------------
// Plans qui attendent le pipeline

/** Un plan renvoyé avec une consigne, ou introuvable : rien à trancher, mais à savoir. */
function CartePlansEnAttente({ dossiers }: { dossiers: DossierApprobation[] }) {
  const liste = dossiers.filter((d) => d.source !== "run" && !d.tranche && (d.reponse_posee || d.plan_absent));
  if (!liste.length) return null;
  return (
    <Carte titre="Plans renvoyés au pipeline" sousTitre="Ils reviendront dans la file quand le pipeline aura proposé un nouveau plan.">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {liste.map((d) => (
          <li key={d.dossier} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">{d.dossier}</span>
              {d.plan_absent ? <Statut ton="danger">plan introuvable</Statut> : <Statut ton="doux">consigne envoyée</Statut>}
            </div>
            {d.reponse_posee && <p className="m-0 text-[13px] text-douce">{d.reponse_posee.consigne}</p>}
          </li>
        ))}
      </ul>
    </Carte>
  );
}

// ---------------------------------------------------------------------------------------
// La file

function CorpsRun({ element, aller }: { element: ElementDecision; aller: Aller }) {
  return (
    <>
      <p className="m-0 text-[13.5px]">Ce run attend la validation d'une étape. Elle se fait sur la page du run, à l'étape concernée, avec son graphe et ses sorties.</p>
      <div>
        <Bouton variante="primaire" icone="suite" onClick={() => aller(element.href)}>
          Ouvrir le run
        </Bouton>
      </div>
    </>
  );
}

function ElementFile({
  element,
  ouvert,
  basculer,
  maintenant,
  corps,
}: {
  element: ElementDecision;
  ouvert: boolean;
  basculer: () => void;
  maintenant: number;
  corps: ReactNode;
}) {
  const id = `decision-${element.cle.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <li className={`ao-file-element${ouvert ? " ouvert" : ""}`} data-cle={element.cle}>
      <h3 className="m-0">
        <button type="button" className="ao-file-tete" aria-expanded={ouvert} aria-controls={id} onClick={basculer}>
          <span className={`ao-decision-genre ${element.genre}`}>{NOM_GENRE[element.genre]}</span>
          <span className="ao-file-texte">
            <span className="ao-file-titre" title={element.titre}>
              {element.titre}
            </span>
            <span className="ao-file-detail" title={element.detail}>
              {element.detail}
            </span>
          </span>
          {element.depuis && <span className="ao-file-age">depuis {attente(element.depuis, maintenant)}</span>}
          <Icone nom="suite" taille={16} className="ao-file-chevron" />
        </button>
      </h3>
      {ouvert && (
        <div id={id} className="ao-file-corps">
          {corps}
        </div>
      )}
    </li>
  );
}

function File({ aDecider, element, aller }: { aDecider: ADecider; element: string | null; aller: Aller }) {
  const toasts = useToasts();
  const maintenant = useHorloge(30_000);
  const { elements, chargement, erreurs } = aDecider;
  // Tant que Raphaël n'a rien ouvert ni fermé, l'élément demandé par l'adresse est ouvert,
  // sinon le plus urgent : la première décision est à un geste.
  const [choix, setChoix] = useState<ReadonlySet<string> | null>(null);
  const demande = element && elements.some((e) => e.cle === element) ? element : null;
  const ouverts: ReadonlySet<string> = choix ?? new Set(demande ? [demande] : elements[0] ? [elements[0].cle] : []);

  // Venu d'un lien « Décider » : l'élément s'ouvre et vient sous les yeux, une seule fois.
  const defile = useRef<string | null>(null);
  useEffect(() => {
    if (!element) return;
    setChoix((c) => (c ? new Set(c).add(element) : c));
  }, [element]);
  useEffect(() => {
    if (!demande || defile.current === demande) return;
    const noeud = document.querySelector(`[data-cle="${CSS.escape(demande)}"]`);
    if (!noeud) return;
    defile.current = demande;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    noeud.scrollIntoView({ block: "start", behavior: reduit ? "auto" : "smooth" });
  }, [demande]);

  function basculer(cle: string) {
    const suivant = new Set(ouverts);
    if (suivant.has(cle)) suivant.delete(cle);
    else suivant.add(cle);
    setChoix(suivant);
  }

  // Une décision partie : l'élément quitte la file et le suivant s'ouvre, comme dans une boîte de réception.
  function regle(e: ElementDecision, source: "livraison" | "prs" | "approbations") {
    const i = elements.findIndex((x) => x.cle === e.cle);
    const suivant = elements[i + 1] ?? elements[i - 1] ?? null;
    setChoix(new Set(suivant ? [suivant.cle] : []));
    aDecider.retirer(e.cle, source);
  }

  function corps(e: ElementDecision): ReactNode {
    const objet = e.objet;
    switch (objet.type) {
      case "dossier":
        return (
          <CorpsDossier
            key={`${objet.dossier.dossier}:${objet.dossier.empreinte}`}
            dossier={objet.dossier}
            apres={(message, fini) => {
              toasts.succes(message);
              if (fini) regle(e, "approbations");
              else aDecider.relire("approbations");
            }}
          />
        );
      case "pr":
        return <DetailPR aDecider={aDecider} depot={objet.depot} pr={objet.pr} peutAgir dansLaFile regle={() => regle(e, "prs")} />;
      case "livraison":
        return <CorpsLivraison aDecider={aDecider} regle={() => regle(e, "livraison")} />;
      case "run":
        return <CorpsRun element={e} aller={aller} />;
    }
  }

  let contenu: ReactNode;
  if (!elements.length && erreurs.length === 3) {
    contenu = <EtatErreur titre="Décisions illisibles" message="Ni la livraison, ni les PR, ni les approbations n'ont répondu." detail={aDecider.approbations.detail} onReessayer={aDecider.recharger} />;
  } else if (!elements.length && chargement) {
    contenu = <Squelette lignes={4} libelle="Lecture des décisions…" />;
  } else if (!elements.length) {
    contenu = (
      <EtatVide
        icone="ok"
        message="Rien n'attend ta décision."
        detail="Les validations de runs, les PR sensibles, les livraisons et les plans métier apparaissent ici dès qu'ils t'attendent."
      />
    );
  } else {
    contenu = (
      <ol className="ao-file" aria-label="Décisions à prendre, la plus urgente en premier">
        {elements.map((e) => (
          <ElementFile key={e.cle} element={e} ouvert={ouverts.has(e.cle)} basculer={() => basculer(e.cle)} maintenant={maintenant} corps={corps(e)} />
        ))}
      </ol>
    );
  }

  const qui = aDecider.approbations.donnees?.qui;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="titre-file">
      <header className="ao-file-entete">
        <div className="min-w-0">
          <h2 id="titre-file" className="text-[17px] font-semibold leading-6 text-encre">
            À décider{elements.length ? ` · ${elements.length}` : ""}
          </h2>
          <p className="m-0 text-[13px] text-douce">Les runs bloqués d'abord, puis les PR sensibles, la livraison et les plans métier ; le plus ancien en tête dans chaque groupe.</p>
        </div>
        {aDecider.approbations.donnees && (
          <div className="ao-file-identite">
            {qui && <span className="font-mono text-[11px] text-douce">{qui.nom ?? qui.par} · {qui.canal}</span>}
          </div>
        )}
      </header>
      {erreurs.length > 0 && erreurs.length < 3 && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-danger bg-danger-fond px-3 py-2 text-[13px] text-encre">
          <Icone nom="alerte" taille={15} className="text-danger" />
          <span className="min-w-0 flex-1">File incomplète : {erreurs.join(", ")} sans réponse.</span>
          <Bouton taille="petit" icone="reessayer" onClick={aDecider.recharger}>
            Réessayer
          </Bouton>
        </div>
      )}
      {contenu}
    </section>
  );
}

/** `element` : la clé d'un élément à ouvrir, venue de l'adresse (/decisions?d=…). */
export function Decisions({ aDecider, element, aller }: { aDecider: ADecider; element: string | null; aller: Aller }) {
  const dansLaFile = new Set(aDecider.elements.map((e) => e.cle));
  const approbations = aDecider.approbations.donnees;
  return (
    <div className="ao-decisions">
      <SuiviLivraison aDecider={aDecider} />
      <File aDecider={aDecider} element={element} aller={aller} />
      <section className="flex flex-col gap-3" aria-labelledby="titre-suivi">
        <h2 id="titre-suivi" className="ao-decisions-intertitre">
          En cours, sans décision à prendre
        </h2>
        <CarteAutresPR aDecider={aDecider} dansLaFile={dansLaFile} />
        {approbations && <CartePlansEnAttente dossiers={approbations.etat.dossiers} />}
        <CarteProduction aDecider={aDecider} />
        {approbations && (approbations.modules.apps.length > 0 || approbations.modules.erreur) && (
          <Carte titre="Modules" sousTitre="Où les plans métier validés produisent leurs effets.">
            <Modules modules={approbations.modules} />
          </Carte>
        )}
      </section>
    </div>
  );
}
