// Les erreurs que l'écran affiche disent ce qui ne va pas et quoi faire. Le message technique
// d'origine reste disponible pour un « Détail technique » : il aide à diagnostiquer, il
// n'explique rien à qui pilote.

/** Une réponse non 2xx de l'API du cockpit. `message` reprend le champ `erreur` du serveur. */
export class ErreurApi extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export interface ErreurLisible {
  /** Ce qu'on affiche. */
  message: string;
  /** Le message d'origine quand il diffère, pour un détail repliable ; sinon `null`. */
  detail: string | null;
}

function messageCode(code: number): string {
  if (code === 401 || code === 403) return "Accès refusé : cette identité tailnet n'est pas autorisée pour cette action.";
  if (code === 404) return "Introuvable : cette ressource n'existe plus ou n'a jamais existé.";
  if (code === 409) return "Les données ont changé entre-temps. Recharge la page, puis réessaie.";
  if (code === 502 || code === 503 || code === 504) return "Le cockpit est momentanément indisponible. Il redémarre peut-être après une livraison.";
  if (code >= 500) return `Le cockpit a rencontré une erreur (${code}). Réessaie dans un instant.`;
  return `La demande a été refusée (${code}).`;
}

/**
 * Traduit une erreur en message lisible. Les messages du serveur sont déjà rédigés en
 * français et passent tels quels ; seuls les codes nus, les pannes réseau et les réponses
 * illisibles sont reformulés.
 */
export function lireErreur(err: unknown): ErreurLisible {
  const brut = err instanceof Error ? err.message : String(err);
  if (err instanceof ErreurApi) {
    return /^\d{3}$/.test(err.message) ? { message: messageCode(err.code), detail: `HTTP ${err.code}` } : { message: err.message, detail: null };
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(brut)) {
    return { message: "Le cockpit ne répond pas. Vérifie la connexion au tailnet, puis réessaie.", detail: brut };
  }
  if (err instanceof SyntaxError || /JSON/.test(brut)) {
    return { message: "Le cockpit a renvoyé une réponse illisible. Il redémarre peut-être après une livraison.", detail: brut };
  }
  return { message: brut, detail: null };
}
