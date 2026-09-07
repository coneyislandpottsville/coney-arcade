import type { Entry, FieldValues } from "./types.ts";

export type EntryRow = {
  id: number;
  initials: string;
  client: string;
  fields: string;
  created_at: string;
};

export type StoredSubmission = EntryRow & { rank_key: string };

export function toEntry(row: EntryRow, rank: number): Entry {
  const fields = JSON.parse(row.fields) as FieldValues;
  return { rank, initials: row.initials, client: row.client, submittedAt: row.created_at, ...fields };
}

export function boardStatement(db: D1Database, gameId: string, limit: number): D1PreparedStatement {
  return db
    .prepare(
      "SELECT id, initials, client, fields, created_at FROM entries WHERE game = ?1 ORDER BY rank_key ASC, id ASC LIMIT ?2",
    )
    .bind(gameId, limit);
}

export async function board(db: D1Database, gameId: string, limit: number): Promise<Entry[]> {
  const { results } = await boardStatement(db, gameId, limit).all<EntryRow>();
  return results.map((row, index) => toEntry(row, index + 1));
}

export async function rankOf(db: D1Database, gameId: string, rankKey: string, id: number): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM entries WHERE game = ?1 AND (rank_key < ?2 OR (rank_key = ?2 AND id < ?3))",
    )
    .bind(gameId, rankKey, id)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export async function findSubmission(
  db: D1Database,
  gameId: string,
  submissionId: string,
): Promise<StoredSubmission | null> {
  return db
    .prepare(
      "SELECT id, initials, client, fields, rank_key, created_at FROM entries WHERE game = ?1 AND submission_id = ?2",
    )
    .bind(gameId, submissionId)
    .first<StoredSubmission>();
}

export async function insertEntry(
  db: D1Database,
  entry: { gameId: string; submissionId: string; client: string; initials: string; canonical: string; rankKey: string },
): Promise<{ id: number; created_at: string } | null> {
  return db
    .prepare(
      "INSERT INTO entries (game, submission_id, client, initials, fields, rank_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
        "ON CONFLICT (game, submission_id) DO NOTHING RETURNING id, created_at",
    )
    .bind(entry.gameId, entry.submissionId, entry.client, entry.initials, entry.canonical, entry.rankKey)
    .first<{ id: number; created_at: string }>();
}
