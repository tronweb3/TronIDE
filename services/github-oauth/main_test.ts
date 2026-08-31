import {
  type AuthStore,
  createMemoryAuthStore,
  createRateLimiter,
  createRequestHandler,
  createTokenCipher,
  type TokenCipher,
} from "./main.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

const ORIGIN = "https://tronide.io";
const CHANNEL = "channel_0123456789abcdef";
const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(43);
const SESSION = "h".repeat(43);

const allowRate = (_req: Request, _bucket: string, limit: number) => ({
  allowed: true,
  limit,
  remaining: limit - 1,
  resetAt: Date.now() + 60_000,
});

function testKey(): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
}

async function createTestDependencies(): Promise<{
  store: AuthStore;
  cipher: TokenCipher;
}> {
  return {
    store: createMemoryAuthStore(),
    cipher: await createTokenCipher(testKey()),
  };
}

async function beginOAuth(
  handler: ReturnType<typeof createRequestHandler>,
): Promise<{ response: Response; authorize: URL; state: string }> {
  const response = await handler(
    new Request(
      `https://proxy.example/oauth/start?origin=${
        encodeURIComponent(ORIGIN)
      }&channel=${CHANNEL}`,
    ),
  );
  const authorize = new URL(response.headers.get("location") || "");
  return {
    response,
    authorize,
    state: authorize.searchParams.get("state") || "",
  };
}

Deno.test("rate limiter rejects requests after the configured per-client allowance", async () => {
  let now = 1_000;
  const check = createRateLimiter({ now: () => now, kvFactory: () => null });
  const req = new Request("https://proxy.example/callback", {
    headers: { "x-forwarded-for": "203.0.113.4" },
  });
  assert(
    (await check(req, "test", 2, 60_000)).allowed,
    "first request should pass",
  );
  assert(
    (await check(req, "test", 2, 60_000)).allowed,
    "second request should pass",
  );
  const denied = await check(req, "test", 2, 60_000);
  assert(
    !denied.allowed && denied.remaining === 0,
    "third request should be denied",
  );
  now += 60_001;
  assert(
    (await check(req, "test", 2, 60_000)).allowed,
    "request should pass after reset",
  );
});

Deno.test("rate limiter falls back when KV initialization throws synchronously", async () => {
  const check = createRateLimiter({
    kvFactory: () => {
      throw new Error("KV is not attached");
    },
  });
  const req = new Request("https://proxy.example/callback", {
    headers: { "x-forwarded-for": "203.0.113.5" },
  });

  const first = await check(req, "test", 2, 60_000);
  const second = await check(req, "test", 2, 60_000);
  const denied = await check(req, "test", 2, 60_000);

  assert(
    first.allowed && second.allowed,
    "local fallback should preserve the configured allowance",
  );
  assert(
    !denied.allowed && denied.remaining === 0,
    "local fallback should still enforce the limit",
  );
});

Deno.test("capabilities advertises the tokenless BFF only to allowed browser origins", async () => {
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    rateCheck: allowRate,
  });
  const allowed = await handler(
    new Request("https://proxy.example/capabilities", {
      headers: { origin: ORIGIN },
    }),
  );
  assertEquals(allowed.status, 200, "allowed origin should read capabilities");
  assertEquals(
    allowed.headers.get("access-control-allow-origin"),
    ORIGIN,
    "capabilities response should be readable cross-origin",
  );
  const payload = await allowed.json();
  assertEquals(payload.authMode, "bff-v1", "BFF mode should be explicit");
  assertEquals(
    payload.githubTokenInBrowser,
    false,
    "capabilities must promise that GitHub tokens stay server-side",
  );

  const disallowed = await handler(
    new Request("https://proxy.example/capabilities", {
      headers: { origin: "https://evil.example" },
    }),
  );
  assertEquals(disallowed.status, 403, "disallowed origin should be rejected");
});

Deno.test("OAuth start owns state and PKCE and always selects an account", async () => {
  const { store, cipher } = await createTestDependencies();
  const values = [STATE, VERIFIER];
  const handler = createRequestHandler({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => values.shift() || SESSION,
  });

  const { response, authorize, state } = await beginOAuth(handler);
  assertEquals(response.status, 302, "OAuth start should redirect");
  assertEquals(
    authorize.origin,
    "https://github.com",
    "authorization must be pinned to GitHub",
  );
  assertEquals(
    authorize.pathname,
    "/login/oauth/authorize",
    "authorization path should be GitHub OAuth",
  );
  assertEquals(
    authorize.searchParams.get("client_id"),
    "client",
    "server should add the client id",
  );
  assertEquals(
    authorize.searchParams.get("state"),
    STATE,
    "server should generate OAuth state",
  );
  assertEquals(
    authorize.searchParams.get("code_challenge_method"),
    "S256",
    "PKCE should use S256",
  );
  assert(
    (authorize.searchParams.get("code_challenge") || "").length === 43,
    "PKCE challenge should be present",
  );
  assertEquals(
    authorize.searchParams.get("prompt"),
    "select_account",
    "account picker must always be requested",
  );
  assertEquals(state, STATE, "test should capture server state");
});

Deno.test("GitHub App OAuth omits legacy scopes and advertises installation requirements", async () => {
  const { store, cipher } = await createTestDependencies();
  const values = [STATE, VERIFIER];
  const handler = createRequestHandler({
    clientId: "github-app-client",
    clientSecret: "secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => values.shift() || SESSION,
  });

  const capabilities = await handler(
    new Request("https://proxy.example/capabilities", {
      headers: { origin: ORIGIN },
    }),
  );
  const payload = await capabilities.json();
  assertEquals(payload.authProvider, "github_app", "provider should be public");
  assertEquals(
    payload.repositoryInstallationRequired,
    true,
    "repository access should require an installation",
  );
  assertEquals(payload.githubAppSlug, "tronide", "app slug should be public");

  const { authorize } = await beginOAuth(handler);
  assertEquals(
    authorize.searchParams.has("scope"),
    false,
    "GitHub App user authorization must not request OAuth App scopes",
  );
  assertEquals(
    authorize.searchParams.get("prompt"),
    "select_account",
    "GitHub App authorization should still force account selection",
  );
});

Deno.test("provider switch selects the matching credential pair", async () => {
  const { store, cipher } = await createTestDependencies();
  const oauthValues = [STATE, VERIFIER];
  const oauthHandler = createRequestHandler({
    oauthClientId: "oauth-client",
    oauthClientSecret: "oauth-secret",
    githubAppClientId: "github-app-client",
    githubAppClientSecret: "github-app-secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "oauth_app",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => oauthValues.shift() || SESSION,
  });
  const { authorize: oauthAuthorize } = await beginOAuth(oauthHandler);
  assertEquals(
    oauthAuthorize.searchParams.get("client_id"),
    "oauth-client",
    "staged GitHub App secrets must not switch the OAuth App early",
  );

  const appValues = ["a".repeat(43), "b".repeat(43)];
  const appHandler = createRequestHandler({
    oauthClientId: "oauth-client",
    oauthClientSecret: "oauth-secret",
    githubAppClientId: "github-app-client",
    githubAppClientSecret: "github-app-secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => appValues.shift() || SESSION,
  });
  const { authorize: appAuthorize } = await beginOAuth(appHandler);
  assertEquals(
    appAuthorize.searchParams.get("client_id"),
    "github-app-client",
    "GitHub App mode must use the GitHub App credentials",
  );
});

Deno.test("GitHub App mode fails closed without a valid installation slug", async () => {
  const { store, cipher } = await createTestDependencies();
  const handler = createRequestHandler({
    clientId: "github-app-client",
    clientSecret: "github-app-secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "../wrong",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
  });
  const response = await handler(
    new Request(
      `https://proxy.example/oauth/start?origin=${
        encodeURIComponent(ORIGIN)
      }&channel=${CHANNEL}`,
    ),
  );
  assertEquals(
    response.status,
    503,
    "an unsafe or missing app slug must block authorization",
  );
});

Deno.test("OAuth callback keeps the GitHub token server-side and rejects state replay", async () => {
  const { store, cipher } = await createTestDependencies();
  const values = [STATE, VERIFIER, SESSION];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = createRequestHandler({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => values.shift() || "x".repeat(43),
    fetchFn: (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/login/oauth/access_token")) {
        return Promise.resolve(
          Response.json({ access_token: "github-secret-token" }),
        );
      }
      if (url.endsWith("/user")) {
        return Promise.resolve(Response.json({ login: "tron-user", id: 42 }));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  const { state } = await beginOAuth(handler);
  const callback = await handler(
    new Request(
      `https://proxy.example/callback?code=VALID_CODE_123&state=${state}`,
    ),
  );
  const body = await callback.text();
  assertEquals(callback.status, 200, "valid callback should succeed");
  assertEquals(
    calls.length,
    2,
    "callback should exchange the code and verify the user",
  );
  assert(
    !body.includes("github-secret-token"),
    "callback HTML must never contain the GitHub token",
  );
  assert(
    body.includes(`\"session\":\"${SESSION}\"`),
    "callback should return only the BFF session",
  );
  assert(
    body.includes('"login":"tron-user"'),
    "callback should return the verified login",
  );
  assert(
    body.includes(`postMessage(data, \"${ORIGIN}\")`),
    "result should target only the initiating origin",
  );

  const exchangeBody = JSON.parse(String(calls[0].init?.body || "{}"));
  assertEquals(
    exchangeBody.code_verifier,
    VERIFIER,
    "token exchange should use the stored PKCE verifier",
  );

  const replay = await handler(
    new Request(
      `https://proxy.example/callback?code=VALID_CODE_123&state=${state}`,
    ),
  );
  assertEquals(replay.status, 400, "replayed state must fail");
  assertEquals(
    calls.length,
    2,
    "replayed state must fail before GitHub is contacted",
  );
});

Deno.test("GitHub App callback validates token type and caps the BFF session at token expiry", async () => {
  const { store, cipher } = await createTestDependencies();
  const now = Date.now();
  const values = [STATE, VERIFIER, SESSION];
  const handler = createRequestHandler({
    clientId: "github-app-client",
    clientSecret: "secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    now: () => now,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    randomTokenFn: () => values.shift() || "x".repeat(43),
    fetchFn: (input) => {
      const url = String(input);
      if (url.endsWith("/login/oauth/access_token")) {
        return Promise.resolve(
          Response.json({ access_token: "ghu_server_only", expires_in: 3600 }),
        );
      }
      if (url.endsWith("/user")) {
        return Promise.resolve(Response.json({ login: "tron-user", id: 42 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });

  const { state } = await beginOAuth(handler);
  const callback = await handler(
    new Request(
      `https://proxy.example/callback?code=VALID_CODE_123&state=${state}`,
    ),
  );
  const body = await callback.text();
  assertEquals(callback.status, 200, "GitHub App callback should succeed");
  assert(
    !body.includes("ghu_server_only"),
    "GitHub App token must remain server-side",
  );
  assert(
    body.includes(`\"expiresAt\":${now + 3600 * 1000 - 60_000}`),
    "session should expire before the upstream GitHub App token",
  );

  const session = await store.getSession(SESSION);
  assertEquals(session?.provider, "github_app", "session should pin provider");
});

Deno.test("GitHub App callback rejects non-user access tokens", async () => {
  const { store, cipher } = await createTestDependencies();
  const values = [STATE, VERIFIER];
  let identityRequests = 0;
  const handler = createRequestHandler({
    clientId: "github-app-client",
    clientSecret: "secret",
    redirectUri: "https://proxy.example/callback",
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    randomTokenFn: () => values.shift() || SESSION,
    fetchFn: (input) => {
      const url = String(input);
      if (url.endsWith("/login/oauth/access_token")) {
        return Promise.resolve(
          Response.json({ access_token: "gho_wrong_type", expires_in: 3600 }),
        );
      }
      if (url.endsWith("/user")) identityRequests++;
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });

  const { state } = await beginOAuth(handler);
  const callback = await handler(
    new Request(
      `https://proxy.example/callback?code=VALID_CODE_123&state=${state}`,
    ),
  );
  assertEquals(callback.status, 502, "wrong token type should fail closed");
  assertEquals(identityRequests, 0, "wrong token must not reach identity API");
});

Deno.test("session is origin-bound and can be revoked", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("github-secret-token"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const upstreamCalls: string[] = [];
  const handler = createRequestHandler({
    clientId: "client",
    clientSecret: "secret",
    allowedOrigins: [ORIGIN, "https://other.example"],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (input) => {
      upstreamCalls.push(String(input));
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });

  const sessionRequest = (origin: string, method = "GET") =>
    new Request("https://proxy.example/session", {
      method,
      headers: { origin, "x-tronide-session": SESSION },
    });

  const valid = await handler(sessionRequest(ORIGIN));
  assertEquals(valid.status, 200, "issuing origin should validate the session");
  const validPayload = await valid.json();
  assertEquals(
    validPayload.login,
    "tron-user",
    "session should expose the verified login",
  );
  assertEquals(
    validPayload.authProvider,
    "oauth_app",
    "legacy sessions should hydrate with their compatible provider",
  );

  const wrongOrigin = await handler(sessionRequest("https://other.example"));
  assertEquals(
    wrongOrigin.status,
    401,
    "a different allow-listed origin must not reuse the session",
  );

  const deleted = await handler(sessionRequest(ORIGIN, "DELETE"));
  assertEquals(deleted.status, 204, "disconnect should revoke the session");
  assert(
    upstreamCalls.some((url) => url.includes("/applications/client/token")),
    "disconnect should best-effort revoke the GitHub OAuth token",
  );
  const afterDelete = await handler(sessionRequest(ORIGIN));
  assertEquals(afterDelete.status, 401, "revoked session must not be reusable");
});

Deno.test("disconnect revokes a legacy session with the legacy credential pair after cut-over", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    provider: "oauth_app",
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("legacy-token"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  let authorization = "";
  let revokeUrl = "";
  const handler = createRequestHandler({
    authProvider: "github_app",
    oauthClientId: "legacy-client",
    oauthClientSecret: "legacy-secret",
    githubAppClientId: "github-app-client",
    githubAppClientSecret: "github-app-secret",
    githubAppSlug: "tronide",
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (input, init) => {
      revokeUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") || "";
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  const response = await handler(
    new Request("https://proxy.example/session", {
      method: "DELETE",
      headers: { origin: ORIGIN, "x-tronide-session": SESSION },
    }),
  );
  assertEquals(
    response.status,
    204,
    "legacy session disconnect should succeed",
  );
  assert(
    revokeUrl.includes("/applications/legacy-client/token"),
    "legacy session must use the issuer client id",
  );
  assertEquals(
    atob(authorization.slice("Basic ".length)),
    "legacy-client:legacy-secret",
    "legacy session must use the issuer client secret",
  );
});

Deno.test("restricted REST BFF injects the server token and rejects browser credentials", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("github-secret-token"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  let upstreamAuthorization = "";
  let upstreamUrl = "";
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (input, init) => {
      upstreamUrl = String(input);
      upstreamAuthorization = new Headers(init?.headers).get("authorization") ||
        "";
      return Promise.resolve(Response.json({ login: "tron-user" }));
    },
  });
  const headers = { origin: ORIGIN, "x-tronide-session": SESSION };

  const allowed = await handler(
    new Request("https://proxy.example/api/user", { headers }),
  );
  assertEquals(allowed.status, 200, "allow-listed API operation should pass");
  assertEquals(
    upstreamUrl,
    "https://api.github.com/user",
    "API target should be pinned to GitHub",
  );
  assertEquals(
    upstreamAuthorization,
    "Bearer github-secret-token",
    "BFF should inject its decrypted token",
  );
  assertEquals(
    allowed.headers.get("cache-control"),
    "no-store",
    "authenticated GitHub API responses must never be cached",
  );

  const forbidden = await handler(
    new Request("https://proxy.example/api/orgs/tronweb3/members", { headers }),
  );
  assertEquals(
    forbidden.status,
    403,
    "arbitrary GitHub API paths must be rejected",
  );

  const rawCredential = await handler(
    new Request("https://proxy.example/api/user", {
      headers: { ...headers, authorization: "Bearer browser-token" },
    }),
  );
  assertEquals(
    rawCredential.status,
    400,
    "browser GitHub credentials must be rejected",
  );
});

Deno.test("GitHub App sessions expose only verified installation metadata", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    provider: "github_app",
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("ghu_server_only"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  let upstreamAuthorization = "";
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (_input, init) => {
      upstreamAuthorization = new Headers(init?.headers).get("authorization") ||
        "";
      return Promise.resolve(Response.json({
        total_count: 2,
        installations: [
          {
            id: 101,
            account: { login: "tron-user", avatar_url: "https://secret" },
            target_type: "User",
            repository_selection: "selected",
            permissions: { contents: "write" },
          },
          {
            id: 102,
            account: { login: "tronweb3" },
            target_type: "Organization",
            repository_selection: "all",
            suspended_at: "2026-08-13T00:00:00Z",
          },
        ],
      }));
    },
  });

  const response = await handler(
    new Request("https://proxy.example/installations", {
      headers: { origin: ORIGIN, "x-tronide-session": SESSION },
    }),
  );
  const payload = await response.json();
  assertEquals(response.status, 200, "installation discovery should succeed");
  assertEquals(
    upstreamAuthorization,
    "Bearer ghu_server_only",
    "installation discovery should use the server token",
  );
  assertEquals(payload.installed, true, "an active installation should count");
  assertEquals(
    payload.installations.length,
    2,
    "installations should be listed",
  );
  assertEquals(
    payload.installations[0].account,
    "tron-user",
    "only safe account metadata should be exposed",
  );
  assertEquals(
    payload.installations[0].permissions,
    undefined,
    "raw upstream permission payload must not be forwarded",
  );
  assertEquals(
    payload.installUrl,
    "https://github.com/apps/tronide/installations/new",
    "install URL should be pinned to the configured app slug",
  );
});

Deno.test("repository access checks the matching installation and selected repository", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    provider: "github_app",
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("ghu_server_only"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const upstreamUrls: string[] = [];
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authProvider: "github_app",
    githubAppSlug: "tronide",
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (input) => {
      const url = String(input);
      upstreamUrls.push(url);
      if (url.includes("/user/installations?")) {
        return Promise.resolve(Response.json({
          installations: [
            {
              id: 101,
              account: { login: "tronweb3" },
              repository_selection: "selected",
            },
            {
              id: 102,
              account: { login: "unrelated-owner" },
              repository_selection: "all",
            },
          ],
        }));
      }
      if (url.includes("/user/installations/101/repositories?")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          repositories: [{ full_name: "tronweb3/another-repository" }],
        }));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  const response = await handler(
    new Request(
      "https://proxy.example/repository-access?owner=tronweb3&repo=private",
      { headers: { origin: ORIGIN, "x-tronide-session": SESSION } },
    ),
  );
  const payload = await response.json();
  assertEquals(response.status, 200, "access diagnosis should succeed");
  assertEquals(payload.accessible, false, "repository should be inaccessible");
  assertEquals(
    payload.installed,
    true,
    "the target owner installation should be recognized",
  );
  assertEquals(
    upstreamUrls.length,
    2,
    "matching installation repositories should be checked",
  );

  const missing = await handler(
    new Request(
      "https://proxy.example/repository-access?owner=missing-org&repo=private",
      { headers: { origin: ORIGIN, "x-tronide-session": SESSION } },
    ),
  );
  const missingPayload = await missing.json();
  assertEquals(missing.status, 200, "missing installation should be diagnosed");
  assertEquals(
    missingPayload.installed,
    false,
    "an unrelated installation must not count for the target owner",
  );
  assertEquals(
    upstreamUrls.length,
    3,
    "missing target installation should not enumerate unrelated repositories",
  );

  const invalid = await handler(
    new Request(
      "https://proxy.example/repository-access?owner=tronweb3&repo=../secret",
      { headers: { origin: ORIGIN, "x-tronide-session": SESSION } },
    ),
  );
  assertEquals(
    invalid.status,
    400,
    "unsafe repository names must fail locally",
  );
  assertEquals(upstreamUrls.length, 3, "unsafe names must not reach GitHub");
});

Deno.test("git proxy allows anonymous public reads and injects session auth only server-side", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("github-secret-token"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const authorizations: string[] = [];
  let streamedUploadBytes = 0;
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: async (_input, init) => {
      authorizations.push(
        new Headers(init?.headers).get("authorization") || "",
      );
      if (init?.body instanceof ReadableStream) {
        const reader = init.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          streamedUploadBytes += value.byteLength;
        }
      }
      return new Response("git-data", { status: 200 });
    },
  });
  const url =
    "https://proxy.example/git/github.com/tronprotocol/tronbox/info/refs?service=git-upload-pack";

  const publicResponse = await handler(
    new Request(url, { headers: { origin: ORIGIN } }),
  );
  assertEquals(
    publicResponse.status,
    200,
    "anonymous public Git request should pass",
  );
  assertEquals(
    authorizations[0],
    "",
    "anonymous request must not get credentials",
  );

  const privateResponse = await handler(
    new Request(url, {
      headers: { origin: ORIGIN, "x-tronide-session": SESSION },
    }),
  );
  assertEquals(
    privateResponse.status,
    200,
    "session-authenticated Git request should pass",
  );
  assert(
    authorizations[1].startsWith("Basic ") &&
      !authorizations[1].includes("github-secret-token"),
    "GitHub Basic auth should be created only inside the BFF",
  );
  assertEquals(
    atob(authorizations[1].slice("Basic ".length)),
    "github-secret-token:x-oauth-basic",
    "OAuth App token must be the Git HTTPS username",
  );
  assertEquals(
    privateResponse.headers.get("cache-control"),
    "no-store",
    "authenticated Git responses must never be cached",
  );

  const rawCredential = await handler(
    new Request(url, {
      headers: { origin: ORIGIN, authorization: "Basic browser-token" },
    }),
  );
  assertEquals(
    rawCredential.status,
    400,
    "raw browser Git credentials must be rejected",
  );

  const oversized = await handler(
    new Request(
      url.replace("info/refs?service=git-upload-pack", "git-receive-pack"),
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-length": String(64 * 1024 * 1024 + 1),
        },
        body: "oversized",
      },
    ),
  );
  assertEquals(oversized.status, 413, "oversized Git uploads must be rejected");

  const uploadChunk = new Uint8Array(1024 * 1024);
  let emittedChunks = 0;
  const chunkedBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emittedChunks < 65) {
        emittedChunks += 1;
        controller.enqueue(uploadChunk);
        return;
      }
      controller.close();
    },
  });
  const chunkedOversized = await handler(
    new Request(
      url.replace("info/refs?service=git-upload-pack", "git-receive-pack"),
      {
        method: "POST",
        headers: { origin: ORIGIN },
        body: chunkedBody,
      },
    ),
  );
  assertEquals(
    chunkedOversized.status,
    413,
    "chunked Git uploads must be rejected by actual byte count",
  );
  assertEquals(
    streamedUploadBytes,
    64 * 1024 * 1024,
    "the byte-counting stream must stop before forwarding the overflow chunk",
  );
});

Deno.test("git proxy rate-limits uploads before consuming their bodies", async () => {
  let producedChunks = 0;
  let producedWhenRateChecked = -1;
  let fetches = 0;
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    rateCheck: (_req, _bucket, limit) => {
      producedWhenRateChecked = producedChunks;
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      };
    },
    fetchFn: () => {
      fetches += 1;
      return Promise.resolve(new Response("unexpected"));
    },
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (producedChunks < 3) {
        producedChunks += 1;
        controller.enqueue(new Uint8Array([producedChunks]));
        return;
      }
      controller.close();
    },
  }, { highWaterMark: 0 });

  const response = await handler(
    new Request(
      "https://proxy.example/git/github.com/tronprotocol/tronbox/git-receive-pack",
      {
        method: "POST",
        headers: { origin: ORIGIN },
        body,
      },
    ),
  );

  assertEquals(
    response.status,
    429,
    "rate-limited Git uploads must be rejected",
  );
  assertEquals(
    producedWhenRateChecked,
    0,
    "rate limiting must run before the request body is consumed",
  );
  assertEquals(fetches, 0, "rate-limited uploads must not reach GitHub");
});

Deno.test("git proxy uses GitHub App user tokens as the HTTPS password", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    provider: "github_app",
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("ghu_server_only"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  let authorization = "";
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return Promise.resolve(new Response("git-data", { status: 200 }));
    },
  });

  const response = await handler(
    new Request(
      "https://proxy.example/git/github.com/tronweb3/private/info/refs?service=git-upload-pack",
      { headers: { origin: ORIGIN, "x-tronide-session": SESSION } },
    ),
  );
  assertEquals(response.status, 200, "GitHub App Git request should pass");
  assertEquals(
    atob(authorization.slice("Basic ".length)),
    "x-access-token:ghu_server_only",
    "GitHub App token must occupy the Git HTTPS password slot",
  );
});

Deno.test("repository-specific GitHub App git denials preserve the user session", async () => {
  const { store, cipher } = await createTestDependencies();
  await store.saveSession(SESSION, {
    provider: "github_app",
    origin: ORIGIN,
    encryptedToken: await cipher.encrypt("ghu_server_only"),
    login: "tron-user",
    userId: 42,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: () => Promise.resolve(new Response("denied", { status: 401 })),
  });
  const response = await handler(
    new Request(
      "https://proxy.example/git/github.com/tronweb3/unselected/info/refs?service=git-upload-pack",
      { headers: { origin: ORIGIN, "x-tronide-session": SESSION } },
    ),
  );
  assertEquals(
    response.status,
    401,
    "upstream repository denial should pass through",
  );
  assert(
    await store.getSession(SESSION),
    "repository denial must not erase an otherwise valid GitHub App session",
  );
});

Deno.test("git proxy rejects disallowed origins and SSRF paths before upstream fetch", async () => {
  const { store, cipher } = await createTestDependencies();
  let fetches = 0;
  const handler = createRequestHandler({
    allowedOrigins: [ORIGIN],
    authStore: store,
    tokenCipher: cipher,
    rateCheck: allowRate,
    fetchFn: () => {
      fetches++;
      return Promise.resolve(new Response("unexpected"));
    },
  });

  const disallowed = await handler(
    new Request(
      "https://proxy.example/git/github.com/tronprotocol/tronbox/info/refs?service=git-upload-pack",
      { headers: { origin: "https://evil.example" } },
    ),
  );
  assertEquals(disallowed.status, 403, "disallowed origin should be rejected");

  const ssrf = await handler(
    new Request(
      "https://proxy.example/git/github.com@evil.example/tronprotocol/tronbox/info/refs?service=git-upload-pack",
      { headers: { origin: ORIGIN } },
    ),
  );
  assertEquals(ssrf.status, 400, "invalid Git target should be rejected");
  assertEquals(
    fetches,
    0,
    "rejected Git requests must not contact an upstream",
  );
});
