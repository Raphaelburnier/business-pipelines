// Les approbations de la maquette reproduisent la boîte métier du cockpit, distincte des
// approbations liées aux runs. Elles restent modifiables pendant la session pour montrer
// l'empreinte, la trace des décisions et la réponse libre.
import type {
  DemandeDecision,
  DemandeDecisionRun,
  DossierApprobation,
  EtatConseiller,
  FilConseil,
  ReponseApprobations,
  ReponseDecision,
} from "../donnees/decisions";

const maintenant = "2026-09-29T18:00:00.000Z";

const conseillerMaquette: EtatConseiller = {
  disponible: false,
  vuLe: "2026-09-29T17:58:20.000Z",
  modele: "qwen3:8b",
  vault: { fichiers: 482, synchroLe: "2026-09-29T17:42:01.000Z" },
};

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
          conseil: {
            classement: "probleme",
            texte: "Le brief ne donne ni lien de validation de la vitrine ni date de disponibilité. La publication peut renvoyer vers une page incomplète.",
            sources: [
              { id: "V1", genre: "vault", titre: "Brief septembre", chemin: "notes/marketing/brief-septembre.md" },
              { id: "R1", genre: "run", titre: "Vérification de la vitrine", run: "run-vitrine-20260929" },
            ],
            modele: "qwen3:8b",
            le: "2026-09-29T17:42:10.000Z",
          },
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
          conseil: {
            classement: "suggestion",
            texte: "Ajouter un seuil d'arrêt mesurable, par exemple le coût par visite maximal, avant de lancer la campagne.",
            sources: [{ id: "V1", genre: "vault", titre: "Budget marketing", chemin: "notes/marketing/budget.md" }],
            modele: "qwen3:8b",
            le: "2026-09-29T17:42:10.000Z",
          },
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
    {
      dossier: "catalogue-automne",
      reponse_posee: null,
      empreinte: "99b6e97c052d",
      depuis: "2026-09-29T11:20:00.000Z",
      appliquer_avec: "catalogue.json",
      plan_absent: false,
      fraicheur: {
        reference: "2026-09-29T10:50:00.000Z",
        age_heures: 7.17,
        max_heures: 24,
        verdict: "frais",
      },
      actions: [
        {
          id: "mettre-a-jour-prix",
          type: "prix",
          cible: "pack-démarrage",
          valeur: { de: 12, vers: 9.9, devise: "CHF" },
          justification: "Le prix suit la campagne d'automne validée.",
          decision: "approuve",
          note: "Application après la publication du catalogue.",
          decision_par: "Raphaël",
          decision_le: "2026-09-29T17:10:00.000Z",
          decision_canal: "tailnet",
        },
      ],
      tranche: true,
      note_vault: "fait",
    },
  ];
}

function filsInitiaux(): Map<string, FilConseil> {
  return new Map([
    [
      "marketing-vitrine-septembre",
      {
        dossier: "marketing-vitrine-septembre",
        conseiller: conseillerMaquette,
        messages: [
          {
            id: 1,
            auteur: "raphael",
            par: "Raphaël",
            texte: "Qu'est-ce qui manque avant de publier ?",
            sources: [],
            statut: "fait",
            modele: null,
            creeLe: "2026-09-29T17:40:05.000Z",
          },
          {
            id: 2,
            auteur: "conseiller",
            par: null,
            texte: "Le lien de la vitrine et sa date de disponibilité ne figurent pas dans le brief. Je ne peux pas vérifier que la campagne mènera vers une page prête.",
            sources: [
              { id: "V1", genre: "vault", titre: "Brief septembre", chemin: "notes/marketing/brief-septembre.md" },
              { id: "R1", genre: "run", titre: "Vérification de la vitrine", run: "run-vitrine-20260929" },
            ],
            statut: "fait",
            modele: "qwen3:8b",
            creeLe: "2026-09-29T17:42:10.000Z",
          },
        ],
      },
    ],
  ]);
}

// Une approbation de run du moteur (phase 5) : une rallonge de budget, tranchée par commande.
function dossiersRuns(): DossierApprobation[] {
  return [
    {
      dossier: "run:5b1e0c2a-6f3d-4b8e-9a71-2c4d5e6f7a80",
      source: "run",
      runId: "add85e8a-0000-4000-8000-000000000001",
      approbationId: "5b1e0c2a-6f3d-4b8e-9a71-2c4d5e6f7a80",
      nodeId: "budget-1",
      reason: "budget",
      projet: "steam-tierlist",
      rapport: {
        question: "Accorder une rallonge de budget à ce run ?",
        resume: "plafond de 3 USD atteint après l'étape de tests",
        changements: ["plafond relevé de 3 USD et 45 turns"],
        implications: ["le run reprend là où il s'est arrêté, sans rejouer les étapes terminées"],
        cout: "3.04 USD et 41 turns consommés",
        risques: ["une boucle qui ne converge pas consommera aussi la rallonge"],
        recommandation: "refuser si une étape tourne en rond, accorder si le travail avance",
      },
      reponse_posee: null,
      empreinte: "budget-1",
      depuis: "2026-09-29T17:20:00.000Z",
      appliquer_avec: "improve-app@4",
      plan_absent: false,
      fraicheur: { reference: null, age_heures: null, max_heures: null, verdict: "inconnue" },
      actions: [],
      tranche: false,
      decision_envoyee: false,
    },
  ];
}

export function approbationsMaquette() {
  const dossiers = [...dossiersInitiaux(), ...dossiersRuns()];
  const fils = filsInitiaux();

  async function lecture(): Promise<ReponseApprobations> {
    return {
      qui: { par: "destrobi28@gmail.com", nom: "Raphaël", canal: "local" },
      etat: {
        dossiers: clone(dossiers),
        decidables: dossiers.filter((dossier) => !dossier.plan_absent && !dossier.tranche).length,
      },
      conseiller: clone(conseillerMaquette),
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

  async function filConseil(dossier: string): Promise<FilConseil> {
    return clone(
      fils.get(dossier) ?? {
        dossier,
        conseiller: conseillerMaquette,
        messages: [],
      }
    );
  }

  async function poserConseil(dossier: string, texte: string): Promise<FilConseil> {
    if (!conseillerMaquette.disponible) throw new Error("Le conseiller est indisponible : PC endormi.");
    const contenu = texte.trim();
    if (!contenu) throw new Error("La question du conseiller est vide.");
    const precedent = fils.get(dossier);
    const fil: FilConseil = precedent ?? { dossier, conseiller: conseillerMaquette, messages: [] };
    fil.messages.push({
      id: fil.messages.length + 1,
      auteur: "raphael",
      par: "Raphaël",
      texte: contenu,
      sources: [],
      statut: "fait",
      modele: null,
      creeLe: maintenant,
    });
    fils.set(dossier, fil);
    return clone(fil);
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
      action.decision_par = "Raphaël";
      action.decision_le = maintenant;
      action.decision_canal = "local";
      return { ...decision, par: "Raphaël", canal: "local", le: maintenant };
    });

    const reponse = demande.reponse?.trim();
    if (reponse) {
      dossier.reponse_posee = { consigne: reponse, par: "Raphaël", le: maintenant };
    }
    dossier.tranche = !dossier.reponse_posee && dossier.actions.length > 0 && dossier.actions.every((action) => action.decision !== null);

    return {
      plan: dossier.empreinte,
      decisions,
      ...(reponse ? { reponse, reponse_par: "Raphaël", reponse_le: maintenant, reponse_canal: "local" } : {}),
    };
  }

  async function deciderRun(approbationId: string, demande: DemandeDecisionRun): Promise<{ id: string; statut: string }> {
    const dossier = dossiers.find((candidat) => candidat.approbationId === approbationId);
    if (!dossier) throw new Error("approbation inconnue");
    if (dossier.decision_envoyee) throw new Error("une décision est déjà partie pour cette approbation");
    if (demande.decision === "oriented" && !demande.note?.trim()) throw new Error("une consigne ne peut pas être vide");
    dossier.decision_envoyee = true;
    dossier.tranche = true;
    return { id: "commande-maquette", statut: "pending" };
  }

  return { lecture, filConseil, poserConseil, decider, deciderRun };
}
