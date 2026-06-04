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
const packageJson = require('../../package.json');

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
      ;['index.html', 'webpack.index.html'].forEach((fileName) => {
        const filePath = path.join(outputPath, fileName)
        if (!fs.existsSync(filePath)) return
        const html = fs.readFileSync(filePath, 'utf8')
        const versionedHtml = html.replace(/(src=")((?:runtime|vendor|main)\.js)(?:\?v=[^"]*)?(")/g, `$1$2?v=${packageJson.version}$3`)
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

  return {
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
};
