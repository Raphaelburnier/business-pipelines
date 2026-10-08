import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { enAttente, messageStatut, type FilEquipe, type OptionsDiscussion, type SelectionEquipe } from "../donnees/discussions";
import { Erreur, Titre } from "../ui";
import { ModeleMission } from "./Missions";

const champ = "w-full rounded-lg border border-trait bg-carte px-3 py-2 text-sm";
const bouton = "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-sur-accent disabled:opacity-50";
const natifs = ["claude", "codex"];

function useEnvoiUnique() {
  const precedent = useRef<{ contenu: string; id: string } | null>(null);
  const idPour = (demande: unknown) => {
    const contenu = JSON.stringify(demande);
    if (precedent.current?.contenu !== contenu) precedent.current = { contenu, id: crypto.randomUUID() };
    return precedent.current.id;
  };
  return [idPour, () => { precedent.current = null; }] as const;
}

export function Marketing({ projetInitial, filId, aller }: { projetInitial: string | null; filId: string | null; aller: (href: string) => void }) {
  const topo = useCharge((s) => s.topologie(), []);
  const [projetId, setProjetId] = useState(projetInitial ?? "");
  const [occupe, setOccupe] = useState(false);
  const fils = useCharge((s) => s.filsEquipe(projetId || undefined), [projetId]);
  return <section className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
    <div><Titre>Équipe marketing</Titre><p className="text-sm text-douce">Discute des objectifs du projet, donne des directives et prépare une spec avec ton équipe.</p></div>
    {topo.erreur && <Erreur>{topo.erreur}</Erreur>}
    <label className="text-sm">Projet
      <select className={champ} disabled={occupe} value={projetId} onChange={(e) => { setProjetId(e.target.value); aller(e.target.value ? `/marketing/${encodeURIComponent(e.target.value)}` : "/marketing"); }}>
        <option value="">Choisir un projet…</option>
        {topo.donnees?.projets.filter((p) => p.aFiche).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
      </select>
    </label>
    {fils.erreur && <Erreur>{fils.erreur}</Erreur>}
    {!!fils.donnees?.length && <nav aria-label="Discussions du projet" className="flex flex-wrap gap-2">
      {fils.donnees.map((f) => <a key={f.id} href={`/marketing/${f.projectId}/${f.id}`} aria-current={filId === f.id ? "page" : undefined} className="max-w-xs truncate rounded-lg border border-trait px-3 py-2 text-sm">{f.objectif}</a>)}
    </nav>}
    {projetId && <a className="text-sm text-accent underline" href={`/marketing/${encodeURIComponent(projetId)}`}>Nouvelle discussion sur ce projet</a>}
    {filId ? <Conversation key={filId} filId={filId} projectId={projetId} aller={aller} /> : projetId ? <Ouvrir key={projetId} projectId={projetId} aller={aller} surEnvoi={setOccupe} /> : <p className="text-sm text-douce">Sélectionne le projet pour retrouver son équipe et ses discussions.</p>}
  </section>;
}

function Ouvrir({ projectId, aller, surEnvoi }: { projectId: string; aller: (href: string) => void; surEnvoi: (valeur: boolean) => void }) {
  const { source } = useSource();
  const [options, setOptions] = useState<OptionsDiscussion | null>(null);
  const [participants, setParticipants] = useState<SelectionEquipe[]>([]);
  const [objectif, setObjectif] = useState("");
  const [contenu, setContenu] = useState("");
  const [type, setType] = useState<"message" | "directive">("message");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(0);
  const catalogue = useCharge((s) => s.modeles(), []);
  const [idPour] = useEnvoiUnique();
  useEffect(() => {
    let annule = false;
    setOptions(null);
    source.optionsDiscussion(projectId).then((o) => {
      if (annule) return;
      setOptions(o);
      setParticipants(o.membres.slice(0, 6).map((m) => ({ membre: m.membre, llm: m.llm })));
      setErreur(null);
    }).catch((err: unknown) => { if (!annule) setErreur(err instanceof Error ? err.message : String(err)); });
    return () => { annule = true; };
  }, [source, projectId, lecture]);
  async function ouvrir(e: FormEvent) {
    e.preventDefault();
    if (!options || envoi) return;
    const demande = { projectId, configuration: options.configuration, objectif: objectif.trim(), contenu: contenu.trim(), type, participants };
    if (!demande.objectif || !demande.contenu || !participants.length) { setErreur("Indique un objectif, un premier message et au moins un agent."); return; }
    setEnvoi(true); surEnvoi(true); setErreur(null);
    try {
      const f = await source.ouvrirDiscussion({ ...demande, requestId: idPour(demande) });
      aller(`/marketing/${f.projectId}/${f.id}`);
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); setEnvoi(false); surEnvoi(false); }
  }
  if (!options) return <div>{erreur ? <><Erreur>{erreur}</Erreur><button className={bouton} onClick={() => setLecture((n) => n + 1)}>Relire l'équipe</button></> : <p>Préparation de l'équipe…</p>}</div>;
  return <form onSubmit={ouvrir} className="flex flex-col gap-4 rounded-xl border border-trait bg-surface p-4">
    <h2 className="font-semibold">Nouvelle discussion · {options.nom}</h2>
    <fieldset disabled={envoi} className="flex flex-col gap-3 disabled:opacity-60">
      <legend className="mb-2 text-sm font-semibold">Participants</legend>
      {options.membres.map((m) => {
        const p = participants.find((p) => p.membre === m.membre);
        return <div key={m.membre} className="grid gap-2 rounded-lg border border-trait p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(p)} onChange={(e) => setParticipants((a) => e.target.checked ? [...a, { membre: m.membre, llm: m.llm }] : a.filter((p) => p.membre !== m.membre))} />{m.nom} · {m.role}</label>
          {p && <ModeleMission choix={{ ...p, noeud: m.membre }} catalogue={catalogue.donnees} vias={natifs} changer={(llm) => {
            if (llm.via !== "claude" && llm.via !== "codex") return;
            const choisi: SelectionEquipe["llm"] = { via: llm.via, model: llm.model };
            setParticipants((a) => a.map((p) => p.membre === m.membre ? { ...p, llm: choisi } : p));
          }} />}
        </div>;
      })}
      {catalogue.erreur && <p role="status" className="text-sm text-alerte">Catalogue indisponible ; les choix configurés restent visibles. {catalogue.erreur}</p>}
      <label className="text-sm">Objectif du projet<textarea className={champ} required rows={3} maxLength={4000} value={objectif} onChange={(e) => setObjectif(e.target.value)} /></label>
      <label className="text-sm">Premier message<textarea className={champ} required rows={4} maxLength={4000} value={contenu} onChange={(e) => setContenu(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={type === "directive"} onChange={(e) => setType(e.target.checked ? "directive" : "message")} />Conserver ce message comme directive pour les prochains tours</label>
    </fieldset>
    <p className="text-sm text-douce">Chaque participant choisi répondra depuis son rôle. Les modèles et l'objectif sont conservés pour ce fil.</p>
    {erreur && <Erreur>{erreur}</Erreur>}
    <button className={bouton} disabled={envoi || !participants.length} type="submit">{envoi ? "Envoi en cours…" : "Ouvrir la discussion"}</button>
  </form>;
}

function Conversation({ filId, projectId, aller }: { filId: string; projectId: string; aller: (href: string) => void }) {
  const { source } = useSource();
  const [revision, setRevision] = useState(0);
  const lecture = useCharge((s) => s.filEquipe(filId), [filId, revision]);
  const fil = lecture.donnees;
  const [contenu, setContenu] = useState("");
  const [type, setType] = useState<"message" | "directive">("message");
  const [destinataire, setDestinataire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<string | null>(null);
  const [idPour, oublierEnvoi] = useEnvoiUnique();
  const [idBrouillon] = useEnvoiUnique();
  const occupe = Boolean(fil?.tours.some((t) => enAttente(t.statut)));
  useEffect(() => {
    if (!occupe) return;
    const timer = setInterval(() => setRevision((r) => r + 1), 3000);
    return () => clearInterval(timer);
  }, [occupe]);
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (envoi || occupe || !contenu.trim()) return;
    const demande = { contenu: contenu.trim(), type, ...(destinataire ? { destinataires: [destinataire] } : {}) };
    setEnvoi(true); setErreur(null);
    try {
      await source.envoyerEquipe(filId, { ...demande, requestId: idPour(demande) });
      oublierEnvoi();
      setContenu(""); setType("message"); setRevision((r) => r + 1);
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  async function transmettre(tour: string, membre: string, proposition: number) {
    if (preparation) return;
    const demande = { tour, membre, proposition };
    setPreparation(`${tour}:${membre}:${proposition}`); setErreur(null);
    try {
      const b = await source.preparerBrouillonEquipe(filId, { ...demande, requestId: idBrouillon(demande) });
      aller(`/missions/${encodeURIComponent(b.projectId)}?brouillon=${encodeURIComponent(b.id)}`);
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setPreparation(null); }
  }
  if (!fil) return lecture.erreur ? <Erreur>{lecture.erreur}</Erreur> : <p>Lecture de la discussion…</p>;
  if (fil.projectId !== projectId) return <Erreur>Cette discussion appartient à un autre projet.</Erreur>;
  return <div className="flex flex-col gap-4">
    <header className="rounded-xl border border-trait bg-carte p-4"><h2 className="font-semibold">{fil.objectif}</h2><p className="mt-2 text-xs text-douce">{fil.participants.map((p) => `${p.nom} · ${p.role} · ${p.llm.via}:${p.llm.model}`).join(" / ")}</p></header>
    {lecture.erreur && <Erreur>{lecture.erreur}</Erreur>}
    <div className="flex flex-col gap-4" aria-label="Messages de l'équipe">
      {fil.tours.map((t) => <article key={t.id} className="rounded-xl border border-trait bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-douce"><span>{t.par} · {t.type === "directive" ? "Directive conservée" : "Message"}</span><span role="status">{messageStatut(t.statut)}</span></div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{t.contenu}</p>
        {t.run && <a className="mt-2 inline-block text-xs text-accent underline" href={`/runs/${t.run}`}>Suivre ce tour</a>}
        {t.erreur && <Erreur>{t.erreur}</Erreur>}
        {t.reponses.map((r) => <div key={r.membre} className="mt-4 rounded-lg border-l-2 border-accent bg-carte p-3">
          <h3 className="text-sm font-semibold">{fil.participants.find((p) => p.membre === r.membre)?.nom ?? r.membre}<span className="ml-2 text-xs font-normal text-douce">{r.modeleObserve}</span></h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">{r.reponse.contenu}</p>
          {!!r.reponse.questions.length && <ul className="mt-2 list-disc pl-5 text-sm">{r.reponse.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
          {r.reponse.propositions.map((p, i) => <details key={i} className="mt-3 rounded-lg border border-trait p-3">
            <summary className="cursor-pointer text-sm font-semibold">{p.titre}</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm">{p.objectif}</p>
            <ul className="mt-2 list-disc pl-5 text-sm">{p.criteres.map((c, j) => <li key={j}>{c}</li>)}</ul>
            <p className="mt-2 whitespace-pre-wrap text-sm text-douce">{p.document}</p>
            <button type="button" disabled={Boolean(preparation)} className={`${bouton} mt-3`} onClick={() => void transmettre(t.id, r.membre, i)}>Préparer cette spec pour le dev</button>
          </details>)}
        </div>)}
        {t.destinataires.some((m) => !t.reponses.some((r) => r.membre === m)) && <p className="mt-3 text-xs text-douce">{enAttente(t.statut) ? "Réponses attendues : " : "Aucune réponse validée de : "}{t.destinataires.filter((m) => !t.reponses.some((r) => r.membre === m)).map((m) => fil.participants.find((p) => p.membre === m)?.nom ?? m).join(", ")}</p>}
      </article>)}
    </div>
    {!!fil.brouillons.length && <div className="rounded-lg border border-trait p-3 text-sm"><h3 className="font-semibold">Specs préparées</h3><ul className="mt-2 list-disc pl-5">{fil.brouillons.map((b) => <li key={b.id}><a className="text-accent underline" href={`/missions/${b.projectId}?brouillon=${b.id}`}>{b.titre}</a></li>)}</ul></div>}
    <form onSubmit={envoyer} className="flex flex-col gap-3 rounded-xl border border-trait bg-carte p-4">
      <fieldset disabled={envoi || occupe} className="flex flex-col gap-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-semibold">Continuer la discussion</legend>
        <label className="text-sm">Destinataires<select className={champ} value={destinataire} onChange={(e) => setDestinataire(e.target.value)}><option value="">Toute l'équipe</option>{fil.participants.map((p) => <option key={p.membre} value={p.membre}>{p.nom} · {p.role}</option>)}</select></label>
        <label className="text-sm">Message<textarea required maxLength={4000} rows={4} className={champ} value={contenu} onChange={(e) => setContenu(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={type === "directive"} onChange={(e) => setType(e.target.checked ? "directive" : "message")} />Conserver comme directive pour les prochains tours</label>
      </fieldset>
      {occupe && <p role="status" className="text-sm text-douce">Termine le tour en cours avant d'envoyer le suivant. Les attentes de quota ou de connexion restent visibles dans son run.</p>}
      {erreur && <Erreur>{erreur}</Erreur>}
      <button type="submit" disabled={envoi || occupe || !contenu.trim()} className={bouton}>{envoi ? "Envoi en cours…" : "Envoyer à l'équipe"}</button>
    </form>
  </div>;
}
