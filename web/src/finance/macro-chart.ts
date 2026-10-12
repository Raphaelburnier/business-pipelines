export function macroChart(
  points: { year: number; value: number | null }[],
  period: { from: number; to: number },
) {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const low = Math.min(0, ...values);
  const high =
    Math.max(0, ...values) === low ? low + 1 : Math.max(0, ...values);
  const span = high - low;
  const y = (v: number) => 290 - ((v - low) / span) * 230;
  const plotted = points.map((p) => ({
    ...p,
    x:
      90 +
      ((p.year - period.from) / Math.max(1, period.to - period.from)) * 830,
    y: p.value === null ? null : y(p.value),
  }));
  let penDown = false,
    previousYear: number | null = null;
  const path = plotted
    .map((p) => {
      if (p.y === null) {
        penDown = false;
        previousYear = p.year;
        return "";
      }
      const command = penDown && previousYear === p.year - 1 ? "L" : "M";
      penDown = true;
      previousYear = p.year;
      return `${command}${p.x},${p.y}`;
    })
    .join(" ");
  return {
    plotted,
    path,
    zero: y(0),
    ticks: [low, low + span / 2, high].map((value) => ({ value, y: y(value) })),
  };
}
