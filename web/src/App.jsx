// Le cockpit en lecture : ce qui tourne, où, et ce qui attend une décision.
//
// Deux vues, pas plus. La liste des runs répond à « est-ce que quelque chose tourne, et
// est-ce que ça va bien ». Un run ouvert répond à « où ça en est ». Tout le reste (lancer,
// arrêter, trancher) arrive en phase 5 : cette page ne fait que regarder, et l'assumer
// évite des boutons qui mentent.
import { useCallback, useEffect, useState } from "react";
import { Approbations, Carte, Erreur, Etat, Journal, LigneRun, Machines, Titre, Topologie, Vide } from "./composants";
import { depuis, usd, useFlux, useRessource } from "./donnees";

const MAX_JOURNAL = 60;

export default function App() {
  // Le run ouvert vit dans le fragment d'URL : recharger la page, ou l'envoyer à quelqu'un,
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
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="font-(family-name:--font-titre) text-2xl font-bold">Cockpit</h1>
        <p className="text-sm text-douce">ce qui tourne, où, et ce qui attend</p>
      </header>
      {runId ? <VueRun runId={runId} onRetour={() => ouvrir(null)} /> : <VueTableau onOuvrir={ouvrir} />}
    </div>
  );
}

function Connexion({ connecte }) {
  return (
    <span className={`flex items-center gap-1.5 text-xs ${connecte ? "text-ok" : "text-danger"}`}>
      <span className={`h-2 w-2 rounded-full ${connecte ? "bg-ok" : "bg-danger"}`} />
      {connecte ? "flux en direct" : "flux interrompu"}
    </span>
  );
}

function VueTableau({ onOuvrir }) {
  const { donnees, erreur, chargement, recharger } = useRessource("/api/tableau-de-bord");
  // Le flux ne porte pas l'état : il dit qu'il a changé, et la vue se recharge. Une base
  // locale encaisse ça sans effort, et la page ne peut pas diverger de ce qui est écrit.
  const { connecte } = useFlux({ surEvenement: () => recharger() });

  if (chargement) return <p className="text-douce">Lecture de l'event store…</p>;
  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Connexion connecte={connecte} />
        <span className="text-sm text-douce">
          {donnees.vivants} run{donnees.vivants > 1 ? "s" : ""} en cours · {usd(donnees.coutDuJourUsd)} en équivalent sur 24 h
        </span>
      </div>

      <Approbations approbations={donnees.approbations} />

      <section>
        <Titre compteur={donnees.machines.length}>Machines</Titre>
        <Machines machines={donnees.machines} />
      </section>

      <section>
        <Titre compteur={donnees.runs.length}>Runs</Titre>
        {donnees.runs.length ? (
          <div className="flex flex-col gap-2">
            {donnees.runs.map((run) => (
              <LigneRun key={run.id} run={run} onOuvrir={onOuvrir} />
            ))}
          </div>
        ) : (
          <Vide>Aucun run enregistré. Lancer un pipeline le fera apparaître ici.</Vide>
        )}
      </section>
    </div>
  );
}

function VueRun({ runId, onRetour }) {
  const { donnees, erreur, chargement, recharger } = useRessource(`/api/runs/${encodeURIComponent(runId)}`);
  const [journal, setJournal] = useState([]);

  const surEvenement = useCallback(
    (evenement) => {
      setJournal((precedents) => [evenement, ...precedents].slice(0, MAX_JOURNAL));
      recharger();
    },
    [recharger]
  );
  const { connecte } = useFlux({ runId, surEvenement });

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

  return (
    <div className="flex flex-col gap-6">
      <button type="button" className="self-start text-sm font-semibold text-accent underline" onClick={onRetour}>
        ← Tous les runs
      </button>

      <Carte>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-(family-name:--font-titre) text-xl font-bold">{donnees.projet || "sans projet"}</span>
          <span className="font-mono text-sm text-douce">{donnees.pipeline}</span>
          <Etat statut={donnees.statut} className="ml-auto" />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-douce">
          <span className="font-mono text-xs">{donnees.id}</span>
          <span>démarré il y a {depuis(donnees.debut)}</span>
          {donnees.fin && <span>terminé il y a {depuis(donnees.fin)}</span>}
          <span title="Sur abonnement, ce coût est un équivalent API, pas une dépense">
            {usd(donnees.coutEquivalentUsd)} équivalent
          </span>
          <Connexion connecte={connecte} />
        </div>
      </Carte>

      <Approbations approbations={donnees.approbations} />

      <section>
        <Titre compteur={donnees.etapes.length}>Topologie</Titre>
        <Topologie etapes={donnees.etapes} />
      </section>

      <section>
        <Titre>Journal</Titre>
        <Journal evenements={journal} />
      </section>
    </div>
  );
}
