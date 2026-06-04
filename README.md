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

- **Full Contract Lifecycle Management**: Easily write, compile, deploy, debug, and test your Solidity smart contracts.
- **Rich Plugin Ecosystem**: A plugin market with intuitive GUIs to extend your IDE's capabilities on demand.
- **TRON Network Integration**: Optimized workflows for TRON, simplifying interaction with TronLink and the TRON network.
- **AI Assistant (New!)**: Integrated AI assistance to help you debug code, optimize contract gas consumption, explain complex logic, and generate unit tests.

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

### v2.3.0 scope notes

TronIDE v2.3.0 is TRON-oriented and does not claim full Ethereum Remix parity. Current Home status is documented in `apps/remix-ide/docs/v2.3.0-roadmap-section-3-traceability.md` and `apps/remix-ide/docs/remix-220-home-parity.md`: AI, tutorials, templates, plugin manager, static analysis, public GitHub links/imports, and the TronScan-oriented Contract Verification plugin exposes its actual local state; account sign-in is token-only for this release, GitHub OAuth is deferred while private read/write uses user-provided fine-grained tokens in the browser, and automated TronScan source submission/receipts plus EVM-only verification services remain blocked/unavailable or not applicable to TRON rather than marked done; AI model/audio/history controls are not duplicated on Home.

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
