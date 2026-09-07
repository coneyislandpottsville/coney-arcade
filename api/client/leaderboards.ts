export const DEFAULT_BASE_URL = "https://leaderboards.coneyislandpottsville.com";

export type Column = { field: string; label: string; format: "integer" | "decimal" | "duration" };
export type Entry = { rank: number; initials: string; client: string; submittedAt: string } & Record<
  string,
  number | string | null
>;
export type BoardHeader = { id: string; name: string; columns: Column[] };
export type Board = { game: BoardHeader; entries: Entry[] };
export type Boards = { games: Array<BoardHeader & { entries: Entry[] }> };
export type Run = { initials: string } & Record<string, number | string | null | undefined>;

export type SubmitResult =
  | { status: "accepted"; duplicate: boolean; rank: number; entry: Entry; board: Entry[] }
  | { status: "pending"; attempts: number }
  | { status: "rejected"; problems: string[] }
  | { status: "conflict" };

export type Validation = { ok: true; normalized: Record<string, unknown> } | { ok: false; problems: string[] };

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type Options = {
  game: string;
  client: string;
  baseUrl?: string;
  storage?: StorageLike | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  uuid?: () => string;
};

export type Leaderboards = {
  board(limit?: number): Promise<Board | null>;
  submit(run: Run): Promise<SubmitResult>;
  flush(): Promise<SubmitResult[]>;
  pending(): number;
  validate(run: Run): Promise<Validation | null>;
};

type Pending = { submissionId: string; run: Run; attempts: number; nextAt: number };

const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000];
const OUTBOX_LIMIT = 20;

export function createLeaderboards(options: Options): Leaderboards {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? (() => Date.now());
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const outboxKey = `coney-leaderboards:${options.game}:${options.client}:outbox`;

  const load = (): Pending[] => {
    try {
      const raw = storage?.getItem(outboxKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isPending) : [];
    } catch {
      return [];
    }
  };

  const save = (items: Pending[]): void => {
    try {
      if (items.length === 0) storage?.removeItem(outboxKey);
      else storage?.setItem(outboxKey, JSON.stringify(items));
    } catch {
      // storage is a convenience; a failed write only loses the retry
    }
  };

  const remove = (submissionId: string): void => {
    save(load().filter((item) => item.submissionId !== submissionId));
  };

  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number | null; data: unknown }> => {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return { status: response.status, data };
    } catch {
      return { status: null, data: null };
    }
  };

  const attempt = async (item: Pending): Promise<SubmitResult> => {
    const { status, data } = await request(`/v1/games/${options.game}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...item.run, submissionId: item.submissionId, client: options.client }),
    });
    const record = isRecord(data) ? data : {};
    if (status === 200 && isRecord(record.entry) && Array.isArray(record.board)) {
      remove(item.submissionId);
      const entry = record.entry as Entry;
      return { status: "accepted", duplicate: record.duplicate === true, rank: Number(entry.rank), entry, board: record.board as Entry[] };
    }
    if (status === 400) {
      remove(item.submissionId);
      return { status: "rejected", problems: Array.isArray(record.problems) ? record.problems.map(String) : [] };
    }
    if (status === 409) {
      remove(item.submissionId);
      return { status: "conflict" };
    }
    const attempts = item.attempts + 1;
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]!;
    save(load().map((p) => (p.submissionId === item.submissionId ? { ...p, attempts, nextAt: now() + delay } : p)));
    return { status: "pending", attempts };
  };

  return {
    async board(limit) {
      const query = limit === undefined ? "" : `?limit=${Math.max(1, Math.floor(limit))}`;
      const { status, data } = await request(`/v1/games/${options.game}/board${query}`);
      return status === 200 && isRecord(data) && Array.isArray(data.entries) ? (data as Board) : null;
    },

    async submit(run) {
      const item: Pending = { submissionId: uuid(), run, attempts: 0, nextAt: now() };
      const outbox = [...load(), item].slice(-OUTBOX_LIMIT);
      save(outbox);
      return attempt(item);
    },

    async flush() {
      const due = load().filter((item) => item.nextAt <= now());
      const results: SubmitResult[] = [];
      for (const item of due) results.push(await attempt(item));
      return results;
    },

    pending() {
      return load().length;
    },

    async validate(run) {
      const { status, data } = await request(`/v1/games/${options.game}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...run, submissionId: uuid(), client: options.client }),
      });
      if ((status !== 200 && status !== 400) || !isRecord(data)) return null;
      return data.ok === true
        ? { ok: true, normalized: isRecord(data.normalized) ? data.normalized : {} }
        : { ok: false, problems: Array.isArray(data.problems) ? data.problems.map(String) : [] };
    },
  };
}

export async function fetchBoards(
  limit = 5,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 5000,
): Promise<Boards | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/board?limit=${limit}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isRecord(data) && Array.isArray(data.games) ? (data as Boards) : null;
  } catch {
    return null;
  }
}

export function formatValue(value: number | string | null | undefined, format: Column["format"]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (format === "duration") {
    const seconds = Math.max(0, Math.floor(value));
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  }
  if (format === "decimal") return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return value.toLocaleString();
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPending(value: unknown): value is Pending {
  return (
    isRecord(value) &&
    typeof value.submissionId === "string" &&
    isRecord(value.run) &&
    typeof value.attempts === "number" &&
    typeof value.nextAt === "number"
  );
}
