/*
 * Copyright 2026 [TronIDE]
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

function ruleBody (source, selector) {
  var escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  var match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  return match ? match[1] : ''
}

function declaredColor (source, property) {
  var escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  var match = source.match(new RegExp(escaped + '\\s*:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])', 'i'))
  return match ? match[1] : null
}

function rgb (hex) {
  if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(function (value) { return value + value }).join('')
  return [1, 3, 5].map(function (start) {
    return parseInt(hex.slice(start, start + 2), 16) / 255
  })
}

function luminance (hex) {
  var channels = rgb(hex).map(function (value) {
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrast (first, second) {
  var firstLuminance = luminance(first)
  var secondLuminance = luminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

test('initial loading UI paints before blocking runtime scripts', function (t) {
  var indexHtml = read('apps/remix-ide/src/index.html')
  var webpackIndexHtml = read('apps/remix-ide/src/webpack.index.html')
  var appSource = read('apps/remix-ide/src/app.js')
  var splashMarkup = '<div id="tronide-initial-splash"'
  var browserFsScript = '<script src="assets/js/browserfs.min.js"></script>'

  t.equal(indexHtml, webpackIndexHtml, 'source and webpack HTML entrypoints stay identical')
  t.ok(indexHtml.includes(splashMarkup), 'the initial HTML contains a static loading status')
  t.ok(indexHtml.indexOf(splashMarkup) < indexHtml.indexOf(browserFsScript), 'the loading status is parsed before BrowserFS blocks runtime startup')
  t.ok(indexHtml.indexOf('</head>') < indexHtml.indexOf(browserFsScript), 'BrowserFS no longer blocks creation of the document body')
  t.ok(indexHtml.includes('role="status"') && indexHtml.includes('Loading TRON IDE…'), 'the loading state is visible and announced to assistive technology')
  t.ok(indexHtml.includes('id="tronide-initial-status"'), 'storage migration can update the already-painted accessible status')
  t.ok(indexHtml.includes('config-v0.8:.remix.config') && indexHtml.includes('storedConfig[\'settings/theme\']'), 'the splash follows the persisted IDE theme')
  t.ok(indexHtml.includes('window.location.search.length > 1') && indexHtml.includes('window.location.hash.slice(1)'), 'the splash follows both supported query parameter locations')
  t.ok(indexHtml.includes("themeQuality[theme] || 'dark'") === false, 'untrusted theme keys are not read directly from the lookup object')
  t.ok(appSource.includes("document.getElementById('tronide-initial-splash')"), 'the runtime reuses the already-painted splash instead of creating a duplicate')
  t.ok(appSource.includes("document.documentElement.removeAttribute('data-splash-theme')"), 'splash-only colors are removed when the IDE becomes visible')
  t.end()
})
test('light theme keeps primary small text and controls at WCAG AA contrast', function (t) {
  var theme = read('apps/remix-ide/src/assets/css/themes/remix-light_powaqg.css')
  var home = read('apps/remix-ide/src/app/ui/landing-page/landing-page.js')
  var releaseNotes = read('apps/remix-ide/src/app/ui/release-notes/release-notes.js')
  var topHeader = read('libs/remix-ui/top-header/src/lib/top-header.css')
  var chat = read('libs/remix-code-reader/src/components/Chat/index.css')
  var chatGreeting = read('libs/remix-code-reader/src/components/Chat/ChatGreetItemRender/index.css')
  var secondaryText = declaredColor(theme, '--ai-text')
  var secondaryButton = declaredColor(theme, '--btn-bg')
  var homeSubtle = declaredColor(home, '--home-subtle')
  var homeSuccess = declaredColor(home, '--home-success')
  var notificationBackground = ruleBody(topHeader, '.top-header-wrapper .notification-badge').match(/background:\s*(#[0-9a-f]{6})/i)

  t.ok(contrast(secondaryText, '#ffffff') >= 4.5, 'secondary text passes AA on white surfaces')
  t.ok(contrast(secondaryText, '#eef1f6') >= 4.5, 'secondary text passes AA on the IDE light background')
  t.ok(contrast(secondaryButton, '#ffffff') >= 4.5, 'white text passes AA on secondary buttons')
  t.ok(contrast(homeSubtle, '#ffffff') >= 4.5, 'Home metadata passes AA on cards')
  t.ok(contrast(homeSuccess, '#ffffff') >= 4.5, 'Home success status passes AA on cards')
  t.notOk(/#747b90|#a2a3bd/i.test(theme), 'legacy low-contrast light-theme text colors cannot return')
  t.notOk(/opacity\s*:\s*\.75/.test(ruleBody(home, '.heroNotesLink')), 'Home release links are not faded below AA contrast')
  t.ok(/opacity\s*:\s*\.75/.test(ruleBody(releaseNotes, '.releaseDate')), 'release dates retain hierarchy without the previous low-contrast opacity')
  t.ok(/opacity\s*:\s*\.75/.test(ruleBody(releaseNotes, '.releaseDetailsHint')), 'release disclosure hints retain AA contrast')
  t.notOk(/opacity\s*:/.test(ruleBody(releaseNotes, '.mediaSource')), 'release image links render at full contrast')
  t.notOk(/opacity\s*:/.test(ruleBody(releaseNotes, '.footer')), 'release footer text renders at full contrast')
  t.ok(notificationBackground && contrast(notificationBackground[1], '#ffffff') >= 4.5, 'notification counts pass AA against white text')
  t.ok(chat.includes('dialogue-wrapper > span {\n  color: var(--ai-text);'), 'AI model labels use the theme-aware accessible text color')
  t.ok(chat.includes('session-dialogue-item-text {\n  color: var(--ai-text);'), 'AI session separators use the theme-aware accessible text color')
  t.ok(chatGreeting.includes('hi-there {\n  margin-right: 8px;\n  font-size: 16px;\n  font-weight: 500;\n  line-height: 18px;\n  color: var(--ai-text);'), 'the AI greeting uses the theme-aware accessible text color')
  t.end()
})

test('custom context menus use explicit theme colors with readable states', function (t) {
  var editor = read('apps/remix-ide/src/app/editor/editor.js')
  var activityMenu = read('apps/remix-ide/src/app/ui/contextMenu.js')
  var fileMenu = read('libs/remix-ui/file-explorer/src/lib/css/file-explorer-context-menu.css')
  var themePaths = [
    'bootstrap-cerulean.min.css',
    'bootstrap-cyborg.min.css',
    'bootstrap-flatly.min.css',
    'bootstrap-spacelab.min.css',
    'remix-black_undtds.css',
    'remix-candy_ikhg4m.css',
    'remix-dark_tvx1s2.css',
    'remix-light_powaqg.css',
    'remix-midcentury_hrzph3.css'
  ]

  t.ok(editor.includes('color:var(--ai-title,#212529)'), 'the editor menu does not fall back to dark text on a dark surface')
  t.notOk(editor.includes('color:var(--text,#212529)'), 'the undefined legacy --text fallback cannot return')
  t.ok(editor.includes("(it.enabled ? '1' : '.82')"), 'disabled commands remain distinguishable without becoming unreadable')
  t.ok(editor.includes("color-mix(in srgb, currentColor 8%, transparent)"), 'editor hover/focus uses a contrast-preserving tint')
  ;[activityMenu, fileMenu].forEach(function (source, index) {
    var label = index === 0 ? 'activity menu' : 'file explorer menu'
    t.ok(/color:\s*var\(--ai-title,\s*#212529\)/.test(source), label + ' sets an explicit theme-aware foreground')
    t.ok(/background-color:\s*var\(--light,\s*#fff\)/.test(source), label + ' sets an explicit theme-aware surface')
    t.ok(/color:\s*inherit/.test(source), label + ' items inherit the verified foreground')
    t.ok(/color-mix\(in srgb,\s*currentColor 8%,\s*transparent\)/.test(source), label + ' hover uses the same safe tint')
  })

  themePaths.forEach(function (fileName) {
    var theme = read('apps/remix-ide/src/assets/css/themes/' + fileName)
    var foreground = declaredColor(theme, '--ai-title')
    var background = declaredColor(theme, '--light')
    t.ok(foreground && background && contrast(foreground, background) >= 4.5, fileName + ' menu foreground passes AA on its menu surface')
  })
  t.end()
})
