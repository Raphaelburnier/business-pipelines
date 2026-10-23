const atelier = require('./atelier');
async function traiter({ req, res, chemin, json, corps, store, params, qui, origineAutorisee }) {
  if (!chemin.startsWith('/api/atelier/')) return false;
  if (req.method !== 'GET' && !origineAutorisee(req)) { json(res, 403, { erreur: 'Origine refusée.' }); return true; }
  const s = store();
  if (!s) { json(res, 503, { erreur: 'Event store indisponible.' }); return true; }
  try {
    if (req.method === 'GET' && chemin === '/api/atelier/catalogue') json(res, 200, atelier.catalogue(s, params()));
    else if (req.method === 'GET' && chemin === '/api/atelier/objectifs') json(res, 200, { objectifs: atelier.lister(s) });
    else if (req.method === 'POST') {
      const d = await corps();
      if (d === null) return true;
      if (chemin === '/api/atelier/modeles') json(res, 201, atelier.sauvegarder(s, params(), d));
      else if (chemin === '/api/atelier/valider') {
        const r = atelier.resoudre(params(), d);
        json(res, 200, { participants: r.participants, budget: r.resolution.budget });
      } else if (chemin === '/api/atelier/objectifs') json(res, 201, atelier.creer(s, params(), d, qui));
      else {
        const m = chemin.match(/^\/api\/atelier\/objectifs\/([a-f0-9-]{36})$/);
        if (m) json(res, 200, atelier.modifier(s, m[1], d));
        else json(res, 404, { erreur: 'Route inconnue.' });
      }
    } else json(res, 404, { erreur: 'Route inconnue.' });
  } catch (err) { json(res, 400, { erreur: err.message }); }
  return true;
}
module.exports = { traiter };
