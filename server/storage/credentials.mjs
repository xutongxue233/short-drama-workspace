import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** Keys stay outside SQLite. A missing key must never silently replace an existing one. */
export function createCredentialVault(filename) {
  let key;
  const sealed = new Map();
  const keyFile = `${filename}.key`;
  function loadKey(create) {
    if (key) return key;
    if (filename === ":memory:") return (key = randomBytes(32));
    try {
      key = readFileSync(keyFile);
    } catch (error) {
      if (error.code !== "ENOENT" || !create)
        throw new Error("无法读取模型凭据加密密钥，请恢复数据库对应的 .key 文件。", {
          cause: error,
        });
      const candidate = randomBytes(32);
      // The store ownership lock prevents concurrent writers; wx also prevents overwrite.
      writeFileSync(keyFile, candidate, { flag: "wx", mode: 0o600 });
      key = candidate;
    }
    if (key.length !== 32) throw new Error("模型凭据加密密钥文件无效，请从备份恢复。");
    return key;
  }
  const context = (id) => Buffer.from(`frameflow-provider-key-v1:${id}`);
  return {
    seal(state) {
      if (!Array.isArray(state.providers)) return state;
      return {
        ...state,
        providers: state.providers.map((provider) => {
          if (!provider.apiKey) return provider;
          if (typeof provider.apiKey !== "string")
            throw new Error("模型凭据格式无效。");
          const previous = sealed.get(provider.id);
          if (previous?.plain === provider.apiKey)
            return { ...provider, apiKey: previous.encrypted };
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", loadKey(true), iv);
          cipher.setAAD(context(provider.id));
          const data = Buffer.concat([
            cipher.update(provider.apiKey, "utf8"),
            cipher.final(),
          ]);
          const encrypted = {
            cipher: "aes-256-gcm-v1",
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            data: data.toString("base64"),
          };
          sealed.set(provider.id, { plain: provider.apiKey, encrypted });
          return { ...provider, apiKey: encrypted };
        }),
      };
    },
    open(state) {
      for (const provider of state.providers || []) {
        const encrypted = provider.apiKey;
        if (!encrypted || typeof encrypted === "string") continue;
        try {
          if (encrypted.cipher !== "aes-256-gcm-v1")
            throw new Error("Unknown credential format");
          const iv = Buffer.from(encrypted.iv, "base64");
          const tag = Buffer.from(encrypted.tag, "base64");
          if (iv.length !== 12 || tag.length !== 16)
            throw new Error("Invalid credential envelope");
          const decipher = createDecipheriv("aes-256-gcm", loadKey(false), iv);
          decipher.setAAD(context(provider.id));
          decipher.setAuthTag(tag);
          const plain = Buffer.concat([
            decipher.update(Buffer.from(encrypted.data, "base64")),
            decipher.final(),
          ]).toString("utf8");
          provider.apiKey = plain;
          sealed.set(provider.id, { plain, encrypted });
        } catch (cause) {
          throw new Error(
            "模型凭据无法解密，请恢复匹配的数据库和 .key 文件；不会覆盖现有凭据。",
            { cause },
          );
        }
      }
      return state;
    },
  };
}
