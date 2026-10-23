const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventStore } = require('agent-orchestrator');
const atelier = require('../src/atelier');
const dates = require('../src/atelier-dates');
const { valider } = require('agent-orchestrator/src/mission');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-'));
  const reg = path.join(dir, 'registre'), projets = path.join(dir, 'projects');
  for (const p of ['agents/auteur/v1', 'pipelines/demo/v1']) fs.mkdirSync(path.join(reg, p), { recursive: true });
  fs.mkdirSync(path.join(projets, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(reg, 'agents/auteur/v1/agent.md'), '---\nname: auteur\nversion: 1\ndescription: Rédiger\ndefaultLlm: {via: claude, model: sonnet}\nallowedTools: [Read, Write]\n---\nRédige les livrables.');
  const graph = { name: 'demo', version: 1, workspace: 'documents', nodes: [{ id: 'rediger', type: 'agent', agent: 'auteur@1', instruction: 'Consigne spécifique', outputs: ['resultat.md'] }], edges: [] };
  fs.writeFileSync(path.join(reg, 'pipelines/demo/v1/pipeline.json'), JSON.stringify(graph));
  fs.writeFileSync(path.join(projets, 'demo/project.json'), JSON.stringify({ id: 'demo', name: 'Demo', business: 'test', repo: '/tmp/demo', pipelines: [{ extends: 'demo@1' }] }));
  const params = { projetsDir: projets, registreDir: reg, roster: [{ id: 'alice', nom: 'Alice', registre: ['auteur'], llm: { via: 'claude', model: 'sonnet' } }] };
  const store = new EventStore(path.join(dir, 'etat.sqlite'));
  t.after(() => { store.fermer(); fs.rmSync(dir, { recursive: true, force: true }); });
  const brouillon = { projectId: 'demo', graph, assignments: { rediger: 'alice' }, baseRef: null };
  const demande = { requestId: randomUUID(), brouillon, objectif: 'Rédiger le script', criteres: ['Script produit'], priority: 'normale' };
  const qui = { par: 'test', canal: 'cockpit' };
  return { store, params, brouillon, demande, qui, dir };
}
test('versions immuables, conflit optimiste et consigne par utilisation', t => {
  const f = fixture(t);
  const v1 = atelier.sauvegarder(f.store, f.params, f.brouillon);
  const v2 = atelier.sauvegarder(f.store, f.params, { ...f.brouillon, id: v1.id, expectedVersion: 1, graph: { ...f.brouillon.graph, title: 'Autre tâche' } });
  assert.equal(v2.version, 2);
  assert.throws(() => atelier.sauvegarder(f.store, f.params, { ...f.brouillon, id: v1.id, expectedVersion: 1 }), /changé/);
  assert.equal(JSON.parse(f.store.db.prepare('SELECT contenu FROM atelier_templates WHERE version=1').get().contenu).graph.title, undefined);
  assert.equal(atelier.catalogue(f.store, f.params).modeles.filter(m => m.origine === 'personnel').length, 1);
});
test('double demande et deux programmateurs ne créent qu’une occurrence et un contrat figé', t => {
  const f = fixture(t), maintenant = Date.parse('2026-10-21T08:00Z');
  atelier.creer(f.store, f.params, f.demande, f.qui, maintenant);
  atelier.creer(f.store, f.params, f.demande, f.qui, maintenant);
  assert.throws(() => atelier.creer(f.store, f.params, { ...f.demande, objectif: 'Autre' }, f.qui), /déjà utilisé/);
  const [c] = atelier.programmer(f.store, maintenant);
  assert.equal(atelier.programmer(f.store, maintenant).length, 0);
  assert.equal(atelier.lister(f.store).length, 1);
  assert.equal(c.payload.mission.participants[0].membre, 'alice');
  assert.equal(valider(c.payload.mission).resolution.pipeline.nodes[0].instruction, 'Consigne spécifique');
  assert.equal(c.payload.mission.resolution.projet.publier, false);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 1);
});
test('un objectif futur ne démarre pas et une occurrence en attente bloque la suivante', t => {
  const f = fixture(t);
  const instant = Date.parse('2026-10-21T08:00Z');
  atelier.creer(f.store, f.params, { ...f.demande, calendrier: { date: '2026-10-21', heure: '10:00', repetition: 'daily' } }, f.qui, instant);
  assert.equal(atelier.programmer(f.store, instant - 1).length, 0);
  assert.equal(atelier.programmer(f.store, instant).length, 1);
  assert.equal(atelier.programmer(f.store, instant + 86400000).length, 0);
  assert.equal(atelier.lister(f.store)[0].occurrences.length, 1);
});
test('dates de Zurich, heure absente et heure répétée', () => {
  assert.equal(dates.instantLocal('2026-10-21', '10:00'), '2026-10-21T08:00:00.000Z');
  assert.equal(dates.instantLocal('2026-10-25', '02:30'), '2026-10-25T00:30:00.000Z');
  assert.throws(() => dates.instantLocal('2026-03-29', '02:30'), /n'existe pas/);
  assert.throws(() => dates.instantLocal('2026-02-30'), /invalide/);
  assert.deepEqual(dates.suivante('2026-03-28', '02:30', 'daily'), { date: '2026-03-29', instant: '2026-03-29T01:00:00.000Z' });
  assert.equal(dates.suivante('2026-10-23', '10:00', 'weekdays').instant, '2026-10-26T09:00:00.000Z');
});
test('pause et report conservent la même commande, les révisions périmées sont refusées', t => {
  const f = fixture(t), now = Date.parse('2026-10-21T08:00Z');
  atelier.creer(f.store, f.params, f.demande, f.qui, now);
  const [c] = atelier.programmer(f.store, now);
  const g = atelier.lire(f.store, f.demande.requestId);
  const paused = atelier.modifier(f.store, g.id, { revision: g.revision, active: false });
  assert.deepEqual(atelier.exclus(f.store, () => {}), [c.id]);
  assert.throws(() => atelier.modifier(f.store, g.id, { revision: g.revision, active: true }), /modifié ailleurs/);
  atelier.modifier(f.store, g.id, { revision: paused.revision, active: true, date: '2026-10-22', heure: '10:00' });
  assert.equal(atelier.lire(f.store, g.id).occurrences[0].commandId, c.id);
  assert.equal(f.store.prendreCommande({ kinds: ['run.start'], prioriserRuns: true, aLaDate: new Date(now).toISOString() }), null);
});
test('un worker indisponible est exclu sans prendre la commande', t => {
  const f = fixture(t);
  atelier.creer(f.store, f.params, f.demande, f.qui);
  const [c] = atelier.programmer(f.store);
  assert.deepEqual(atelier.exclus(f.store, () => { throw new Error('worker indisponible'); }), [c.id]);
  assert.equal(f.store.commande(c.id).status, 'pending');
  assert.equal(atelier.lire(f.store, f.demande.requestId).occurrences[0].raison, 'worker indisponible');
  assert.deepEqual(atelier.exclus(f.store, () => {}), []);
});
for (const repetition of ['daily', 'weekdays', 'weekly']) for (const etat of ['pending', 'running', 'succeeded']) {
  test(`report du prochain départ ${repetition} après une occurrence ${etat}`, t => {
    const f = fixture(t), now = Date.parse('2026-10-21T08:00Z');
    atelier.creer(f.store, f.params, { ...f.demande, calendrier: { date: '2026-10-21', heure: '10:00', repetition } }, f.qui, now);
    const [c] = atelier.programmer(f.store, now);
    if (etat !== 'pending') {
      f.store.prendreCommande({ kinds: ['run.start'] });
      const { run } = f.store.ouvrirRunCommande(c.id, { pipelineRef: 'demo@1', projectId: 'demo' });
      if (etat === 'succeeded') f.store.statutRun(run.id, 'succeeded');
    }
    const avant = atelier.lire(f.store, f.demande.requestId);
    const commandeAvant = f.store.commande(c.id);
    const apres = atelier.modifier(f.store, avant.id, { revision: avant.revision, date: '2026-10-30', heure: '11:00' });
    assert.equal(apres.nextAt, '2026-10-30T10:00:00.000Z');
    assert.deepEqual(apres.occurrences, avant.occurrences, 'le report futur ne réécrit pas une occurrence existante');
    assert.deepEqual(f.store.commande(c.id), commandeAvant);
    assert.equal(atelier.programmer(f.store, Date.parse('2026-10-22T09:00Z')).length, 0);
  });
}
test('un départ unique commencé ne peut pas être déplacé ni recréé', t => {
  const f = fixture(t), now = Date.parse('2026-10-21T08:00Z');
  atelier.creer(f.store, f.params, f.demande, f.qui, now);
  atelier.programmer(f.store, now);
  f.store.prendreCommande({ kinds: ['run.start'] });
  const g = atelier.lire(f.store, f.demande.requestId);
  assert.throws(() => atelier.modifier(f.store, g.id, { revision: g.revision, date: '2026-10-22' }), /déjà commencé/);
  assert.equal(atelier.programmer(f.store, now + 86400000).length, 0);
});
test('un pipeline libre ne permet ni script arbitraire ni sortie hors workspace', t => {
  const f = fixture(t);
  const unsafe = structuredClone(f.brouillon);
  unsafe.graph.nodes[0].outputs = ['../secret'];
  assert.throws(() => atelier.resoudre(f.params, unsafe), /Chemin/);
  unsafe.graph.nodes = [{ id: 'shell', type: 'script', run: 'bash' }];
  assert.throws(() => atelier.resoudre(f.params, unsafe), /pipeline libre/);
  for (const scopeDir of ['/tmp', '../autre', 'web/../../autre', '.git', 'web//src']) {
    assert.throws(() => atelier.resoudre(f.params, { ...f.brouillon, graph: { ...f.brouillon.graph, nodes: [{ ...f.brouillon.graph.nodes[0], scopeDir }] } }), /périmètre/);
  }
  assert.equal(atelier.resoudre(f.params, { ...f.brouillon, graph: { ...f.brouillon.graph, nodes: [{ ...f.brouillon.graph.nodes[0], scopeDir: 'documents' }] } }).resolution.pipeline.nodes[0].scopeDir, 'documents');
});
test('le catalogue et la mission conservent les revues obligatoires et optionnelles du projet', t => {
  const f = fixture(t), fichier = path.join(f.params.registreDir, 'pipelines/demo/v1/pipeline.json');
  const graph = JSON.parse(fs.readFileSync(fichier));
  fs.mkdirSync(path.join(f.params.registreDir, 'agents/relecteur/v1'), { recursive: true });
  fs.writeFileSync(path.join(f.params.registreDir, 'agents/relecteur/v1/agent.md'), '---\nname: relecteur\nversion: 1\ndescription: Relire\ndefaultLlm: {via: claude, model: sonnet}\nallowedTools: [Read]\n---\nRelis.');
  graph.nodes.push({ id: 'relire', type: 'review', agent: 'relecteur@1' }, { id: 'securite', type: 'review', agent: 'relecteur@1', optional: true });
  graph.edges.push({ from: 'rediger', to: 'relire' }, { from: 'relire', to: 'securite' });
  fs.writeFileSync(fichier, JSON.stringify(graph));
  const catalogue = atelier.catalogue(f.store, f.params);
  assert.deepEqual(catalogue.erreurs, []);
  const modele = catalogue.modeles[0];
  assert.equal(modele.graph.nodes.filter(n => n.type === 'review').length, 2);
  const brouillon = { projectId: modele.projectId, graph: modele.graph, assignments: modele.assignments, baseRef: modele.baseRef };
  const g = atelier.creer(f.store, f.params, { ...f.demande, brouillon }, f.qui);
  const [c] = atelier.programmer(f.store);
  const mission = valider(c.payload.mission);
  assert.equal(mission.resolution.pipeline.nodes.find(n => n.id === 'relire').disabled, false);
  assert.equal(mission.resolution.pipeline.nodes.find(n => n.id === 'securite').disabled, true);
  assert.deepEqual(mission.participants.map(p => p.noeud), ['rediger', 'relire']);
  assert.equal(g.brouillon.baseRef, 'demo@1');
  const retire = structuredClone(brouillon);
  retire.graph.nodes = retire.graph.nodes.filter(n => n.id !== 'relire');
  assert.throws(() => atelier.resoudre(f.params, retire), /requise relire/);
});
test('les liens et contrôles du modèle de départ restent obligatoires', t => {
  const f = fixture(t);
  const source = path.join(f.params.registreDir, 'pipelines/demo/v1/pipeline.json');
  const graph = JSON.parse(fs.readFileSync(source));
  graph.nodes.push({ id: 'valider', type: 'approval', rapport: 'rapport.json' });
  graph.edges.push({ from: 'rediger', to: 'valider' });
  fs.writeFileSync(source, JSON.stringify(graph));
  assert.throws(() => atelier.resoudre(f.params, { ...f.brouillon, baseRef: 'demo@1' }), /requise valider/);
});
