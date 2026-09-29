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
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [attendue, setAttendue] = useState<string | null>(null);

  const enCours = donnees?.enCours ?? null;
  // Pendant une livraison, et tant que le cockpit ne répond plus, la carte se relit seule :
  // le flux peut être coupé par le redémarrage, et rien d'autre ne la réveillerait.
  const suivre = Boolean(enCours || attendue || erreur);
  useEffect(() => {
    if (!suivre) return undefined;
    const t = setInterval(() => setTic((n) => n + 1), 2500);
    return () => clearInterval(t);
  }, [suivre]);

  const derniere = donnees?.historique[0] ?? null;
  useEffect(() => {
    if (attendue && derniere?.id === attendue && !enCours) setAttendue(null);
  }, [attendue, derniere, enCours]);

  async function livrer(cible: VersionsLivraison) {
    setEnvoi(true);
    setErreurEnvoi(null);
    try {
      const commande = await source.livrer(cible);
      setAttendue(commande.id);
      setConfirmation(false);
      setTic((n) => n + 1);
    } catch (err) {
      setErreurEnvoi(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  const redemarrage = Boolean(erreur && (enCours || attendue));
  const propo = donnees?.proposition ?? null;
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
          <Etapes etape={enCours.etape} echec={false} />
          <Journal lignes={enCours.journal} />
          <p className="text-[12px] text-douce">
            Rien à arrêter ici : interrompre une bascule serait pire que la laisser finir ou se restaurer.
          </p>
        </div>
      )}

      {issueRecente && <Issue livraison={issueRecente} />}

      {propo && !enCours && (
        <div className="ao-liv-bloc">
          {DEPOTS.map((d) => (
            <Commits
              key={d.cle}
              nom={d.nom}
              avant={propo.enProduction[d.cle]}
              apres={propo.disponible ? propo.disponible[d.cle] : propo.enProduction[d.cle] ?? ""}
              commits={propo.commits[d.cle]}
            />
          ))}
          {propo.disponible && donnees?.peutLivrer && !confirmation && (
            <div className="ao-actions">
              <button type="button" className="ao-btn primaire" onClick={() => setConfirmation(true)}>
                Livrer
              </button>
            </div>
          )}
          {propo.disponible && donnees?.peutLivrer && confirmation && (
            <div className="ao-liv-confirmation" role="group" aria-label="Confirmer la livraison">
              <p>Livrer ces commits sur le NAS ? Le cockpit va redémarrer quelques dizaines de secondes.</p>
              <div className="ao-actions">
                <button type="button" className="ao-btn primaire" disabled={envoi} onClick={() => propo.disponible && livrer(propo.disponible)}>
                  {envoi ? "Envoi…" : "Confirmer"}
                </button>
                <button type="button" className="ao-btn" disabled={envoi} onClick={() => setConfirmation(false)}>
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

export function Decisions() {
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const approbations = topo?.projets.reduce((n, p) => n + p.approbationsEnAttente, 0) ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto">
      <CarteLivraison />
      <section className="ao-liv" aria-labelledby="titre-approbations">
        <header>
          <h2 id="titre-approbations">Approbations</h2>
          <span className={`ao-liv-etat ${approbations ? "dispo" : ""}`}>
            {approbations ? `${approbations} en attente` : "rien en attente"}
          </span>
        </header>
        <p className="text-douce">Les arbitrages des pipelines (marketing et autres) se tranchent sur leur page.</p>
        <div className="ao-actions">
          {/* Une autre page servie par le cockpit : un vrai lien, rechargement compris. */}
          <a className="ao-btn" href="/decisions/pipelines">
            Ouvrir les approbations
          </a>
        </div>
      </section>
    </div>
  );
}
