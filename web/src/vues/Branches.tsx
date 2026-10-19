// Les branches métier du cockpit, telles que le registre les déclare : ce qui désigne chaque
// nature, les pipelines qui la portent et les projets d'où lancer une mission.
import { useCharge } from "../donnees/contexte";
import { libelleNature } from "../donnees/natures";
import { Erreur, Titre, Vide } from "../ui";

export function Branches({ aller }: { aller: (href: string) => void }) {
  const { donnees, erreur } = useCharge((s) => s.natures(), []);
  return <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
    <div>
      <Titre compteur={donnees?.natures.length}>Branches</Titre>
      <p className="text-sm text-douce">Chaque nature de mission vient de <code>natures/</code> dans le registre. Une branche ajoutée là apparaît ici et dans le choix de nature d'une mission.</p>
    </div>
    {erreur && <Erreur>{erreur}</Erreur>}
    {donnees && !donnees.natures.length && <Vide>Aucune nature déclarée.</Vide>}
    {donnees?.natures.map((n) => <article key={n.id} className="flex flex-col gap-2 rounded-lg border border-trait bg-carte p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{n.libelle}</h3>
        <span className="text-xs text-douce">{n.regles === "dediees" ? "règles dédiées" : "règles génériques"} · priorité {n.priorite}</span>
      </header>
      <p className="text-sm">{n.description}</p>
      <p className="text-xs text-douce">Désignée par {[...n.tags.map((t) => `le tag ${t}`), ...n.handlers.map((h) => `une étape ${h}`)].join(", ")}.</p>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-douce">Pipelines du registre</h4>
          {n.pipelines.length
            ? <ul className="mt-1 flex flex-wrap gap-1">{n.pipelines.map((p) => <li key={p}><code className="rounded border border-trait px-1.5 py-0.5 text-xs">{p}</code></li>)}</ul>
            : <p className="mt-1 text-douce">Aucun pipeline ne porte encore cette nature.</p>}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-douce">Projets</h4>
          {n.projets.length
            ? <ul className="mt-1 flex flex-wrap gap-2">{n.projets.map((p) => <li key={p.id}>
                <a className="text-accent underline" href={`/missions/${encodeURIComponent(p.id)}`}
                  onClick={(e) => { e.preventDefault(); aller(`/missions/${encodeURIComponent(p.id)}`); }}>{p.nom}</a>
              </li>)}</ul>
            : <p className="mt-1 text-douce">Aucun projet n'y est rattaché.</p>}
        </div>
      </div>
      {n.discussion && <p className="text-xs text-douce">
        Discussion d'équipe : gabarit <code>{n.discussion.gabarit}</code>, ouverte aux membres qui incarnent {n.discussion.competences.join(", ")}
        {n.discussion.versNature ? `. Les specs du fil partent vers un workflow ${libelleNature(donnees?.natures, n.discussion.versNature).toLowerCase()}.` : "."}
      </p>}
    </article>)}
  </section>;
}
