// Les approbations de la maquette reproduisent la boîte métier du cockpit, distincte des
// approbations liées aux runs. Elles restent modifiables pendant la session pour montrer
// l'empreinte, la trace des décisions et la réponse libre.
import type { DemandeDecision, DossierApprobation, ReponseApprobations, ReponseDecision } from "../donnees/decisions";

const maintenant = "2026-09-29T18:00:00.000Z";

function clone<T>(valeur: T): T {
  return structuredClone(valeur);
}

function dossiersInitiaux(): DossierApprobation[] {
  return [
    {
      dossier: "marketing-vitrine-septembre",
      reponse_posee: null,
      empreinte: "6c04248ed1af",
      depuis: "2026-09-29T16:35:00.000Z",
      appliquer_avec: "marketing.json",
      plan_absent: false,
      fraicheur: {
        reference: "2026-09-29T15:40:00.000Z",
        age_heures: 2.33,
        max_heures: 24,
        verdict: "frais",
      },
      actions: [
        {
          id: "publier-vitrine",
          type: "publier",
          cible: "site-vitrine",
          valeur: { canal: "instagram", contenu: "decks de démarrage" },
          justification: "La campagne reste dans le budget mensuel autorisé.",
          sources: ["brief-septembre.md", "budget-marketing.json"],
          decision: null,
          note: null,
        },
        {
          id: "allouer-budget",
          type: "budget",
          cible: "publicite",
          valeur: { montant_eur: 180, duree_jours: 7 },
          justification: "Le montant tient sous le plafond de 250 € par campagne.",
          rapport: "Prévision : 35 à 60 visites qualifiées.",
          decision: null,
          note: null,
        },
      ],
      tranche: false,
    },
    {
      dossier: "prospection-partenaire-octobre",
      reponse_posee: {
        consigne: "Revoir la liste avec les trois partenaires déjà rencontrés avant de reproposer ce plan.",
        par: "destrobi28@gmail.com",
        le: "2026-09-29T15:10:00.000Z",
      },
      empreinte: "4287db5f5c10",
      depuis: "2026-09-29T14:30:00.000Z",
      appliquer_avec: "prospection.json",
      plan_absent: false,
      fraicheur: {
        reference: "2026-09-28T12:30:00.000Z",
        age_heures: 29.5,
        max_heures: 24,
        verdict: "perime",
      },
      actions: [
        {
          id: "contacter-partenaires",
          type: "contacter",
          cible: "partenaires",
          question: "Faut-il relancer les cinq contacts proposés ?",
          decision: null,
          note: null,
        },
      ],
      tranche: false,
    },
  ];
}

export function approbationsMaquette() {
  const dossiers = dossiersInitiaux();

  async function lecture(): Promise<ReponseApprobations> {
    return {
      qui: { par: "destrobi28@gmail.com", nom: "Raphaël", canal: "local" },
      etat: {
        dossiers: clone(dossiers),
        decidables: dossiers.filter((dossier) => !dossier.plan_absent && !dossier.tranche).length,
      },
      modules: {
        apps: [
          {
            nom: "AI Studio",
            url: "/ai-studio",
            etat: "en-ligne",
            description: "Prépare les contenus visuels validés par les plans métier.",
            notes: ["Archive NAS disponible"],
          },
          {
            nom: "Vitrine",
            url: null,
            etat: "en-cours",
            description: "Publication prévue après validation marketing.",
            notes: [],
          },
        ],
        erreur: null,
      },
    };
  }

  async function decider(demande: DemandeDecision): Promise<ReponseDecision> {
    const dossier = dossiers.find((candidat) => candidat.dossier === demande.dossier);
    if (!dossier) throw new Error(`aucun dossier "${demande.dossier}" en attente : rien à décider`);
    if (dossier.plan_absent) throw new Error(`le plan gelé de "${demande.dossier}" est introuvable : décider à l'aveugle est refusé`);
    if (dossier.empreinte !== demande.empreinte) throw new Error("le plan a changé depuis l'affichage : recharger et relire avant de décider");
    if (!demande.decisions.length && !demande.reponse?.trim()) throw new Error("aucune décision ni réponse à enregistrer");

    const actions = new Map(dossier.actions.map((action) => [action.id, action]));
    const decisions = demande.decisions.map((decision) => {
      const action = actions.get(decision.action_id);
      if (!action) throw new Error(`action "${decision.action_id}" absente du plan gelé`);
      action.decision = decision.decision;
      action.note = decision.motif?.trim() || null;
      return { ...decision, par: "destrobi28@gmail.com", canal: "local", le: maintenant };
    });

    const reponse = demande.reponse?.trim();
    if (reponse) {
      dossier.reponse_posee = { consigne: reponse, par: "destrobi28@gmail.com", le: maintenant };
    }
    dossier.tranche = !dossier.reponse_posee && dossier.actions.length > 0 && dossier.actions.every((action) => action.decision !== null);

    return {
      plan: dossier.empreinte,
      decisions,
      ...(reponse
        ? { reponse, reponse_par: "destrobi28@gmail.com", reponse_le: maintenant, reponse_canal: "local" }
        : {}),
    };
  }

  return { lecture, decider };
}
