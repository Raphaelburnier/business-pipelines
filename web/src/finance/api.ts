export type Kind = "mouvements" | "soldes" | "factures";
export type RecordData = Record<string, string | number>;
export interface Row {
  data: RecordData;
  line: number;
  importId: string;
}
export interface ImportMeta {
  id: string;
  kind: Kind;
  fileName: string;
  importedAt: string;
  added: number;
  sha256?: string;
  synthetic?: boolean;
}
export interface Bucket {
  currency: string;
  opening: number | null;
  closing: number | null;
  receipts: number;
  refunds: number;
  netReceipts: number;
  expenses: number;
  operatingCashSurplus: number;
  ownerFunding: number;
  transfers: number;
  unpaid: number | null;
  movementCount: number;
  points: { date: string; amount: number; moment: string }[];
  accountBalances: {
    accountId: string;
    opening: number | null;
    closing: number | null;
    baseline: { date: string; importId: string; line: number } | null;
  }[];
}
export interface Summary {
  revision: number;
  from: string | null;
  to: string | null;
  accounts: string[];
  businesses: string[];
  buckets: Bucket[];
  warnings: string[];
  movements: Row[];
  invoices: Row[];
  imports: ImportMeta[];
  empty: boolean;
  synthetic?: boolean;
  scope: string;
  accountScopes: {
    accountId: string;
    ownership: string;
    businessId: string;
    updatedAt: string;
  }[];
}
export interface Preview {
  token: string;
  headers: string[];
  fields: string[];
  issues: { line: number; field?: string; message: string }[];
  newCount: number;
  duplicateCount: number;
  rowCount: number;
  canConfirm: boolean;
  sample: { data: RecordData; line: number }[];
}
export interface MacroSnapshot {
  provider: {
    name: string;
    url: string;
    license: string;
    termsUrl: string;
    frequency: string;
  };
  countries: { id: string; name: string }[];
  indicators: {
    id: string;
    name: string;
    unit: string;
    definition: string;
    attribution: string;
    url: string;
  }[];
  period: { from: number; to: number };
  series: {
    id: string;
    countryId: string;
    indicatorId: string;
    points: { year: number; value: number | null }[];
    latest: { year: number; value: number } | null;
    lastYearMissing: boolean;
    lagging: boolean;
  }[];
  collectedAt: string | null;
  sourceUpdatedAt: string | null;
  lastAttempt: {
    at: string;
    ok: boolean;
    message: string;
    durationMs: number;
    added?: number;
    revised?: number;
    unchanged?: number;
    observationCount?: number;
    availableCount?: number;
  } | null;
  revision: number;
  cacheAgeDays: number | null;
  cacheStale: boolean;
  refreshSkipped?: boolean;
  nextRefreshAt: string | null;
  empty: boolean;
  synthetic?: boolean;
}
export async function financeRequest<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/finance/${path}`, {
    signal,
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.erreur || `Finance indisponible (${response.status}).`,
    );
  return data as T;
}
export const money = (minor: number | null | undefined, currency: string) =>
  minor == null
    ? "Inconnu"
    : new Intl.NumberFormat("fr-CH", { style: "currency", currency }).format(
        minor / 100,
      );
export const categories: Record<string, string> = {
  customer_payment: "Encaissement client",
  customer_refund: "Remboursement",
  operating_expense: "Dépense d’exploitation",
  owner_funding: "Apport / retrait",
  internal_transfer: "Virement interne",
};
