#!/usr/bin/env node
// Service de livraison du cockpit : voir src/livreur.js et docs/SPEC-livraison.md.
//
// Deux choses en boucle. Publier la proposition (ce qui tourne, ce qui peut partir) dans
// etat/livraison.json, que le cockpit affiche. Et prendre les commandes `livraison.start`,
// une à la fois, pour les exécuter : vérifier, préparer la release, lancer deploy.sh, raconter
// chaque étape dans l'event store, qui les relaie au cockpit par son flux.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore } = require("agent-orchestrator");
const livreur = require("../src/livreur");
const signature = require("../src/signature-commandes");

const BUSINESS = process.env.LIVREUR_BUSINESS || "/volume1/docker/business-pipelines";
const STORE = process.env.ORCH_EVENT_STORE || path.join(BUSINESS, "etat", "events.sqlite");
const MIROIRS_DIR = process.env.LIVREUR_MIROIRS || "/git/systeme";
const RELEASES = process.env.LIVREUR_RELEASES || "/volume1/docker/releases";
const SAUVEGARDES = process.env.LIVREUR_SAUVEGARDES || "/volume1/docker/business-pipelines-backups";
const PROPOSITION = path.join(BUSINESS, "etat", "livraison.json");
const AUTORISES = path.join(BUSINESS, "specs", "livraison.json");
const INTERVALLE_FILE = Number(process.env.LIVREUR_FILE_MS || 2000);
const INTERVALLE_PROPOSITION = Number(process.env.LIVREUR_PROPOSITION_MS || 60000);
// Décision du 2026-09-29 : cinq releases et cinq sauvegardes gardées.
const GARDER = 5;

const miroirs = {
  cockpit: path.join(MIROIRS_DIR, "business-pipelines.git"),
  moteur: path.join(MIROIRS_DIR, "agent-orchestrator.git"),
  registre: path.join(MIROIRS_DIR, "agent-registry.git"),
};
const git = livreur.gitLocal();

let arret = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (arret = true));
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function publierProposition() {
  try {
    const release = livreur.lireRelease(path.join(BUSINESS, ".release"));
    livreur.ecrireJson(PROPOSITION, livreur.proposition({ git, miroirs, release }));
  } catch (err) {
    // Miroirs pas encore créés par le publieur, par exemple : dit au cockpit, sans planter.
    livreur.ecrireJson(PROPOSITION, { erreur: String(err.message).split("\n")[0], calculeeLe: new Date().toISOString() });
  }
}

/** Lance deploy.sh, relaie sa sortie par paquets et suit les étapes. */
function basculer(store, commande, deploy) {
  return new Promise((resolve) => {
    let etape = "preparer";
    let tampon = [];
    const dernieres = [];
    const emettre = (type, payload) => store.emettre({ type, payload: { commande: commande.id, ...payload } });
    const vider = () => {
      if (tampon.length) emettre("livraison.journal", { lignes: tampon.slice(-40) });
      tampon = [];
    };
    const minuterie = setInterval(vider, 2000);
    const lire = (morceau) => {
      for (const ligne of String(morceau).split("\n").map((x) => x.trimEnd()).filter(Boolean)) {
        tampon.push(ligne);
        dernieres.push(ligne);
        if (dernieres.length > 30) dernieres.shift();
        const suivante = livreur.etapeDeLigne(ligne, etape);
        if (suivante && suivante !== etape) {
          vider();
          etape = suivante;
          emettre("livraison.etape", { etape });
        }
      }
    };
    const enfant = spawn("sh", [deploy], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    enfant.stdout.on("data", lire);
    enfant.stderr.on("data", lire);
    enfant.on("error", (err) => lire(`deploy.sh n'a pas démarré : ${err.message}`));
    enfant.on("close", (code) => {
      clearInterval(minuterie);
      vider();
      resolve({ code: code ?? 1, etape, dernieres });
    });
  });
}

async function livrer(store, commande) {
  const emettre = (type, payload) => store.emettre({ type, payload: { commande: commande.id, ...payload } });
  const payload = commande.payload;
  const incident = path.join(BUSINESS, "etat", "incident-livraison");
  if (fs.existsSync(incident)) {
    const raison = `livraison suspendue : ${fs.readFileSync(incident, "utf8").trim()}`;
    emettre("livraison.fin", { issue: "suspendue", etape: "restaurer", raison });
    return { ok: false, raison };
  }
  const version = livreur.DEPOTS.map((d) => `${d} ${String(payload[d]).slice(0, 7)}`).join(" · ");
  console.log(`Livraison ${commande.id} demandée par ${commande.par} : ${version}`);
  emettre("livraison.debut", { par: commande.par, version, cible: payload });

  let etape = "verifier";
  try {
    emettre("livraison.etape", { etape });
    const preuve = signature.verifier(signature.cleEnv(), commande);
    if (!preuve.ok) throw new Error(preuve.raison);
    if (preuve.transition) console.error(`livraison ${commande.id} acceptée sans vérification de signature (transition)`);
    const { modeleDe } = livreur.verifierDemande({
      git,
      miroirs,
      payload,
      par: commande.par,
      canal: commande.canal,
      autorises: livreur.lireAutorises(AUTORISES),
      release: livreur.lireRelease(path.join(BUSINESS, ".release")),
    });

    etape = "preparer";
    emettre("livraison.etape", { etape });
    const prete = livreur.preparerRelease({ git, miroirs, payload, modeleDe, releasesDir: RELEASES, par: commande.par });

    const fin = await basculer(store, commande, prete.deploy);
    etape = fin.etape;
    if (fin.code !== 0) {
      const issue = etape === "restaurer" ? "restauree" : "echec";
      const raison =
        issue === "restauree"
          ? "échec après la bascule : version précédente restaurée"
          : `deploy.sh terminé en code ${fin.code} à l'étape ${etape}, avant la bascule : rien n'a été remplacé`;
      emettre("livraison.fin", { issue, etape, raison, release: prete.release, journal: fin.dernieres });
      return { ok: false, raison };
    }
    emettre("livraison.fin", { issue: "livree", release: prete.release, version });
    return { ok: true, detail: { release: prete.release, version } };
  } catch (err) {
    const raison = String(err.message).split("\n")[0];
    emettre("livraison.fin", { issue: "echec", etape, raison });
    return { ok: false, raison };
  } finally {
    livreur.retention({ dossier: RELEASES, retenir: (nom) => /^cockpit-/.test(nom), garder: GARDER });
    livreur.retention({ dossier: SAUVEGARDES, retenir: (nom) => /^business-pipelines-before-.*\.tar\.gz$/.test(nom), garder: GARDER });
  }
}

(async () => {
  const store = new EventStore(STORE);
  // Une livraison coupée en pleine bascule n'est jamais rejouée : relancer depuis le début
  // pourrait défaire une restauration. Elle passe en échec et Raphaël décide.
  const abandonnees = store.abandonnerCommandesInterrompues({
    kinds: [livreur.KIND],
    raison: "le livreur a redémarré pendant la livraison ; rien n'est rejoué",
  });
  if (abandonnees) {
    store.emettre({ type: "livraison.fin", payload: { issue: "echec", raison: "livraison interrompue par un redémarrage du livreur" } });
  }
  console.log(`Livreur : ${BUSINESS}, miroirs dans ${MIROIRS_DIR}${abandonnees ? `, ${abandonnees} livraison(s) interrompue(s) passée(s) en échec` : ""}`);

  let prochaineProposition = 0;
  // Un déploiement réécrit .release, y compris par bin/livrer.sh, sans passer par ce service :
  // la proposition se recalcule aussitôt, sinon le cockpit proposerait encore pendant une
  // minute la version qui vient d'être déployée.
  const versionEnPlace = () => {
    try {
      return fs.statSync(path.join(BUSINESS, ".release")).mtimeMs;
    } catch {
      return 0;
    }
  };
  let releaseVue = versionEnPlace();
  try {
    while (!arret) {
      const commande = store.prendreCommande({ kinds: [livreur.KIND] });
      if (commande) {
        store.terminerCommande(commande.id, await livrer(store, commande));
        prochaineProposition = 0;
      }
      const release = versionEnPlace();
      if (release !== releaseVue) {
        releaseVue = release;
        prochaineProposition = 0;
      }
      if (Date.now() >= prochaineProposition) {
        publierProposition();
        prochaineProposition = Date.now() + INTERVALLE_PROPOSITION;
      }
      if (!commande) await attendre(INTERVALLE_FILE);
    }
  } finally {
    store.fermer();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
