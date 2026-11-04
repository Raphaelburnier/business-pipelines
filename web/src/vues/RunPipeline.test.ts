import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceMaquette } from "../mock/source";

globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) } as never;

vi.mock("../donnees/contexte", () => ({
  useSource: () => ({ source: { deciderRun: vi.fn(), renommerPipeline: vi.fn(), rattacherPipeline: vi.fn() } }),
  useCharge: vi.fn(),
}));
import { useCharge } from "../donnees/contexte";
import { RunPipeline } from "./RunPipeline";

const FIXE = Date.parse("2026-10-20T12:00:00.000Z");
let table: Record<string, unknown> = {};

beforeAll(async () => {
  const source = sourceMaquette({ t0: FIXE, maintenant: () => FIXE + 30_000 });
  const runs = await source.runs({ limite: 30 });
  table = {
    runs,
    run: await source.run(runs[0]!.id),
    equipe: await source.equipe(),
    pipelines: await source.pipelines(),
  };
});

beforeEach(() => {
  vi.mocked(useCharge).mockImplementation((selecteur) => {
    const cle = selecteur({ runs: () => "runs", equipe: () => "equipe", pipelines: () => "pipelines", run: () => "run" } as never) as unknown as string;
    return { donnees: table[cle] ?? null, erreur: null } as never;
  });
});

describe("RunPipeline", () => {
  it("rend la liste, le graphe et l'inspecteur", () => {
    const runs = table.runs as Awaited<ReturnType<ReturnType<typeof sourceMaquette>["runs"]>>;
    const html = renderToStaticMarkup(createElement(RunPipeline, { runId: runs[0]!.id, aller: vi.fn() }));
    expect(html).toContain('aria-label="Runs"');
    expect(html).toContain(`href="/run/${encodeURIComponent(runs[0]!.id)}"`);
    expect(html).not.toContain('href="/pipelines/');
    expect(html).toContain('class="pl-graphe');
    expect(html).toContain('aria-label="Graphe du pipeline"');
    expect(html).toContain('aria-label="Inspecteur"');
  });

  it("affiche les états vide et erreur sans lever", () => {
    table = { ...table, runs: [] };
    expect(renderToStaticMarkup(createElement(RunPipeline, { runId: null, aller: vi.fn() }))).toContain("Aucun run enregistré");
    table = { ...table, runs: null };
    vi.mocked(useCharge).mockImplementation((selecteur) => {
      const cle = selecteur({ runs: () => "runs", equipe: () => "equipe", pipelines: () => "pipelines", run: () => "run" } as never) as unknown as string;
      return { donnees: table[cle] ?? null, erreur: cle === "runs" ? "boum" : null } as never;
    });
    expect(renderToStaticMarkup(createElement(RunPipeline, { runId: null, aller: vi.fn() }))).toContain("boum");
  });
});
