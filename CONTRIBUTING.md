# Contributing to TronIDE

Thanks for your interest in contributing! TronIDE is an open-source IDE for TRON smart contract development, maintained as a fork of the [Remix Project](https://github.com/ethereum/remix-project). This guide covers how to report issues, propose changes, and get your contribution merged.

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md). Security-sensitive reports should follow the [Security Policy](./SECURITY.md).

## Ways to contribute

- **Report a bug**: [open an issue](https://github.com/tronweb3/TronIDE/issues/new/choose) using the Bug Report template.
- **Request a feature**: [open an issue](https://github.com/tronweb3/TronIDE/issues/new/choose) using the Feature Request template.
- **Ask or discuss**: use [GitHub Discussions](https://github.com/tronweb3/TronIDE/discussions) for questions, ideas, and general conversation.
- **Fix a bug or build a feature**: comment on an existing issue first so a maintainer can assign it, then open a pull request.

Issues labeled **`good first issue`** or **`help wanted`** are good starting points.

## Development setup

### Prerequisites

- Node.js `20.19.2` (use `nvm install 20.19.2 && nvm use 20.19.2`)
- `pnpm` `10.12.4` (`npm i -g pnpm@10.12.4` or `corepack enable`)

### Install & build

```bash
git clone https://github.com/tronweb3/TronIDE.git
cd TronIDE
pnpm install --frozen-lockfile
pnpm build:libs
```

### Git hooks

To maintain high code quality and prevent accidental credential leaks, this repository uses Git hooks for pre-commit checks (including fast local secret scans, API key checks, eval checks, and optional Claude Code AI review).

These hooks are set up automatically when you run `pnpm install` via the `setup-hooks` script. If you need to manually install or reset them, run:
```bash
pnpm run setup-hooks
```

To enable the opt-in Claude Code review on your staged changes when committing, run:
```bash
PRE_COMMIT_AI_REVIEW=1 git commit -m "commit message"
```

### Run locally

```bash
pnpm build:prod
cd build/apps/remix-ide
npx http-server
# Open http://127.0.0.1:8080
```

### Run tests

```bash
pnpm test:libs      # Unit tests for workspace libraries
pnpm lint:libs      # Lint workspace libraries
```

End-to-end tests live under `apps/remix-ide-e2e/`; see the README in that folder for Selenium/Nightwatch setup. You will need a local `.env` (copy from `.env.example`) if you run the Gist or runAndDeploy suites.

## Branching and commits

- Fork the repository and create a feature branch from `main`:
  `type/<issue-number>-<short-description>`, for example `feat/321-add-ai-optimizer` or `fix/412-compiler-panic`.
- Keep commits focused. One logical change per commit makes review easier.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for the commit subject line. Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.
- Reference the issue number in the commit body when applicable.

## Pull request checklist

Before opening a PR, please verify:

- [ ] The PR targets `main`.
- [ ] `pnpm lint:libs` passes.
- [ ] `pnpm test:libs` passes (or the relevant test suite for your change).
- [ ] New functionality is covered by tests when practical.
- [ ] User-visible changes are noted in `CHANGELOG.md` under the `[Unreleased]` section.
- [ ] The PR description explains **what** changed and **why**, and links the related issue.

## Review and merge

- A maintainer will review your PR and may request changes. Please respond in the PR rather than opening a new one.
- Once approved, the PR will be squashed and merged into `main`. The merge commit will follow Conventional Commits so the changelog can be generated.
- Your contribution will be credited in the release notes.

## Licensing

By submitting a contribution, you agree that it will be licensed under the [Apache-2.0 License](./LICENSE), the same license used by the rest of the project. If your contribution is derived from other open-source work, please call out the upstream source and its license in the PR description.

## Questions

If anything is unclear, open a [GitHub Discussion](https://github.com/tronweb3/TronIDE/discussions). We would rather answer a question than have someone struggle in silence.
