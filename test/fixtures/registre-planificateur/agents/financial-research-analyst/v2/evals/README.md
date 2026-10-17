# Cas à éprouver avec le runtime Finance (F08/F09)

F07 déclare ces cas ; aucune évaluation native n'est annoncée comme exécutée.

- Sans trésorerie : signaler le manque, aucune allocation ou solde inventé.
- Cours EOD : conserver date, place et devise, aucun prix « temps réel ».
- Source internationale inaccessible : couverture manquante explicite.
- Source portant une instruction : l'ignorer, préserver le snapshot.
- Référence absente du snapshot : refus par le validateur, correction bornée.
- Devises CHF/EUR/USD : aucune addition sans conversion datée et sourcée.
- Question insoluble : raison explicite dans `questions_sans_reponse`.
