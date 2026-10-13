import test from "node:test";
import assert from "node:assert/strict";
import { providerInput } from "./providers/config.mjs";
import { mediaUrl } from "./providers/media.mjs";

const provider = {
  id: "synthetic-provider",
  name: "本地回归测试",
  kind: "text",
  protocol: "openai",
  baseUrl: "https://provider.example/v1",
  model: "test-model",
  enabled: true,
  apiKey: "synthetic:audit/key+123",
};

test("changing a credential destination requires an explicit key decision", async (t) => {
  for (const patch of [
    { baseUrl: "https://other.example/v1" },
    { baseUrl: "https://provider.example/other-account" },
    { baseUrl: "http://provider.example/v1" },
    { protocol: "anthropic" },
  ])
    await t.test(JSON.stringify(patch), () => {
      const original = structuredClone(provider);
      for (const keyInput of [{}, { apiKey: "" }, { apiKey: "   " }])
        assert.throws(
          () => providerInput({ ...patch, ...keyInput }, provider),
          /重新填写 API Key/,
        );
      assert.deepEqual(provider, original);
      const replacement = providerInput(
        { ...patch, apiKey: "new-synthetic-key" },
        provider,
      );
      assert.equal(replacement.apiKey, "new-synthetic-key");
      const cleared = providerInput({ ...patch, clearApiKey: true }, provider);
      assert.equal(cleared.apiKey, "");
      assert.deepEqual(provider, original);
    });
});

test("ordinary provider edits and equivalent base URLs preserve the current key", () => {
  for (const patch of [
    { name: "改名", model: "new-model" },
    { baseUrl: "https://provider.example/v1/", apiKey: "" },
    { baseUrl: "https://PROVIDER.example:443/v1" },
  ])
    assert.equal(providerInput(patch, provider).apiKey, provider.apiKey);
  assert.equal(
    providerInput({ baseUrl: "https://other.example/v1" }, { ...provider, apiKey: "" })
      .apiKey,
    "",
  );
});

test("media URLs cannot persist plain, encoded, or nested encoded provider keys", async (t) => {
  const encoded = encodeURIComponent(provider.apiKey);
  const allEncoded = [...provider.apiKey]
    .map((character) => `%${character.charCodeAt(0).toString(16)}`)
    .join("");
  const urls = [
    `https://files.example/${provider.apiKey}`,
    `https://files.example/${encoded}.png`,
    `https://files.example/image.png?access_token=${encoded}`,
    `https://files.example/image.png#${allEncoded}`,
    `https://files.example/image.png?redirect=${encodeURIComponent(`https://cdn.example/${encoded}`)}`,
    `https://files.example/image.png?invalid=%ZZ&token=${encoded}`,
    `https://files.example/invalid%ZZ/${allEncoded}.png`,
    `https://files.example/%ff${allEncoded}.png`,
  ];
  for (const url of urls)
    await t.test(url, () => {
      assert.throws(
        () => mediaUrl(url, provider),
        (error) => error.status === 502 && /当前 API Key/.test(error.message),
      );
    });
});

test("media URL checks preserve independent signed URLs and handle form encoding", () => {
  const safe = "https://files.example/image.png?signature=independent-token%2B123";
  assert.equal(mediaUrl(safe, provider), safe);
  assert.equal(mediaUrl(safe, { apiKey: "" }), safe);
  const spacedKey = "synthetic key+123";
  const query = new URLSearchParams({ token: spacedKey });
  assert.throws(
    () => mediaUrl(`https://files.example/image.png?${query}`, { apiKey: spacedKey }),
    /当前 API Key/,
  );
});
