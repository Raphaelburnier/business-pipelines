import { describe, expect, it } from "vitest";
import { priceChart } from "./price-chart";
const points = [
  {
    id: "A:2026-10-09",
    date: "2026-10-09",
    close: 110.1,
    adjustedClose: 100,
    volume: 10,
  },
  {
    id: "A:2026-10-12",
    date: "2026-10-12",
    close: 111.1,
    adjustedClose: null,
    volume: 12,
  },
  {
    id: "A:2026-10-13",
    date: "2026-10-13",
    close: 112.1,
    adjustedClose: 101,
    volume: 13,
  },
];
describe("cours datés", () => {
  it("espace les séances selon leurs dates, sans inventer de prix le week-end", () => {
    const chart = priceChart(points, false)!;
    expect(chart.plotted).toHaveLength(3);
    expect(chart.plotted[1]!.x - chart.plotted[0]!.x).toBeCloseTo(
      3 * (chart.plotted[2]!.x - chart.plotted[1]!.x),
    );
    expect(chart.plotted[0]!.value).toBe(110.1);
  });
  it("interrompt la courbe ajustée absente, distingue brut et ajusté, pas de zéro", () => {
    const chart = priceChart(points, true)!;
    expect(chart.path.match(/M/g)).toHaveLength(2);
    expect(chart.path).not.toContain("L");
    expect(chart.plotted[1]!.y).toBeNull();
    expect(chart.plotted[0]!.value).toBe(100);
    expect(priceChart([], false)).toBeNull();
    expect(
      priceChart([{ ...points[0]!, adjustedClose: null }], true),
    ).toBeNull();
  });
});
