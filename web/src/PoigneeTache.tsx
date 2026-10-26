export function PoigneeTache({ titre }: { titre: string }) {
  return <span className="task-poignee" role="img" aria-label={`Glisser « ${titre} » vers le calendrier`} title="Glisser cette tâche sur un jour du calendrier">
    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">{[4, 9, 14].flatMap(y => [3, 8].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}</svg>
    <span>Glisser</span>
  </span>;
}
