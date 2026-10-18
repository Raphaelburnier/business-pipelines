// Rattacher un pipeline du registre à un projet depuis la page Pipelines.
//
// Les fiches `projects/<id>/project.json` vivent dans git et partent sur le NAS à chaque
// livraison : une fiche modifiée sur la machine serait écrasée au déploiement suivant. Le
// cockpit ne l'écrit donc pas. Il vérifie que la fiche modifiée se résout, puis dépose une
// commande `github.project.attach` ; le publieur, qui a le jeton GitHub, propose la fiche en
// PR sur une branche `automation/`. La CI la valide et l'auto-merge la fusionne ; la livraison
// suivante du cockpit la met en service.
const fs = require("fs");
const os = require("os");
const path = require("path");
const registre = require("agent-orchestrator/src/registre");
const signature = require("./signature-commandes");

const KIND = "github.project.attach";
const ID = /^[a-z0-9][a-z0-9-]*$/;
const REF = /^([a-z0-9][a-z0-9-]*)(?:@([1-9][0-9]*))?$/;

class RefusRattachement extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const base = (ref) => String(ref || "").split("@")[0];

/** La dernière version publiée d'un pipeline du registre, ou `null`. */
function derniereVersion(dossier, nom) {
  try {
    const versions = fs
      .readdirSync(path.join(dossier, "pipelines", nom))
      .map((v) => /^v([1-9][0-9]*)$/.exec(v))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    return versions.length ? Math.max(...versions) : null;
  } catch {
    return null;
  }
}

/** La fiche avec une entrée de plus, au format des fiches du dépôt. */
function ficheRattachee(texte, ref) {
  const fiche = JSON.parse(texte);
  if (!Array.isArray(fiche.pipelines)) throw new Error("fiche sans liste de pipelines");
  if (fiche.pipelines.some((p) => base(p.extends) === base(ref))) return null;
  fiche.pipelines.push({ extends: ref });
  return `${JSON.stringify(fiche, null, 2)}\n`;
}

/**
 * Vérifie qu'un rattachement a un sens avant de le demander : la fiche existe, le pipeline
 * est publié, il n'y est pas déjà, et la fiche modifiée se résout comme au lancement (une
 * étape `verify-project` exige par exemple une `verification` dans la fiche).
 * Rend la référence épinglée `nom@version`.
 * @param {{ projetsDir: string, dossierRegistre: string, projet: unknown, pipeline: unknown }} demande
 */
function verifier({ projetsDir, dossierRegistre, projet, pipeline }) {
  if (typeof projet !== "string" || !ID.test(projet)) throw new RefusRattachement(400, "projet invalide");
  const m = typeof pipeline === "string" ? REF.exec(pipeline) : null;
  if (!m) throw new RefusRattachement(400, "pipeline invalide : nom ou nom@version attendu");
  const version = m[2] ? Number(m[2]) : derniereVersion(dossierRegistre, m[1]);
  if (!version) throw new RefusRattachement(404, `${m[1]} n'est pas un pipeline publié dans le registre`);
  const ref = `${m[1]}@${version}`;
  try {
    registre.lirePipelineBrut(dossierRegistre, ref);
  } catch (err) {
    throw new RefusRattachement(404, String(err.message).split("\n")[0]);
  }

  const fichier = path.join(projetsDir, projet, "project.json");
  if (!fs.existsSync(fichier)) throw new RefusRattachement(404, `le projet ${projet} n'a pas de fiche`);
  const modifiee = ficheRattachee(fs.readFileSync(fichier, "utf8"), ref);
  if (!modifiee) throw new RefusRattachement(409, `${projet} utilise déjà ${m[1]}`);

  // La fiche candidate est résolue dans un dossier temporaire, ses specs en chemins absolus
  // vers ceux de l'originale, puis effacée.
  const essai = fs.mkdtempSync(path.join(os.tmpdir(), "rattachement-"));
  try {
    const candidate = JSON.parse(modifiee);
    for (const p of candidate.pipelines) if (p.spec) p.spec = path.resolve(path.dirname(fichier), p.spec);
    const candidat = path.join(essai, "project.json");
    fs.writeFileSync(candidat, JSON.stringify(candidate));
    registre.resoudreProjet(candidat, { index: candidate.pipelines.length - 1, registre: dossierRegistre });
  } catch (err) {
    throw new RefusRattachement(409, `${ref} ne peut pas servir ${projet} tel quel : ${String(err.message).split("\n")[0]}`);
  } finally {
    fs.rmSync(essai, { recursive: true, force: true });
  }
  return ref;
}

/** Les rattachements demandés, du plus récent au plus ancien, avec leur PR ou leur refus. */
function etat(store) {
  if (!store) return [];
  return store
    .commandes({ limite: 5000 })
    .filter((c) => c.kind === KIND)
    .slice(-10)
    .reverse()
    .map((c) => ({
      id: c.id,
      projet: c.payload.projet,
      pipeline: c.payload.pipeline,
      statut: c.status,
      ok: c.resultat ? Boolean(c.resultat.ok) : null,
      raison: c.resultat && !c.resultat.ok ? c.resultat.raison : null,
      pr: c.resultat && c.resultat.ok && c.resultat.detail ? { numero: c.resultat.detail.numero, url: c.resultat.detail.url } : null,
      par: c.par,
      le: c.done_at || c.created_at,
    }));
}

/**
 * Dépose la demande pour le publieur. Réservée, comme les fusions, aux identités tailnet
 * autorisées à livrer : la PR qui en sort sera fusionnée sans autre clic.
 * @param {{ store: any, projetsDir: string, dossierRegistre: string, depot: string, autorise: boolean, qui: any, demande: any }} options
 */
function demander({ store, projetsDir, dossierRegistre, depot, autorise, qui, demande, cleSignature = signature.cleEnv() }) {
  if (!autorise) throw new RefusRattachement(403, "seule une identité tailnet autorisée à livrer peut rattacher un pipeline");
  if (!store) throw new RefusRattachement(503, "event store indisponible");
  const ref = verifier({ projetsDir, dossierRegistre, projet: demande && demande.projet, pipeline: demande && demande.pipeline });
  const enCours = etat(store).some(
    (r) => r.projet === demande.projet && base(r.pipeline) === base(ref) && (r.statut === "pending" || r.statut === "taken" || (r.ok && r.pr))
  );
  if (enCours) throw new RefusRattachement(409, `un rattachement de ${base(ref)} à ${demande.projet} est déjà demandé`);
  try {
    return store.creerCommande({ kind: KIND, payload: { depot, projet: demande.projet, pipeline: ref }, par: qui.par, canal: qui.canal, signer: signature.signataire(cleSignature, KIND) });
  } catch (err) {
    throw new RefusRattachement(400, err.message);
  }
}

/**
 * Côté publieur : relit la fiche sur la branche par défaut, l'écrit sur une nouvelle branche
 * `automation/` et ouvre la PR. Rend son numéro et son adresse.
 * @param {{ api: (methode: string, chemin: string, corps?: any) => Promise<any>, depot: string, projet: string, pipeline: string, par: string, maintenant?: number }} options
 */
async function proposer({ api, depot, projet, pipeline, par, maintenant = Date.now() }) {
  if (!ID.test(projet) || !REF.test(pipeline) || !pipeline.includes("@")) throw new Error("demande de rattachement invalide");
  const infos = await api("GET", `/repos/${depot}`);
  const parDefaut = infos.default_branch;
  const tete = await api("GET", `/repos/${depot}/git/ref/heads/${encodeURIComponent(parDefaut)}`);
  const chemin = `projects/${projet}/project.json`;
  const fichier = await api("GET", `/repos/${depot}/contents/${chemin}?ref=${tete.object.sha}`);
  const modifiee = ficheRattachee(Buffer.from(fichier.content, "base64").toString("utf8"), pipeline);
  if (!modifiee) throw new Error(`${projet} utilise déjà ${base(pipeline)} sur ${parDefaut}`);

  const branche = `automation/rattacher-${projet}-${base(pipeline)}-${maintenant.toString(36)}`;
  await api("POST", `/repos/${depot}/git/refs`, { ref: `refs/heads/${branche}`, sha: tete.object.sha });
  await api("PUT", `/repos/${depot}/contents/${chemin}`, {
    message: `chore(projects): attach ${pipeline} to ${projet}`,
    content: Buffer.from(modifiee, "utf8").toString("base64"),
    sha: fichier.sha,
    branch: branche,
  });
  const pr = await api("POST", `/repos/${depot}/pulls`, {
    title: `chore(projects): attach ${pipeline} to ${projet}`,
    head: branche,
    base: parDefaut,
    body: `Demandé depuis la page Pipelines du cockpit par ${par}.\n\nAjoute \`{ "extends": "${pipeline}" }\` à \`${chemin}\`. Le projet pourra lancer ce pipeline depuis Missions après la livraison du cockpit.`,
  });
  return { numero: pr.number, url: pr.html_url, branche };
}

module.exports = { KIND, verifier, demander, etat, proposer, ficheRattachee, RefusRattachement };
