// « Fix et fonctionnalités à venir » : la feuille de route de l'audit et les défauts à corriger.
// Les données vivent dans feuille.ts ; une PR qui avance un point met son statut à jour.
import "./avenir.css";
import { useMemo, useState } from "react";
import { DATE_AUDIT, DEFAUTS, LOTS, SUGGESTIONS, type Severite, type Statut } from "./feuille";

type Onglet = "feuille" | "defauts" | "suggestions";

const ONGLETS: Array<{ id: Onglet; nom: string }> = [
  { id: "feuille", nom: "Feuille de route" },
  { id: "defauts", nom: "Bugs et failles" },
  { id: "suggestions", nom: "Suggestions" },
];

const MOT_STATUT: Record<Statut, string> = { "a-faire": "à faire", "en-cours": "en cours", fait: "fait" };
const SEVERITES: Severite[] = ["critique", "haute", "moyenne", "basse"];

function Pastille({ statut }: { statut: Statut }) {
  return <span className={`av-statut ${statut}`}>{MOT_STATUT[statut]}</span>;
}

function FeuilleDeRoute() {
  return (
    <ol className="av-lots">
      {LOTS.map((lot) => {
        const faits = lot.etapes.filter((e) => e.statut === "fait").length;
        return (
          <li key={lot.id} className="av-lot">
            <header>
              <span className="kicker">Lot {lot.id}{lot.prerequis ? ` · après ${lot.prerequis}` : ""}</span>
              <h3>{lot.titre}</h3>
              <p>{lot.but}</p>
              <span className="av-avancement" aria-label={`${faits} étapes faites sur ${lot.etapes.length}`}>
                {faits}/{lot.etapes.length}
              </span>
            </header>
            <ul>
              {lot.etapes.map((e) => (
                <li key={e.id}>
                  <div className="av-ligne">
                    <b>{e.id}</b>
                    <span className="av-titre">{e.titre}</span>
                    {e.sensible && <span className="av-sensible" title="Touche un fichier sensible : fusion explicite">sensible</span>}
                    <Pastille statut={e.statut} />
                  </div>
                  <p>{e.detail}</p>
                  <div className="av-fichiers">
                    {e.fichiers.map((f) => <code key={f}>{f}</code>)}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function Defauts() {
  const [severite, setSeverite] = useState<Severite | "toutes">("toutes");
  const [masquerFaits, setMasquerFaits] = useState(true);
  const visibles = useMemo(
    () => DEFAUTS.filter((d) => (severite === "toutes" || d.severite === severite) && (!masquerFaits || d.statut !== "fait")),
    [severite, masquerFaits]
  );
  return (
    <section className="av-defauts">
      <div className="av-filtres" role="group" aria-label="Filtrer par sévérité">
        {(["toutes", ...SEVERITES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={severite === s} onClick={() => setSeverite(s)}>
            {s} {s !== "toutes" && <span>{DEFAUTS.filter((d) => d.severite === s).length}</span>}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={masquerFaits} onChange={(e) => setMasquerFaits(e.target.checked)} />
          masquer les corrigés
        </label>
      </div>
      {visibles.length === 0 ? (
        <p className="av-vide">Rien à afficher avec ces filtres.</p>
      ) : (
        <ul className="av-liste">
          {visibles.map((d) => (
            <li key={d.id} className={`av-defaut ${d.severite}`}>
              <div className="av-ligne">
                <b>{d.id}</b>
                <span className={`av-severite ${d.severite}`}>{d.severite}</span>
                <span className="av-titre">{d.titre}</span>
                <Pastille statut={d.statut} />
              </div>
              <div className="av-fichiers"><code>{d.fichiers}</code></div>
              <p>Correctif : {d.correctif}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AVenir() {
  const [onglet, setOnglet] = useState<Onglet>("feuille");
  const etapes = LOTS.flatMap((l) => l.etapes);
  const ouverts = DEFAUTS.filter((d) => d.statut !== "fait");
  const critiques = ouverts.filter((d) => d.severite === "critique").length;
  return (
    <div className="av-page">
      <section className="av-hero">
        <div>
          <span className="kicker">Audit du {DATE_AUDIT}</span>
          <h2>Fix et fonctionnalités à venir</h2>
          <p>
            Ce qui reste pour une boucle agentique entièrement automatique, dans l'ordre des dépendances. Le lot sécurité
            passe avant le superviseur : plus les agents s'enchaînent sans clic, plus une injection de prompt peut aller loin.
          </p>
        </div>
        <dl className="av-chiffres">
          <div><dt>étapes faites</dt><dd>{etapes.filter((e) => e.statut === "fait").length}/{etapes.length}</dd></div>
          <div><dt>défauts ouverts</dt><dd>{ouverts.length}</dd></div>
          <div className={critiques ? "alerte" : ""}><dt>critiques</dt><dd>{critiques}</dd></div>
        </dl>
      </section>
      <div className="av-onglets" role="tablist">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}>
            {o.nom}
          </button>
        ))}
      </div>
      {onglet === "feuille" && <FeuilleDeRoute />}
      {onglet === "defauts" && <Defauts />}
      {onglet === "suggestions" && (
        <ul className="av-suggestions">
          {SUGGESTIONS.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}
