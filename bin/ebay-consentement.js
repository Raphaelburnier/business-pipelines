#!/usr/bin/env node

// Consentement eBay, à faire une seule fois par compte vendeur.
//
// Lire eBay et y écrire ne demandent pas le même jeton. Les identifiants applicatifs
// suffisent pour la Browse API, mais l'API Sell les refuse : demander le scope
// sell.inventory en client_credentials rend un 400 invalid_scope, et appeler l'API Sell
// avec un jeton applicatif rend un 403 « Insufficient permissions ».
//
// Écrire exige donc un consentement humain dans un navigateur. Il rend un refresh token
// qui vit environ 18 mois, à partir duquel tous les jetons d'écriture suivants se
// fabriquent sans interaction. C'est l'unique geste manuel de toute la chaîne.
//
//   node bin/ebay-consentement.js specs/ajustement-prix.env

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const ebay = require("../src/ebay");

const fichier = process.argv[2];
if (!fichier) {
  console.error("Usage : node bin/ebay-consentement.js <chemin/vers/spec.env>");
  process.exit(2);
}

const chemin = path.resolve(fichier);
if (!fs.existsSync(chemin)) {
  console.error(`Fichier introuvable : ${chemin}`);
  process.exit(2);
}

function lireEnv(texte) {
  const env = {};
  for (const ligne of texte.split("\n")) {
    const m = ligne.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// Remplace la clé si elle existe, l'ajoute sinon. Ajouter en aveugle laisserait deux
// lignes pour la même variable, et laquelle gagne dépend du lecteur.
function poserCle(texte, cle, valeur) {
  const motif = new RegExp(`^\\s*${cle}\\s*=.*$`, "m");
  const ligne = `${cle}=${valeur}`;
  return motif.test(texte) ? texte.replace(motif, ligne) : `${texte.replace(/\n*$/, "")}\n${ligne}\n`;
}

// eBay renvoie le code dans l'URL de redirection, encodé. Coller l'URL entière est ce que
// tout le monde fait, alors on l'accepte autant que le code seul.
function extraireCode(saisie) {
  const brut = saisie.trim();
  const m = brut.match(/[?&]code=([^&\s]+)/);
  return decodeURIComponent(m ? m[1] : brut);
}

(async () => {
  const texte = fs.readFileSync(chemin, "utf-8");
  const env = lireEnv(texte);

  let url;
  try {
    url = ebay.urlConsentement({ env });
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }

  console.log("\n1. Ouvre cette URL dans un navigateur et connecte-toi avec le compte");
  console.log("   VENDEUR concerné (dans le sandbox, un utilisateur de test, pas ton");
  console.log("   compte développeur) :\n");
  console.log(`   ${url}\n`);
  console.log("2. Accepte. eBay te renvoie vers une URL qui porte `?code=...`.");
  console.log("3. Colle ici cette URL entière, ou juste le code.\n");
  console.log("   Le code expire en quelques minutes et ne sert qu'une fois.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const saisie = await new Promise((r) => rl.question("code ou URL > ", r));
  rl.close();

  const code = extraireCode(saisie);
  if (!code) {
    console.error("\nRien reçu. Rien n'a été écrit.");
    process.exit(1);
  }

  let jetons;
  try {
    jetons = await ebay.echangerCode({ env, code });
  } catch (err) {
    console.error(`\n${err.message}`);
    console.error("\nUn code périmé ou déjà utilisé donne `invalid_grant` : refais l'étape 1.");
    process.exit(1);
  }

  fs.writeFileSync(chemin, poserCle(texte, "EBAY_REFRESH_TOKEN", jetons.refresh_token));

  const jours = Math.round((jetons.refresh_token_expires_in || 0) / 86400);
  console.log(`\nEBAY_REFRESH_TOKEN écrit dans ${path.relative(process.cwd(), chemin)}.`);
  console.log(`Il vaut environ ${jours} jours. Ce fichier est gitignoré : il ne partira pas.`);
  console.log("\nL'écriture eBay est débloquée. Aucun autre geste manuel n'est prévu.\n");
})();
