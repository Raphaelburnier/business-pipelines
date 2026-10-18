---
name: finance-snapshot-analysis
description: Analyse un instantané financier fourni, vérifie la traçabilité et prépare un rapport prudent sans collecte externe.
---

# Procédure d’analyse d’un instantané Finance

Cette procédure s'applique aux missions `finance-research`. Elle utilise seulement les
fichiers explicitement fournis au run et n'autorise aucune collecte externe.

1. Lire l'instantané et vérifier son identifiant, sa date de préparation, son indicateur
   `synthetic`, sa période, ses devises, ses limites et ses références de source.
2. Pour chaque chiffre, refaire le calcul à partir des composantes et des unités du
   snapshot. Garder chaque devise séparée ; ne pas convertir ou agréger sans taux daté.
3. Séparer les faits sourcés, les hypothèses et les données absentes. Les apports ne sont
   pas des revenus, les virements internes ne sont pas des flux business consolidés et les
   factures impayées ne sont pas de la trésorerie disponible.
4. Ne pas présenter l'excédent opérationnel comme un bénéfice comptable. Si l'instantané
   est synthétique, marquer chaque conclusion financière qui en dépend comme fictive.
5. Pour les cours et données macro, conserver période, place, devise, unité, source et
   fraîcheur lorsqu'ils existent. Si le snapshot ne fournit rien, dire que rien n'a été
   observé ; ne pas compléter par la mémoire du modèle ou une estimation.
6. Répondre à chaque question de la mission avec les identifiants de source pertinents.
   Placer les questions sans preuve dans `questions_sans_reponse` avec la raison.
7. Décrire des scénarios conditionnels avec leurs hypothèses, effets possibles, risques et
   vérifications nécessaires. Ne pas promettre un rendement ni formuler un ordre d'achat
   ou de vente. Une recommandation personnalisée exige aussi un profil et une situation
   financière réels suffisants ; leur absence doit rester explicite.
8. Lors d'une correction, traiter les manques déterministes transmis par la consigne du
   moteur sans prétendre avoir lu un fichier qui n'est pas déclaré en entrée.
9. Écrire seulement le fichier de rapport déclaré par le nœud. Ne modifier aucun fichier
   d'entrée, manifeste, validation ou autre sortie.

Avant de terminer, contrôler que chaque fait chiffré a une source, que les devises ne sont
pas mélangées, que les absences sont visibles et que rien ne prétend être en temps réel.

Contrat A4 : rapport version 2. Utiliser des métriques structurées liées aux chemins
et aux valeurs exactes du snapshot ; aucune valeur chiffrée en prose. Les faits
chiffrés sont rendus par l'interface à partir de ces métriques contrôlées.
