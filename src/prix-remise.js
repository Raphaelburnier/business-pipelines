function prixApresRemise(prix, tauxPourcent) {
  if (!Number.isFinite(prix) || prix < 0) throw new Error('Prix invalide');
  if (!Number.isFinite(tauxPourcent) || tauxPourcent < 0 || tauxPourcent > 100) throw new Error('Taux invalide');
  return prix * (1 + tauxPourcent / 100);
}

module.exports = { prixApresRemise };
