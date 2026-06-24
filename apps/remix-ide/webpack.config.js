/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const nxWebpack = require('@nrwl/react/plugins/webpack');
const webpack = require('webpack');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const packageJson = require('../../package.json');

// Single source of truth for the Content-Security-Policy. This must stay in
// sync with the <meta http-equiv="Content-Security-Policy"> in src/index.html /
// src/webpack.index.html, the nginx `add_header Content-Security-Policy`
// (apps/remix-ide/nginx.conf), and the generated `_headers` file (build.sh).
//
// Sending the CSP as a *response header* (here for the dev-server, via _headers
// for static prod hosting, via nginx for the Docker image) is more reliable
// than a <meta> tag and is the only way to honour header-only directives such
// as `frame-ancestors`, which a <meta> CSP silently ignores.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://kit.fontawesome.com https://www.googletagmanager.com https://www.google-analytics.com https://tronprotocol.github.io https://binaries.soliditylang.org",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://use.fontawesome.com https://*.fontawesome.com",
  "font-src 'self' data: https://use.fontawesome.com https://*.fontawesome.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:",
  "frame-src 'self' http://localhost:* https:",
  "worker-src 'self' blob:",
  "form-action 'self'",
  // Header-only directive — ignored when delivered via <meta>.
  "frame-ancestors 'self'"
].join('; ');

class DropSourceMapAssetsPlugin {
  apply (compiler) {
    compiler.hooks.thisCompilation.tap('DropSourceMapAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'DropSourceMapAssetsPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
        },
        (assets) => {
          Object.keys(assets)
            .filter((assetName) => assetName.endsWith('.map'))
            .forEach((assetName) => compilation.deleteAsset(assetName))
        }
      )
    })
  }
}

class VersionedEntrypointAssetsPlugin {
  apply (compiler) {
    compiler.hooks.done.tap('VersionedEntrypointAssetsPlugin', (stats) => {
      const outputPath = stats.compilation.outputOptions.path
      // The entry bundles have fixed names (runtime.js / vendor.js / main.js),
      // so the only cache-buster is this ?v= query. Deriving it from the
      // package version meant every build on a release branch shared the same
      // ?v=2.3.0 URL — browsers and the CDN then served a stale bundle for the
      // whole TTL after a deploy. Derive ?v= from each file's CONTENT instead:
      // the query changes exactly when the bundle changes, so a deploy always
      // busts the cache and an unchanged bundle keeps it.
      const tokenCache = {}
      const tokenFor = (assetName) => {
        if (tokenCache[assetName] !== undefined) return tokenCache[assetName]
        let token = packageJson.version
        try {
          const assetPath = path.join(outputPath, assetName)
          if (fs.existsSync(assetPath)) {
            token = crypto.createHash('md5').update(fs.readFileSync(assetPath)).digest('hex').slice(0, 12)
          }
        } catch (e) { /* fall back to the package version */ }
        tokenCache[assetName] = token
        return token
      }
      ;['index.html', 'webpack.index.html'].forEach((fileName) => {
        const filePath = path.join(outputPath, fileName)
        if (!fs.existsSync(filePath)) return
        const html = fs.readFileSync(filePath, 'utf8')
        const versionedHtml = html.replace(/(src=")((?:runtime|vendor|main)\.js)(?:\?v=[^"]*)?(")/g,
          (match, pre, asset, post) => `${pre}${asset}?v=${tokenFor(asset)}${post}`)
        if (versionedHtml !== html) fs.writeFileSync(filePath, versionedHtml)
      })
    })
  }
}

module.exports = config => {
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "querystring": require.resolve("querystring-es3"),
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    path: require.resolve('path-browserify'),
    http: require.resolve('stream-http'),
    https: require.resolve('https-browserify'),
    constants: require.resolve('constants-browserify'),
    os: false, //require.resolve("os-browserify/browser"),
    timers: false, // require.resolve("timers-browserify"),
    zlib: require.resolve('browserify-zlib'),
    'assert/strict': require.resolve('assert/'),
    fs: false,
    module: false,
    tls: false,
    net: false,
    readline: false,
    child_process: false,
    buffer: require.resolve('buffer/'),
    vm: require.resolve('vm-browserify')
  };
  config.module.rules.push({
    test: /\.js$/,
    use: ['source-map-loader'],
    enforce: 'pre',
    exclude: /node_modules/, // Exclude dependencies from source map processing
  });
  if (config.mode === 'production') {
    config.devtool = false;
    config.plugins = (config.plugins || []).filter((plugin) => plugin?.constructor?.name !== 'SourceMapDevToolPlugin');
    config.plugins.push(new DropSourceMapAssetsPlugin());
  }
  config.plugins.push(new VersionedEntrypointAssetsPlugin());
  config.plugins.push(new webpack.DefinePlugin({
    'process.env.TRON_PUBLIC_TRONGRID_API_KEY': JSON.stringify(process.env.TRON_PUBLIC_TRONGRID_API_KEY || ''),
    'process.env.TRONSCAN_MAINNET_CONTRACT_API_URLS': JSON.stringify(process.env.TRONSCAN_MAINNET_CONTRACT_API_URLS || ''),
    'process.env.TRONSCAN_NILE_CONTRACT_API_URLS': JSON.stringify(process.env.TRONSCAN_NILE_CONTRACT_API_URLS || ''),
    'process.env.TRONSCAN_SHASTA_CONTRACT_API_URLS': JSON.stringify(process.env.TRONSCAN_SHASTA_CONTRACT_API_URLS || '')
  }));

  const nxWebpackConfig = nxWebpack(config, {});

  const finalConfig = {
    ...nxWebpackConfig,
    devtool: config.mode === 'production' ? false : nxWebpackConfig.devtool,
    entry: './src/main.js',
    node: {},
    output: {
      ...nxWebpackConfig.output,
      scriptType: 'text/javascript',
      devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]'
    }
  };

  // When invoked by the nx dev-server (`nx serve`), `config` already carries a
  // `devServer` block (Access-Control-Allow-Origin, historyApiFallback, ...).
  // Preserve it and add the CSP response header so local dev mirrors how prod
  // delivers the policy. During a plain `nx build` there is no devServer block,
  // so this guard is a no-op and nothing is added to the production bundle.
  const devServer = config.devServer || nxWebpackConfig.devServer;
  if (devServer) {
    finalConfig.devServer = {
      ...devServer,
      headers: {
        ...(devServer.headers || {}),
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        // Mirror nginx.conf / the _headers file so local dev matches prod. These
        // two are response-header only (browsers ignore them in <meta>), so the
        // dev server is the only place the app itself can deliver them locally.
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff'
      }
    };
  }

  return finalConfig;
};
