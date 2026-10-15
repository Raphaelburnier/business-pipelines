// « Demander au cockpit » (§11.7) : comprendre un run, un coût, un échec, sans rien lancer.
//
// Le toggle choisit qui répond à la prochaine question : l'assistant du cockpit (instantané
// des runs), ou un conseiller Claude ou Codex qui part du vault et lit le cockpit par ses
// outils. Un conseiller peut proposer une mission, une livraison ou une fusion : la carte
// s'affiche sous sa réponse et seul ton clic agit.
// Les réponses viennent du runner du NAS : le chat reste disponible quand le PC dort.
// Pendant une réponse, le fil arrive par son propre flux SSE (`/api/chat/<id>/flux`).
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTexteBrouillon } from "../donnees/brouillons";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import { depuis, usd } from "../format";
import { retenirFilDemander } from "../navigation";
import type { AgentChat, FilDetaille, ListeFils, MessageChat } from "../types";
import { Erreur, Titre, Vide } from "../ui";
import { ActionsChat } from "./ActionsChat";

const AGENTS: AgentChat[] = ["cockpit", "claude", "codex"];
const NOMS: Record<AgentChat, string> = { cockpit: "Cockpit", claude: "Claude", codex: "Codex" };

const EXEMPLES: Record<AgentChat, string[]> = {
  cockpit: ["Pourquoi le dernier run a échoué ?", "Qu'est-ce qui coûte le plus ce mois-ci ?", "Le PC est-il disponible pour lancer une tâche ?"],
  claude: ["Que devrais-je prioriser cette semaine d'après mes notes ?", "Écris la mission pour la prochaine étape de steam-tierlist", "Y a-t-il une livraison prête ?"],
  codex: ["Critique l'architecture du cockpit d'après mes notes", "Explique-moi le protocole MCP simplement", "Quelles PR peuvent être fusionnées ?"],
};

const INTRO: Record<AgentChat, string> = {
  cockpit: "Pose une question sur tes runs, tes machines ou tes coûts. Le cockpit explique, il ne lance rien.",
  claude: "Claude part de ton vault et lit le cockpit au besoin, en prenant le temps de réfléchir. Il peut écrire une mission ou préparer une livraison : tu confirmes d'un clic.",
  codex: "Codex part de ton vault et lit le cockpit au besoin, avec un effort de raisonnement élevé. Il peut écrire une mission ou préparer une fusion : tu confirmes d'un clic.",
};

const lireAgent = (brut: string): AgentChat => (AGENTS.includes(brut as AgentChat) ? (brut as AgentChat) : "cockpit");
const modeleDe = (liste: ListeFils | null, agent: AgentChat) => liste?.agents?.find((a) => a.id === agent)?.modele ?? (agent === "cockpit" ? liste?.modele : undefined);

const enCours = (fil: FilDetaille | null) => !!fil?.messages.some((m) => m.role === "assistant" && (m.statut === "queued" || m.statut === "streaming"));

function Bulle({ message, aller }: { message: MessageChat; aller: (href: string) => void }) {
  if (message.role === "user") {
    return <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-sur-accent">{message.contenu}</div>;
  }
  const agent = message.agent ?? "cockpit";
  return (
    <>
      <div className={`mr-auto max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border px-3 py-2 text-sm ${message.statut === "failed" ? "border-danger bg-danger-fond text-danger" : "border-trait bg-carte"}`}>
        {agent !== "cockpit" && <span className="mb-1 block text-[11px] font-semibold text-douce">{NOMS[agent]}</span>}
        {message.statut === "queued" && <span className="text-douce">En file sur le runner du NAS…</span>}
        {message.statut === "streaming" && !message.contenu && agent !== "cockpit" && <span className="text-douce">Réfléchit et consulte le vault…</span>}
        {message.contenu}
        {message.statut === "streaming" && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" aria-label="réponse en cours" />}
      </div>
      <ActionsChat actions={message.actions} aller={aller} />
    </>
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
  // puis retirée de l'adresse pour qu'un rechargement ne la remette pas. Sinon, la question en
  // cours de saisie survit au rechargement jusqu'à son envoi.
  const [question, setQuestion, oublierQuestion] = useTexteBrouillon("demander:question");
  useEffect(() => {
    const prerempli = new URLSearchParams(window.location.search).get("question");
    if (prerempli !== null) {
      setQuestion(prerempli);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [setQuestion]);
  const [envoi, setEnvoi] = useState(false);
  // Le répondant choisi est retenu pour les prochaines questions, sur cet appareil.
  const [agentBrut, setAgentBrut] = useTexteBrouillon("demander:agent");
  const agent = lireAgent(agentBrut);
  const bas = useRef<HTMLDivElement>(null);

  const relire = useCallback(async () => {
    if (!filId) return setFil(null);
    try {
      const lu = await source.fil(filId);
      setFil(lu);
      setErreur(lu ? null : "conversation introuvable");
      // Le menu ramène à ce fil ; un fil disparu ne doit plus y ramener.
      retenirFilDemander(lu ? filId : null);
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

  const nouvelle = () => {
    retenirFilDemander(null);
    aller("/demander");
  };

  const bloque = liste.donnees?.usage.bloque ?? false;
  const peutEnvoyer = !envoi && !actif && !bloque && question.trim().length > 0;

  async function envoyer(event?: FormEvent) {
    event?.preventDefault();
    if (!peutEnvoyer) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const suite = await source.poser(question.trim(), filId, agent);
      oublierQuestion();
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
        <button type="button" onClick={nouvelle} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-sur-accent">
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
            {NOMS[agent]}{modeleDe(liste.donnees, agent) ? ` ${modeleDe(liste.donnees, agent)}` : ""} via le NAS · {agent === "cockpit" ? "lecture seule" : "propose, tu confirmes"}
          </span>
          <div role="group" aria-label="Qui répond" className="flex shrink-0 overflow-hidden rounded-lg border border-trait text-xs">
            {AGENTS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={agent === a}
                onClick={() => setAgentBrut(a)}
                title={modeleDe(liste.donnees, a) ?? undefined}
                className={`px-2.5 py-1 ${agent === a ? "bg-accent font-semibold text-sur-accent" : "bg-carte hover:text-accent"}`}
              >
                {NOMS[a]}
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {erreur && <Erreur>{erreur}</Erreur>}
          {!filId && (
            <Vide>
              <span className="block">{INTRO[agent]}</span>
              <span className="mt-3 flex flex-wrap justify-center gap-2">
                {EXEMPLES[agent].map((e) => (
                  <button key={e} type="button" onClick={() => setQuestion(e)} className="rounded-full border border-trait bg-surface px-3 py-1 text-xs hover:border-accent">
                    {e}
                  </button>
                ))}
              </span>
            </Vide>
          )}
          {fil?.messages.map((m) => <Bulle key={m.id} message={m} aller={aller} />)}
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
            placeholder={bloque ? "Plafond mensuel atteint" : actif ? "Réponse en cours…" : `Ta question à ${NOMS[agent]} (Entrée pour envoyer, Maj+Entrée pour une ligne)`}
            aria-label={`Question à ${NOMS[agent]}`}
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-lg border border-trait bg-carte px-3 py-2 text-sm"
          />
          <button type="submit" disabled={!peutEnvoyer} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-sur-accent disabled:opacity-50">
            {envoi ? "Envoi…" : "Envoyer"}
          </button>
        </form>
      </section>
    </div>
  );
}
