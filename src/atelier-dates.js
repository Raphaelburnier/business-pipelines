// Dates civiles de Zurich : un jour de calendrier n'est pas toujours 24 heures.
const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function civil(instant) { return format.format(new Date(instant)).replace(' ', 'T'); }
function jour(date, delta) {
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error('Date de calendrier invalide.');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function instantLocal(date, heure = '00:00') {
  jour(date, 0);
  const cible = `${date}T${heure}`;
  const brut = Date.parse(`${cible}:00Z`);
  if (!Number.isFinite(brut)) throw new Error('Heure invalide.');
  const offsets = new Set([-36, 0, 36].map((h) => {
    const t = brut + h * 3600_000;
    return Date.parse(`${civil(t)}:00Z`) - t;
  }));
  const possibles = [...offsets].map((o) => brut - o).filter((t) => civil(t) === cible).sort((a, b) => a - b);
  if (!possibles.length) throw new Error("Cette heure n'existe pas à Zurich lors du passage à l'heure d'été.");
  // Au retour à l'heure d'hiver, une seule occurrence : première apparition de l'heure.
  return new Date(possibles[0]).toISOString();
}
function suivante(date, heure, repetition) {
  if (repetition === 'none') return null;
  let prochain = jour(date, repetition === 'weekly' ? 7 : 1);
  while (repetition === 'weekdays' && [0, 6].includes(new Date(`${prochain}T12:00Z`).getUTCDay())) prochain = jour(prochain, 1);
  try { return { date: prochain, instant: instantLocal(prochain, heure) }; }
  catch (err) {
    // Une récurrence traversant le saut de printemps part à la première minute existante.
    const minutes = Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3));
    for (let m = minutes + 1; m < Math.min(minutes + 181, 1440); m++) {
      try { return { date: prochain, instant: instantLocal(prochain, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`) }; } catch { /* minute inexistante */ }
    }
    throw err;
  }
}
module.exports = { civil, jour, instantLocal, suivante };
