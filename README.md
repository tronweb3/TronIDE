<p align="center">
    <a href="https://tronide.io/">
        <img src="./apps/remix-ide/src/assets/img/tron-ide-logo.png" alt="TronIDE Logo" width="240">
    </a>
</p>

<h1 align="center">TronIDE</h1>

<p align="center">
    <a href="https://nodejs.org/">
        <img alt="Node.js" src="https://img.shields.io/badge/Node.js-v20.x-blue?logo=nodedotjs">
    </a>
    <a href="./LICENSE">
        <img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
    </a>
</p>

Welcome to the TronIDE project! This guide aims to provide clear instructions for all community members who wish to use, understand, or contribute to this project.

## 1. About TronIDE

**TronIDE** is a powerful, open-source IDE for TRON network smart contract development. It is a TRON-oriented fork of the Remix Project: the UI reuses Remix architecture where useful, but the product scope is TRON / TronLink / TVM workflows rather than full Ethereum Remix parity.

It is a platform for development tools that uses a plugin architecture, dedicated to serving the entire lifecycle of TRON smart contract (Solidity) development. TronIDE is not only a playground for learning and teaching TRON contract development but also a feature-rich professional IDE.

### Core Features

- **Full Contract Lifecycle Management**: Write, compile, deploy, debug, and test Solidity smart contracts on a JavaScript VM (Tron), Injected TronWeb (TronLink), and TRON-focused examples.
- **AI Assistant**: An in-panel assistant with a real IDE tool belt — it can compile and set the compiler version, deploy, read/write contracts, run tests and static analysis, search the workspace, show diffs and make precise edits, drive local Git (clone / commit / push / pull), record–replay–export a deploy flow as a runnable TronBox project, and save a compiler-settings reference for the manual TronScan verification workflow. Every file/state write asks for your confirmation first, and API keys are kept in browser memory only.
- **TRON Network Integration**: Optimized workflows for TRON — connect TronLink, deploy and transact on Nile or Mainnet with clear wallet feedback, and TronScan-oriented contract verification.
- **Local Git & GitHub**: A per-workspace Git panel (init, stage, commit, branches, history) plus in-browser clone / fetch / pull / push, with GitHub connected via an OAuth popup and tokens held in memory only.
- **Rich Plugin Ecosystem**: A plugin architecture with intuitive GUIs to extend the IDE's capabilities on demand.

------

## 2. Quick Start

Getting TronIDE running on your local machine is straightforward.

1.  **Prerequisites**
    * Ensure you have **Node.js v20.x** installed (we highly recommend using `nvm` for version management).
        ```bash
        nvm install 20
        nvm use 20
        ```
    * Install the `pnpm` package manager globally.
        ```bash
        npm i -g pnpm
        ```
    * For testnet wallet validation, install TronLink in your browser, unlock it, and switch to Nile. Mainnet is not required for release validation.

2.  **Clone and Install Dependencies**
    ```bash
    git clone https://github.com/tronweb3/TronIDE.git
    cd TronIDE
    pnpm install
    ```

3.  **Build and Run**
    This command will build the production version of the application.
    ```bash
    pnpm build:prod
    ```
    After the build is complete, navigate to the output directory and serve it with a local HTTP server.
    ```bash
    cd build/apps/remix-ide

    # You can use any static server tool, e.g., http-server
    # npm i -g http-server
    http-server
    ```
    You can now open `http://127.0.0.1:8080` (or the address provided by `http-server`) in your browser to access your local TronIDE instance.

4.  **Basic TRON testnet flow**
    * Open the Home page and use the top-right **Connect Wallet** action only when you are ready to authorize TronLink.
    * Use Nile/testnet for validation; do not treat mainnet deployment as a release pass criterion.
    * Compile a sample Solidity contract, open Deploy & Run, connect TronLink on Nile, deploy, call a view method, send one state-changing transaction, and open the transaction on Tronscan.

### v2.3.2 scope notes

TronIDE is TRON-oriented and does not claim full Ethereum Remix parity. Highlights of the current 2.3.x line:

- **AI assistant** with a real IDE tool belt (compile / deploy / read–write, workspace search, diff and precise edits, tests, static analysis, local Git, Recorder → TronBox export, and verification), gated by per-write confirmation.
- **Local Git panel** (init / stage / commit / branches / history) plus in-browser clone / fetch / pull / push.
- **GitHub connect via an OAuth popup**, with tokens held in browser memory only — no GitHub secret is persisted to disk (the earlier Settings-tab gist token has been retired).
- **Contract Verification** selects the deployable main contract and downloads a flattened `.sol` file for TronScan; the exported metadata JSON is a reference checklist only, and the final source upload stays manual.
- **In-app Release Notes** (open them from the version badge or the Release Notes button in the header) and a **Feedback** entry that links straight to the project's GitHub issues.

TronLink is the wallet path for real networks. Automated TronScan source submission/receipts and EVM-only verification services are unavailable or not applicable to TRON rather than marked as done.

### v2.3.3 AI task workflow

The v2.3.3 line turns individual AI tool calls into visible, recoverable development tasks:

1. Start from one of the four TRON AI task cards on Home, or open the AI panel and describe the outcome you want.
2. Bank of AI is selected by default; enter a dedicated low-limit Bank of AI API key, load its live model list if needed, and enable **Workspace Actions**. You can still switch to Anthropic, Google Gemini, or another OpenAI-compatible provider. API keys remain in browser memory and disappear after a reload or panel close.
3. Review the generated plan and task timeline. Read-only steps run directly; file, Git remote, and on-chain writes show their target, risk, and approval snapshot before execution. Mainnet writes require an additional confirmation and are never retried automatically.
4. If a step fails or is stopped, use its error code and suggested recovery action. Task history, safe artifacts, and recovery state are kept locally so the task can be reopened without pretending that an already-broadcast transaction was cancelled.
5. After a successful deployment, use the next-step card to verify, interact, save a Recorder scenario, or export a TronBox project. The export boundary is generated files plus the public TronBox CLI; TronIDE does not embed TronBox as a browser runtime.

For release validation, use an unlocked TronLink account on Nile with test funds. Confirm the network, account, contract, method, arguments, and value shown on every approval card. A missing wallet injection, unknown network, uncertain transaction, or unsupported model capability is a blocking state rather than a silent fallback.

Task diagnostics can be exported as privacy-safe Markdown or JSON. Raw prompts, source code, transaction arguments, credentials, provider payloads, and raw errors are excluded. The AI settings also expose a separate local aggregate of workflow outcomes, duration buckets, canonical error codes, and approval decisions; it is never uploaded and can be cleared or disabled at any time.

------

## 3. How to Contribute

We enthusiastically welcome any form of contribution from the community, whether it's reporting a bug or submitting a new feature.

### Reporting Bugs & Feature Suggestions

If you encounter a problem or have a great idea, the best way to let us know is by creating a GitHub Issue.

1.  **Visit the Issues Page**: [https://github.com/tronweb3/TronIDE/issues](https://github.com/tronweb3/TronIDE/issues)
2.  **Choose a Template**: Select the `Bug Report` or `Feature Request` template based on your needs.
3.  **Describe in Detail**: Please fill out the template with as much detail as possible. This helps us diagnose and address the issue faster.

### Picking Up a Task & Development Workflow

We encourage developers to get directly involved with coding. Issues tagged with **`looking for help`** are excellent starting points.

1.  **Express Your Interest**: Leave a comment on the issue you'd like to work on. A core maintainer will assign it to you.
    > **Please note**: To ensure project momentum, we may reassign an issue if there is no activity for an extended period. We will contact the original assignee first in such cases.

2.  **Fork & Create a Branch**:
    * Fork this project to your personal account.
    * Create a new branch for your work. Our recommended branch naming convention is `type/issue-number-short-description` (e.g., `feat/321-add-ai-optimizer`).

3.  **Develop & Commit**:
    * Complete your coding and ensure it passes local tests.
    * Please commit your code following the **[Conventional Commits](https://www.conventionalcommits.org/)** specification.

4.  **Open a Pull Request (PR)**:
    * Push your branch to your forked repository, then open a PR against the `main` branch of the main repository.
    * Clearly summarize your changes in the PR description and complete the `Author Checklist` in the template.

5.  **Code Review & Merge**:
    * Core maintainers will review your code and may request changes.
    * After your PR passes code review, QA testing, and design review, it will be merged. Congratulations on becoming a TronIDE contributor!

------

## 4. Development & Testing

### Running Unit Tests

Use the following command to run the unit tests for the project's libraries:

```bash
pnpm test:libs
```

### Offline Usage
The master branch always has the latest stable build. It also contains a ZIP file with the entire build. Download it to use offline.

**Note**: It contains the latest release of Solidity available at the time of packaging. No other compiler versions are supported.

------

## 5. Analytics & Privacy

The hosted TronIDE application includes **Google Analytics (gtag.js, property `G-PPGK4JW2YY`)** to collect anonymous usage statistics (page views, feature interactions). No personally identifiable information is collected.

The v2.3.3 AI task aggregate is separate from Google Analytics. It is stored only on the current device, contains fixed counters rather than raw task events, and excludes prompts, source code, addresses, transaction arguments, API keys, wallet data, task identifiers, and tool names. Use the AI settings to inspect the summary, clear it, or opt out; opting out deletes the stored aggregate and stops new counting.

If you self-host or build from source, you can remove the `<script>` block referencing `googletagmanager.com` in `apps/remix-ide/src/index.html` to disable analytics entirely.

---

## 6. License & Acknowledgements

* **License (TronIDE modifications)**: TronIDE modifications and newly authored code are released under the **[Apache-2.0 License](./LICENSE)**. See [`NOTICE`](./NOTICE) for the consolidated attribution summary.
* **Upstream**: This project is a fork of the [Remix Project](https://github.com/ethereum/remix-project). Upstream code retains its original licenses in-tree:
  * `apps/remix-ide/` — originally MIT; see [`apps/remix-ide/LICENSE.md`](./apps/remix-ide/LICENSE.md).
  * `libs/remix-*` (`remix-analyzer`, `remix-astwalker`, `remix-core-plugin`, `remix-debug`, `remix-lib`, `remix-simulator`, `remix-solidity`, `remix-tests`, `remix-url-resolver`, `remixd`) — originally Apache-2.0.
  * Per-file source headers identify original Remix copyright and TronIDE modifications, in accordance with Apache-2.0 §4(b).
* **Third-party dependencies**: Distributed build artifacts may bundle additional third-party software under their respective licenses. Generate an aggregated list with `pnpm run licenses:report` (writes `THIRD_PARTY_LICENSES.txt`).
* **Trademarks**: "Remix", "TRON", "TronLink", and related names and logos belong to their respective owners. The applicable open-source licenses do not grant trademark rights (Apache-2.0 §6).
* **Acknowledgements**: We thank the original Remix team, the TRON community, and all contributors who have made TronIDE possible.
