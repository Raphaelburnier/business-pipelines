// Qui a le droit de parler au cockpit, et sous quel nom sa décision est signée.
//
// Le cockpit n'était joignable que depuis la machine. Il devient joignable depuis le
// téléphone. Ce module est toute la surface que ce changement ajoute, sorti du serveur
// pour être testé sans monter de socket : ce qui décide qui signe touche à l'argent.
//
// Le montage retenu : Tailscale termine le TLS sur un vrai nom et relaie vers localhost,
// et le cockpit continue de n'écouter QUE sur 127.0.0.1. Ce n'est pas de la prudence
// décorative. La documentation de Tailscale pose que le service derrière `serve` doit
// rester sur localhost, sinon n'importe qui sur le réseau peut fabriquer les en-têtes
// d'identité que `serve` injecte. Élargir l'écoute ne rendrait pas le cockpit plus
// joignable, ça détruirait la seule chose qui donne du sens aux en-têtes.
//
// Ce que ça authentifie, et ce que ça n'authentifie pas, dit franchement : l'identité
// vient du tailnet, établie par WireGuard, donc un appareil qui n'est pas le tien ne
// peut pas signer. Un PROCESSUS déjà présent sur cette machine, lui, peut fabriquer
// l'en-tête. Il pouvait déjà écrire le registre de décisions directement : la frontière
// n'a pas bougé. L'en-tête supprime l'erreur humaine, pas l'attaquant local.
const os = require("os");
const fs = require("fs");
const { Refus } = require("./cockpit");

const EN_TETE_LOGIN = "tailscale-user-login";
const EN_TETE_NOM = "tailscale-user-name";

function nomHote(entetes) {
  return String((entetes && entetes.host) || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
}

// La liste des hôtes reste une liste blanche. Un nom d'hôte que je n'ai pas prévu ne
// parle pas au serveur, même s'il résout vers 127.0.0.1 : c'est la défense contre le
// rebinding DNS, et elle ne s'assouplit pas parce qu'on ajoute une entrée.
function hotesAutorises({ port, tailnet = null }) {
  const liste = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `127.0.0.1`, `localhost`];
  if (tailnet) {
    const t = String(tailnet).toLowerCase();
    liste.push(t, `${t}:443`, `${t}:${port}`);
  }
  return new Set(liste);
}

function hoteAutorise(entetes, opts) {
  const brut = String((entetes && entetes.host) || "").toLowerCase();
  return hotesAutorises(opts).has(brut);
}

// Tant que le cockpit n'était joignable qu'en loopback, aucun navigateur visitant un
// autre site ne pouvait lui poster quoi que ce soit d'utile. Sous un vrai nom de domaine
// stable, un formulaire hébergé ailleurs peut viser cette URL, et un POST de formulaire
// n'est pas soumis au contrôle préalable CORS. L'origine est donc vérifiée à partir du
// moment où le navigateur en déclare une.
function originesAutorisees({ port, tailnet = null }) {
  const liste = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
  if (tailnet) {
    const t = String(tailnet).toLowerCase();
    liste.push(`https://${t}`, `https://${t}:443`, `http://${t}:${port}`);
  }
  return new Set(liste);
}

// Une requête sans en-tête Origin ne vient pas d'un navigateur, donc pas d'un autre site :
// curl et les tests passent. Une requête QUI en déclare une doit déclarer la bonne.
function origineAutorisee(entetes, opts) {
  const brut = (entetes && entetes.origin) || "";
  if (!brut) return true;
  return originesAutorisees(opts).has(String(brut).toLowerCase());
}

// Le corps d'une requête ne peut pas dire qui l'envoie. L'identité se lit dans le canal
// par lequel elle est arrivée, jamais dans ce qu'elle raconte d'elle-même.
function identite(entetes, { tailnet = null, operateurLocal = null } = {}) {
  const e = entetes || {};
  const login = String(e[EN_TETE_LOGIN] || "").trim();
  const nom = String(e[EN_TETE_NOM] || "").trim();

  if (login) {
    return { par: login, nom: nom || null, canal: "tailnet" };
  }

  // Arrivée sous le nom du tailnet mais sans identité. Deux causes possibles, toutes
  // deux disqualifiantes : le relais `serve` n'est pas en place et quelque chose d'autre
  // répond sur ce nom, ou l'appareil est « tagged » et Tailscale ne remplit alors aucun
  // en-tête. Dans les deux cas on ignore qui décide, donc on ne signe pas.
  if (tailnet && nomHote(e) === String(tailnet).toLowerCase()) {
    throw new Refus(
      `requête arrivée sous "${tailnet}" sans identité Tailscale : ` +
        `le relais tailscale serve n'est pas en place, ou l'appareil est tagged. ` +
        `Une décision non attribuable est refusée.`
    );
  }

  // Console de la machine. Personne n'a prouvé son identité et personne ne prétend le
  // contraire : on signe du compte système, qui est au moins vrai. Le champ texte libre
  // d'avant laissait écrire n'importe quel nom, y compris par distraction.
  const local = String(operateurLocal || os.userInfo().username || "").trim();
  if (!local) {
    throw new Refus("aucun opérateur local déterminable : renseigner COCKPIT_OPERATEUR_LOCAL");
  }
  return { par: local, nom: null, canal: "local" };
}

// L'adresse d'écoute, sortie du serveur pour la raison qui vaut pour tout ce fichier :
// ce qui décide de la surface exposée se teste sans monter de socket.
//
// L'incident. Le cockpit est resté injoignable dix jours après la bascule sur le NAS.
// `listen(PORT, "127.0.0.1")` était écrit en dur. Dans un conteneur, cette adresse
// désigne la boucle locale DU CONTENEUR, que rien n'atteint : le relais de port de Docker
// parle à l'interface du conteneur, pas à sa boucle. Le service tournait, le port était
// publié, et personne ne répondait jamais. Une panne muette parce que tout avait l'air
// normal des deux côtés.
//
// Pourquoi élargir ne casse pas l'invariant posé en tête de ce fichier. L'exigence n'est
// pas que le processus lise "127.0.0.1", elle est que RIEN venu du réseau n'atteigne le
// cockpit sans passer par Tailscale, faute de quoi les en-têtes d'identité se fabriquent.
// Sur l'hôte, c'est la liaison qui l'assure. Dans un conteneur, c'est la publication du
// port, écrite "127.0.0.1:4600:4600" dans docker-compose.yaml : seule la boucle de l'hôte
// atteint le relais, donc seul Tailscale, qui tourne sur l'hôte, arrive jusqu'ici. La
// frontière change de place, pas de nature. Écrire "0.0.0.0" sans cette publication
// rouvrirait tout : les deux lignes se lisent ensemble ou ne se lisent pas.
//
// Aucun réglage, délibérément. Être dans un conteneur est un fait, pas une préférence, et
// il n'existe aucun montage où l'on voudrait l'autre valeur. Une variable d'environnement
// ne serait qu'un moyen de plus de se tromper, et se tromper ici publie sur le réseau un
// service qui signe des dépenses. Une détection ratée, elle, rend le cockpit muet plutôt
// qu'ouvert : c'est le bon sens de panne.
function adresseEcoute({ conteneur }) {
  return conteneur ? "0.0.0.0" : "127.0.0.1";
}

// La sonde, séparée de la décision, pour que la décision se teste sans système de
// fichiers. Docker dépose /.dockerenv à la racine, Podman /run/.containerenv.
function dansConteneur(fsModule = fs) {
  return fsModule.existsSync("/.dockerenv") || fsModule.existsSync("/run/.containerenv");
}

module.exports = {
  identite,
  hotesAutorises,
  hoteAutorise,
  originesAutorisees,
  origineAutorisee,
  adresseEcoute,
  dansConteneur,
  EN_TETE_LOGIN,
  EN_TETE_NOM,
};
