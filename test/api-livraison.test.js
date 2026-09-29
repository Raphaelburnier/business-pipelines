// La livraison vue du cockpit, sur un vrai event store : ce que rend GET /api/livraison, et
// ce que POST /api/livraisons accepte ou refuse. Chaque réponse est validée contre le schéma
// du moteur, dont le front tire ses types.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const { livraison: schema } = require("agent-orchestrator/packages/schemas/livraison");
const apiLivraison = require("../src/api-livraison");

const SHA = (c) => c.repeat(40);
const DISPONIBLE = { cockpit: SHA("a"), moteur: SHA("b"), registre: SHA("c") };
const RAPHAEL = { par: "raphael@example.com", canal: "tailnet" };

function bac({ disponible = DISPONIBLE, autorises = ["raphael@example.com"], proposition = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-livraison-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const propositionFichier = path.join(dir, "livraison.json");
  const autorisesFichier = path.join(dir, "autorises.json");
  if (proposition) {
    fs.writeFileSync(
      propositionFichier,
      JSON.stringify({
        enProduction: { cockpit: "3e65f10", moteur: SHA("b"), registre: SHA("c") },
        disponible,
        commits: { cockpit: disponible ? [{ sha: SHA("a"), titre: "feat: carte", auteur: "r", date: "2026-09-29T12:00:00Z" }] : [], moteur: [], registre: [] },
        calculeeLe: "2026-09-29T12:00:00Z",
      })
    );
  }
  fs.writeFileSync(autorisesFichier, JSON.stringify({ autorises }));
  return { store, propositionFichier, autorisesFichier };
}

const etat = (b, qui = RAPHAEL) => schema.reponse.parse(apiLivraison.etat({ ...b, qui }));
const demander = (b, demande = DISPONIBLE, qui = RAPHAEL) => apiLivraison.demander({ ...b, demande, qui });
const refuse = (fn, code, motif) =>
  assert.throws(fn, (err) => err instanceof apiLivraison.RefusLivraison && err.code === code && motif.test(err.message));

test("sans proposition du livreur, la réponse le dit ; avec, elle la rend", () => {
  const vide = etat(bac({ proposition: false }));
  assert.strictEqual(vide.proposition, null);
  assert.match(vide.erreur, /pas encore publié/);

  const b = bac();
  const lu = etat(b);
  assert.deepStrictEqual(lu.proposition.disponible, DISPONIBLE);
  assert.strictEqual(lu.peutLivrer, true);
  assert.strictEqual(etat(b, { par: "admindunas", canal: "local" }).peutLivrer, false);
  assert.strictEqual(etat(b, { par: "autre@example.com", canal: "tailnet" }).peutLivrer, false);
});

test("seule l'identité tailnet autorisée dépose une livraison, et seulement ce qui est proposé", () => {
  const b = bac();
  refuse(() => demander(b, DISPONIBLE, { par: "admindunas", canal: "local" }), 403, /tailnet/);
  refuse(() => demander(b, DISPONIBLE, { par: "autre@example.com", canal: "tailnet" }), 403, /pas autorisé/);
  refuse(() => demander(b, { ...DISPONIBLE, moteur: SHA("d") }), 409, /a changé/);
  refuse(() => demander(bac({ disponible: null })), 409, /déjà à jour/);
  refuse(() => demander(bac({ autorises: [] })), 403, /pas autorisé/);

  const commande = demander(b);
  assert.strictEqual(commande.kind, "livraison.start");
  assert.deepStrictEqual(commande.payload, DISPONIBLE);
  assert.strictEqual(commande.par, "raphael@example.com");
  // Deux clics : une seule livraison.
  refuse(() => demander(b), 409, /déjà en cours/);
});

test("la livraison en cours suit les étapes du livreur, puis passe dans l'historique", () => {
  const b = bac();
  const commande = demander(b);
  let lu = etat(b);
  assert.strictEqual(lu.enCours.id, commande.id);
  assert.strictEqual(lu.enCours.etape, null);

  b.store.prendreCommande({ kinds: ["livraison.start"] });
  b.store.emettre({ type: "livraison.etape", payload: { commande: commande.id, etape: "construire" } });
  b.store.emettre({ type: "livraison.journal", payload: { commande: commande.id, lignes: ["Construction des images..."] } });
  // Un événement d'une autre livraison ne se mélange pas à celle-ci.
  b.store.emettre({ type: "livraison.etape", payload: { commande: "autre", etape: "restaurer" } });
  lu = etat(b);
  assert.strictEqual(lu.enCours.statut, "taken");
  assert.strictEqual(lu.enCours.etape, "construire");
  assert.deepStrictEqual(lu.enCours.journal, ["Construction des images..."]);

  b.store.emettre({ type: "livraison.fin", payload: { commande: commande.id, issue: "livree", release: "cockpit-20260929-140000" } });
  b.store.terminerCommande(commande.id, { ok: true, detail: { release: "cockpit-20260929-140000" } });
  lu = etat(b);
  assert.strictEqual(lu.enCours, null);
  assert.strictEqual(lu.historique[0].issue, "livree");
  assert.strictEqual(lu.historique[0].release, "cockpit-20260929-140000");
});

test("une livraison refusée par le livreur garde sa raison", () => {
  const b = bac();
  const commande = demander(b);
  b.store.prendreCommande({ kinds: ["livraison.start"] });
  b.store.emettre({
    type: "livraison.fin",
    payload: { commande: commande.id, issue: "restauree", etape: "restaurer", raison: "échec après la bascule", journal: ["Bascule...", "restauration"] },
  });
  b.store.terminerCommande(commande.id, { ok: false, raison: "échec après la bascule" });
  const [derniere] = etat(b).historique;
  assert.strictEqual(derniere.issue, "restauree");
  assert.strictEqual(derniere.etape, "restaurer");
  assert.strictEqual(derniere.raison, "échec après la bascule");
  assert.deepStrictEqual(derniere.journal, ["Bascule...", "restauration"]);
});
