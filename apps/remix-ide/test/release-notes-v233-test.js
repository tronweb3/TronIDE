/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')
var sourcePath = path.join(root, 'apps/remix-ide/src/app/ui/release-notes/release-notes.js')
var headerPath = path.join(root, 'libs/remix-ui/top-header/src/lib/top-header.js')
var landingPath = path.join(root, 'apps/remix-ide/src/app/ui/landing-page/landing-page.js')
var standalonePath = path.join(root, 'apps/remix-ide/src/release-notes.html')
var linkPath = path.join(root, 'apps/remix-ide/src/lib/release-notes-link.js')
var projectPath = path.join(root, 'apps/remix-ide/project.json')
var webpackPath = path.join(root, 'apps/remix-ide/webpack.config.js')
var mainPath = path.join(root, 'apps/remix-ide/src/main.js')
var appPath = path.join(root, 'apps/remix-ide/src/app.js')
var assetRoot = path.join(root, 'apps/remix-ide/src/assets/img/release-notes')
var assetDir = path.join(assetRoot, 'v2.3.3')
var names = ['home-ai-task-cards', 'bank-of-ai-provider', 'task-timeline-history', 'tron-skill-result', 'approval-write-lock', 'deploy-next-steps']
var releaseMediaIds = {
  '2.3.0': ['HomeWorkbench', 'TronLinkEnvironment', 'ContractVerification', 'AiProviderPicker', 'TvmDebugger', 'TronStaticAnalysis'],
  '2.3.1': ['WorkspaceTemplate', 'CompilerQuickPicks', 'VerificationFlatten', 'PrettierFormat', 'DeployRecorder', 'TronBoxExport'],
  '2.3.2': ['LocalGit', 'GitHubAccount', 'AiToolExecution', 'EditorContextMenu', 'StaticAnalysisSummary', 'DebuggerEnvironmentBoundary'],
  '2.3.3': ['HomeAiTasks', 'BankOfAIProvider', 'TaskTimeline', 'TronSkillResult', 'ApprovalWriteLock', 'DeploymentNextSteps']
}
var historicalReleases = {
  '2.3.0': {
    sourceDocumentId: '10W-bsCqGmCmZWGOpcC-ZcLy1T_jBktW8qiUPa12vbtY',
    names: ['home-workbench', 'tronlink-environment', 'contract-verification', 'ai-provider-picker', 'tvm-debugger', 'tron-static-analysis']
  },
  '2.3.1': {
    sourceDocumentId: '13ijbhknKiCAQwEmhs52U_gCOFWGT9zCKkhdiv-FnCDI',
    names: ['workspace-template', 'compiler-quick-picks', 'verification-flatten', 'prettier-format', 'deploy-recorder', 'tronbox-export']
  },
  '2.3.2': {
    sourceDocumentId: '13ijbhknKiCAQwEmhs52U_gCOFWGT9zCKkhdiv-FnCDI',
    names: ['local-git', 'github-account', 'ai-tool-execution', 'editor-context-menu', 'static-analysis-summary', 'debugger-environment-boundary']
  }
}

function sha256 (filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

test('v2.3.3 release notes contain six accessible versioned screenshots', function (t) {
  var source = fs.readFileSync(sourcePath, 'utf8')
  t.ok(source.indexOf("version: '2.3.3'") !== -1, 'v2.3.3 is the newest release entry')
  t.ok(source.indexOf('releaseNotesGalleryV' + '$' + '{versionId}') !== -1, 'release gallery has a stable test hook')
  t.ok(source.indexOf('alt=' + '$' + '{media.alt}') !== -1, 'every screenshot uses its declared alt text')
  t.ok(source.indexOf('loading="lazy"') !== -1, 'screenshots load lazily')
  t.ok(source.indexOf('source srcset=' + '$' + '{media.webp} type="image/webp"') !== -1, 'page prefers WebP and retains PNG fallback')
  t.ok(source.indexOf('<h1 class=' + '$' + '{css.pageTitle}>Release Notes</h1>') !== -1, 'the page has a semantic heading')
  t.ok(source.indexOf('<h2 class=' + '$' + '{css.releaseVersion}') !== -1, 'each release has a semantic heading')
  t.ok(source.indexOf('<h3 class=' + '$' + '{css.areaTitle}>') !== -1, 'release areas have semantic headings')
  t.ok(source.indexOf('Bank of AI is the default BYOK provider') !== -1, 'the default Bank of AI provider is documented for users')
  t.ok(source.indexOf('Usage metrics stay on the device; prompts and keys are not included') !== -1, 'the Bank of AI usage-record boundary is explicit')
  t.ok(source.indexOf('AI SDKs and UI assets load on demand') !== -1, 'the second cold-start reduction is documented for users')
  t.ok(source.indexOf('Deploy & Run reads Prague and Osaka activation parameters') !== -1, 'the protocol capability check is documented for users')
  t.ok(source.indexOf('blocked before account selection, fee estimation, signing, or broadcast') !== -1, 'the pre-broadcast protection boundary is explicit')
  t.ok(source.indexOf('CLZ source compilation will follow when an official compatible compiler is available') !== -1, 'the compiler boundary is not presented as delivered')
  t.ok(source.indexOf('dynamic call targets are outside this first-pass check') !== -1, 'the static scanner limitation is disclosed')
  for (var name of names) {
    t.ok(source.indexOf(name + '.webp') !== -1, name + ' WebP is referenced')
    t.ok(source.indexOf(name + '.png') !== -1, name + ' PNG source is referenced')
  }
  t.end()
})

test('release notes pair screenshots with feature modules and collapse historical versions', function (t) {
  var source = fs.readFileSync(sourcePath, 'utf8')
  t.ok(source.indexOf('renderReleaseContent (release, versionId)') !== -1, 'feature modules render their own content')
  t.ok(source.indexOf('(area.mediaIds || [])') !== -1, 'each module resolves only its assigned screenshots')
  t.ok(source.indexOf('releaseNotesAreaGalleryV' + '$' + '{versionId}') !== -1, 'module screenshot groups have stable test hooks')
  t.ok(source.indexOf('releaseNotesDetailsV' + '$' + '{versionId}') !== -1, 'each version has an accessible disclosure')
  t.ok(source.indexOf("if (release.tag === 'Current')") !== -1, 'the current release controls the default-open state')
  t.ok(source.indexOf('data-id="releaseNotesDetailsV' + '$' + '{versionId}" open') !== -1, 'the current release is expanded by default')
  t.ok(source.indexOf('Version highlights and screenshots') !== -1, 'the disclosure clearly describes its contents')

  for (var release of Object.keys(releaseMediaIds)) {
    for (var mediaId of releaseMediaIds[release]) {
      var references = source.split("'" + mediaId + "'").length - 1
      t.equal(references, 2, mediaId + ' is declared once and assigned to exactly one feature module')
    }
  }
  t.end()
})

test('Release Notes entry points are standalone links instead of IDE-tab actions', function (t) {
  var header = fs.readFileSync(headerPath, 'utf8')
  var landing = fs.readFileSync(landingPath, 'utf8')
  var links = fs.readFileSync(linkPath, 'utf8')
  t.ok(links.indexOf("RELEASE_NOTES_URL = 'release-notes.html'") !== -1, 'one same-origin standalone URL is shared by every entry point')
  t.ok(header.indexOf("href={RELEASE_NOTES_URL}") !== -1, 'header entries use the standalone URL')
  t.ok(landing.indexOf('href=${RELEASE_NOTES_URL}') !== -1, 'Home uses the standalone URL')
  t.ok(header.indexOf("target='_blank'") !== -1 && landing.indexOf('target="_blank"') !== -1, 'Release Notes opens separately from the active IDE tab')
  t.notOk(header.indexOf("plugin.appManager.activatePlugin('releaseNotes')") !== -1, 'the header no longer activates an IDE Release Notes tab')
  t.notOk(landing.indexOf("this.appManager.activatePlugin('releaseNotes')") !== -1, 'Home no longer activates an IDE Release Notes tab')
  t.end()
})

test('standalone Release Notes is a shipped, themed and secured document', function (t) {
  var standalone = fs.readFileSync(standalonePath, 'utf8')
  var project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
  var assets = project.targets.build.options.assets
  var webpack = fs.readFileSync(webpackPath, 'utf8')
  var main = fs.readFileSync(mainPath, 'utf8')
  var app = fs.readFileSync(appPath, 'utf8')
  t.ok(assets.includes('apps/remix-ide/src/release-notes.html'), 'the standalone document is copied into every build')
  t.ok(webpack.indexOf("'release-notes.html'") !== -1, 'its entry bundles receive content-derived cache tokens')
  t.ok(webpack.indexOf("fs.existsSync(path.join(outputPath, asset)) ? match : ''") !== -1, 'development-only entry scripts are removed when production does not emit them')
  t.ok(standalone.indexOf('id="release-notes-root"') !== -1, 'the standalone renderer has a dedicated root')
  t.ok(standalone.indexOf('http-equiv="Content-Security-Policy"') !== -1, 'the standalone page carries the CSP fallback')
  t.ok(standalone.indexOf('window.top !== window.self') !== -1, 'the standalone page keeps the static-host clickjacking guard')
  t.ok(standalone.indexOf("storedConfig['settings/theme']") !== -1, 'the standalone page follows the saved IDE theme')
  t.ok(standalone.indexOf('<script src="main.js" type="module"></script>') !== -1, 'the standalone document loads the shared app bundle')
  t.ok(main.indexOf('isReleaseNotesPage(window.location.pathname)') !== -1, 'main routes the standalone document before BrowserFS startup')
  t.ok(main.indexOf('new ReleaseNotes({ standalone: true }).render()') !== -1, 'the standalone document reuses the release renderer')
  t.notOk(app.indexOf('new ReleaseNotes()') !== -1, 'Release Notes is no longer registered as an IDE workbench tab')
  t.end()
})

test('standalone Release Notes provides an explicit route back to the IDE', function (t) {
  var source = fs.readFileSync(sourcePath, 'utf8')
  t.ok(source.indexOf('this.standalone = options.standalone === true') !== -1, 'standalone rendering is explicit')
  t.ok(source.indexOf('data-id="releaseNotesBackToIde"') !== -1, 'the page includes a stable Back to TRON IDE link')
  t.end()
})

test('v2.3.3 release screenshot assets share one reproducible capture manifest', function (t) {
  var manifestPath = path.join(assetDir, 'manifest.json')
  t.ok(fs.existsSync(manifestPath), 'capture manifest exists')
  if (!fs.existsSync(manifestPath)) return t.end()
  var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  t.equal(manifest.release, '2.3.3', 'manifest is pinned to v2.3.3')
  t.equal(manifest.source, 'one local production build', 'all scenes come from one production build')
  t.match(manifest.buildArtifactSha256, /^[0-9a-f]{64}$/, 'manifest fingerprints the exact production JavaScript')
  t.equal(manifest.images.length, 6, 'manifest records six scenes')
  for (var name of names) {
    var png = path.join(assetDir, name + '.png')
    var webp = path.join(assetDir, name + '.webp')
    t.ok(fs.existsSync(png) && fs.statSync(png).size > 1000, name + ' has a high-resolution PNG')
    t.ok(fs.existsSync(webp) && fs.statSync(webp).size > 1000, name + ' has a WebP page asset')
  }
  t.end()
})

test('v2.3.0 through v2.3.2 release notes contain accessible, source-traceable screenshots', function (t) {
  var source = fs.readFileSync(sourcePath, 'utf8')
  t.ok(source.indexOf('const original = media.original || media.png') !== -1, 'the gallery supports source PNG and JPEG screenshots')
  t.ok(source.indexOf('Open high-resolution image') !== -1, 'the source-image link uses a format-neutral label')

  for (var release of Object.keys(historicalReleases)) {
    var expected = historicalReleases[release]
    var releaseDir = path.join(assetRoot, 'v' + release)
    var manifestPath = path.join(releaseDir, 'manifest.json')
    t.ok(source.indexOf("version: '" + release + "'") !== -1, 'v' + release + ' has a release entry')
    t.ok(fs.existsSync(manifestPath), 'v' + release + ' source manifest exists')
    if (!fs.existsSync(manifestPath)) continue

    var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    t.equal(manifest.release, release, 'v' + release + ' manifest is pinned to the release')
    t.equal(manifest.sourceDocument.documentId, expected.sourceDocumentId, 'v' + release + ' records the Google Doc source')
    t.equal(manifest.images.length, 6, 'v' + release + ' records six representative screenshots')

    for (var name of expected.names) {
      var image = manifest.images.find(function (entry) { return entry.id === name })
      t.ok(image, 'v' + release + ' records ' + name)
      if (!image) continue
      var original = path.join(releaseDir, image.original)
      var webp = path.join(releaseDir, image.webp)
      t.ok(source.indexOf('v' + release + '/' + image.original) !== -1, name + ' original is referenced')
      t.ok(source.indexOf('v' + release + '/' + image.webp) !== -1, name + ' WebP is referenced')
      t.ok(fs.existsSync(original) && fs.statSync(original).size > 1000, name + ' has an original source image')
      t.ok(fs.existsSync(webp) && fs.statSync(webp).size > 1000, name + ' has a WebP page asset')
      if (fs.existsSync(original)) t.equal(sha256(original), image.originalSha256, name + ' original matches its source manifest')
      if (fs.existsSync(webp)) t.equal(sha256(webp), image.webpSha256, name + ' WebP matches its source manifest')
    }
  }
  t.end()
})
