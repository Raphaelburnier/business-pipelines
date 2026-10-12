import { describe, it, expect } from "vitest";
import { macroChart } from "./macro-chart";
describe("graphiques macro", () => {
  it("interrompt la courbe sur les années absentes sans ramener à zéro", () => {
    const graph = macroChart(
      [
        { year: 2021, value: 3 },
        { year: 2022, value: null },
        { year: 2023, value: 1 },
      ],
      { from: 2021, to: 2023 },
    );
    expect(graph.path.match(/M/g)).toHaveLength(2);
    expect(graph.path).not.toContain("L");
    expect(graph.plotted[1]!.y).toBeNull();
  });
  it("respecte l'espacement temporel et place les valeurs négatives sous zéro", () => {
    const graph = macroChart(
      [
        { year: 2020, value: -4 },
        { year: 2021, value: 8 },
        { year: 2023, value: 2 },
      ],
      { from: 2020, to: 2023 },
    );
    expect(graph.plotted[0]!.y!).toBeGreaterThan(graph.zero);
    expect(graph.plotted[1]!.y!).toBeLessThan(graph.zero);
    expect(graph.plotted[2]!.x - graph.plotted[1]!.x).toBeCloseTo(
      2 * (graph.plotted[1]!.x - graph.plotted[0]!.x),
    );
    expect(graph.path.match(/M/g)).toHaveLength(2);
  });
});
