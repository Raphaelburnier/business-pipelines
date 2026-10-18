// Les commandes d'autorité signées par le cockpit, vérifiées par le publieur et le livreur.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("agent-orchestrator");
const signature = require("../src/signature-commandes");

const CLE = Buffer.from("k".repeat(48));
const AUTRE = Buffer.from("x".repeat(48));
const SHA = (c) => c.repeat(40);
const base = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signature-")), "events.sqlite");
const livraison = { cockpit: SHA("a"), moteur: SHA("b"), registre: SHA("c") };

test("une commande signée à la création se vérifie après relecture de la base", () => {
  const store = new EventStore(base());
  const c = store.creerCommande({ kind: "livraison.start", payload: livraison, par: "raphael@example.com", canal: "tailnet", signer: signature.signataire(CLE, "livraison.start") });
  const relue = store.prendreCommande({ kinds: ["livraison.start"] });
  assert.equal(relue.id, c.id);
  assert.deepEqual(signature.verifier(CLE, relue), { ok: true });
  store.fermer();
});

test("une ligne posée sans la clé, ou modifiée après coup, est refusée", () => {
  const store = new EventStore(base());
  const forgee = store.creerCommande({ kind: "github.merge", payload: { depot: "r/p", numero: 1, sha: SHA("a"), baseSha: SHA("b") }, par: "raphael@example.com", canal: "tailnet" });
  assert.match(signature.verifier(CLE, forgee).raison, /non signée/);
  const autreCle = store.creerCommande({ kind: "github.merge", payload: { depot: "r/p", numero: 2, sha: SHA("a"), baseSha: SHA("b") }, par: "raphael@example.com", canal: "tailnet", signer: signature.signataire(AUTRE, "github.merge") });
  assert.match(signature.verifier(CLE, autreCle).raison, /invalide/);
  const signee = store.creerCommande({ kind: "github.merge", payload: { depot: "r/p", numero: 3, sha: SHA("a"), baseSha: SHA("b") }, par: "raphael@example.com", canal: "tailnet", signer: signature.signataire(CLE, "github.merge") });
  store.db.prepare("UPDATE commands SET par = 'agent' WHERE id = ?").run(signee.id);
  assert.match(signature.verifier(CLE, store.commande(signee.id)).raison, /invalide/);
  store.fermer();
});

test("une commande signée trop ancienne est refusée : pas de rejeu d'une vieille livraison", () => {
  const store = new EventStore(base());
  const c = store.creerCommande({ kind: "livraison.start", payload: livraison, par: "raphael@example.com", canal: "tailnet", signer: signature.signataire(CLE, "livraison.start") });
  const plusTard = Date.parse(c.created_at) + signature.FRAICHEUR_MS + 1000;
  assert.match(signature.verifier(CLE, c, { maintenant: plusTard }).raison, /trop ancienne/);
  store.fermer();
});

test("les kinds sans autorité ne sont pas concernés, et sans clé c'est la transition", () => {
  assert.deepEqual(signature.verifier(CLE, { kind: "github.ci.rerun", id: "x", payload: {}, par: "p", canal: null, created_at: new Date().toISOString() }), { ok: true });
  assert.deepEqual(signature.verifier(null, { kind: "github.merge", id: "x", payload: {}, par: "p", canal: null, created_at: new Date().toISOString() }), { ok: true, transition: true });
  assert.equal(signature.signataire(CLE, "run.start"), undefined);
  assert.equal(signature.signataire(null, "github.merge"), undefined);
});

test("lecture de la clé : absente = null, trop courte = erreur", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cle-"));
  assert.equal(signature.lireCle(path.join(dir, "absente")), null);
  assert.equal(signature.lireCle(dir), null);
  fs.writeFileSync(path.join(dir, "courte"), "abc");
  assert.throws(() => signature.lireCle(path.join(dir, "courte")), /trop courte/);
  fs.writeFileSync(path.join(dir, "bonne"), "z".repeat(64) + "\n");
  assert.equal(signature.lireCle(path.join(dir, "bonne")).length, 64);
});
