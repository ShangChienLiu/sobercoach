// Minimal APNs HTTP/2 client with ES256 provider-token auth (WebCrypto).
// Keys live only in Edge Function secrets.

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string; // .p8 contents
  bundleId: string;
  sandbox: boolean;
  fetchImpl?: typeof fetch;
}

export interface ApnsPayload {
  title: string;
  body: string;
  threadId: string;
  category: string; // e.g. "SOBERCOACH_REMINDER" with a "Stop these" action
  data: Record<string, string>;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  apnsId: string | null;
  reason: string | null;
}

let cachedJwt: { token: string; issuedAt: number; keyId: string } | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Converts a DER ECDSA signature to the raw r||s form if needed. */
function derToRaw(sig: Uint8Array): Uint8Array {
  if (sig.length === 64) return sig;
  // DER: 0x30 len 0x02 rlen r 0x02 slen s
  let offset = 2;
  const rLen = sig[offset + 1];
  let r = sig.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  const sLen = sig[offset + 1];
  let s = sig.slice(offset + 2, offset + 2 + sLen);
  r = r.length > 32 ? r.slice(r.length - 32) : r;
  s = s.length > 32 ? s.slice(s.length - 32) : s;
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

export async function providerToken(cfg: ApnsConfig, now = Date.now()): Promise<string> {
  // APNs accepts a token for up to 60 min; refresh after 45.
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && now - cachedJwt.issuedAt < 45 * 60 * 1000) {
    return cachedJwt.token;
  }
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(cfg.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${b64url(derToRaw(new Uint8Array(sig)))}`;
  cachedJwt = { token, issuedAt: now, keyId: cfg.keyId };
  return token;
}

export async function sendPush(cfg: ApnsConfig, deviceToken: string, payload: ApnsPayload): Promise<ApnsResult> {
  const host = cfg.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const token = await providerToken(cfg);
  const body = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "thread-id": payload.threadId,
      category: payload.category,
      "mutable-content": 1,
    },
    ...payload.data,
  };
  const res = await (cfg.fetchImpl ?? fetch)(`${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      "authorization": `bearer ${token}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let reason: string | null = null;
  if (!res.ok) {
    try {
      const j = await res.json() as { reason?: string };
      reason = j.reason ?? `HTTP ${res.status}`;
    } catch {
      reason = `HTTP ${res.status}`;
    }
  }
  return { ok: res.ok, status: res.status, apnsId: res.headers.get("apns-id"), reason };
}

export function apnsConfigFromEnv(env: (k: string) => string | undefined): ApnsConfig | null {
  const teamId = env("APNS_TEAM_ID");
  const keyId = env("APNS_KEY_ID");
  const privateKeyPem = env("APNS_PRIVATE_KEY");
  const bundleId = env("APNS_BUNDLE_ID");
  if (!teamId || !keyId || !privateKeyPem || !bundleId) return null;
  return { teamId, keyId, privateKeyPem: privateKeyPem.replace(/\\n/g, "\n"), bundleId, sandbox: env("APNS_SANDBOX") !== "false" };
}
