# Organization GitHub App migration (`release/v2.3.3`)

## Target architecture

TronIDE remains a static browser application. The Deno backend-for-frontend
(BFF) owns GitHub state, PKCE, the confidential code exchange, encrypted GitHub
credentials, and the allow-listed REST/Git proxies. The browser receives only
an origin-bound opaque TronIDE session.

The organization GitHub App authenticates **on behalf of the current user** by
using a GitHub App user access token (`ghu_`). P0 does not use a private key,
JWT, installation access token, or bot identity:

- user attribution remains intact for Git and REST writes;
- Gists use the GitHub App account permission `Gists: read and write`;
- repository REST and Git smart-HTTP use `Contents: read and write`;
- repository access is limited by both the user's own permission and the
  repositories selected in the GitHub App installation.

## BFF contract

- `/oauth/start` owns state, PKCE, and `prompt=select_account`.
- GitHub App authorization deliberately omits the OAuth App `scope` parameter.
- `/callback` accepts only expiring `ghu_` user tokens and caps the TronIDE
  session before the upstream eight-hour token expiry.
- P0 discards the returned refresh token. This matches the existing eight-hour
  TronIDE session and avoids adding long-lived credentials before safe refresh
  rotation is implemented.
- `/installations` returns only safe installation metadata for the authorized
  user; it never trusts an installation id supplied by the browser.
- `/repository-access` diagnoses one strictly validated `owner/repo`. This
  matches the installation account and checks its selected repositories,
  distinguishing a missing App installation from unavailable repository access
  without treating an unrelated account installation as sufficient.
- GitHub App user tokens authenticate Git HTTP as
  `x-access-token:<server-held-token>`. Legacy OAuth App sessions retain their
  prior authentication format during a rolling cut-over.
- Disconnect revokes the server session and best-effort revokes the GitHub user
  access token through the application client credentials.

## Deployment prerequisites owned by `tronweb3`

1. Create a public GitHub App under the organization:
   - name: `TronIDE`;
   - homepage: `https://tronide.io`;
   - callback: the team BFF `/callback` URL;
   - request OAuth during installation: off;
   - expiring user-to-server tokens: on;
   - Contents: read and write;
   - Gists: read and write;
   - no organization permissions and no webhook for P0;
   - usable by any account.
2. Create the organization Deno application/KV and preferably bind a stable
   product domain such as `https://github-auth.tronide.io`.
3. Configure the variables documented in `README.md`, including:
   - `GITHUB_AUTH_PROVIDER=github_app`;
   - `GITHUB_APP_CLIENT_ID`;
   - `GITHUB_APP_CLIENT_SECRET`;
   - `GITHUB_APP_SLUG`;
   - `SESSION_ENCRYPTION_KEY`;
   - `REDIRECT_URI`;
   - `ALLOWED_ORIGINS`.
4. Deploy `services/github-oauth/main.ts` from the canonical TronIDE source.
   A separate deployment mirror may be used, but it must not become a divergent
   source of truth.
5. During a same-KV rolling switch, retain the legacy `GITHUB_CLIENT_ID` and
   `GITHUB_CLIENT_SECRET` until old sessions expire so disconnect can revoke
   them with the credential pair that issued them.

## Cut-over order

The frontend pipelines do **not** deploy `services/github-oauth`; Deno must be
deployed separately. Do not point production at the GitHub App BFF until the
service, organization-owned credentials, and secrets are ready.

1. Deploy the new BFF with `GITHUB_AUTH_PROVIDER=github_app` and verify:
   - `/health` reports `provider=github_app`;
   - `/capabilities` reports `authProvider=github_app`;
   - `/oauth/start` includes state, PKCE, and account selection but no scope.
2. Install the App on test user/organization accounts and select test repos.
3. Build the test TronIDE with `TRONIDE_GITHUB_BFF_ORIGIN` pointing to the new
   organization BFF.
4. Validate account selection, Gists, public Git reads, selected private repos,
   unselected private repos, repository access updates, disconnect, revocation,
   and expiry.
5. Promote BFF first and frontend second. Do not change the current personal
   OAuth App or BFF until the organization pair is validated.
6. After the observation window, revoke the old OAuth App client secret and
   retire the personal BFF. Existing users must reconnect; GitHub cannot migrate
   OAuth App grants to a GitHub App automatically.

## Rollback

- Repoint the frontend build variable to the current OAuth BFF.
- The code's default `GITHUB_AUTH_PROVIDER=oauth_app` preserves the old behavior
  until the organization cut-over is explicitly enabled.
- Never fall back to returning a GitHub token to the browser.
- Old and new KV sessions do not need migration; reconnecting is expected at
  the final provider switch.

## Acceptance criteria

- The GitHub authorization/installation pages identify `TronIDE` owned by
  `tronweb3`; no Redchar1992 app-owner branding remains.
- Every new authorization forces account selection.
- No `ghu_`, `ghr_`, `gho_`, PAT, or client secret appears in callback HTML,
  `postMessage`, browser storage, frontend state, logs, or browser headers.
- Gist create/read/update works with the App's user Gists permission.
- Selected private repositories support import, clone, pull, push, and contents
  writes; unselected repositories fail with an actionable install/manage hint.
- Public anonymous Git reads continue to work without a TronIDE session.
- State replay, cross-origin session reuse, path traversal, arbitrary upstream
  hosts, raw browser authorization, revoked tokens, and expired sessions fail.
- Deno checks/tests, focused frontend tests, core P0/P1 regression, and the
  production build pass before deployment.
