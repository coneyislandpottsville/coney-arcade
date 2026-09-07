export type Limiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export interface Env {
  DB: D1Database;
  SUBMIT_LIMITER: Limiter;
  VALIDATE_LIMITER: Limiter;
  TURNSTILE_SECRET?: string;
}
