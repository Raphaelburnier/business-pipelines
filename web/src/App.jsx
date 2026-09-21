// Le cockpit en lecture : ce qui tourne, où, et ce qui attend une décision.
//
// Deux vues, pas plus. La liste répond à « est-ce que quelque chose tourne, et est-ce que
// ça va bien ». Un run ouvert répond à « où ça en est, et qu'est-ce qui a coûté ». Agir
// (lancer, arrêter, trancher) arrive en phase 5 : cette page ne fait que regarder, et
// l'assumer évite des boutons qui mentent.
//
// La disposition suit ce que fait un outil d'observabilité : des chiffres en haut, la
// liste à gauche, le détail à droite. Sur téléphone tout retombe en une colonne, dans
// l'ordre où on lit.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Carte,
  Connexion,
  Decisions,
  DetailEtape,
  Erreur,
  Etapes,
  Etat,
  Journal,
  LigneRun,
  Machines,
  Metrique,
  ParModele,
  Timeline,
  Titre,
  Vide,
} from "./composants";
import { depuis, duree, jetons, usd, useFlux, useHorloge, useLectureRun, useRessource } from "./donnees";

const MAX_JOURNAL = 300;

export default function App() {
  // Le run ouvert vit dans le fragment d'URL : recharger la page, ou envoyer le lien,
  // garde la vue. Une application d'une page qui perd son état au rechargement oblige à
  // refaire le chemin à chaque fois.
  const [runId, setRunId] = useState(() => window.location.hash.replace(/^#\/?run\//, "") || null);

  useEffect(() => {
    const suivre = () => setRunId(window.location.hash.replace(/^#\/?run\//, "") || null);
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, []);

  const ouvrir = useCallback((id) => {
    window.location.hash = id ? `/run/${id}` : "";
  }, []);

  return (
    <div className="mx-auto max-w-[110rem] px-4 pb-12 pt-4">
      {runId ? <VueRun runId={runId} onRetour={() => ouvrir(null)} /> : <VueTableau onOuvrir={ouvrir} />}
    </div>
  );
}

function Entete({ children, connecte }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-trait pb-3">
      <h1 className="font-(family-name:--font-titre) text-xl font-bold">Cockpit</h1>
      {children}
      <div className="ml-auto">
        <Connexion connecte={connecte} />
      </div>
    </header>
  );
}

function VueTableau({ onOuvrir }) {
  const { donnees, erreur, chargement, recharger } = useRessource("/api/tableau-de-bord");
  // Le flux ne porte pas l'état : il dit qu'il a changé, et la vue se recharge. Une base
  // locale encaisse ça sans effort, et la page ne peut pas diverger de ce qui est écrit.
  const { connecte } = useFlux({ surEvenement: () => recharger() });
  const [journal, setJournal] = useState([]);
  useFlux({ surEvenement: (e) => setJournal((p) => [e, ...p].slice(0, MAX_JOURNAL)) });
  const maintenant = useHorloge();

  const chiffres = useMemo(() => {
    if (!donnees) return null;
    const etapesEnCours = donnees.runs.reduce((n, r) => n + (r.etapes.parStatut.running || 0), 0);
    const enLigne = donnees.machines.filter((m) => ["online", "busy"].includes(m.etat)).length;
    const echecs = donnees.runs.filter((r) => r.statut === "failed").length;
    return { etapesEnCours, enLigne, echecs };
  }, [donnees]);

  if (chargement) return <p className="text-douce">Lecture de l'event store…</p>;
  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return null;

  return (
    <>
      <Entete connecte={connecte}>
        <span className="text-sm text-douce">ce qui tourne, où, et ce qui attend</span>
      </Entete>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metrique
          valeur={donnees.vivants}
          libelle="runs en cours"
          detail={`${donnees.runs.length} au total`}
          ton={donnees.vivants ? "text-accent" : "text-encre"}
        />
        <Metrique valeur={chiffres.etapesEnCours} libelle="étapes actives" />
        <Metrique valeur={usd(donnees.coutDuJourUsd)} libelle="équivalent 24 h" detail="pas une dépense" />
        <Metrique
          valeur={`${chiffres.enLigne}/${donnees.machines.length}`}
          libelle="machines"
          ton={chiffres.enLigne ? "text-ok" : "text-danger"}
        />
        <Metrique
          valeur={donnees.approbations.length}
          libelle="décisions"
          ton={donnees.approbations.length ? "text-alerte" : "text-encre"}
        />
      </div>

      <div className="mb-4">
        <Decisions approbations={donnees.approbations} maintenant={maintenant} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
        <section>
          <Titre compteur={donnees.runs.length}>Runs</Titre>
          {donnees.runs.length ? (
            <div className="flex flex-col gap-2">
              {donnees.runs.map((run) => (
                <LigneRun key={run.id} run={run} onOuvrir={onOuvrir} maintenant={maintenant} />
              ))}
            </div>
          ) : (
            <Vide>Aucun run enregistré. Lancer un pipeline le fera apparaître ici.</Vide>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section>
            <Titre compteur={donnees.machines.length}>Machines</Titre>
            <Machines machines={donnees.machines} maintenant={maintenant} />
          </section>
          <section>
            <Titre>Flux</Titre>
            <Journal evenements={journal} hauteur="max-h-72" />
          </section>
        </aside>
      </div>
    </>
  );
}

function VueRun({ runId, onRetour }) {
  const { donnees, erreur, chargement, recharger } = useRessource(`/api/runs/${encodeURIComponent(runId)}`);
  const [journal, setJournal] = useState([]);
  const [selection, setSelection] = useState(null);
  const maintenant = useHorloge();

  const surEvenement = useCallback(
    (evenement) => {
      setJournal((precedents) => [evenement, ...precedents].slice(0, MAX_JOURNAL));
      recharger();
    },
    [recharger]
  );
  const { connecte } = useFlux({ runId, surEvenement });
  const lecture = useLectureRun(donnees, maintenant);

  const etapeChoisie = useMemo(
    () => (donnees && donnees.etapes.find((e) => e.id === selection)) || null,
    [donnees, selection]
  );
  const evenementsEtape = useMemo(
    () => (selection ? journal.filter((e) => e.etape === selection) : []),
    [journal, selection]
  );

  if (chargement) return <p className="text-douce">Lecture du run…</p>;
  if (erreur) {
    return (
      <div className="flex flex-col gap-4">
        <Erreur>{erreur}</Erreur>
        <button type="button" className="self-start text-sm font-semibold text-accent underline" onClick={onRetour}>
          Retour aux runs
        </button>
      </div>
    );
  }
  if (!donnees) return null;

  const fin = donnees.fin ? Date.parse(donnees.fin) : maintenant;

  return (
    <>
      <Entete connecte={connecte}>
        <button type="button" className="text-sm font-semibold text-accent underline" onClick={onRetour}>
          ← tous les runs
        </button>
        <span className="truncate font-semibold">{donnees.projet || "sans projet"}</span>
        <span className="truncate font-mono text-xs text-douce">{donnees.pipeline}</span>
        <Etat statut={donnees.statut} />
      </Entete>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metrique valeur={duree(fin - Date.parse(donnees.debut))} libelle="durée" detail={`il y a ${depuis(donnees.debut, maintenant)}`} />
        <Metrique valeur={donnees.etapes.length} libelle="étapes" detail={`${lecture.voies.length} machine(s)`} />
        <Metrique valeur={usd(donnees.coutEquivalentUsd)} libelle="équivalent API" />
        <Metrique valeur={jetons(lecture.jetonsTotal)} libelle="jetons" />
        <Metrique
          valeur={donnees.approbations.length}
          libelle="décisions"
          ton={donnees.approbations.length ? "text-alerte" : "text-encre"}
        />
      </div>

      <Decisions approbations={donnees.approbations} maintenant={maintenant} />

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_21rem]">
        <section className="flex flex-col gap-4">
          <div>
            <Titre>Exécution</Titre>
            <Timeline lecture={lecture} etapes={donnees.etapes} selection={selection} onSelection={setSelection} />
          </div>
          <div>
            <Titre compteur={donnees.etapes.length}>Étapes</Titre>
            <Etapes etapes={donnees.etapes} selection={selection} onSelection={setSelection} />
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <DetailEtape etape={etapeChoisie} evenements={evenementsEtape} onFermer={() => setSelection(null)} />
          {lecture.parModele.length > 0 && (
            <div>
              <Titre>Coût par modèle</Titre>
              <Carte>
                <ParModele lignes={lecture.parModele} total={donnees.coutEquivalentUsd} />
              </Carte>
            </div>
          )}
        </aside>
      </div>

      {/* Le journal est bavard : il prend toute la largeur, sous le reste, et personne n'a
          à le traverser pour atteindre le détail d'une étape. */}
      <div className="mt-4">
        <Titre>Journal</Titre>
        <Journal evenements={journal} />
      </div>
    </>
  );
}
