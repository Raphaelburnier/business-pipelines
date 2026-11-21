// Les branches métier du cockpit, telles que le registre les déclare : ce qui désigne chaque
// nature, les pipelines qui la portent et les projets d'où lancer une mission. C'est l'onglet
// « Branches » de Missions.
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { suivreLien } from "../coquille/Navigation";
import { useCharge } from "../donnees/contexte";
import { libelleNature } from "../donnees/natures";

const intertitre = "text-[12.5px] font-semibold text-douce";

export function Branches({ aller }: { aller: (href: string) => void }) {
  const { donnees, erreur, detail, recharger } = useCharge((s) => s.natures(), []);
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
      <div>
        <h2 className="text-lg font-semibold text-encre">
          Branches {donnees && <span className="text-[15px] font-normal tabular-nums text-douce">· {donnees.natures.length}</span>}
        </h2>
        <p className="text-sm text-douce">
          Chaque nature de mission vient de <code className="font-mono text-[13px]">natures/</code> dans le registre. Une branche ajoutée là apparaît ici et dans le choix de nature d'une mission.
        </p>
      </div>
      {erreur && !donnees && <EtatErreur titre="Lecture des branches impossible" message={erreur} detail={detail} onReessayer={recharger} />}
      {!donnees && !erreur && <Squelette lignes={5} libelle="Chargement des branches…" className="rounded-xl border border-trait bg-surface p-4" />}
      {donnees && !donnees.natures.length && <EtatVide message="Aucune nature déclarée" detail="Ajoute une nature dans natures/ du registre pour qu'elle apparaisse ici." />}
      {donnees?.natures.map((n) => (
        <article key={n.id} className="flex flex-col gap-2 rounded-xl border border-trait bg-surface p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-encre">{n.libelle}</h3>
            <span className="text-xs text-douce">
              {n.regles === "dediees" ? "règles dédiées" : "règles génériques"} · priorité {n.priorite}
            </span>
          </header>
          <p className="text-sm">{n.description}</p>
          <p className="text-xs text-douce">Désignée par {[...n.tags.map((t) => `le tag ${t}`), ...n.handlers.map((h) => `une étape ${h}`)].join(", ")}.</p>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <h4 className={intertitre}>Pipelines du registre</h4>
              {n.pipelines.length ? (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {n.pipelines.map((p) => (
                    <li key={p}>
                      <code className="rounded-md border border-trait px-1.5 py-0.5 font-mono text-xs">{p}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-douce">Aucun pipeline ne porte encore cette nature.</p>
              )}
            </div>
            <div>
              <h4 className={intertitre}>Projets</h4>
              {n.projets.length ? (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {n.projets.map((p) => {
                    const href = `/missions/${encodeURIComponent(p.id)}`;
                    return (
                      <li key={p.id}>
                        <a className="font-medium text-accent underline underline-offset-2 hover:no-underline" href={href} onClick={suivreLien(aller, href)}>
                          {p.nom}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-douce">Aucun projet n'y est rattaché.</p>
              )}
            </div>
          </div>
          {n.discussion && (
            <p className="text-xs text-douce">
              Discussion d'équipe : gabarit <code className="font-mono">{n.discussion.gabarit}</code>, ouverte aux membres qui incarnent {n.discussion.competences.join(", ")}
              {n.discussion.versNature ? `. Les specs du fil partent vers un workflow ${libelleNature(donnees?.natures, n.discussion.versNature).toLowerCase()}.` : "."}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
