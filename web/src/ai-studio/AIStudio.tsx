import { useCallback, useEffect, useId, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { aiStudioApi } from "./api";
import type { CharacterProfile, ComfyStatus, Generation } from "./types";

export type AIStudioPage =
  | { page: "home" }
  | { page: "profile"; id: string; tab: "gallery" | "generate" | "references" | "settings" }
  | { page: "generation"; id: string };

export function AIStudio({ route, aller }: { route: AIStudioPage; aller: (href: string) => void }) {
  if (route.page === "home") return <StudioHome aller={aller} />;
  if (route.page === "generation") return <Inspector id={route.id} aller={aller} />;
  return <ProfileStudio id={route.id} tab={route.tab} aller={aller} />;
}

function StudioHome({ aller }: { aller: (href: string) => void }) {
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const [p, g, s] = await Promise.all([aiStudioApi.profiles(), aiStudioApi.generations(undefined, 12), aiStudioApi.status()]);
      setProfiles(p);
      setGenerations(g);
      setStatus(s);
      setErreur(null);
    } catch (err) {
      setErreur(message(err));
    }
  }, []);
  useEffect(() => void charger(), [charger]);

  return (
    <div className="studio-page">
      <section className="studio-hero">
        <div>
          <p className="studio-eyebrow">Production image · ComfyUI</p>
          <h2>La planche-contact de vos personnages.</h2>
          <p>Créez un profil, cadrez une prise, puis retrouvez chaque seed et chaque workflow à côté de l’image.</p>
        </div>
        <div className={`studio-comfy ${status?.available ? "ok" : "hs"}`}>
          <span className="studio-voyant" aria-hidden="true" />
          <div><b>{status?.available ? "ComfyUI prêt" : "ComfyUI hors ligne"}</b><small>{status?.available ? `${status.latency_ms} ms` : status?.error || "Vérification…"}</small></div>
        </div>
      </section>

      {erreur && <Alerte>{erreur}</Alerte>}
      <div className="studio-section-head">
        <div><span className="studio-index">A</span><h3>Personnages</h3></div>
        <button type="button" className="ao-btn primaire" onClick={() => setCreation((v) => !v)}>{creation ? "Fermer" : "+ Créer un personnage"}</button>
      </div>
      {creation && <CreateProfile onCree={(profile) => aller(`/ai-studio/profiles/${profile.id}/generate`)} />}
      {profiles.length ? (
        <div className="studio-profiles">
          {profiles.map((profile) => {
            const derniere = generations.find((g) => g.profile_id === profile.id && g.status === "completed");
            return (
              <button type="button" className="studio-profile-card" key={profile.id} onClick={() => aller(`/ai-studio/profiles/${profile.id}`)}>
                <span className="studio-profile-visual">
                  {derniere ? <img src={imageUrl(derniere)} alt="" /> : <span className="studio-monogramme">{initiales(profile.name)}</span>}
                  <i>{String(profile.generation_count || 0).padStart(3, "0")}</i>
                </span>
                <span><b>{profile.name}</b><small>{profile.description || "Profil à définir"}</small></span>
              </button>
            );
          })}
        </div>
      ) : <Vide titre="Aucun personnage" action="Créez le premier profil pour préparer une génération reproductible." />}

      <div className="studio-section-head studio-recentes"><div><span className="studio-index">B</span><h3>Prises récentes</h3></div></div>
      {generations.length ? <ContactSheet generations={generations} aller={aller} /> : <Vide titre="Aucune prise" action="Les générations apparaîtront ici, y compris pendant leur traitement." />}
    </div>
  );
}

function CreateProfile({ onCree }: { onCree: (profile: CharacterProfile) => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const soumettre = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOccupe(true);
    try {
      const profile = await aiStudioApi.createProfile({
        name: String(form.get("name") || ""), description: String(form.get("description") || ""),
        project_id: String(form.get("project_id") || ""),
        identity_prompt: String(form.get("identity_prompt") || ""), negative_prompt: String(form.get("negative_prompt") || ""),
        checkpoint: String(form.get("checkpoint") || ""), preferred_ratio: "4:5",
      });
      onCree(profile);
    } catch (err) {
      setErreur(message(err));
    } finally { setOccupe(false); }
  };
  return (
    <form className="studio-panel studio-create" onSubmit={soumettre}>
      <Champ label="Nom" name="name" placeholder="Luna" required />
      <Champ label="Projet d'archive" name="project_id" placeholder="tokyo-weekend (sinon : nom du personnage)" />
      <Champ label="Description" name="description" placeholder="Personnage Instagram lifestyle" />
      <CheckpointField label="Checkpoint par défaut" required />
      <label className="studio-field wide"><span>Prompt d’identité</span><textarea name="identity_prompt" rows={3} placeholder="adult woman, green eyes, black bob haircut…" /></label>
      <label className="studio-field wide"><span>Negative prompt</span><textarea name="negative_prompt" rows={2} placeholder="deformed, low quality…" /></label>
      {erreur && <Alerte>{erreur}</Alerte>}
      <button className="ao-btn primaire" disabled={occupe}>{occupe ? "Création…" : "Créer et générer"}</button>
    </form>
  );
}

function ProfileStudio({ id, tab, aller }: { id: string; tab: "gallery" | "generate" | "references" | "settings"; aller: (href: string) => void }) {
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = generations.some((g) => !["completed", "failed", "cancelled"].includes(g.status));
  const charger = useCallback(async () => {
    try {
      const [p, g] = await Promise.all([aiStudioApi.profile(id), aiStudioApi.generations(id)]);
      setProfile(p); setGenerations(g); setErreur(null);
    } catch (err) { setErreur(message(err)); }
  }, [id]);
  useEffect(() => void charger(), [charger]);
  useEffect(() => {
    if (!actif) return;
    const timer = setInterval(() => void charger(), 1500);
    return () => clearInterval(timer);
  }, [actif, charger]);
  if (erreur) return <Alerte>{erreur}</Alerte>;
  if (!profile) return <Chargement />;

  const racine = `/ai-studio/profiles/${profile.id}`;
  return (
    <div className="studio-page">
      <header className="studio-profile-head">
        <button type="button" className="studio-retour" onClick={() => aller("/ai-studio")}>← AI Studio</button>
        <div className="studio-avatar">{initiales(profile.name)}</div>
        <div><p className="studio-eyebrow">Character profile · {profile.id}</p><h2>{profile.name}</h2><p>{profile.description || "Description non renseignée"}</p></div>
        <div className="studio-profile-stat"><b>{generations.filter((g) => g.status === "completed").length}</b><span>prises</span></div>
      </header>
      <nav className="studio-tabs" aria-label={`Navigation de ${profile.name}`}>
        {(["gallery", "generate", "references", "settings"] as const).map((nom) => (
          <button key={nom} type="button" aria-current={tab === nom ? "page" : undefined} onClick={() => aller(nom === "gallery" ? racine : `${racine}/${nom}`)}>{libelleTab(nom)}</button>
        ))}
      </nav>
      {tab === "gallery" && (generations.length ? <ContactSheet generations={generations} aller={aller} /> : <Vide titre="Galerie vide" action="Passez dans Generate pour préparer la première prise." />)}
      {tab === "generate" && <Generate profile={profile} aller={aller} />}
      {tab === "references" && <References profile={profile} onChange={charger} />}
      {tab === "settings" && <Settings profile={profile} onChange={setProfile} />}
    </div>
  );
}

function Generate({ profile, aller }: { profile: CharacterProfile; aller: (href: string) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const valeur = (nom: string) => String(form.get(nom) || "");
    setOccupe(true); setErreur(null);
    try {
      const resultat = await aiStudioApi.generate({
        profile_id: profile.id,
        project_id: valeur("project_id"),
        workflow_id: valeur("workflow_id"),
        prompt: valeur("prompt"), scene: valeur("scene"), outfit: valeur("outfit"), pose: valeur("pose"),
        camera_angle: valeur("camera_angle"), shot_type: valeur("shot_type"), lighting: valeur("lighting"), style: valeur("style"),
        aspect_ratio: valeur("aspect_ratio"), count: Number(valeur("count")), same_seed: form.get("same_seed") === "on",
        creativity: Number(valeur("creativity") || 0.65),
        settings: {
          checkpoint: valeur("checkpoint"), seed: valeur("seed") || undefined,
          cfg: advanced ? Number(valeur("cfg")) : Number((6.5 - 3 * Number(valeur("creativity") || 0.65)).toFixed(1)),
          steps: Number(valeur("steps")),
          sampler: valeur("sampler"), scheduler: valeur("scheduler"), denoise: Number(valeur("denoise")),
          width: advanced ? Number(valeur("width")) : undefined, height: advanced ? Number(valeur("height")) : undefined,
          identity_strength: Number(valeur("identity_strength")),
        },
      });
      const premiere = resultat.generations[0];
      if (!premiere) throw new Error("Aucune génération créée.");
      aller(`/ai-studio/generations/${premiere.generation_id}`);
    } catch (err) { setErreur(message(err)); setOccupe(false); }
  };

  return (
    <form className="studio-generate" onSubmit={soumettre}>
      <section className="studio-director-card">
        <div className="studio-step"><span>01</span><div><b>Décrire la prise</b><small>L’identité du profil est ajoutée séparément.</small></div></div>
        <label className="studio-prompt"><textarea name="prompt" required rows={4} placeholder={`${profile.name} walking through Tokyo at night, full body, 3/4 view`} /></label>
        <div className="studio-form-grid">
          <Champ label="Scène" name="scene" placeholder="Tokyo night" />
          <Champ label="Tenue" name="outfit" placeholder="Black streetwear" />
          <Select label="Pose" name="pose" options={["walking", "standing", "sitting", "looking back", "candid"]} />
          <Select label="Angle" name="camera_angle" options={["eye level", "front", "3/4 left", "3/4 right", "profile left", "profile right", "low angle", "high angle", "over shoulder"]} />
          <Select label="Cadrage" name="shot_type" options={["full body", "medium shot", "close-up", "wide shot", "selfie", "mirror selfie"]} />
          <Select label="Lumière" name="lighting" options={["soft natural light", "golden hour", "neon night", "studio softbox", "hard flash"]} />
          <Select label="Style" name="style" options={["realistic Instagram lifestyle", "street photography", "luxury fashion", "cinematic portrait", "editorial"]} />
          <Select label="Ratio" name="aspect_ratio" options={["4:5", "1:1", "9:16", "1.91:1"]} />
        </div>
      </section>
      <section className="studio-director-card">
        <div className="studio-step"><span>02</span><div><b>Régler la série</b><small>Les images choisies seront archivées après validation.</small></div></div>
        <div className="studio-controls">
          <label><span>Projet</span><input name="project_id" defaultValue={profile.project_id || profile.id} required /></label>
          <label><span>Workflow</span><select name="workflow_id" defaultValue="portrait_realistic_v1"><option value="portrait_realistic_v1">Portrait realistic</option></select></label>
          <label><span>Images</span><select name="count" defaultValue="4">{[1, 2, 4, 6, 8].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label><span>Identity</span><input name="identity_strength" type="range" min="0" max="1" step="0.01" defaultValue="0" disabled title="Activé en Phase 2" /><small>Phase 2</small></label>
          <label><span>Créativité</span><input name="creativity" type="range" min="0" max="1" step="0.05" defaultValue="0.65" /></label>
          <label><input name="same_seed" type="checkbox" /> Même seed</label>
        </div>
        <button type="button" className="studio-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>{advanced ? "− Masquer les paramètres avancés" : "+ Paramètres avancés"}</button>
        {advanced && <AdvancedFields profile={profile} />}
      </section>
      {!advanced && <AdvancedHidden profile={profile} />}
      {erreur && <Alerte>{erreur}</Alerte>}
      <div className="studio-generate-action"><span><b>{profile.name}</b><small>portrait_realistic_v1 · {profile.default_resolution.width}×{profile.default_resolution.height}</small></span><button className="ao-btn primaire" disabled={occupe}>{occupe ? "Mise en file…" : "Générer"}</button></div>
    </form>
  );
}

function AdvancedFields({ profile, settings }: { profile: CharacterProfile; settings?: Generation["settings"] }) {
  const s = settings;
  return <div className="studio-advanced">
    <CheckpointField label="Checkpoint" defaultValue={s?.checkpoint || profile.checkpoint} required />
    <Champ label="Seed (vide = aléatoire)" name="seed" type="number" defaultValue={s?.seed} />
    <Champ label="CFG" name="cfg" type="number" min="1" max="15" step="0.1" defaultValue={s?.cfg ?? 5} />
    <Champ label="Steps" name="steps" type="number" min="1" max="150" defaultValue={s?.steps ?? 28} />
    <Select label="Sampler" name="sampler" options={["dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "euler", "euler_ancestral"]} defaultValue={s?.sampler} />
    <Select label="Scheduler" name="scheduler" options={["karras", "normal", "exponential", "sgm_uniform", "simple"]} defaultValue={s?.scheduler} />
    <Champ label="Denoise" name="denoise" type="number" min="0" max="1" step="0.01" defaultValue={s?.denoise ?? 1} />
    <Champ label="Largeur" name="width" type="number" min="256" max="4096" step="8" defaultValue={s?.width ?? profile.default_resolution.width} />
    <Champ label="Hauteur" name="height" type="number" min="256" max="4096" step="8" defaultValue={s?.height ?? profile.default_resolution.height} />
  </div>;
}

function AdvancedHidden({ profile }: { profile: CharacterProfile }) {
  return <>{Object.entries({ checkpoint: profile.checkpoint, steps: 28, sampler: "dpmpp_2m", scheduler: "karras", denoise: 1 }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</>;
}

function References({ profile, onChange }: { profile: CharacterProfile; onChange: () => void }) {
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOccupe(true); setErreur(null);
    try { await aiStudioApi.addReference(profile.id, file); onChange(); }
    catch (err) { setErreur(message(err)); }
    finally { setOccupe(false); event.target.value = ""; }
  };
  return <section className="studio-panel">
    <div className="studio-section-head"><div><span className="studio-index">REF</span><h3>Images de référence</h3></div><label className="ao-btn primaire studio-upload">{occupe ? "Import…" : "+ Ajouter"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={envoyer} disabled={occupe} /></label></div>
    <p className="studio-note">Conservées avec le profil dans les données de travail. Leur injection IPAdapter/FaceID arrive en Phase 2.</p>
    {erreur && <Alerte>{erreur}</Alerte>}
    {profile.references.length ? <div className="studio-reference-grid">{profile.references.map((r) => <figure key={r.name}><img src={r.url} alt={`Référence ${r.name}`} /><figcaption>{r.name}</figcaption></figure>)}</div> : <Vide titre="Aucune référence" action="Ajoutez un visage net et un plein pied. PNG, JPEG ou WebP, 12 Mio maximum." />}
  </section>;
}

function Settings({ profile, onChange }: { profile: CharacterProfile; onChange: (p: CharacterProfile) => void }) {
  const [messageEtat, setMessageEtat] = useState<string | null>(null);
  const soumettre = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const profileMaj = await aiStudioApi.updateProfile(profile.id, {
        name: String(form.get("name")), description: String(form.get("description")), checkpoint: String(form.get("checkpoint")),
        project_id: String(form.get("project_id")),
        identity_prompt: String(form.get("identity_prompt")), negative_prompt: String(form.get("negative_prompt")),
        default_resolution: { width: Number(form.get("width")), height: Number(form.get("height")) },
      } as Partial<CharacterProfile>);
      onChange(profileMaj); setMessageEtat("Profil enregistré.");
    } catch (err) { setMessageEtat(message(err)); }
  };
  return <form className="studio-panel studio-settings" onSubmit={soumettre}>
    <Champ label="Nom" name="name" defaultValue={profile.name} required /><Champ label="Description" name="description" defaultValue={profile.description} />
    <Champ label="Projet par défaut" name="project_id" defaultValue={profile.project_id || profile.id} required />
    <CheckpointField label="Checkpoint" defaultValue={profile.checkpoint} required />
    <label className="studio-field wide"><span>Prompt d’identité</span><textarea name="identity_prompt" rows={5} defaultValue={profile.identity_prompt} /></label>
    <label className="studio-field wide"><span>Negative prompt</span><textarea name="negative_prompt" rows={4} defaultValue={profile.negative_prompt} /></label>
    <Champ label="Largeur par défaut" name="width" type="number" step="8" defaultValue={profile.default_resolution.width} />
    <Champ label="Hauteur par défaut" name="height" type="number" step="8" defaultValue={profile.default_resolution.height} />
    <button className="ao-btn primaire">Enregistrer</button>{messageEtat && <p role="status">{messageEtat}</p>}
  </form>;
}

function Inspector({ id, aller }: { id: string; aller: (href: string) => void }) {
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [validationEnCours, setValidationEnCours] = useState(false);
  const charger = useCallback(async () => {
    try { const g = await aiStudioApi.generation(id); setGeneration(g); setProfile(await aiStudioApi.profile(g.profile_id)); setErreur(null); }
    catch (err) { setErreur(message(err)); }
  }, [id]);
  useEffect(() => void charger(), [charger]);
  useEffect(() => {
    if (!generation || (["completed", "failed", "cancelled"].includes(generation.status) && !(generation.approved_at && !generation.archived_at))) return;
    const timer = setInterval(() => void charger(), 1200); return () => clearInterval(timer);
  }, [generation, charger]);
  if (!generation || !profile) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const terminal = ["completed", "failed", "cancelled"].includes(generation.status);

  const valider = async () => {
    setValidationEnCours(true); setErreur(null);
    try {
      setGeneration(await aiStudioApi.approve(generation.generation_id));
      await charger();
    } catch (err) { setErreur(message(err)); }
    finally { setValidationEnCours(false); }
  };

  const regenerer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const r = await aiStudioApi.regenerate(generation.generation_id, { same_seed: form.get("same_seed") === "on", settings: { cfg: Number(form.get("cfg")), steps: Number(form.get("steps")), denoise: Number(form.get("denoise")), sampler: String(form.get("sampler")), scheduler: String(form.get("scheduler")), width: Number(form.get("width")), height: Number(form.get("height")), checkpoint: String(form.get("checkpoint")) } });
      const variante = r.generations[0];
      if (!variante) throw new Error("Aucune variante créée.");
      aller(`/ai-studio/generations/${variante.generation_id}`);
    } catch (err) { setErreur(message(err)); }
  };
  return <div className="studio-page inspector-page">
    <button type="button" className="studio-retour" onClick={() => aller(`/ai-studio/profiles/${generation.profile_id}`)}>← Galerie {profile.name}</button>
    {erreur && <Alerte>{erreur}</Alerte>}
    <div className="studio-inspector">
      <section className="studio-inspector-image">
        {generation.status === "completed" ? <img src={imageUrl(generation)} alt={generation.request.prompt} /> : <ProgressCard generation={generation} />}
        <span className="studio-shot-id">{generation.generation_id}</span>
      </section>
      <section className="studio-inspector-data">
        <p className="studio-eyebrow">Image inspector</p><h2>{profile.name}</h2>
        <p className="studio-inspector-prompt">{generation.request.prompt}</p>
        {generation.error && <Alerte>{generation.error}</Alerte>}
        <dl className="studio-metadata">
          <Meta label="État" value={generation.status} /><Meta label="Seed" value={String(generation.seed)} /><Meta label="Workflow" value={generation.workflow_id} />
          <Meta label="Projet" value={generation.project_id || generation.profile_id} /><Meta label="Archive NAS" value={generation.archived_at ? `Archivée le ${dateCourte(generation.archived_at)}` : generation.approved_at ? "Validation enregistrée · transfert en attente" : "En attente de validation"} />
          {generation.archive?.directory && <Meta label="Dossier archive" value={generation.archive.directory} />}
          <Meta label="Checkpoint" value={generation.settings.checkpoint} /><Meta label="CFG" value={String(generation.settings.cfg)} /><Meta label="Steps" value={String(generation.settings.steps)} />
          <Meta label="Sampler" value={generation.settings.sampler} /><Meta label="Scheduler" value={generation.settings.scheduler} /><Meta label="Denoise" value={String(generation.settings.denoise)} />
          <Meta label="Résolution" value={`${generation.settings.width} × ${generation.settings.height}`} /><Meta label="Identity" value={`${generation.settings.identity.method} · ${generation.settings.identity.strength}`} />
          <Meta label="LoRA" value={generation.settings.loras.length ? generation.settings.loras.map((l) => `${l.name} ${l.weight}`).join(", ") : "Aucun"} />
          <Meta label="Comfy prompt_id" value={generation.prompt_id || "—"} /><Meta label="Créée" value={dateCourte(generation.created_at)} />
        </dl>
        <details className="studio-prompt-details"><summary>Prompts structurés</summary><pre>{generation.settings.positive_prompt}</pre><h4>Negative</h4><pre>{generation.settings.negative_prompt || "—"}</pre></details>
        <div className="studio-inspector-actions">
          {generation.status === "completed" && !generation.approved_at && <button type="button" className="ao-btn primaire" disabled={validationEnCours} onClick={() => void valider()}>{validationEnCours ? "Validation…" : "Valider et archiver"}</button>}
          {generation.archive_error && <Alerte>{generation.archive_error}</Alerte>}
          <button type="button" className="ao-btn" onClick={() => void navigator.clipboard.writeText(generation.settings.positive_prompt)}>Copier le prompt</button>
          <button type="button" className="ao-btn" onClick={() => void navigator.clipboard.writeText(JSON.stringify(generation.settings, null, 2))}>Copier les réglages</button>
          <a className="ao-btn" href={`/api/ai-studio/generations/${generation.generation_id}/workflow`} download>Télécharger le workflow</a>
          {!terminal && <button type="button" className="ao-btn" onClick={() => void aiStudioApi.cancel(generation.generation_id).then(charger)}>Annuler</button>}
        </div>
        {terminal && <form className="studio-regenerate" onSubmit={regenerer}><h3>Regénérer / ajuster</h3><AdvancedFields profile={profile} settings={generation.settings} /><label className="studio-check"><input type="checkbox" name="same_seed" defaultChecked /> Conserver la seed</label><button className="ao-btn primaire">Créer la variante</button></form>}
      </section>
    </div>
  </div>;
}

function ContactSheet({ generations, aller }: { generations: Generation[]; aller: (href: string) => void }) {
  return <div className="studio-contact-sheet">{generations.map((g, index) => <button type="button" className="studio-shot" key={g.generation_id} onClick={() => aller(`/ai-studio/generations/${g.generation_id}`)}><span className="studio-shot-frame">{g.status === "completed" ? <img src={imageUrl(g)} alt={g.request.prompt} loading="lazy" /> : <ProgressCard generation={g} />}</span><span className="studio-shot-caption"><b>{String(index + 1).padStart(2, "0")}</b><span>{g.request.prompt || g.status}</span><small>{g.status === "completed" ? g.archived_at ? "Archivée" : g.approved_at ? "Archivage en attente" : "À valider" : g.status} · {g.seed}</small></span></button>)}</div>;
}

function ProgressCard({ generation }: { generation: Generation }) {
  return <span className={`studio-progress ${generation.status === "failed" ? "failed" : ""}`}><i style={{ "--progress": `${generation.progress}%` } as CSSProperties} /><b>{generation.progress}%</b><small>{generation.status.replaceAll("_", " ")}</small></span>;
}

function Champ({ label, name, placeholder, required, type = "text", defaultValue, min, max, step }: { label: string; name: string; placeholder?: string; required?: boolean; type?: string; defaultValue?: string | number; min?: string; max?: string; step?: string }) {
  return <label className="studio-field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} min={min} max={max} step={step} /></label>;
}
function CheckpointField({ label, defaultValue, required }: { label: string; defaultValue?: string; required?: boolean }) {
  const listeId = useId();
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    let actif = true;
    aiStudioApi.checkpoints().then((noms) => { if (actif) setCheckpoints(noms); })
      .catch(() => { if (actif) setErreur(true); });
    return () => { actif = false; };
  }, []);
  return <label className="studio-field"><span>{label}</span>
    <input name="checkpoint" list={listeId} defaultValue={defaultValue} placeholder="Sélectionner un modèle ComfyUI" required={required} />
    <datalist id={listeId}>{checkpoints.map((nom) => <option key={nom} value={nom} />)}</datalist>
    <small>{erreur ? "ComfyUI indisponible : saisir le nom exact du checkpoint." : checkpoints.length ? `${checkpoints.length} checkpoint(s) détecté(s) sur le PC.` : "Chargement des modèles ComfyUI…"}</small>
  </label>;
}
function Select({ label, name, options, defaultValue }: { label: string; name: string; options: string[]; defaultValue?: string }) {
  return <label className="studio-field"><span>{label}</span><select name={name} defaultValue={defaultValue || options[0]}>{options.map((o) => <option key={o}>{o}</option>)}</select></label>;
}
function Meta({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>; }
function Alerte({ children }: { children: string }) { return <div className="studio-alert" role="alert">{children}</div>; }
function Vide({ titre, action }: { titre: string; action: string }) { return <div className="studio-empty"><b>{titre}</b><span>{action}</span></div>; }
function Chargement() { return <div className="studio-empty"><b>Chargement du studio…</b></div>; }
function message(err: unknown) { return err instanceof Error ? err.message : String(err); }
function initiales(nom: string) { return nom.split(/\s+/).map((m) => m[0]).join("").slice(0, 2).toUpperCase(); }
function imageUrl(g: Generation) { return `/api/ai-studio/generations/${encodeURIComponent(g.generation_id)}/image?v=${encodeURIComponent(g.updated_at)}`; }
function dateCourte(iso: string) { return new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); }
function libelleTab(tab: "gallery" | "generate" | "references" | "settings") { return { gallery: "Galerie", generate: "Generate", references: "Références", settings: "Settings" }[tab]; }
