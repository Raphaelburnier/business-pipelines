// Le portrait d'un membre : sa photo si on en a choisi une, sinon un buste cyberpunk généré,
// toujours le même pour un même id (design system AgenticOS, composant AgentPortrait).
// Aucun visage réel, aucun personnage existant. Cadre 120:140.
import { useId } from "react";
import type { MembreEquipe } from "../donnees/equipe";

export type Rarete = "legendaire" | "epique" | "rare" | "commun" | "local";

export const RARETES: Record<Rarete, { libelle: string; lueur: string }> = {
  legendaire: { libelle: "Légendaire", lueur: "#fdf500" },
  epique: { libelle: "Épique", lueur: "#e455ae" },
  rare: { libelle: "Rare", lueur: "#37ebf3" },
  commun: { libelle: "Commun", lueur: "#d1c5c0" },
  local: { libelle: "Local", lueur: "#1ac5b0" },
};

/** La rareté suit la gamme du modèle : le mot l'accompagne toujours, jamais la couleur seule. */
export function rarete(m: Pick<MembreEquipe, "llm">): Rarete {
  const modele = m.llm.model.toLowerCase();
  if (modele.includes("fable")) return "legendaire";
  if (modele.includes("opus")) return "epique";
  if (modele.includes("ollama") || modele.includes("local")) return "local";
  if (m.llm.via === "claude" || m.llm.via === "codex") return "rare";
  return "commun";
}

const PEAUX = ["#f1d3bd", "#e0b494", "#c68e68", "#9a6643", "#6e4529", "#4a2e1c"];
const CHEVEUX = ["#272932", "#d1c5c0", "#e455ae", "#37ebf3", "#9370db", "#fdf500", "#710000", "#1ac5b0"];
const VESTES = ["#2f313b", "#3d404d", "#710000", "#272932"];
const COIFFURES = ["undercut", "mohawk", "bob", "buzz", "long", "messy", "ponytail", "spiky"] as const;
const YEUX = ["visor", "eyes", "mono", "glasses"] as const;
const IMPLANTS = ["temple", "jaw", "cheek", "ear", "none"] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Un tirage déterministe : chaque appel avance la graine. */
function tirage(id: string) {
  let r = hash(id);
  return <T,>(liste: readonly T[]): T => {
    r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0;
    return liste[r % liste.length] as T;
  };
}

export function Portrait({ membre, largeur, className = "" }: { membre: MembreEquipe; largeur: number; className?: string }) {
  const hauteur = Math.round((largeur * 140) / 120);
  if (membre.photo) {
    return <img src={membre.photo} alt={`Photo de ${membre.nom}`} width={largeur} height={hauteur} className={`ao-portrait-photo ${className}`} />;
  }
  return <Buste membre={membre} largeur={largeur} hauteur={hauteur} className={className} />;
}

function Buste({ membre, largeur, hauteur, className }: { membre: MembreEquipe; largeur: number; hauteur: number; className: string }) {
  const uid = useId().replace(/:/g, "");
  const choisir = tirage(membre.id);
  const peau = choisir(PEAUX);
  const coiffure = choisir(COIFFURES);
  const yeux = choisir(YEUX);
  const implant = choisir(IMPLANTS);
  const cheveux = choisir(CHEVEUX);
  const veste = choisir(VESTES);
  const lueur = RARETES[rarete(membre)].lueur;

  return (
    <svg viewBox="0 0 120 140" width={largeur} height={hauteur} role="img" aria-label={`Portrait de ${membre.nom}`} className={className}>
      <defs>
        <clipPath id={`${uid}c`}>
          <rect width="120" height="140" />
        </clipPath>
        <pattern id={`${uid}s`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#fff" fillOpacity=".05" />
        </pattern>
        <filter id={`${uid}g`} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <g clipPath={`url(#${uid}c)`}>
        <rect width="120" height="140" fill="#1e1f27" />
        <path d="M70 0H120V70L50 140H0V110Z" fill={lueur} fillOpacity=".16" />
        <path d="M96 0h8L24 140h-8Z" fill={lueur} fillOpacity=".35" />
        <path d="M10 140c3-28 20-38 50-38s47 10 50 38Z" fill={veste} />
        <path d="M40 104l20 22 20-22" fill="none" stroke={lueur} strokeWidth="3" />
        <path d="M50 84h20v22l-10 6-10-6Z" fill={peau} />
        <path d="M50 96l10 6 10-6v4l-10 6-10-6Z" fill="#000" fillOpacity=".18" />
        <path d="M36 46c0-16 10-26 24-26s24 10 24 26v16c0 14-10 26-24 26S36 76 36 62Z" fill={peau} />
        <path d="M60 88c-14 0-24-12-24-26v-6c4 18 12 26 24 26Z" fill="#000" fillOpacity=".12" />
        <g fill={cheveux}>
          <Coiffure forme={coiffure} />
        </g>
        <Yeux forme={yeux} lueur={lueur} flou={`${uid}g`} />
        <path d="M54 74h12" stroke="#272932" strokeWidth="2" strokeOpacity=".6" />
        <Implant forme={implant} lueur={lueur} />
        <rect width="120" height="140" fill={`url(#${uid}s)`} />
      </g>
    </svg>
  );
}

function Coiffure({ forme }: { forme: (typeof COIFFURES)[number] }) {
  switch (forme) {
    case "undercut":
      return (
        <>
          <path d="M34 46c0-20 12-30 28-30 14 0 24 8 24 22l-4 4c-6-10-18-12-30-8-8 3-14 8-18 14Z" />
          <rect x="34" y="44" width="4" height="12" fillOpacity=".5" />
        </>
      );
    case "mohawk":
      return (
        <>
          <path d="M53 8h14l3 10-2 16H52l-2-16Z" />
          <path d="M38 40c2-10 8-16 14-18v10c-6 2-10 5-14 8ZM82 40c-2-10-8-16-14-18v10c6 2 10 5 14 8Z" fillOpacity=".35" />
        </>
      );
    case "bob":
      return <path d="M32 70V44c0-18 12-28 28-28s28 10 28 28v26h-8V46c-10-2-22-8-26-16-4 10-10 14-14 16v24Z" />;
    case "buzz":
      return <path d="M36 44c0-16 10-24 24-24s24 8 24 24c-6-6-14-8-24-8s-18 2-24 8Z" fillOpacity=".75" />;
    case "long":
      return <path d="M30 110V46c0-20 12-30 30-30s30 10 30 30v64h-10V48c-12 0-24-6-30-14-4 8-12 14-20 14v62Z" />;
    case "messy":
      return <path d="M34 48c-4-18 6-32 26-32 18 0 30 12 26 30l-6-8-4 8-6-10-6 8-6-8-6 8-6-6Z" />;
    case "ponytail":
      return (
        <>
          <path d="M36 44c0-18 12-26 24-26s24 8 24 26c-8-8-18-10-24-10s-16 2-24 10Z" />
          <path d="M82 34c14 4 16 20 10 34l-6-2c4-10 2-20-6-26Z" />
        </>
      );
    case "spiky":
      return <path d="M34 46l-4-14 10 4-2-16 12 10 4-14 8 12 8-12 2 14 12-8-4 16 10-2-6 12c-8-8-18-10-26-10s-18 2-24 8Z" />;
  }
}

function Yeux({ forme, lueur, flou }: { forme: (typeof YEUX)[number]; lueur: string; flou: string }) {
  switch (forme) {
    case "visor":
      return (
        <>
          <path d="M34 50h52v10l-4 4H38l-4-4Z" fill="#272932" />
          <rect x="38" y="53" width="44" height="5" fill={lueur} />
          <rect x="38" y="53" width="44" height="5" fill={lueur} opacity=".5" filter={`url(#${flou})`} />
        </>
      );
    case "eyes":
      return (
        <>
          <rect x="44" y="54" width="9" height="4" fill="#272932" />
          <rect x="67" y="54" width="9" height="4" fill="#272932" />
          <rect x="48" y="55" width="3" height="2" fill={lueur} />
          <rect x="71" y="55" width="3" height="2" fill={lueur} />
        </>
      );
    case "mono":
      return (
        <>
          <rect x="44" y="54" width="9" height="4" fill="#272932" />
          <circle cx="71" cy="56" r="7" fill="#272932" />
          <circle cx="71" cy="56" r="4" fill={lueur} />
          <path d="M78 56h8" stroke="#272932" strokeWidth="2" />
        </>
      );
    case "glasses":
      return (
        <>
          <rect x="41" y="51" width="15" height="9" fill="none" stroke="#272932" strokeWidth="2.5" />
          <rect x="64" y="51" width="15" height="9" fill="none" stroke="#272932" strokeWidth="2.5" />
          <path d="M56 55h8" stroke="#272932" strokeWidth="2" />
          <rect x="46" y="54" width="4" height="3" fill="#272932" />
          <rect x="69" y="54" width="4" height="3" fill="#272932" />
        </>
      );
  }
}

function Implant({ forme, lueur }: { forme: (typeof IMPLANTS)[number]; lueur: string }) {
  switch (forme) {
    case "temple":
      return (
        <>
          <path d="M36 44h-4v14h4M32 50h-6" fill="none" stroke={lueur} strokeWidth="2" />
          <rect x="28" y="40" width="4" height="4" fill={lueur} />
        </>
      );
    case "jaw":
      return (
        <>
          <path d="M70 70l12-4v10l-8 8h-8" fill="#7a7e92" />
          <path d="M74 72h6" stroke={lueur} strokeWidth="2" />
        </>
      );
    case "cheek":
      return <path d="M40 64h8l4 4M40 68h6" fill="none" stroke={lueur} strokeWidth="1.5" />;
    case "ear":
      return (
        <>
          <rect x="82" y="50" width="6" height="14" fill="#7a7e92" />
          <path d="M88 52V36" stroke="#7a7e92" strokeWidth="2" />
          <circle cx="88" cy="35" r="2" fill={lueur} />
        </>
      );
    case "none":
      return null;
  }
}
