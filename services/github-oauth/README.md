# tronide-gh-oauth — GitHub App BFF for TronIDE

TronIDE is a static application, so its GitHub credential boundary lives in this
Deno backend-for-frontend (BFF). Deno owns OAuth state and PKCE, exchanges the
code, verifies the GitHub identity, encrypts the access token in KV, and returns
only a short-lived TronIDE session handle to the browser.

The browser uses that opaque session for restricted GitHub REST and Git
smart-HTTP endpoints. A GitHub token is never sent through `postMessage`, web
storage, frontend state, or browser request headers.

The frontend BFF base URL is public build configuration:
`TRONIDE_GITHUB_BFF_ORIGIN`. It may include a reverse-proxy path prefix. Set it
to the team-owned deployment during cut-over; no source edit is required when
the BFF host or path changes.

Operational guides:

- [`GITHUB_APP_SETUP.md`](./GITHUB_APP_SETUP.md): create the organization-owned
  GitHub App.
- [`DENO_PROJECT_SETUP.md`](./DENO_PROJECT_SETUP.md): create and deploy the
  organization-owned Deno App and KV.
- [`BFF_MIGRATION.md`](./BFF_MIGRATION.md): architecture, rollout, rollback,
  and acceptance criteria.

The service supports a staged migration: `GITHUB_AUTH_PROVIDER=oauth_app`
preserves the current OAuth App deployment, while `github_app` enables the
organization-owned GitHub App flow. Existing OAuth sessions remain usable only
when the provider switch reuses the same Deno KV and keeps the legacy OAuth App
credentials during the grace period; moving to a new Deno project requires
users to reconnect.

## 1. Organization-owned GitHub App

The GitHub App and the Deno project are separate resources. Create both under
organization control and verify their owners, credentials, and deployment
access; transferring the source repository alone changes neither resource.

Create the app under `tronweb3` with:

| Field                              | Value                                  |
| ---------------------------------- | -------------------------------------- |
| GitHub App name                    | `TronIDE`                              |
| Homepage URL                       | `https://tronide.io`                   |
| User authorization callback URL    | `<REDIRECT_URI>` ending in `/callback` |
| Request OAuth during installation  | off                                    |
| User-to-server token expiration    | on                                     |
| Where can this GitHub App be used? | Any account                            |
| Repository permission: Contents    | Read and write                         |
| Account permission: Gists          | Read and write                         |
| Organization permissions / webhook | none / off for P0                      |

Repository access additionally requires each user or organization to install
the app and select repositories. Gist access is a user permission and does not
depend on a repository installation.

## 2. Deno deployment

Use the current Deno Deploy platform at `console.deno.com`. Attach a Deno KV
database, then deploy `main.ts`:

```sh
cd services/github-oauth
deno deploy --org=<team-org> --app=tronide-gh-oauth --prod
```

A linked repository may deploy the same entry point automatically. The main
TronIDE frontend pipeline does not deploy this service.

## 3. Environment variables

| Variable                   | Required | Description                                            |
| -------------------------- | -------- | ------------------------------------------------------ |
| `GITHUB_AUTH_PROVIDER`     | yes      | `github_app` after cut-over; defaults to `oauth_app`   |
| `GITHUB_APP_CLIENT_ID`     | yes      | Organization GitHub App client id                      |
| `GITHUB_APP_CLIENT_SECRET` | yes      | GitHub App client secret; Deno only                    |
| `GITHUB_APP_SLUG`          | yes      | Public app slug used for the installation URL          |
| `SESSION_ENCRYPTION_KEY`   | yes      | Exactly 32 random bytes, base64 encoded                |
| `REDIRECT_URI`             | yes      | Public Deno/team BFF `/callback` URL                   |
| `ALLOWED_ORIGINS`          | yes      | Comma-separated exact TronIDE origins                  |
| `SESSION_TTL_SECONDS`      | no       | BFF session lifetime; defaults to 8 hours              |
| `OAUTH_RATE_LIMIT`         | no       | OAuth starts/callbacks per client/minute; default `10` |
| `API_RATE_LIMIT`           | no       | Authenticated REST calls/client/minute; default `120`  |
| `GIT_PUBLIC_RATE_LIMIT`    | no       | Anonymous Git calls/client/minute; default `30`        |
| `GIT_AUTH_RATE_LIMIT`      | no       | Authenticated Git calls/client/minute; default `120`   |

The three `GITHUB_APP_*` variables are required when
`GITHUB_AUTH_PROVIDER=github_app`. Keep `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` during a same-KV grace period so legacy sessions can be
revoked correctly. `GITHUB_SCOPE` is used only by the temporary OAuth App
rollback deployment. The active provider selects its own credential pair, so
staging GitHub App secrets cannot switch an OAuth App deployment early.

Generate the encryption key without printing or committing it to source:

```sh
openssl rand -base64 32
```

Store it only in Deno's secret/environment settings. Sessions fail closed when
KV or the encryption key is unavailable; only rate limiting has an in-memory
fallback.

## 4. Endpoints

| Endpoint                 | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `GET /health`            | Reports `mode=bff-v1`                                               |
| `GET /capabilities`      | Machine-readable BFF capability probe                               |
| `GET /oauth/start`       | Creates state + PKCE and redirects to GitHub with account selection |
| `GET /callback`          | Consumes state, verifies GitHub, creates encrypted server session   |
| `GET /session`           | Validates and hydrates the current session                          |
| `DELETE /session`        | Revokes the local session and best-effort GitHub token              |
| `GET /installations`     | Lists safe metadata for the user's verified App installations       |
| `GET /repository-access` | Diagnoses access to one exact owner/repository                      |
| `/api/*`                 | Allow-listed `/user`, repository contents, and gist operations      |
| `/git/*`                 | GitHub-only smart-HTTP proxy for isomorphic-git                     |

Authenticated browser calls send `X-TronIDE-Session`; `Authorization` from the
browser is rejected. Sessions are bound to the exact `Origin` that initiated
OAuth.

## 5. Local verification

```sh
cd services/github-oauth
deno task test
deno check main.ts
```

For a full local flow, create a separate development GitHub App and set its
callback to the local BFF. Never reuse production client secrets in committed
files or test fixtures.
