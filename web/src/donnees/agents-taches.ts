export interface AgentTache {
  id: string | null;
  nom: string;
  role: string;
  via: string;
}

export function nomRole(role: string): string {
  const noms: Record<string,string> = { plan: 'Planification', implement: 'Développement', review: 'Revue du code', 'review-security': 'Revue de sécurité' };
  return noms[role] || role.replace(/-/g, ' ');
}
