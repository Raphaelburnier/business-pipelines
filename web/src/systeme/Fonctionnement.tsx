import { useState } from "react";
import "./fonctionnement.css";

// Guide de fonctionnement, sans lecture de données ni commande d'exécution.
const PARCOURS = [
  { titre: "Demande", responsable: "Cockpit", detail: "Tu choisis une tâche et un projet. Le cockpit conserve la commande dans une file durable : fermer la page ne supprime pas la demande." },
  { titre: "Attribution", responsable: "Planificateur", detail: "Le planificateur choisit parmi les pipelines versionnés rattachés au projet et les agents déclarés dans l’équipe. Il tient compte des rôles et des runtimes disponibles ; cette sélection est déterministe, sans appel à un modèle." },
  { titre: "Plan", responsable: "Agent planificateur", detail: "L’agent lit la demande et prépare les changements, les critères d’acceptation, les vérifications et les risques. Ce plan sert de contrat de travail au codeur." },
  { titre: "Code", responsable: "Agent de développement", detail: "L’agent modifie le code dans le dossier du run et décrit ce qu’il a réalisé. Le moteur conserve des checkpoints Git et les fichiers échangés entre les étapes." },
  { titre: "Tests", responsable: "Superviseur", detail: "Le superviseur lance les commandes déclarées dans la fiche du projet : tests et, selon sa stack, typecheck et build. Il utilise une copie isolée du code ; les checks s’exécutent sans réseau. La préparation peut avoir accès au réseau si la fiche l’autorise." },
  { titre: "Revues", responsable: "Sessions indépendantes", detail: "Une nouvelle session relit l’arbre livrable en lecture seule. La revue de sécurité intervient si le projet l’active. Une anomalie critique ou majeure bloque la publication. Un test rouge ou une revue en échec renvoie au code, puis aux vérifications : improve-app@8 prévoit au maximum deux tours de correction." },
  { titre: "PR", responsable: "Publication", detail: "Le travail vérifié est publié dans une branche puis une pull request. Les preuves doivent encore correspondre aux fichiers livrables : modifier le code après les tests impose de le vérifier de nouveau." },
  { titre: "Fusion", responsable: "GitHub", detail: "La CI valide le merge avec la branche principale courante. La fusion automatique exige notamment le SHA exact vérifié, une branche interne admissible, aucun conflit, aucune conversation de revue non résolue et aucun fichier sensible. Une modification sensible demande une fusion explicite." },
  { titre: "Livraison", responsable: "Livreur", detail: "La livraison sélectionne les versions du cockpit, du moteur et du registre, vérifie le modèle de déploiement autorisé, construit la nouvelle version et contrôle la bascule. Une fusion GitHub et une installation en production sont deux états distincts." },
] as const;

const ATTENTES = [
  { nom: "Quota atteint", code: "waiting_quota", effet: "Le travail est conservé. Une reprise peut être programmée à la réinitialisation connue du quota, ou après le délai de prudence si cette date est inconnue." },
  { nom: "Connexion requise", code: "waiting_auth", effet: "Reconnecter le compte Claude ou Codex sur la machine concernée, puis confirmer la reprise. Le moteur ne reconnecte pas le compte automatiquement." },
  { nom: "Machine indisponible", code: "waiting_machine", effet: "Le maître attend le worker. La reprise peut être automatique lorsque la machine redevient disponible, selon la politique d’attente." },
  { nom: "Décision attendue", code: "waiting_approval", effet: "Une approbation ou une consigne humaine est nécessaire pour poursuivre. Le moteur conserve le travail en attendant la décision." },
  { nom: "Code à resynchroniser", code: "waiting_freshness", effet: "Un conflit avec une version plus récente du dépôt bloque la progression. Il faut résoudre cette situation avant de reprendre." },
] as const;

export function Fonctionnement() {
  const [selection, setSelection] = useState(0);
  const etape = PARCOURS[selection]!;
  return (
    <article className="sy-guide" aria-labelledby="fonctionnement-titre">
      <header className="sy-guide-entete">
        <span className="kicker">Système · Guide de fonctionnement · 30 octobre 2026</span>
        <h2 id="fonctionnement-titre">Comment travaille l’orchestrateur</h2>
        <p className="sy-guide-chapeau">Une tâche devient un travail d’équipe : le moteur distribue les étapes aux agents, vérifie leurs résultats et conserve l’avancement pour pouvoir reprendre.</p>
        <p>Un <strong>pipeline</strong> est la recette de travail. Un <strong>run</strong> est une exécution précise de cette recette pour une tâche.</p>
      </header>

      <nav className="sy-guide-sommaire" aria-label="Dans ce guide">
        <a href="#composants">Les trois composants</a>
        <a href="#parcours">Parcours d’un run</a>
        <a href="#machines">NAS et PC</a>
        <a href="#controles">Contrôles</a>
        <a href="#reprises">Attentes et reprises</a>
        <a href="#livraison">Fusion et livraison</a>
      </nav>

      <section id="composants" aria-labelledby="composants-titre">
        <h3 id="composants-titre">Trois composants, trois responsabilités</h3>
        <div className="sy-guide-composants">
          <div><span className="kicker">Piloter</span><h4>Le cockpit</h4><code>business-pipelines</code><p>Tu choisis les tâches, suis les runs, prends les décisions et demandes les livraisons.</p></div>
          <div><span className="kicker">Définir</span><h4>Le registre</h4><code>agent-registry</code><p>Il contient les définitions versionnées des agents et des pipelines : consignes, modèles, étapes, fichiers échangés et règles de correction.</p></div>
          <div><span className="kicker">Exécuter</span><h4>Le moteur</h4><code>agent-orchestrator</code><p>Il applique ces règles, distribue le travail entre les machines et enregistre les résultats.</p></div>
        </div>
      </section>

      <section id="parcours" aria-labelledby="parcours-titre">
        <h3 id="parcours-titre">Du besoin au résultat installé</h3>
        <p>Exemple d’une amélioration de code avec <code>improve-app@8</code>. Sélectionne une étape pour lire son rôle ; ce parcours explique le processus et ne représente pas un run en cours.</p>
        <ol className="sy-guide-parcours" aria-label="Étapes d’une amélioration">
          {PARCOURS.map((item, index) => (
            <li key={item.titre}><button type="button" aria-pressed={selection === index} aria-controls="fonctionnement-etape" onClick={() => setSelection(index)}><span aria-hidden="true">{index + 1}</span>{item.titre}</button></li>
          ))}
        </ol>
        <div id="fonctionnement-etape" className="sy-guide-etape" aria-live="polite" aria-atomic="true">
          <span className="kicker">Étape {selection + 1} sur {PARCOURS.length} · {etape.responsable}</span>
          <h4>{etape.titre}</h4><p>{etape.detail}</p>
        </div>
        <p className="sy-guide-retour"><strong>Boucle de correction :</strong> tests ou revue en échec → code → nouveaux tests → nouvelles revues. Deux tours de correction au maximum dans ce pipeline.</p>
      </section>

      <section id="machines" aria-labelledby="machines-titre">
        <h3 id="machines-titre">Le NAS coordonne, le PC exécute</h3>
        <p>Le <strong>maître sur le NAS</strong> coordonne les étapes. Le <strong>worker sur le PC</strong> reçoit notamment les travaux de développement et de revue, puis utilise Claude ou Codex selon le rôle attribué.</p>
        <p>Le maître tient compte des capacités et des places disponibles sur chaque machine. Plusieurs runs peuvent avancer en parallèle ; certaines étapes attendent leur tour. Les workers envoient régulièrement un signe de vie : une déconnexion rend la machine visible comme indisponible.</p>
        <p>Les commandes, événements, résultats et points de reprise sont enregistrés durablement, notamment dans le journal SQLite du moteur. Le cockpit lit cet état pour afficher l’avancement ; fermer l’interface n’arrête pas les agents.</p>
      </section>

      <section id="controles" aria-labelledby="controles-titre">
        <h3 id="controles-titre">Des contrôles séparés du codeur</h3>
        <ul className="sy-guide-liste">
          <li><strong>Tests supervisés.</strong> Les commandes proviennent de la fiche administrée du projet. Le codeur décrit son travail ; le superviseur exécute les contrôles et conserve leur résultat.</li>
          <li><strong>Revues indépendantes.</strong> Une session neuve relit le code en lecture seule. Les anomalies critiques ou majeures bloquent la publication.</li>
          <li><strong>Preuves liées au code.</strong> Les résultats portent sur l’arbre de fichiers vérifié. Un changement ultérieur impose une nouvelle validation.</li>
          <li><strong>Portée des vérifications.</strong> Une validation verte prouve que les contrôles prévus ont réussi. Leur qualité dépend des tests déclarés et des critères d’acceptation.</li>
        </ul>
      </section>

      <section id="reprises" aria-labelledby="reprises-titre">
        <h3 id="reprises-titre">Une attente a une cause et une suite</h3>
        <p>La reprise retrouve le dossier et l’identité du même run, ainsi que les étapes déjà validées. Elle dépend de la cause d’attente et des conditions de reprise.</p>
        <dl className="sy-guide-attentes">
          {ATTENTES.map((attente) => <div key={attente.code}><dt>{attente.nom}<code>{attente.code}</code></dt><dd>{attente.effet}</dd></div>)}
        </dl>
        <div className="sy-guide-delais">
          <div><span className="sy-guide-duree">5 h</span><h4>Quota sans date de retour connue</h4><p>C’est une cadence de prudence après un quota atteint. Si le fournisseur donne une date fiable de réinitialisation, elle est utilisée. Ce délai ne s’applique pas à tous les runs.</p></div>
          <div><span className="sy-guide-duree">6 h</span><h4>Diagnostic d’un run long</h4><p>Par défaut, le runner enregistre les dernières traces de progression et les étapes actives. Le run continue : ce diagnostic ne lance pas d’agent enquêteur et ne provoque aucune interruption automatique.</p></div>
        </div>
        <p>Les appels individuels aux modèles ont aussi leurs propres limites de durée, d’inactivité, d’actions ou de tours. Le seuil de diagnostic d’un run long ne garantit donc pas qu’un même appel puisse durer six heures.</p>
        <p>La pause des démarrages et l’annulation d’un run sont deux commandes distinctes. Une annulation conserve les fichiers de travail et demande l’arrêt de l’exécution, y compris sur le worker distant.</p>
      </section>

      <section id="livraison" aria-labelledby="livraison-titre">
        <h3 id="livraison-titre">Fusionner puis livrer</h3>
        <p>Une PR peut être fusionnée dans GitHub alors que la machine cible utilise encore la version précédente. La livraison sélectionne les versions des trois dépôts, construit et contrôle la nouvelle version, puis effectue la bascule. Le résultat réellement servi doit ensuite être vérifié.</p>
        <details className="sy-guide-details">
          <summary>Où sont définies et enregistrées les modifications sensibles ?</summary>
          <p>La sensibilité est calculée à partir des fichiers modifiés par la PR, puis rattachée à sa branche. Les règles du cockpit sont dans <code>deploy/fichiers-sensibles.json</code> : workflows, instructions d’agents, secrets, migrations, infrastructure, déploiement et autres chemins protégés.</p>
          <p>Le publieur conserve les chemins détectés dans le champ <code>sensibles</code> de chaque PR, dans l’instantané <code>etat/pull-requests.json</code>. Le workflow GitHub de fusion applique aussi son propre contrôle et consigne ses refus dans le résumé du run. Il relit les métadonnées sans exécuter le code de la PR.</p>
          <p>Cette politique de fusion appartient au cockpit et aux workflows des dépôts. Le registre définit les agents et les pipelines. Une modification sensible exige une fusion explicite ; un nouveau modèle de déploiement nécessite son autorisation distincte.</p>
        </details>
        <details className="sy-guide-details">
          <summary>Et si GitHub Actions est bloqué par la facturation ?</summary>
          <p>Le motif doit être confirmé dans les annotations du run. L’exception autorisée permet alors une fusion manuelle en squash après validation locale du merge avec la branche principale courante, tests adaptés, SHA exacts documentés et vérification des conflits et conversations. Une CI non exécutée ne vaut jamais une CI verte ; un test rouge reste bloquant. Les CI disponibles continuent à s’exécuter normalement.</p>
        </details>
      </section>
      <footer className="sy-guide-pied">Guide du fonctionnement vérifié le 30 octobre 2026. Les limites effectives dépendent du pipeline, de la fiche projet et de la configuration du runtime.</footer>
    </article>
  );
}
