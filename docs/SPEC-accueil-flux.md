# Accueil du cockpit : flux et inspection

## Objectif
Lire les relations entre orchestrateur, machines, projets enregistrés et étapes du
dernier run. Inspecter une cellule dans un panneau latéral en conservant l'accueil.

## Périmètre
Frontend React/TypeScript dans `web/src/topologie`, `App.tsx` et `vues/Panneau.tsx`.
Réutiliser les sources REST/SSE, les détails et les thèmes Night City existants.
Les cellules d'étapes représentent des jalons du run, pas des dépendances séquentielles.

## Critères de réussite
- Liaisons visibles, avec ancrages explicites, y compris après un événement SSE.
- Les embranchements vers les étapes ne traversent pas les autres cellules.
- Le clic et l'activation clavier inspectent projet, machine, orchestrateur ou étape
  sans modifier l'URL de l'accueil.
- Le graphe reste visible et interactif pendant l'inspection.
- Une étape ouvre son run avec cette étape sélectionnée.
- Fermeture par bouton, Échap ou clic sur le fond ; retour du focus au déclencheur.
- Les anciennes URL de détail fonctionnent toujours.
- Affichage adapté au téléphone ; thèmes jour/nuit et réduction des animations respectés.

## Validation
`npm --prefix web run build` et `npm --prefix web test`.
Vérification navigateur avec `npm --prefix web run dev -- --host 127.0.0.1 --port 5178`
sur `/?source=maquette`, à 1440 px et 390 px, puis après actualisation des données.

## Conventions et limites
Conserver les noms français, les composants existants et les tokens CSS du thème.
Ne pas modifier les contrats serveur ni ajouter de dépendance. Les opérations métier
restent sur les boutons existants ; inspecter une cellule ne lance aucune commande.
