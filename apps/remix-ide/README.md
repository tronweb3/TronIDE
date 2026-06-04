## TronIDE

**TronIDE** is a powerful, open-source IDE for TRON network smart contract development. It is based on the popular Remix Project and enhanced with exclusive features for the TRON ecosystem.

It is a platform for development tools that uses a plugin architecture, dedicated to serving the entire lifecycle of TRON smart contract (Solidity) development. TronIDE is not only a playground for learning and teaching TRON contract development but also a feature-rich professional IDE.

### Core Features

- **Full Contract Lifecycle Management**: Easily write, compile, deploy, debug, and test your Solidity smart contracts.
- **Rich Plugin Ecosystem**: A plugin market with intuitive GUIs to extend your IDE's capabilities on demand.
- **TRON Network Integration**: Optimized workflows for TRON, simplifying interaction with TronLink and the TRON network.
- 🤖 **AI Assistant (New!)**: Integrated AI assistance to help you debug code, optimize contract gas consumption, explain complex logic, and generate unit tests.
- **Remix 2.2.0 Home Parity Entry Points**: The Home page exposes TRON-safe equivalents for Remix 2.2.0 onboarding, most-used plugins, Contract Verification, top product controls, and local status messaging; walkthrough entry points are intentionally hidden until target highlighting is reliable in the simplified Home view. See `docs/remix-220-home-parity.md` for the 4.1 requirement-to-evidence map.

### Remix 2.2.0 Home Parity Notes

The v2.3.0 Home page intentionally keeps TRON semantics while matching the Remix 2.2.0 entry-point surface:

- **P0 home/onboarding**: `Prepare Workspace`, `First Time? Start Here!`, TRON documentation/website/source-build links, a TRON DApp starter card, and a `Connect Wallet` Start building card that delegates to the real header TronLink / Deploy & Run flow.
- **P0 plugin cards**: `Most used plugins` includes Contract Verification, Solidity Analyzers, and Cookbook-style template discovery; the tutorial walkthrough card is hidden from Home.
- **P0 Contract Verification**: the Home page opens a side-panel Contract Verification plugin that provides a TronScan-first MVP with network/address status lookup, local verification package generation from the latest compiler artifact, copy/download JSON actions, and manual TronScan handoff. EVM-only services such as Sourcify, Etherscan, Blockscout, and Routescan are explicitly not presented as available TRON verification backends.
- **P0 Help & Walkthroughs**: walkthrough source remains available for future work, but the Home panel and `Start Learning` button are not rendered in this release because highlight targets can be unavailable in the simplified view.
- **P1 productization**: Home provides local layout controls, a local notification center, real plugin activation toggles, top-bar workspace/GitHub/wallet boundaries, and optional Home status messaging without faking unavailable account, OAuth, or external-service features; GitHub private read/write is available through user-provided fine-grained tokens stored in this browser; AI model/audio/history controls stay in the outer AI panel instead of Home.

Verification commands for this surface:

```bash
node apps/remix-ide/test/remix-220-home-parity-test.js
node apps/remix-ide/test/index.js
pnpm nx build remix-ide
```

Quality gates covered by the home parity test include missing-section fallbacks, unavailable OAuth/account states, external-link `noopener` protections, accessibility labels/alt text, local asset existence, static external URL allowlisting, and placeholder-copy rejection for `TODO`, `FIXME`, `lorem ipsum`, `coming soon`, and dummy credential markers.

Operational boundaries:

- No new runtime dependencies or environment variables are required for this Home page surface.
- Clean bootstrap uses the pinned root engines (`node` 20.19.2 and `pnpm` 10.12.4) and the repository postinstall (`build:libs` plus `downloadsolc_assets`). Network access to `https://binaries.soliditylang.org/wasm/soljson-v0.8.20+commit.a1b79de6.js` is required for a fresh checkout.
- Account sign-in is token-only in local builds, GitHub OAuth is deferred until backend resources exist, private GitHub read/write uses user-provided fine-grained browser tokens, and automated verification receipts plus TronScan submit/API credentials are shown only as explicit unavailable or configuration-gated states unless the corresponding real backend is configured. RemixAI model switching, audio input, and history are not duplicated on Home; use the outer AI panel for AI controls.
- The Home page does not accept free-form security-sensitive input for the new 2.2.0 parity controls. Walkthrough search filters only local walkthrough metadata; workspace creation uses generated local names; the verification plugin only accepts network/address for public lookup and opens TronScan with `noopener` for manual source submission.
- Workspace status refreshes are debounced and use the existing workspace provider directory traversal. This avoids adding new polling loops, network calls, background jobs, or unbounded external integration work to the Home page.
- Deployment to a hosted environment is not part of the local release-gate scope; validate the built app by serving `build/apps/remix-ide` from a static HTTP server.

------

## Quick Start

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

2.  **Clone and Install Dependencies**
    ```bash
    git clone [Your Project's Git URL]
    cd tron-remix
    pnpm install
    ```
    Clean-checkout note: `pnpm install` runs the repository `postinstall`, which builds shared libraries and downloads the Solidity compiler asset used by the IDE. Network access to the Solidity binary host is required for that bootstrap step.

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

	### License
	This project contains code from the original MIT-licensed project:

	MIT © 2018-21 Remix Team

	New modifications and additions are licensed under the Apache License 2.0.
