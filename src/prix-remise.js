function prixApresRemise(prix, tauxPourcent) {
  if (!Number.isFinite(prix) || prix < 0) throw new TypeError('Prix invalide');
  if (!Number.isFinite(tauxPourcent) || tauxPourcent < 0 || tauxPourcent > 100) throw new TypeError('Taux invalide');
  return prix * (1 - tauxPourcent / 100);
}
module.exports = { prixApresRemise };
