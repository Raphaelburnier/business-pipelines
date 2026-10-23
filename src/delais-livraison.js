const fs = require("node:fs");

const CONFIG = {
  construction: ["LIVRAISON_BUILD_TIMEOUT_SEC", 2700, 7200],
  bascule: ["LIVRAISON_SWITCH_TIMEOUT_SEC", 600, 1800],
  restauration: ["LIVRAISON_ROLLBACK_TIMEOUT_SEC", 300, 900],
  commande: ["LIVRAISON_COMMAND_TIMEOUT_SEC", 120, 1800],
  archive: ["LIVRAISON_ARCHIVE_TIMEOUT_SEC", 300, 900],
  grace: ["LIVRAISON_STOP_GRACE_SEC", 5, 30],
};

function environnement(fichier, env = process.env) {
  let valeurs = {};
  try { valeurs = JSON.parse(fs.readFileSync(fichier, "utf8")); }
  catch (err) { if (err.code !== "ENOENT") throw err; }
  if (!valeurs || typeof valeurs !== "object" || Array.isArray(valeurs)) throw new Error("délais de livraison : objet JSON attendu");
  for (const cle of Object.keys(valeurs)) if (!Object.hasOwn(CONFIG, cle)) throw new Error(`délai de livraison inconnu : ${cle}`);
  const resultat = { ...env };
  for (const [cle, [variable, defaut, maximum]] of Object.entries(CONFIG)) {
    const valeur = Object.hasOwn(valeurs, cle) ? valeurs[cle] : Number(env[variable] ?? defaut);
    if (!Number.isSafeInteger(valeur) || valeur < 1 || valeur > maximum) throw new Error(`${cle} doit être un entier entre 1 et ${maximum} secondes`);
    resultat[variable] = String(valeur);
  }
  return resultat;
}
module.exports = { environnement };
