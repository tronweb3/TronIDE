# Security Policy

Thanks for helping keep TronIDE and its users safe. This document describes how to report vulnerabilities and which versions are eligible for fixes.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.1.x   | ✅ Active support |
| < 2.1   | ❌ End of life |

The latest minor release on the `main` branch is always the supported version. Older releases may receive security fixes on a best-effort basis when the fix is low-risk to backport.

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for security reports.** Public disclosure before a fix is available puts users at risk.

Report vulnerabilities privately via **GitHub Security Advisory**:

1. Go to <https://github.com/tronweb3/TronIDE/security/advisories/new>
2. Fill in the advisory form with:
   - Affected version(s) / commit
   - Steps to reproduce (minimal proof-of-concept is ideal)
   - Impact assessment (what an attacker can achieve)
   - Any suggested mitigation
3. Submit the advisory. The maintainers will be notified automatically.

If you cannot use GitHub Security Advisory (e.g., you do not have a GitHub account), open a minimal public issue requesting a private channel — do not include vulnerability details in the public issue.

## Response Expectations

- **Acknowledgement**: within 3 business days of your report.
- **Triage & severity assessment**: within 7 business days.
- **Fix timeline**: depends on severity.
  - Critical / High: target patch within 14 days, coordinated disclosure.
  - Medium / Low: target fix in the next minor release.
- **Public disclosure**: after a fix is released, the advisory is published with credit to the reporter (unless the reporter requests anonymity).

## Scope

In scope:

- The TronIDE application and its official workspaces/libraries in this repository.
- Build and release artifacts published from this repository.

Out of scope:

- Issues in upstream [Remix Project](https://github.com/ethereum/remix-project) that also affect TronIDE — please report those to the upstream project; we will track and backport fixes as appropriate.
- Third-party dependencies — please report to the upstream maintainer first; we welcome notifications so we can update our lockfile.
- Vulnerabilities in user-managed API keys (AI assistant, Gist tokens). See the "AI Assistant & API Keys" section below for how TronIDE handles these locally.

## AI Assistant & API Keys

The integrated AI Assistant ("TRON IDE AI") lets you bring your own API key for supported providers (OpenAI, Anthropic, Google, xAI, Qwen, and similar OpenAI-compatible endpoints). The following is how the current implementation handles your key, so you can make an informed decision about which key to use.

### Storage

- The key lives **only in React component state** while the AI panel is mounted.
- It is **not** written to `localStorage`, `sessionStorage`, cookies, IndexedDB, or any other persistent store.
- It is **not** sent to any TronIDE / TRON-operated backend. There is no proxy in the middle.
- On panel unmount (e.g., closing the AI sidebar or navigating away), the key in state is zeroed out. A full page reload also clears it.

### Transport

- Requests go **directly from your browser to the provider's HTTPS endpoint** (for example, `https://api.openai.com`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com`, `https://api.x.ai`, `https://dashscope-intl.aliyuncs.com`).
- The provider SDKs are initialized with `dangerouslyAllowBrowser: true`, which is required for client-side use but means any code running in the page (including third-party scripts, if present) can read the key at runtime. Only install TronIDE from sources you trust, and prefer an isolated browser profile if you need stronger boundaries.

### Recommendations for users

- **Scope the key narrowly.** Create a dedicated key for TronIDE, limit it to the models you plan to use, and set a low spend cap or rate limit at the provider.
- **Rotate if exposed.** If a key is accidentally pasted into an Issue, screenshot, or share link, revoke it at the provider immediately.
- **Clear on shared machines.** Close the AI panel or reload the page when you step away. Because the key is memory-only, that's enough — there is nothing persisted to wipe.
- **Do not paste keys into bug reports or Discussions.** If a bug requires reproducing with a key, describe the symptoms instead and we will work with you privately if needed.

### Recommendations for fork maintainers

If you ship a hosted deployment of TronIDE:

- Consider fronting LLM calls with a backend proxy so users never enter their raw key in the browser. The current design was chosen for zero-infra setup and privacy (keys never leave the user's device), which is appropriate for self-hosted / local use.
- If you add persistence (e.g., remembering keys across sessions), disclose it clearly and pick a storage location with equivalent or better protection than in-memory state.
- Keep `dangerouslyAllowBrowser: true` in mind: your site's CSP and third-party script policy directly affect the exposure window.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption.
- Report the vulnerability privately via the process described above and give us a reasonable window to remediate before any public disclosure.
- Do not exploit the vulnerability beyond what is necessary to demonstrate it.

Thank you for helping keep TronIDE secure.
