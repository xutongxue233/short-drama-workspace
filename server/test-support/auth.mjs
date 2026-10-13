import assert from "node:assert/strict";

/** Existing integration fixtures authenticate through the real bootstrap endpoint. */
export async function authenticatedFetch(base, fetchImpl = globalThis.fetch) {
  const origin = new URL(base).origin;
  const response = await fetchImpl(`${origin}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "fixture-admin",
      displayName: "测试负责人",
      password: "Fixture-password-12345",
    }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const authHeaders = { Cookie: cookie, "X-CSRF-Token": session.csrfToken };
  const fetch = (url, options = {}) => {
    assert.equal(
      new URL(url).origin,
      origin,
      "Test credentials cannot leave the fixture server",
    );
    return fetchImpl(url, {
      ...options,
      headers: { ...authHeaders, ...options.headers },
    });
  };
  return { fetch, headers: authHeaders, user: session.user };
}
