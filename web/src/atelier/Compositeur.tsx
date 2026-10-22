import { useState, type DragEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, useReactFlow, type Node, type NodeProps, type NodeChange, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AgentCatalogue, Brouillon, Graphe } from './types';

type Visuel = Node<{ titre: string; sousTitre: string }, 'etape'>;
function Etape({ data, selected }: NodeProps<Visuel>) {
  return <div className={`at-noeud ${selected ? 'selectionne' : ''}`}><Handle type="target" position={Position.Top} /><strong>{data.titre}</strong><small>{data.sousTitre}</small><Handle type="source" position={Position.Bottom} /></div>;
}
const nodeTypes = { etape: Etape };
const liste = (v: string) => v.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
function parcours(g: Graphe, de: string, vers: string, vus = new Set<string>()): string[] | null {
  if (de === vers) return [de];
  if (vus.has(de)) return null;
  vus.add(de);
  for (const e of g.edges.filter(e => e.from === de)) { const suite = parcours(g, e.to, vers, vus); if (suite) return [de, ...suite]; }
  return null;
}
function Canevas({ valeur, agents, changer }: { valeur: Brouillon; agents: AgentCatalogue[]; changer: (v: Brouillon) => void }) {
  const { screenToFlowPosition } = useReactFlow();
  const [choix, choisir] = useState<string | null>(null);
  const [lien, choisirLien] = useState<number | null>(null);
  const [recherche, chercher] = useState('');
  const g = valeur.graph;
  const selection = g.nodes.find(n => n.id === choix);
  const agentChoisi = selection && 'agent' in selection ? agents.find(a => a.ref === selection.agent) : null;
  const setGraph = (graph: Graphe, assignments = valeur.assignments) => changer({ ...valeur, graph, assignments });
  function ajouter(ref: string, position?: { x: number; y: number }) {
    const a = agents.find(a => a.ref === ref);
    if (!a) return;
    const id = `etape-${crypto.randomUUID().slice(0, 8)}`;
    setGraph({ ...g, nodes: [...g.nodes, { id, type: 'agent', agent: ref, instruction: '', runsOn: 'pc', llm: a.llm, inputs: [], outputs: [`${id}.md`], slice: '*', mustChange: false }],
      layout: { ...g.layout, [id]: [position?.x ?? 100 + (g.nodes.length % 3) * 250, position?.y ?? 60 + Math.floor(g.nodes.length / 3) * 170] } },
      a.membres[0] ? { ...valeur.assignments, [id]: a.membres[0].id } : valeur.assignments);
    choisir(id); choisirLien(null);
  }
  const update = (id: string, patch: Record<string, unknown>) => setGraph({ ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, ...patch } as Graphe['nodes'][number] : n) });
  function retirer(id: string) {
    const assignments = { ...valeur.assignments }; delete assignments[id];
    setGraph({ ...g, nodes: g.nodes.filter(n => n.id !== id), edges: g.edges.filter(e => e.from !== id && e.to !== id), cycles: g.cycles.filter(c => !c.nodes.includes(id)) }, assignments);
    choisir(null);
  }
  function connecter(c: Connection) {
    if (!c.source || !c.target || c.source === c.target || g.edges.some(e => e.from === c.source && e.to === c.target)) return;
    const cycle = parcours(g, c.target, c.source);
    const source = g.nodes.find(n => n.id === c.source);
    const sorties = source && 'outputs' in source ? source.outputs : [];
    setGraph({ ...g, edges: [...g.edges, { from: c.source, to: c.target }],
      nodes: g.nodes.map(n => n.id === c.target && n.type === 'agent' ? { ...n, inputs: [...new Set([...n.inputs, ...sorties])] } : n),
      cycles: cycle ? [...g.cycles, { id: `boucle-${crypto.randomUUID().slice(0, 8)}`, nodes: cycle, maxLoops: 2 }] : g.cycles });
  }
  function deplacer(changements: NodeChange<Visuel>[]) {
    const layout = { ...g.layout }; let modifie = false;
    for (const c of changements) if (c.type === 'position' && c.position) { layout[c.id] = [c.position.x, c.position.y]; modifie = true; }
    if (modifie) setGraph({ ...g, layout });
  }
  function deposer(e: DragEvent) { e.preventDefault(); ajouter(e.dataTransfer.getData('application/x-agent'), screenToFlowPosition({ x: e.clientX, y: e.clientY })); }
  const nodes: Visuel[] = g.nodes.map((n, i) => ({ id: n.id, type: 'etape', selected: choix === n.id, deletable: false,
    position: { x: g.layout?.[n.id]?.[0] ?? 150 + (i % 3) * 240, y: g.layout?.[n.id]?.[1] ?? 60 + Math.floor(i / 3) * 170 },
    data: { titre: 'agent' in n ? (agents.find(a => a.ref === n.agent)?.membres.find(m => m.id === valeur.assignments[n.id])?.nom || agents.find(a => a.ref === n.agent)?.nom || n.agent) : n.id,
      sousTitre: n.type === 'agent' ? n.instruction?.slice(0, 75) || 'Préciser sa mission' : n.type === 'review' ? 'Revue indépendante' : n.type === 'approval' ? 'Approbation' : 'Contrôle du workflow' } }));
  return <div className="at-compositeur">
    <aside className="at-palette"><h3>Agents disponibles</h3><input aria-label="Rechercher un agent" placeholder="Chercher un agent…" value={recherche} onChange={e => chercher(e.target.value)} />
      <p className="at-aide">Glisse un agent sur le plan ou clique sur Ajouter.</p>
      {agents.filter(a => `${a.nom} ${a.membres.map(m => m.nom).join(' ')}`.toLowerCase().includes(recherche.toLowerCase())).map(a => <div key={a.ref} className="at-agent" draggable onDragStart={e => { e.dataTransfer.setData('application/x-agent', a.ref); e.dataTransfer.effectAllowed = 'copy'; }}>
        <strong>{a.membres.map(m => m.nom).join(', ') || a.nom}</strong><small>{a.nom} · {a.ref.split('@')[1]}</small><button type="button" onClick={() => ajouter(a.ref)} aria-label={`Ajouter ${a.nom}`}>Ajouter</button>
      </div>)}
    </aside>
    <div className="at-plan" onDrop={deposer} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}>
      {!g.nodes.length && <p className="at-plan-vide">Dépose ton premier agent<br /><small>Relie ensuite les étapes dans l'ordre du travail.</small></p>}
      <ReactFlow nodes={nodes} edges={g.edges.map((e, i) => ({ id: `lien-${i}`, source: e.from, target: e.to, label: e.on || 'suite', selected: lien === i }))} nodeTypes={nodeTypes}
        onNodesChange={deplacer} onConnect={connecter} onNodeClick={(_, n) => { choisir(n.id); choisirLien(null); }} onEdgeClick={(_, e) => { choisirLien(Number(e.id.slice(5))); choisir(null); }}
        onPaneClick={() => { choisir(null); choisirLien(null); }} fitView minZoom={0.25} maxZoom={2} deleteKeyCode={null}><Background /><Controls /></ReactFlow>
    </div>
    <aside className="at-inspecteur">
      {selection ? <><h3>Cette étape</h3><p className="at-aide">Les réglages s'appliquent à cette utilisation de l'agent.</p>
        {selection.type === 'agent' ? <>
          <label>Agent<select value={selection.agent} onChange={e => { const a = agents.find(a => a.ref === e.target.value)!; const assignments = { ...valeur.assignments }; if (a.membres[0]) assignments[selection.id] = a.membres[0].id; else delete assignments[selection.id]; setGraph({ ...g, nodes: g.nodes.map(n => n.id === selection.id ? { ...selection, agent: a.ref, llm: a.llm } : n) }, assignments); }}>
            {agents.map(a => <option key={a.ref} value={a.ref}>{a.nom} ({a.ref})</option>)}
          </select></label>
          {!!agentChoisi?.membres.length && <label>Membre<select value={valeur.assignments[selection.id] || ''} onChange={e => { const assignments = { ...valeur.assignments }; if (e.target.value) assignments[selection.id] = e.target.value; else delete assignments[selection.id]; changer({ ...valeur, assignments }); }}><option value="">Configuration du rôle</option>{agentChoisi.membres.map(m => <option value={m.id} key={m.id}>{m.nom} · {m.llm.via}</option>)}</select></label>}
          <label>Sa consigne<textarea rows={6} value={selection.instruction || ''} placeholder="Que doit faire cet agent ?" onChange={e => update(selection.id, { instruction: e.target.value })} /></label>
          <label>Livrables attendus<textarea key={`${selection.id}-sorties`} rows={3} defaultValue={selection.outputs.join('\n')} onBlur={e => update(selection.id, { outputs: liste(e.target.value) })} /></label>
          <label>Fichiers reçus<textarea key={`${selection.id}-${selection.inputs.join(',')}`} rows={2} defaultValue={selection.inputs.join('\n')} onBlur={e => update(selection.id, { inputs: liste(e.target.value) })} /></label>
          <button type="button" onClick={() => retirer(selection.id)}>Retirer cette étape</button>
        </> : <p>Ce contrôle appartient au workflow du projet et reste conservé.</p>}
      </> : lien !== null && g.edges[lien] ? <><h3>Lien entre étapes</h3><label>Continuer si<input placeholder="Toujours" value={g.edges[lien]!.on || ''} onChange={e => setGraph({ ...g, edges: g.edges.map((a, i) => i === lien ? { from: a.from, to: a.to, ...(e.target.value ? { on: e.target.value } : {}) } : a) })} /></label><button onClick={() => { setGraph({ ...g, edges: g.edges.filter((_, i) => i !== lien) }); choisirLien(null); }}>Supprimer ce lien</button></> : <><h3>Organisation du travail</h3><p>Sélectionne une étape pour adapter sa consigne et ses livrables.</p><p className="at-aide">Tire un lien entre les points de deux étapes. Les livrables sont alors transmis à l'étape suivante.</p></>}
      {!!g.cycles.length && <details><summary>Boucles de correction</summary>{g.cycles.map(c => <label key={c.id}>{c.nodes.join(' → ')}<input type="number" min={1} max={10} value={c.maxLoops} onChange={e => setGraph({ ...g, cycles: g.cycles.map(x => x.id === c.id ? { ...x, maxLoops: Math.max(1, Math.min(10, Number(e.target.value))) } : x) })} /></label>)}</details>}
      {!!g.nodes.length && <details><summary>Relier sans glisser</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); connecter({ source: String(f.get('de')), target: String(f.get('vers')), sourceHandle: null, targetHandle: null }); }}><label>De<select name="de">{g.nodes.map(n => <option key={n.id}>{n.id}</option>)}</select></label><label>Vers<select name="vers">{g.nodes.map(n => <option key={n.id}>{n.id}</option>)}</select></label><button>Relier</button></form></details>}
    </aside>
  </div>;
}
export function Compositeur(props: Parameters<typeof Canevas>[0]) { return <ReactFlowProvider><Canevas {...props} /></ReactFlowProvider>; }
