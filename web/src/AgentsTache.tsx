import { createContext, useContext, useState, type ReactNode } from 'react';
import { useCharge } from './donnees/contexte';
import { nomRole, type AgentTache } from './donnees/agents-taches';

const Photos = createContext<Map<string, string | null>>(new Map());
export function EquipeTaches({ children }: { children: ReactNode }) {
  const { donnees } = useCharge(s => s.equipe(), []);
  return <Photos.Provider value={new Map(donnees?.agents.map(a => [a.id, a.photo]))}>{children}</Photos.Provider>;
}
function Badge({ agent, roles }: { agent: AgentTache; roles: string[] }) {
  const photos = useContext(Photos);
  const [imageInvalide, setImageInvalide] = useState<string | null>(null);
  const photo = agent.id ? photos.get(agent.id) : null;
  const initiales = agent.nom.split(/[\s-]+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
  return <span className="task-agent" title={`${agent.nom} · ${roles.map(nomRole).join(', ')} · ${agent.via}`}>
    <span className="task-agent-portrait" aria-hidden="true">{photo && photo !== imageInvalide ? <img src={photo} alt="" onError={() => setImageInvalide(photo)} /> : initiales}</span>
    <span className="task-agent-nom">{agent.nom}</span>
  </span>;
}
export function AgentsTache({ agents = [], compact = false }: { agents?: AgentTache[]; compact?: boolean }) {
  const groupes = new Map<string, { agent: AgentTache; roles: string[] }>();
  for (const agent of agents) {
    const id = agent.id || `${agent.nom}:${agent.via}`;
    const groupe = groupes.get(id);
    if (groupe) groupe.roles.push(agent.role);
    else groupes.set(id, { agent, roles: [agent.role] });
  }
  if (!groupes.size) return <span className="task-agent-vide">Agents à attribuer</span>;
  return <span className={`task-agents ${compact ? 'compact' : ''}`} role="group" aria-label={`Agents : ${[...groupes.values()].map(g => g.agent.nom).join(', ')}`}>
    {[...groupes].map(([id, g]) => <Badge key={id} {...g} />)}
  </span>;
}
