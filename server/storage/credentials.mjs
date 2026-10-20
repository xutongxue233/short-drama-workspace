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
  const collections = [
    ["providers", "apiKey", "frameflow-provider-key-v1"],
    ["computers", "token", "frameflow-computer-token-v1"],
  ];
  return {
    seal(state) {
      const result = { ...state };
      for (const [collection, field, namespace] of collections) {
        if (!Array.isArray(state[collection])) continue;
        result[collection] = state[collection].map((entity) => {
          const plain = entity[field];
          if (!plain) return entity;
          if (typeof plain !== "string") throw new Error("凭据格式无效。");
          const identity = `${namespace}:${entity.id}`;
          const previous = sealed.get(identity);
          if (previous?.plain === plain)
            return { ...entity, [field]: previous.encrypted };
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", loadKey(true), iv);
          cipher.setAAD(Buffer.from(identity));
          const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
          const encrypted = {
            cipher: "aes-256-gcm-v1",
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            data: data.toString("base64"),
          };
          sealed.set(identity, { plain, encrypted });
          return { ...entity, [field]: encrypted };
        });
      }
      return result;
    },
    open(state) {
      for (const [collection, field, namespace] of collections)
        for (const entity of state[collection] || []) {
          const encrypted = entity[field];
          if (!encrypted || typeof encrypted === "string") continue;
          const identity = `${namespace}:${entity.id}`;
          try {
            if (encrypted.cipher !== "aes-256-gcm-v1")
              throw new Error("Unknown credential format");
            const iv = Buffer.from(encrypted.iv, "base64");
            const tag = Buffer.from(encrypted.tag, "base64");
            if (iv.length !== 12 || tag.length !== 16)
              throw new Error("Invalid credential envelope");
            const decipher = createDecipheriv("aes-256-gcm", loadKey(false), iv);
            decipher.setAAD(Buffer.from(identity));
            decipher.setAuthTag(tag);
            const plain = Buffer.concat([
              decipher.update(Buffer.from(encrypted.data, "base64")),
              decipher.final(),
            ]).toString("utf8");
            entity[field] = plain;
            sealed.set(identity, { plain, encrypted });
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
