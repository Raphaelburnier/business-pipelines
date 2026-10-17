// Les actions d'un conseiller de « Demander », sous sa réponse. Mission, livraison et fusion
// sont des propositions : chaque carte relit l'état réel au moment du clic et passe par la
// route habituelle du cockpit, avec ses contrôles (identité tailnet, versions, CI revérifiée).
// Relancer une CI et écrire aux agents, le conseiller le fait lui-même : la carte en garde la
// trace, faite ou refusée, et renvoie là où l'issue se lit.
import { useState } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { deposerSpecChat } from "../donnees/specChat";
import type { ActionChat, VersionsLivraison } from "../types";

type Action<T extends ActionChat["type"]> = Extract<ActionChat, { type: T }>;

const court = (sha: string) => sha.slice(0, 7);
const carte = "flex flex-col gap-2 rounded-lg border border-accent bg-surface p-3 text-sm";
const bouton = "self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-sur-accent disabled:opacity-50";
const secondaire = "self-start rounded-lg border border-trait px-3 py-1.5 text-sm";

function Raison({ texte }: { texte: string }) {
  return <p className="text-xs text-douce">{texte}</p>;
}

function CarteMission({ action, aller }: { action: Action<"mission">; aller: (href: string) => void }) {
  const { spec } = action;
  const ouvrir = () => {
    deposerSpecChat(spec);
    aller(`/missions/${encodeURIComponent(spec.projectId)}`);
  };
  return (
    <div className={carte}>
      <p className="font-semibold">Mission proposée · {action.titre}</p>
      <p className="text-xs text-douce">Projet {spec.projectId}{spec.nature ? ` · ${spec.nature}` : ""}</p>
      <p className="whitespace-pre-wrap">{spec.objectif}</p>
      <ul className="list-disc pl-5 text-xs">{spec.criteres.map((c, i) => <li key={i}>{c}</li>)}</ul>
      <Raison texte={action.raison} />
      <button type="button" onClick={ouvrir} className={bouton}>Ouvrir dans le planificateur</button>
    </div>
  );
}

function CarteLivraison({ action, aller }: { action: Action<"livraison">; aller: (href: string) => void }) {
  const { source } = useSource();
  const [tour, setTour] = useState(0);
  const etat = useCharge((s) => s.livraison(), [tour]);
  const [confirmer, setConfirmer] = useState<VersionsLivraison | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const d = etat.donnees;
  const disponible = d?.proposition?.disponible ?? null;
  const bloque = !d ? "lecture de la livraison…" : d.enCours ? "une livraison est déjà en cours" : !disponible ? (d.erreur ?? "la production est déjà à jour") : !d.peutLivrer ? "ton identité n'est pas autorisée à livrer depuis cet appareil" : null;

  async function livrer() {
    if (!confirmer) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await source.livrer(confirmer);
      setResultat("Livraison demandée : le livreur la prend, suis-la dans Décisions.");
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
      setTour((t) => t + 1);
    } finally {
      setEnvoi(false);
      setConfirmer(null);
    }
  }

  return (
    <div className={carte}>
      <p className="font-semibold">Livraison proposée sur le NAS</p>
      {disponible && <p className="font-mono text-xs">cockpit {court(disponible.cockpit)} · moteur {court(disponible.moteur)} · registre {court(disponible.registre)}</p>}
      <Raison texte={action.raison} />
      {etat.erreur && <p className="text-xs text-danger">{etat.erreur}</p>}
      {erreur && <p className="text-xs text-danger">{erreur}</p>}
      {resultat ? (
        <button type="button" onClick={() => aller("/decisions")} className={secondaire}>{resultat}</button>
      ) : bloque ? (
        <p className="text-xs text-douce">Pas livrable maintenant : {bloque}.</p>
      ) : confirmer ? (
        <span className="flex flex-wrap gap-2">
          <button type="button" onClick={livrer} disabled={envoi} className={bouton}>{envoi ? "Envoi…" : "Confirmer la livraison"}</button>
          <button type="button" onClick={() => setConfirmer(null)} disabled={envoi} className={secondaire}>Annuler</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirmer(disponible)} className={bouton}>Livrer cette version…</button>
      )}
    </div>
  );
}

function CarteFusion({ action, aller }: { action: Action<"fusion">; aller: (href: string) => void }) {
  const { source } = useSource();
  const [tour, setTour] = useState(0);
  const etat = useCharge((s) => s.pullRequests(), [tour]);
  const [confirmer, setConfirmer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const d = etat.donnees;
  const pr = d?.depots.find((x) => x.depot === action.depot)?.ouvertes.find((p) => p.numero === action.numero) ?? null;
  const bloque = !d ? "lecture des PR…" : !pr ? "la PR n'est plus ouverte dans le relevé du publieur" : d.perime ? "le relevé du publieur est trop ancien" : pr.fusionEnCours ? "une fusion est déjà en cours" : pr.raison ? pr.raison : !d.peutFusionner ? "ton identité n'est pas autorisée à fusionner depuis cet appareil" : null;

  async function fusionner() {
    if (!pr) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await source.fusionnerPR({ depot: action.depot, numero: pr.numero, sha: pr.sha, baseSha: pr.baseSha });
      setResultat("Fusion demandée : le publieur revérifie la CI puis fusionne. Suis-la dans Décisions.");
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
      setTour((t) => t + 1);
    } finally {
      setEnvoi(false);
      setConfirmer(false);
    }
  }

  return (
    <div className={carte}>
      <p className="font-semibold">Fusion proposée · {action.depot}#{action.numero}</p>
      {pr && <p>{pr.titre} <span className="text-xs text-douce">· CI {pr.ci.etat} · {court(pr.sha)}</span></p>}
      <Raison texte={action.raison} />
      {etat.erreur && <p className="text-xs text-danger">{etat.erreur}</p>}
      {erreur && <p className="text-xs text-danger">{erreur}</p>}
      {resultat ? (
        <button type="button" onClick={() => aller("/decisions")} className={secondaire}>{resultat}</button>
      ) : bloque ? (
        <p className="text-xs text-douce">Pas fusionnable d'ici : {bloque}.</p>
      ) : confirmer ? (
        <span className="flex flex-wrap gap-2">
          <button type="button" onClick={fusionner} disabled={envoi} className={bouton}>{envoi ? "Envoi…" : `Confirmer la fusion de #${action.numero}`}</button>
          <button type="button" onClick={() => setConfirmer(false)} disabled={envoi} className={secondaire}>Annuler</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirmer(true)} className={bouton}>Fusionner…</button>
      )}
    </div>
  );
}

const LIBELLES: Record<Action<"execution">["action"], { titre: string; suivre: string | null }> = {
  ci: { titre: "CI relancée", suivre: "/decisions" },
  message_pr: { titre: "Message à l'agent de la PR", suivre: "/decisions" },
  message_equipe: { titre: "Message à l'équipe", suivre: null },
  consigne_run: { titre: "Consigne au run", suivre: "/decisions" },
};

function CarteExecution({ action, aller }: { action: Action<"execution">; aller: (href: string) => void }) {
  const libelle = LIBELLES[action.action];
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${action.ok ? "border-trait bg-surface" : "border-danger bg-surface"}`}>
      <p className="font-semibold">
        {action.ok ? "Fait" : "Refusé"} · {libelle.titre} · <span className="font-mono text-xs">{action.cible}</span>
      </p>
      <p className={action.ok ? "text-xs" : "text-xs text-danger"}>{action.detail}</p>
      <Raison texte={action.raison} />
      {action.ok && libelle.suivre && (
        <button type="button" onClick={() => aller(libelle.suivre ?? "/")} className={secondaire}>Suivre l'issue</button>
      )}
    </div>
  );
}

export function ActionsChat({ actions, aller }: { actions: ActionChat[]; aller: (href: string) => void }) {
  if (!actions.length) return null;
  return (
    <div className="mr-auto flex w-full max-w-[92%] flex-col gap-2">
      {actions.map((a) =>
        a.type === "mission" ? <CarteMission key={a.id} action={a} aller={aller} />
        : a.type === "livraison" ? <CarteLivraison key={a.id} action={a} aller={aller} />
        : a.type === "execution" ? <CarteExecution key={a.id} action={a} aller={aller} />
        : <CarteFusion key={a.id} action={a} aller={aller} />
      )}
    </div>
  );
}
