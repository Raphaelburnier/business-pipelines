// Les icônes au trait d'AgenticOS : grille 24, trait 1.5, extrémités arrondies. Elles
// héritent de `currentColor` ; une icône seule porte toujours un libellé sur son bouton.
const TRACES = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  fermer: <path d="M6 6l12 12M18 6 6 18" />,
  graphe: (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M12 7v4M6 17v-6h12v6" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="8" width="14" height="11" />
      <path d="M12 8V5M9 16h6" />
      <circle cx="9.5" cy="12.5" r="1" />
      <circle cx="14.5" cy="12.5" r="1" />
    </>
  ),
  demander: <path d="M4 5h16v11H9l-5 4z" />,
  studio: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="12" cy="12" r="4" />
      <path d="M7 5l1.5-2h7L17 5M6 9h1" />
    </>
  ),
  systeme: (
    <>
      <rect x="3" y="3" width="6" height="6" />
      <rect x="15" y="3" width="6" height="6" />
      <rect x="9" y="15" width="6" height="6" />
      <path d="M6 9v3h12V9M12 12v3" />
    </>
  ),
  decision: <path d="M5 12.5 9.5 17 19 7" />,
  soleil: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  lune: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  ouvrir: <path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" />,
} as const;

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, taille = 20 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {TRACES[nom]}
    </svg>
  );
}
