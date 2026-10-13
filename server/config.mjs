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
  const host = env.WORKBENCH_HOST?.trim() || "127.0.0.1";
  const localHosts = ["127.0.0.1", "localhost", "::1"];
  const originInput = env.WORKBENCH_ORIGIN?.trim();
  let publicOrigin;
  if (originInput) {
    const url = new URL(originInput);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "WORKBENCH_ORIGIN must be an HTTPS origin without a path or credentials.",
      );
    publicOrigin = url.origin;
  }
  if (!localHosts.includes(host) && !publicOrigin)
    throw new Error(
      "WORKBENCH_HOST outside loopback requires WORKBENCH_ORIGIN with HTTPS.",
    );
  const setupToken = env.WORKBENCH_SETUP_TOKEN?.trim();
  if (setupToken && setupToken.length < 32)
    throw new Error("WORKBENCH_SETUP_TOKEN must contain at least 32 characters.");
  const trustProxyInput = env.WORKBENCH_TRUST_PROXY?.trim() || "false";
  if (!["true", "false"].includes(trustProxyInput))
    throw new Error("WORKBENCH_TRUST_PROXY must be true or false.");
  const trustProxy = trustProxyInput === "true";
  if (trustProxy && !publicOrigin)
    throw new Error("WORKBENCH_TRUST_PROXY requires WORKBENCH_ORIGIN.");
  return Object.freeze({
    host,
    publicOrigin,
    setupToken,
    trustProxy,
    apiPort: integerSetting(env, "API_PORT", 3001, { min: 1, max: 65535 }),
    dataDir,
    databaseFile: resolve(dataDir, "workbench.sqlite"),
    distDir: resolve(PROJECT_ROOT, "dist"),
  });
}
