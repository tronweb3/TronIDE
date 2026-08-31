/*
 * Focused regression coverage for terminal Enter event handling.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function extractFunction (source, signature) {
  var start = source.indexOf(signature)
  if (start === -1) throw new Error(`Missing ${signature}`)

  var openingBrace = source.indexOf('{', start)
  var depth = 0
  for (var index = openingBrace; index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] === '}') depth--
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new Error(`Unterminated ${signature}`)
}

test('Terminal Enter consumes the key event and executes one command', function (t) {
  var source = fs.readFileSync(path.join(__dirname, '../src/app/panels/terminal.js'), 'utf8')
  var wrapScript = extractFunction(source, 'function wrapScript (script)')
  var changeHandler = extractFunction(source, 'function change (event)')
  var executedScripts = []
  var prevented = 0
  var stopped = 0
  var removedAutocomplete = 0
  var terminal = {
    _cmdIndex: 4,
    _cmdTemp: 'stale',
    _cmdHistory: [],
    _view: { input: { innerText: '2 + 2' } },
    _components: {
      autoCompletePopup: {
        handleAutoComplete: function () { return false },
        removeAutoComplete: function () { removedAutocomplete++ }
      }
    },
    commands: {
      script: function (script) { executedScripts.push(script) }
    }
  }
  var change = new Function('self', `${wrapScript}\n${changeHandler}\nreturn change`)(terminal) // eslint-disable-line no-new-func

  change({
    which: 13,
    ctrlKey: false,
    preventDefault: function () { prevented++ },
    stopPropagation: function () { stopped++ }
  })

  t.equal(prevented, 1, 'plain Enter prevents the contenteditable default')
  t.equal(stopped, 1, 'plain Enter cannot bubble into a synchronously opened modal')
  t.equal(executedScripts.length, 1, 'the terminal command still executes exactly once')
  t.ok(executedScripts[0].includes('2 + 2'), 'the entered command reaches the script runner')
  t.deepEqual(terminal._cmdHistory, ['2 + 2'], 'the command is recorded once in history')
  t.equal(terminal._view.input.innerText, '\n', 'the terminal input is cleared')
  t.equal(removedAutocomplete, 1, 'autocomplete cleanup still runs once')
  t.end()
})

test('Terminal Git commands fail explicitly instead of becoming silent no-ops', function (t) {
  var source = fs.readFileSync(path.join(__dirname, '../src/app/panels/terminal.js'), 'utf8')
  var predicateSource = extractFunction(source, 'function isTerminalGitCommand (script)')
  var isTerminalGitCommand = new Function(`return (${predicateSource})`)() // eslint-disable-line no-new-func

  t.ok(isTerminalGitCommand('git status'), 'git status is recognized as the disabled native bridge')
  t.ok(isTerminalGitCommand('  git log --oneline  '), 'surrounding whitespace does not bypass the guard')
  t.notOk(isTerminalGitCommand('github'), 'ordinary scripts beginning with git are not swallowed')
  t.ok(/Terminal Git commands are unavailable\. Use the Git panel/.test(source), 'the terminal gives users an actionable error')
  t.notOk(/this\.call\('git',\s*'execute'/.test(source), 'the discontinued native Git service is not called')
  t.end()
})
