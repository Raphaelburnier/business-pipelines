import { useState, type ChangeEvent } from "react";
import { financeRequest, type Kind, type Preview } from "./api";

export function Imports({ onImported }: { onImported: () => void }) {
  const [kind, setKind] = useState<Kind>("mouvements");
  const [file, setFile] = useState<{ fileName: string; csv: string } | null>(
    null,
  );
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setPreview(null);
    setMapping({});
    setMessage("");
    setError("");
    setFile(null);
    if (!chosen) return;
    if (chosen.size > 1_000_000) {
      setError(
        "Fichier limité à 1 Mo. Découper le relevé en plusieurs imports.",
      );
      return;
    }
    setBusy(true);
    try {
      setFile({ fileName: chosen.name, csv: await chosen.text() });
    } catch {
      setError("Impossible de lire ce fichier.");
    } finally {
      setBusy(false);
    }
  }
  async function stage() {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setPreview(
        await financeRequest<Preview>("imports/preview", {
          kind,
          ...file,
          mapping,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.canConfirm) return;
    setBusy(true);
    setError("");
    try {
      const result = await financeRequest<{
        added: number;
        duplicates: number;
      }>("imports/confirm", { token: preview.token });
      setMessage(
        `${result.added} ligne(s) ajoutée(s), ${result.duplicates} doublon(s) ignoré(s).`,
      );
      setPreview(null);
      onImported();
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="fin-panel fin-import"
      aria-labelledby="fin-import-title"
    >
      <div className="fin-panel-head">
        <div>
          <span className="fin-eyebrow">01 / Entrées</span>
          <h3 id="fin-import-title">Importer un relevé</h3>
        </div>
        <span className="fin-tag">CSV · 1 Mo max.</span>
      </div>
      <p>
        Choisis un modèle, remplis-le puis vérifie l’aperçu. Rien n’est
        enregistré avant ta confirmation.
      </p>
      <div className="fin-templates">
        {(["mouvements", "soldes", "factures"] as Kind[]).map((k) => (
          <a key={k} href={`/api/finance/templates/${k}`} download>
            {k}.csv ↓
          </a>
        ))}
      </div>
      <div className="fin-form">
        <label>
          Type de données
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setPreview(null);
              setMessage("");
              setMapping({});
            }}
          >
            <option value="mouvements">Mouvements de compte</option>
            <option value="soldes">Soldes observés</option>
            <option value="factures">Factures</option>
          </select>
        </label>
        <label>
          Fichier CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={selectFile}
          />
        </label>
        <button
          type="button"
          className="fin-primary"
          disabled={!file || busy}
          onClick={stage}
        >
          {busy ? "Traitement…" : "Prévisualiser l’import"}
        </button>
      </div>
      <details>
        <summary>Format des colonnes et catégories</summary>
        <p>
          Dates au format YYYY-MM-DD. Montants en centimes entiers : 1200 CHF →
          120000 ; une dépense → -120000. Devises : CHF, EUR, USD. Soldes au
          début de la date, avant les mouvements du jour.
        </p>
        <p>
          Catégories : customer_payment, customer_refund, operating_expense,
          owner_funding, internal_transfer. Un virement utilise le même
          transfer_group_id dans les deux comptes. L’identifiant
          source_record_id doit rester stable lors d’un réimport.
        </p>
        <p>
          Une facture impayée ne crée pas d’encaissement. La taxe vide reste
          inconnue.
        </p>
      </details>
      {error && (
        <p role="alert" className="fin-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="fin-success">
          {message}
        </p>
      )}
      {preview && (
        <div className="fin-preview">
          <h4>Aperçu · {file?.fileName}</h4>
          <p>
            {preview.rowCount} ligne(s) lue(s) · {preview.newCount} nouvelle(s)
            · {preview.duplicateCount} doublon(s)
          </p>
          <details>
            <summary>Associer les colonnes du fichier</summary>
            <div className="fin-mapping">
              {preview.fields.map((field) => (
                <label key={field}>
                  {field}
                  <select
                    value={
                      mapping[field] ||
                      (preview.headers.includes(field) ? field : "")
                    }
                    disabled={busy}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, [field]: e.target.value }));
                      setPreview((p) => (p ? { ...p, canConfirm: false } : p));
                    }}
                  >
                    <option value="">Sélectionner une colonne</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p>
              Après une modification, clique sur « Prévisualiser l’import » pour
              recalculer les contrôles.
            </p>
          </details>
          {preview.issues.length > 0 && (
            <div className="fin-error" role="alert">
              <b>{preview.issues.length} erreur(s) à corriger</b>
              <ul>
                {preview.issues.slice(0, 30).map((issue, i) => (
                  <li key={i}>
                    Ligne {issue.line} : {issue.message}
                  </li>
                ))}
              </ul>
              {preview.issues.length > 30 && (
                <p>Seules les 30 premières erreurs sont affichées.</p>
              )}
            </div>
          )}
          {preview.sample.length > 0 && (
            <div className="fin-scroll">
              <table>
                <caption>Les dix premières lignes à ajouter</caption>
                <thead>
                  <tr>
                    <th>Ligne CSV</th>
                    {preview.fields.map((f) => (
                      <th key={f}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      {preview.fields.map((f) => (
                        <td key={f}>{String(row.data[f])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="fin-actions">
            <button
              type="button"
              className="fin-primary"
              disabled={busy || !preview.canConfirm}
              onClick={confirm}
            >
              Confirmer l’import
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Fermer l’aperçu
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
