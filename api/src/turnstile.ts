export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const PROOF_ACTION = "sign";
export const MAX_TOKEN_LENGTH = 2048;

export type Proof =
  | { ok: true; hostname: string; action: string | null; cdata: string | null }
  | { ok: false; codes: string[] }
  | { ok: null };

const IP_PATTERN = /^[0-9a-f.:]+$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function verifyProof(fetchImpl: typeof fetch, secret: string, token: string, ip: string): Promise<Proof> {
  const body: Record<string, string> = { secret, response: token };
  if (IP_PATTERN.test(ip)) body.remoteip = ip;
  let data: unknown;
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: null };
    data = await response.json();
  } catch {
    return { ok: null };
  }
  if (!isRecord(data)) return { ok: null };
  if (data.success !== true) {
    const codes = data["error-codes"];
    return { ok: false, codes: Array.isArray(codes) ? codes.map(String) : [] };
  }
  return {
    ok: true,
    hostname: typeof data.hostname === "string" ? data.hostname : "",
    action: typeof data.action === "string" ? data.action : null,
    cdata: typeof data.cdata === "string" ? data.cdata : null,
  };
}
