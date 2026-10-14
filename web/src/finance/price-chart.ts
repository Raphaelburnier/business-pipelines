import type { PricePoint } from "./api";
export function priceChart(points: PricePoint[], adjusted: boolean) {
  const values = points.flatMap((p) => {
    const v = adjusted ? p.adjustedClose : p.close;
    return v === null ? [] : [v];
  });
  if (!values.length) return null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.1, max * 0.002, 0.01);
  const low = Math.max(0, min - padding),
    high = max + padding;
  const from = Date.parse(points[0]!.date),
    to = Date.parse(points.at(-1)!.date);
  let penDown = false;
  const plotted = points.map((p) => {
    const v = adjusted ? p.adjustedClose : p.close;
    return {
      ...p,
      value: v,
      x: 110 + ((Date.parse(p.date) - from) / Math.max(1, to - from)) * 810,
      y: v === null ? null : 290 - ((v - low) / (high - low)) * 230,
    };
  });
  const path = plotted
    .map((p) => {
      if (p.y === null) {
        penDown = false;
        return "";
      }
      const command = penDown ? "L" : "M";
      penDown = true;
      return `${command}${p.x},${p.y}`;
    })
    .join(" ");
  return {
    plotted,
    path,
    ticks: [low, (low + high) / 2, high].map((value) => ({
      value,
      y: 290 - ((value - low) / (high - low)) * 230,
    })),
  };
}
