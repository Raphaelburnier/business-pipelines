import "./prioritaire.css";

export function InterrupteurPrioritaire({ checked, name, disabled, onChange, libelleAccessible }: {
  checked?: boolean;
  name?: string;
  disabled?: boolean;
  onChange?: (prioritaire: boolean) => void;
  libelleAccessible?: string;
}) {
  return <label className="run-prioritaire">
    <input type="checkbox" role="switch" name={name} checked={checked} disabled={disabled}
      aria-label={libelleAccessible} onChange={onChange ? (event) => onChange(event.target.checked) : undefined} />
    Run prioritaire
  </label>;
}
