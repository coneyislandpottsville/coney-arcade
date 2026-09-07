const BLOCKLIST = new Set([
  "ASS", "FUK", "FUC", "FCK", "FUQ", "SEX", "CUM", "DIK", "DIC", "DIX", "COK",
  "TIT", "FAG", "KKK", "NIG", "NGR", "NGA", "WTF", "XXX", "SUX", "PIS", "POO",
]);

export function cleanInitials(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
}

export function isBlocked(initials: string): boolean {
  return BLOCKLIST.has(initials);
}

export function sanitizeInitials(raw: unknown, fallback: string): string {
  const s = cleanInitials(raw);
  return s === "" || isBlocked(s) ? fallback : s;
}
