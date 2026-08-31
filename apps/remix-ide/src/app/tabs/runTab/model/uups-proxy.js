/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const remixLib = require('@remix-project/remix-lib')
const { createUUPSProxyHelpers } = require('./uups-proxy-core')

module.exports = createUUPSProxyHelpers(remixLib)
