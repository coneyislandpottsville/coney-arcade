export type FieldType = "integer" | "decimal";

export type Bound = number | { field: string; factor: number };

export interface FieldRule {
  type: FieldType;
  required: boolean;
  min?: number;
  max?: Bound;
  step?: number;
  precision: number;
  onInvalid: "unknown" | "reject";
}

export interface RankingComponent {
  field: string;
  order: "asc" | "desc";
  unknown: "first" | "last";
}

export interface Column {
  field: string;
  label: string;
  format: "integer" | "decimal" | "duration";
}

export interface Game {
  id: string;
  name: string;
  listed: boolean;
  board: number;
  clients: string[];
  origins: string[];
  initials: { default: string };
  fields: Record<string, FieldRule>;
  ranking: RankingComponent[];
  columns: Column[];
}

export type FieldValues = Record<string, number | null>;

export interface Entry {
  rank: number;
  initials: string;
  client: string;
  submittedAt: string;
  [field: string]: number | string | null;
}
