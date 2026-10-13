import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function integerSetting(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim()))
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

/** Resolve once at composition time. Relative paths are anchored to the checkout. */
export function readConfig(env = process.env) {
  const dataDir = resolve(PROJECT_ROOT, env.WORKBENCH_DATA_DIR?.trim() || "data");
  return Object.freeze({
    host: "127.0.0.1",
    apiPort: integerSetting(env, "API_PORT", 3001, { min: 1, max: 65535 }),
    dataDir,
    databaseFile: resolve(dataDir, "workbench.sqlite"),
    distDir: resolve(PROJECT_ROOT, "dist"),
  });
}
