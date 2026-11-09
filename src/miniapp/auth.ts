import { createHmac, timingSafeEqual } from "node:crypto";

export const INIT_DATA_MAX_AGE = 24 * 60 * 60;
const CLOCK_SKEW = 60;

export type InitDataCheck = { ok: true; userId: number } | { ok: false };

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// The secret is HMAC-SHA256 of the bot token keyed with "WebAppData"; the signed string is every
// field except `hash`, sorted by key, as `key=value` lines. The check is the same for every API
// request, even though the network is closed: only the owner may pass.
export function checkInitData(
  initData: string,
  botToken: string,
  ownerId: number,
  now = new Date(),
  maxAge = INIT_DATA_MAX_AGE,
): InitDataCheck {
  const fail = { ok: false } as const;
  if (!initData || !botToken || !Number.isSafeInteger(ownerId) || ownerId <= 0) return fail;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return fail;
  params.delete("hash");
  const text = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(text).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return fail;

  const issued = Number(params.get("auth_date"));
  const age = Math.floor(now.getTime() / 1000) - issued;
  if (!Number.isSafeInteger(issued) || age > maxAge || age < -CLOCK_SKEW) return fail;

  let userId: unknown;
  try {
    userId = JSON.parse(params.get("user") ?? "").id;
  } catch {
    return fail;
  }
  return userId === ownerId ? { ok: true, userId: ownerId } : fail;
}
