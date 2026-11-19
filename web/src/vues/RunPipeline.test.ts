import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceMaquette } from "../mock/source";

globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { pathname: "/run", search: "" },
  history: { state: null, replaceState() {} },
} as never;

const FIXE = Date.parse("2026-10-20T12:00:00.000Z");

vi.mock("../donnees/contexte", () => ({
  useSource: () => ({ source: { deciderRun: vi.fn(), renommerPipeline: vi.fn(), rattacherPipeline: vi.fn() } }),
  useCharge: vi.fn(),
  useHorloge: () => Date.parse("2026-10-20T12:00:30.000Z"),
}));
import { useCharge } from "../donnees/contexte";
import { FournisseurToasts } from "../composants/Toasts";
import { RunPipeline } from "./RunPipeline";

// La page d'un run lit `s.run(id).then(…)` : la fausse source rend une clé qui se résout en clé.
const FAUSSE_SOURCE = { runs: () => "runs", equipe: () => "equipe", pipelines: () => "pipelines", run: () => ({ then: () => "run" }) } as never;
const rendre = (runId: string | null) => renderToStaticMarkup(createElement(FournisseurToasts, null, createElement(RunPipeline, { runId, aller: vi.fn() })));
let table: Record<string, unknown> = {};

beforeAll(async () => {
  const source = sourceMaquette({ t0: FIXE, maintenant: () => FIXE + 30_000 });
  const runs = await source.runs({ limite: 30 });
  table = {
    runs,
    run: { run: await source.run(runs[0]!.id) },
    equipe: await source.equipe(),
    pipelines: await source.pipelines(),
  };
});

beforeEach(() => {
  vi.mocked(useCharge).mockImplementation((selecteur) => {
    const cle = selecteur(FAUSSE_SOURCE) as unknown as string;
    return { donnees: table[cle] ?? null, erreur: null } as never;
  });
});

describe("RunPipeline", () => {
  it("rend la liste à /run, le graphe et le panneau de détail à /run/:id", () => {
    const runs = table.runs as Awaited<ReturnType<ReturnType<typeof sourceMaquette>["runs"]>>;
    const liste = rendre(null);
    expect(liste).toContain('aria-label="Runs"');
    expect(liste).toContain(`href="/run/${encodeURIComponent(runs[0]!.id)}"`);
    expect(liste).not.toContain('href="/pipelines/');
    const html = rendre(runs[0]!.id);
    expect(html).toContain('class="pl-graphe');
    expect(html).toContain('aria-label="Graphe du pipeline"');
    expect(html).toContain('aria-label="Détail du run"');
  });

  it("affiche les états vide et erreur sans lever", () => {
    table = { ...table, runs: [] };
    expect(rendre(null)).toContain("Aucun run enregistré");
    table = { ...table, runs: null };
    vi.mocked(useCharge).mockImplementation((selecteur) => {
      const cle = selecteur(FAUSSE_SOURCE) as unknown as string;
      return { donnees: table[cle] ?? null, erreur: cle === "runs" ? "boum" : null } as never;
    });
    expect(rendre(null)).toContain("boum");
  });
});
