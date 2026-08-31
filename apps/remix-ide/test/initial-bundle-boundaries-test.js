/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var root = path.resolve(__dirname, '../../..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function javascriptFiles (directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(function (entry) {
    var target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) return []
      return javascriptFiles(target)
    }
    return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [target] : []
  })
}

test('AI vendor SDKs stay behind vendor-specific async chunks', function (t) {
  var source = read('libs/remix-code-reader/src/services/toolsApi.js')

  t.notOk(/import\s+[^;]+\s+from\s+['"](?:openai|@google\/genai|@anthropic-ai\/sdk)['"]/.test(source), 'vendor SDKs are not static entry dependencies')
  t.ok(source.includes('webpackChunkName: "ai-openai"'), 'OpenAI has a named async chunk')
  t.ok(source.includes('webpackChunkName: "ai-google"'), 'Google GenAI has a named async chunk')
  t.ok(source.includes('webpackChunkName: "ai-anthropic"'), 'Anthropic has a named async chunk')
  t.ok(source.includes('anthropicClient ? null : await loadAnthropic()'), 'injected test clients do not download the Anthropic SDK')
  t.ok(source.includes('googleClient ? null : await loadGoogleGenAI()'), 'injected test clients do not download the Google SDK')
  t.ok(source.includes('openAIClient ? null : await loadOpenAI()'), 'injected test clients do not download the OpenAI SDK')
  t.end()
})

test('the lazy OpenAI chunk resolves the real SDK on first request', async function (t) {
  var originalFetch = global.fetch
  var requestedUrl = ''
  global.fetch = async function (url) {
    requestedUrl = String(url)
    return new Response(JSON.stringify({
      id: 'lazy-sdk-test',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'LAZY-OPENAI-OK' }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    var tools = await import('../../../libs/remix-code-reader/src/services/toolsApi.js')
    var response = await tools.getOpenaiChatByInstantiation({
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'test-key',
      model: 'test-model',
      stream: false,
      aiModelVendor: 'OpenAI'
    })
    t.equal(response.choices[0].message.content, 'LAZY-OPENAI-OK', 'the dynamically imported SDK completes a request')
    t.equal(requestedUrl, 'https://api.openai.com/v1/chat/completions', 'the lazy client retains the official vendor endpoint')
  } finally {
    global.fetch = originalFetch
  }
  t.end()
})

test('AI code highlighting uses the small core and an explicit language set', function (t) {
  var source = read('libs/remix-code-reader/src/components/common/CodeHighlight/index.js')

  t.ok(source.includes('highlight.js/lib/core'), 'the full highlight.js language registry is excluded')
  t.notOk(/from\s+['"]highlight\.js['"]/.test(source), 'the full highlight.js entry cannot return')
  ;['javascript', 'typescript', 'json', 'bash', 'xml', 'css', 'markdown', 'python'].forEach(function (language) {
    t.ok(source.includes(`highlight.js/lib/languages/${language}`), `${language} remains available to AI code fences`)
  })
  t.ok(source.includes('hljsDefineSolidity(hljs)'), 'Solidity and Yul remain registered')
  t.end()
})

test('the reduced highlighter still parses Solidity and common code fences', function (t) {
  var hljs = require('highlight.js/lib/core')
  require('highlightjs-solidity')(hljs)
  hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
  hljs.registerLanguage('json', require('highlight.js/lib/languages/json'))

  t.ok(/hljs-keyword/.test(hljs.highlight('contract Store { uint256 value; }', { language: 'solidity' }).value), 'Solidity keywords are highlighted')
  t.ok(/hljs-keyword/.test(hljs.highlight('const value = 1', { language: 'javascript' }).value), 'JavaScript keywords are highlighted')
  t.ok(/hljs-attr/.test(hljs.highlight('{"value":1}', { language: 'json' }).value), 'JSON properties are highlighted')
  t.end()
})

test('runtime source avoids the Ant Design barrel import', function (t) {
  var roots = [path.join(root, 'apps/remix-ide/src'), path.join(root, 'libs')]
  var offenders = roots.flatMap(javascriptFiles).filter(function (file) {
    var source = fs.readFileSync(file, 'utf8')
    return /(?:from\s+['"]antd['"]|require\(\s*['"]antd['"]\s*\))/.test(source)
  }).map(function (file) { return path.relative(root, file) })

  t.deepEqual(offenders, [], 'components import only the Ant Design submodules they use')
  t.end()
})
