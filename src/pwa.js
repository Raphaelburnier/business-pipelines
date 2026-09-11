// Ce qui fait du cockpit une application installable sur téléphone, tablette et poste,
// et rien de plus.
//
// Un navigateur n'accepte d'installer une page que si trois conditions tiennent :
// l'origine est en HTTPS avec un certificat valide, la page déclare un manifeste, et un
// service worker enregistré porte un gestionnaire de requêtes. La première vient de
// Tailscale, qui termine le TLS sur le nom de la machine dans le tailnet. Les deux
// autres sont ici.
//
// LE SERVICE WORKER NE MET RIEN EN CACHE, ET C'EST DÉLIBÉRÉ.
// La page montre des décisions en attente, et chaque plan gelé porte une empreinte qui
// lie l'approbation à un plan précis. Servir une copie gardée en cache montrerait des
// actions déjà tranchées, et ferait cocher contre une empreinte morte : l'écriture
// partirait pour se faire refuser en 409, sans que rien à l'écran l'ait laissé prévoir.
// Le cockpit envoie déjà `Cache-Control: no-store` sur la page et sur l'API ; un cache
// de service worker passerait outre, puisqu'il répond avant que la requête parte.
// Le worker existe donc pour deux raisons seulement : rendre l'application installable,
// et remplacer la page d'erreur du navigateur par un message qui dit quoi faire quand
// la machine est éteinte ou le relais démonté.
const fs = require("fs");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

// Le fond des icônes. Le manifeste s'en sert aussi pour l'écran de démarrage, ce qui
// fait apparaître l'icône sur son propre fond plutôt que sur un carré blanc.
const FOND = "#0f1b26";

// Une table littérale, pas un chemin construit depuis l'URL. Le cockpit sert des
// fichiers du disque pour la première fois : joindre l'URL à un dossier ouvrirait la
// remontée de répertoire, et la fermer ensuite demanderait de normaliser correctement,
// ce qui est exactement le genre de code qu'on croit juste et qui ne l'est pas.
const ICONES = {
  "/icone-192.png": "icone-192.png",
  "/icone-512.png": "icone-512.png",
  "/apple-touch-icon.png": "icone-ios-180.png",
};

class IconeAbsente extends Error {}

const enMemoire = new Map();

function lireIcone(fichier) {
  if (enMemoire.has(fichier)) return enMemoire.get(fichier);
  const chemin = path.join(PUBLIC, fichier);
  if (!fs.existsSync(chemin)) {
    throw new IconeAbsente(`${chemin} est absent : les icônes de l'application manquent au dépôt`);
  }
  const octets = fs.readFileSync(chemin);
  enMemoire.set(fichier, octets);
  return octets;
}

function manifeste() {
  return {
    id: "/",
    name: "Cockpit d'approbation",
    short_name: "Cockpit",
    description: "Approuver ou refuser les actions que les agents proposent.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: FOND,
    theme_color: FOND,
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // La coche tient dans le cercle central de 80 %, donc la même image sert de
      // masquable : Android la rogne en cercle ou en goutte sans manger le dessin.
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

const HORS_PORTEE = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cockpit injoignable</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;
color-scheme:light dark}h1{font-size:1.2rem}li{margin:.4rem 0}button{font:inherit;padding:.7rem 1.2rem;
border-radius:6px;cursor:pointer;margin-top:1.5rem}</style>
<h1>Le cockpit ne répond pas</h1>
<p>L'application est installée, mais la machine qui tient les approbations est hors de portée. Rien n'a été perdu : aucune décision ne part d'ici tant que la connexion n'est pas revenue.</p>
<p>Les trois causes, dans l'ordre de fréquence :</p>
<ul>
<li>Tailscale n'est pas connecté sur ce téléphone.</li>
<li>La machine qui héberge le cockpit est éteinte ou en veille.</li>
<li>Le relais est démonté : <code>npm run cockpit:tailnet</code> sur la machine.</li>
</ul>
<button onclick="location.reload()">Réessayer</button>`;

// `skipWaiting` et `clients.claim` font prendre la main à la nouvelle version tout de
// suite. Sans eux, une correction du worker n'atteint le téléphone qu'après fermeture de
// tous les onglets de l'app, ce qui, sur une app installée, peut vouloir dire jamais.
const SERVICE_WORKER = `// Généré par src/pwa.js. Ne rien mettre en cache ici : voir l'en-tête de ce fichier.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  // Les décisions partent en POST. Elles ne passent pas par ici : une écriture rejouée
  // depuis un worker écrirait deux fois la même décision sans que personne la recoche.
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() =>
      e.request.mode === "navigate"
        ? new Response(${JSON.stringify(HORS_PORTEE)}, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          })
        : Response.error()
    )
  );
});
`;

// Les balises que la page doit porter pour être installable. Elles vivent ici plutôt que
// dans le gabarit du cockpit pour que le manifeste et ce qui le déclare bougent ensemble.
const BALISES = `<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${FOND}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cockpit">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`;

// L'échec d'enregistrement est avalé sans bruit, et c'est voulu : un navigateur qui ne
// sait pas faire de service worker doit continuer à afficher les approbations. Ce n'est
// pas le worker qui rend la page utilisable, seulement installable.
const ENREGISTREMENT = `<script>
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
</script>`;

/**
 * Rend la ressource servie à cette URL, ou null si l'URL n'en est pas une.
 * @param {string} url
 * @returns {{type: string, corps: Buffer}|null}
 */
function ressource(url) {
  if (url === "/manifest.webmanifest") {
    return {
      type: "application/manifest+json; charset=utf-8",
      corps: Buffer.from(JSON.stringify(manifeste(), null, 2)),
    };
  }
  if (url === "/sw.js") {
    return { type: "text/javascript; charset=utf-8", corps: Buffer.from(SERVICE_WORKER) };
  }
  const fichier = ICONES[url];
  if (fichier) return { type: "image/png", corps: lireIcone(fichier) };
  return null;
}

module.exports = { ressource, manifeste, BALISES, ENREGISTREMENT, FOND, IconeAbsente };
