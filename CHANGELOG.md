# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source release scaffolding: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, minimal GitHub Actions CI workflow.
- `.env.example` templates documenting the variables used by e2e tests.

### Changed
- README now clearly identifies TronIDE as a fork of the Remix Project and links to the upstream repository.
- `package.json` metadata points to the public GitHub repository (`tronweb3/TronIDE`); workspace `name` renamed from `remix-project` to `tronide`.

### Removed
- `.env` files are no longer tracked in the repository; copy `.env.example` to set up local development.

## [2.1.8] - 2026-04

Baseline release forked from the internal TronIDE codebase. Includes TRON-specific validation, TRC10 handling, and the integrated AI assistant.

---

Earlier releases (pre-open-source) were tracked internally and are not reproduced here. For historical context, see git tags `v2.1.x` in the repository.
