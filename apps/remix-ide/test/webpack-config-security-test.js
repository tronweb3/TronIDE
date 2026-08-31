/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

'use strict'

var test = require('tape')
var webpackConfig = require('../webpack.config')

test('webpack config removes Nx task metadata from client environment definitions', function (t) {
  var nxDefinitions = {
    'process.env': {
      NODE_ENV: JSON.stringify('production'),
      NX_WORKSPACE_ROOT: JSON.stringify('/private/build/checkout'),
      NX_TERMINAL_OUTPUT_PATH: JSON.stringify('/private/build/cache/output'),
      NX_TASK_HASH: JSON.stringify('private-task-hash')
    }
  }
  var publicDefinitions = {
    'process.env.TRON_PUBLIC_TRONGRID_API_KEY': JSON.stringify('public-value')
  }

  webpackConfig.stripNxClientEnvironment([
    { definitions: nxDefinitions },
    { definitions: publicDefinitions }
  ])

  t.deepEqual(nxDefinitions['process.env'], {
    NODE_ENV: JSON.stringify('production')
  }, 'non-Nx values are retained while all NX_* values are removed')
  t.deepEqual(publicDefinitions, {
    'process.env.TRON_PUBLIC_TRONGRID_API_KEY': JSON.stringify('public-value')
  }, 'explicit public client definitions are not changed')
  t.end()
})
