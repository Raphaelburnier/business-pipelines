// Transport commun aux approbations historiques et aux alertes d'exploitation.
const nodemailer = require("nodemailer");

function config(env) {
  const manquantes = ["SMTP_HOTE", "SMTP_UTILISATEUR", "SMTP_MOTDEPASSE", "ALERTE_DESTINATAIRE"].filter(k => !env[k]);
  if (manquantes.length) throw Object.assign(new Error(`Transport courriel : variables manquantes : ${manquantes.join(", ")}. Voir specs/alerte.env.example.`), { code: "CONFIG_MANQUANTE" });
  if (["SMTP_HOTE", "SMTP_UTILISATEUR", "SMTP_MOTDEPASSE", "ALERTE_DESTINATAIRE"].some(k => typeof env[k] !== "string" || !env[k].trim() || env[k].length > 8192)) throw Object.assign(new Error("Configuration du courriel invalide."), { code: "CONFIG_INVALIDE" });
  const port = Number(env.SMTP_PORT || 587);
  const adresse = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const expediteur = env.ALERTE_EXPEDITEUR || env.SMTP_UTILISATEUR;
  const adresseExpediteur = typeof expediteur === "string" ? expediteur.match(/<([^<>]+)>$/)?.[1] || expediteur : "";
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !adresse.test(env.ALERTE_DESTINATAIRE) ||
      !adresse.test(adresseExpediteur) || /[\r\n]/.test(expediteur) || /[\r\n]/.test(env.SMTP_HOTE)) {
    throw Object.assign(new Error("Configuration du courriel invalide."), { code: "CONFIG_INVALIDE" });
  }
  return { port, secure: port === 465 };
}

async function envoyer({ titre, texte, messageId }, env) {
  const { port, secure } = config(env);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOTE, port, secure, requireTLS: !secure,
    auth: { user: env.SMTP_UTILISATEUR, pass: env.SMTP_MOTDEPASSE },
    pool: true, maxConnections: 1, maxMessages: 1,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  let timer;
  try {
    await Promise.race([
      transport.sendMail({ from: env.ALERTE_EXPEDITEUR || env.SMTP_UTILISATEUR, to: env.ALERTE_DESTINATAIRE, subject: titre, text: texte, ...(messageId ? { messageId } : {}) }),
      new Promise((_, reject) => { timer = setTimeout(() => { transport.close(); reject(Object.assign(new Error("Délai du transport dépassé."), { code: "ETIMEDOUT" })); }, 20000); }),
    ]);
  } finally { clearTimeout(timer); transport.close(); }
}

function categorie(err) {
  return ["EAUTH", "ETIMEDOUT", "ECONNECTION", "ESOCKET", "ETLS", "EPROTOCOL", "EENVELOPE", "EMESSAGE"].includes(err?.code) ? err.code : "TRANSPORT_ERREUR";
}
module.exports = { config, envoyer, categorie };
