# tronide — project security rules

Project-specific guidance for the security-guidance plugin's LLM diff review.
These rules are tailored to a browser-based blockchain IDE (React + tronweb/web3/ethers),
its local-filesystem bridge (`remixd`), URL-based contract resolvers, and the iframe
plugin system. Flag any diff that violates them.

## Wallet secrets — keys, mnemonics, passphrases

- NEVER log private keys, mnemonics, seed phrases, or wallet passwords (no `console.log`,
  no analytics/telemetry, no error reports). This includes logging whole objects/state
  slices that may transitively contain them.
- NEVER persist raw secret material to `localStorage`, `sessionStorage`, `IndexedDB`,
  cookies, or `.remix.config` in plaintext. Encrypted keystores only; the decrypted
  key/mnemonic must stay in memory and be zeroed/dropped after use.
- NEVER transmit secret material off-device — not to RPC endpoints, not in URLs/query
  strings, not to any backend. Signing happens locally via tronweb/web3/ethers; only
  signed transactions or signatures leave the client.
- Treat any new function parameter or variable named like `privateKey`, `pk`, `mnemonic`,
  `seed`, `secret`, `passphrase`, `keystore` as sensitive and trace where it flows.

## Hardcoded secrets & endpoints

- No hardcoded API keys, RPC tokens (TronGrid / Infura / Alchemy / fullnode keys),
  or credentials in source. Pull from env/config; never commit real values.
- No private keys or mnemonics in fixtures, tests, comments, or example snippets unless
  they are well-known throwaway test vectors clearly labeled as such.

## SSRF & URL resolvers (`remix-url-resolver`, contract imports, RPC config)

- User-controlled URLs (imports like `http(s)://`, `ipfs://`, `github:`, `swarm:`, or a
  user-entered RPC/fullnode endpoint) must go through the existing resolver/allowlist —
  do not add raw `fetch`/`axios`/`XMLHttpRequest` against a user-supplied URL.
- Reject/disallow `file://`, `localhost`, `127.0.0.1`, link-local `169.254.0.0/16`, and
  cloud-metadata `169.254.169.254` targets for any user-driven fetch.
- Validate scheme against an explicit allowlist; never infer trust from the host suffix.

## remixd — local filesystem bridge

- `remixd` exposes a shared folder to the browser over a websocket. Any file path coming
  from the client MUST be resolved and confined to the shared root — block `..`, absolute
  paths, and symlink escapes (`path.resolve` + prefix check on the realpath).
- Enforce the websocket origin allowlist; do not widen CORS / accept `*` origins.
- Do not add endpoints that read/write/delete paths outside the shared folder.

## Plugin system & iframes (postMessage)

- Every `window.addEventListener('message', ...)` handler MUST verify `event.origin`
  against the expected plugin origin before acting on the payload. No origin check = flag.
- Never `eval`, `new Function`, or otherwise execute a plugin/postMessage payload as code.
- Keep plugin iframes sandboxed; do not add `allow-same-origin allow-scripts` together
  for untrusted plugin sources, and don't drop `sandbox` to make a plugin "work".

## XSS (React / remix-ui)

- Avoid `dangerouslySetInnerHTML`, raw `innerHTML`/`outerHTML`, and
  `insertAdjacentHTML` with any value derived from contract output, compiler/debugger
  results, file contents, URLs, or other user/chain-controlled data. Render as text or
  sanitize (e.g. DOMPurify) first.
- Don't build DOM-injected markup via string concatenation of untrusted values.

## Code execution

- Compiling and running user Solidity/Vyper via the solc worker and the simulator is the
  product's purpose — that is expected and not a finding.
- BUT do not `eval` / `new Function` / `vm`-run untrusted *JavaScript/JSON* (config,
  plugin data, network responses). Parse JSON with `JSON.parse`, never `eval`.

## General

- Parameterize any DB/query access; no string-concatenated queries with caller input.
- Use `subprocess`/`child_process` with an argv array, never a shell string built from
  user input (relevant in `remixd`, scripts, and tooling).
- Don't weaken existing crypto: no `Math.random()` for key/nonce/salt generation — use
  `crypto.getRandomValues` / Node `crypto`.
