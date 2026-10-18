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
const { Refus } = require("./cockpit");

const EN_TETE_LOGIN = "tailscale-user-login";
const EN_TETE_NOM = "tailscale-user-name";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

// Où le cockpit se met à écouter, et le seul cas qui justifie autre chose que la boucle
// locale.
//
// Un serveur lié à 127.0.0.1 DANS un conteneur n'est joignable par personne. La
// publication `127.0.0.1:4600:4600` relaie vers l'adresse du conteneur sur son réseau,
// jamais vers sa boucle locale à lui, et la connexion est réinitialisée. Le cockpit du
// NAS a tourné dix jours dans cet état : « Up » pour Docker, muet pour tout le monde, et
// rien dans ses journaux ne le disait puisqu'aucune requête ne lui parvenait. Une alerte
// reçue dehors menait à une page morte, ce que le service systemd du poste existe
// précisément pour empêcher.
//
// Le confinement ne disparaît pas, il change de couche. Dans un conteneur, ce qui limite
// l'accès n'est plus l'adresse d'écoute mais l'espace de noms réseau, plus la publication
// loopback de l'hôte. Tailscale continue de parler à 127.0.0.1 sur l'hôte, donc
// l'exigence qui rend ses en-têtes d'identité fiables tient toujours.
//
// Deux clés, pas une, et c'est délibéré. `COCKPIT_HOTE` seul suffirait à ouvrir le
// cockpit sur le LAN par une faute de frappe dans un .env du poste, et le LAN est
// exactement l'endroit où n'importe qui peut fabriquer un en-tête d'identité Tailscale.
// `COCKPIT_CONTENEUR=1` est la reconnaissance explicite que la publication de l'hôte a
// pris le relais. Fail-closed comme le reste : sans elle, le refus.
function adresseEcoute({ hote = null, conteneur = false } = {}) {
  const demande = String(hote == null ? "" : hote).trim() || "127.0.0.1";
  if (LOOPBACK.has(demande)) return demande;
  if (!conteneur) {
    throw new Refus(
      `COCKPIT_HOTE="${demande}" ouvre le cockpit hors de la boucle locale. ` +
        `Sur le réseau, les en-têtes d'identité Tailscale se fabriquent, donc n'importe ` +
        `qui signerait des décisions sous ton nom. Cette adresse n'a de sens que dans un ` +
        `conteneur dont l'hôte publie 127.0.0.1:<port> : poser aussi COCKPIT_CONTENEUR=1.`
    );
  }
  return demande;
}

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
//
// Sur le NAS, le runner partage le réseau de l'hôte et ses agents ont Bash : ils joignent
// 127.0.0.1:4600 comme `tailscale serve`. Quand `serve` relaie vers le socket Unix du cockpit
// (COCKPIT_SOCKET), que le runner ne monte pas, `socketSeul` refuse tout en-tête d'identité
// arrivé autrement : c'est le chemin qui atteste que Tailscale l'a posé.
function identite(entetes, { tailnet = null, operateurLocal = null, viaSocket = false, socketSeul = false } = {}) {
  const e = entetes || {};
  const login = String(e[EN_TETE_LOGIN] || "").trim();
  const nom = String(e[EN_TETE_NOM] || "").trim();

  if (login && socketSeul && !viaSocket) {
    throw new Refus("en-tête d'identité Tailscale reçu hors du socket de tailscale serve : refusé");
  }
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

// Dans le conteneur du NAS, le canal « local » n'est plus la console de Raphaël : c'est
// n'importe quel processus de l'hôte, agents du runner compris. Il garde la lecture (contrôle
// de santé de deploy.sh), jamais l'écriture.
function verifierEcriture(qui, { methode, conteneur = false }) {
  const lecture = ["GET", "HEAD", "OPTIONS"].includes(String(methode || "").toUpperCase());
  if (!lecture && conteneur && qui && qui.canal === "local") {
    throw new Refus("écriture refusée : dans le conteneur, seul le tailnet identifie qui décide");
  }
}

module.exports = {
  identite,
  verifierEcriture,
  adresseEcoute,
  hotesAutorises,
  hoteAutorise,
  originesAutorisees,
  origineAutorisee,
  EN_TETE_LOGIN,
  EN_TETE_NOM,
};
