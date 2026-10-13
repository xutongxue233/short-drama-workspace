import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "../http/errors.mjs";

const derive = promisify(scrypt);
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// Unknown accounts perform the same expensive operation as existing accounts.
export const DUMMY_HASH = `scrypt-v1$${"00".repeat(16)}$${"00".repeat(64)}`;

export function passwordInput(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256)
    throw new HttpError(400, "密码长度须为 12–256 个字符。");
  return value;
}

export async function hashPassword(value) {
  const password = passwordInput(value);
  const salt = randomBytes(16).toString("hex");
  const derived = await derive(password, salt, 64, OPTIONS);
  return `scrypt-v1$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(value, encoded) {
  if (typeof value !== "string" || value.length > 256) return false;
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded || "");
  if (!match) return false;
  const result = await derive(value, match[1], 64, OPTIONS);
  return timingSafeEqual(result, Buffer.from(match[2], "hex"));
}
