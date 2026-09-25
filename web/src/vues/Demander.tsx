// « Demander au cockpit » (§11.7) : comprendre un run, un coût, un échec, sans rien lancer.
//
// Les réponses viennent de Claude par le runner du NAS : le chat reste disponible quand le
// PC dort. Pendant une réponse, le fil arrive par son propre flux SSE (`/api/chat/<id>/flux`).
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import { depuis, usd } from "../format";
import type { FilDetaille, MessageChat } from "../types";
import { Erreur, Titre, Vide } from "../ui";

const EXEMPLES = ["Pourquoi le dernier run a échoué ?", "Qu'est-ce qui coûte le plus ce mois-ci ?", "Le PC est-il disponible pour lancer une tâche ?"];

const enCours = (fil: FilDetaille | null) => !!fil?.messages.some((m) => m.role === "assistant" && (m.statut === "queued" || m.statut === "streaming"));

function Bulle({ message }: { message: MessageChat }) {
  if (message.role === "user") {
    return <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white">{message.contenu}</div>;
  }
  return (
    <div className={`mr-auto max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border px-3 py-2 text-sm ${message.statut === "failed" ? "border-danger bg-danger-fond text-danger" : "border-trait bg-carte"}`}>
      {message.statut === "queued" && <span className="text-douce">En file sur le runner du NAS…</span>}
      {message.contenu}
      {message.statut === "streaming" && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" aria-label="réponse en cours" />}
    </div>
  );
}

export function Demander({ filId, aller }: { filId: string | null; aller: (href: string) => void }) {
  const { source } = useSource();
  // L'horloge ne sert qu'à rafraîchir « il y a… » : un fil créé après son dernier tic
  // serait daté dans le futur, d'où Date.now() au rendu.
  useHorloge(30_000);
  const [tourListe, setTourListe] = useState(0);
  const liste = useCharge((s) => s.fils(), [tourListe]);
  const [fil, setFil] = useState<FilDetaille | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Une question pré-remplie par un autre écran (« Expliquer cette étape ») : lue une fois,
  // puis retirée de l'adresse pour qu'un rechargement ne la remette pas.
  const [question, setQuestion] = useState(() => new URLSearchParams(window.location.search).get("question") ?? "");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("question")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [envoi, setEnvoi] = useState(false);
  const bas = useRef<HTMLDivElement>(null);

  const relire = useCallback(async () => {
    if (!filId) return setFil(null);
    try {
      const lu = await source.fil(filId);
      setFil(lu);
      setErreur(lu ? null : "conversation introuvable");
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    }
  }, [source, filId]);

  useEffect(() => {
    void relire();
  }, [relire]);

  // Tant qu'une réponse s'écrit, le fil arrive par son flux ; la liste est relue ensuite.
  const actif = enCours(fil);
  useEffect(() => {
    if (!actif || !filId) {
      setTourListe((t) => t + 1);
      return;
    }
    return source.ecouterFil(filId, setFil, () => setTourListe((t) => t + 1));
  }, [actif, filId, source]);

  // Accolades obligatoires : les navigateurs récents font rendre une promesse à
  // scrollIntoView, que React prendrait pour une fonction de nettoyage.
  useEffect(() => {
    bas.current?.scrollIntoView({ block: "end" });
  }, [fil?.messages.length, fil?.messages.at(-1)?.contenu.length]);

  const bloque = liste.donnees?.usage.bloque ?? false;
  const peutEnvoyer = !envoi && !actif && !bloque && question.trim().length > 0;

  async function envoyer(event?: FormEvent) {
    event?.preventDefault();
    if (!peutEnvoyer) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const suite = await source.poser(question.trim(), filId);
      setQuestion("");
      setFil(suite);
      if (suite.id !== filId) aller(`/demander/${encodeURIComponent(suite.id)}`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  const touche = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) void envoyer(event);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={`flex min-h-0 flex-col gap-2 rounded-xl border border-trait bg-surface p-3 ${filId ? "hidden lg:flex" : ""}`}>
        <button type="button" onClick={() => aller("/demander")} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white">
          Nouvelle question
        </button>
        <Titre compteur={liste.donnees?.fils.length}>Conversations</Titre>
        {liste.erreur && <Erreur>{liste.erreur}</Erreur>}
        {liste.donnees && !liste.donnees.fils.length && <p className="text-xs text-douce">Aucune conversation pour l'instant.</p>}
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {liste.donnees?.fils.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => aller(`/demander/${encodeURIComponent(f.id)}`)}
                aria-current={f.id === filId ? "page" : undefined}
                className={`flex w-full flex-col rounded-lg border px-2 py-1.5 text-left hover:border-accent ${f.id === filId ? "border-accent bg-carte" : "border-trait bg-carte"}`}
              >
                <span className="truncate text-sm font-semibold">{f.titre}</span>
                <span className="text-[11px] text-douce">il y a {depuis(f.majLe, Date.now())}</span>
              </button>
            </li>
          ))}
        </ul>
        {liste.donnees && (
          <p className={`mt-auto text-[11px] ${bloque ? "text-danger" : "text-douce"}`} title="Dépense du chat, suivie à part des runs">
            {usd(liste.donnees.usage.coutEquivalentUsd)} sur {usd(liste.donnees.usage.plafondUsd)} ce mois
            {bloque && " : plafond atteint, le chat reprend le mois prochain"}
          </p>
        )}
      </aside>

      <section className="flex min-h-[60vh] min-w-0 flex-col rounded-xl border border-trait bg-surface">
        <header className="flex items-center gap-2 border-b border-trait px-3 py-2">
          {filId && (
            <button type="button" onClick={() => aller("/demander")} className="text-xs text-douce hover:text-accent lg:hidden">
              ← conversations
            </button>
          )}
          <span className="truncate text-sm font-semibold">{fil?.titre ?? "Nouvelle question"}</span>
          <span className="ml-auto hidden whitespace-nowrap text-[11px] text-douce sm:inline">
            Claude{liste.donnees ? ` ${liste.donnees.modele}` : ""} via le NAS · lecture seule
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {erreur && <Erreur>{erreur}</Erreur>}
          {!filId && (
            <Vide>
              <span className="block">Pose une question sur tes runs, tes machines ou tes coûts. Le cockpit explique, il ne lance rien.</span>
              <span className="mt-3 flex flex-wrap justify-center gap-2">
                {EXEMPLES.map((e) => (
                  <button key={e} type="button" onClick={() => setQuestion(e)} className="rounded-full border border-trait bg-surface px-3 py-1 text-xs hover:border-accent">
                    {e}
                  </button>
                ))}
              </span>
            </Vide>
          )}
          {fil?.messages.map((m) => <Bulle key={m.id} message={m} />)}
          <div ref={bas} />
        </div>

        <form onSubmit={envoyer} className="flex items-end gap-2 border-t border-trait p-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={touche}
            rows={2}
            maxLength={4000}
            disabled={bloque}
            placeholder={bloque ? "Plafond mensuel atteint" : actif ? "Réponse en cours…" : "Ta question (Entrée pour envoyer, Maj+Entrée pour une ligne)"}
            aria-label="Question au cockpit"
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-lg border border-trait bg-carte px-3 py-2 text-sm"
          />
          <button type="submit" disabled={!peutEnvoyer} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {envoi ? "Envoi…" : "Envoyer"}
          </button>
        </form>
      </section>
    </div>
  );
}
