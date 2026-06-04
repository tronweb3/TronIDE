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

'use strict'

var fs = require('fs')
var compiler = require('solc')
var compilerInput = require('@remix-project/remix-solidity').CompilerInput
var defaultVersion = 'soljson_v0.8.6+commit.0e36fba.js'
const path = require('path')

compiler.loadRemoteVersion(defaultVersion, (error, solcSnapshot) => {
  console.log('solcSnapshot: ', solcSnapshot)
  if (error) console.log(error)
  var compilationResult = {}
  const testsFolder = path.resolve(__dirname + '/../test-browser/tests/') + '/' // eslint-disable-line

  gatherCompilationResults(testsFolder, compilationResult, solcSnapshot)
  replaceSolCompiler(compilationResult, solcSnapshot)
})

function gatherCompilationResults (dir, compilationResult, solcSnapshot) {
  var filenames = fs.readdirSync(dir, 'utf8')
  filenames.map(function (item, i) {
    if (item.endsWith('.js')) {
      var testDef = require(dir + item)
      if ('@sources' in testDef) {
        var sources = testDef['@sources']()
        for (var files in sources) {
          compile(solcSnapshot, sources[files], true, function (result) {
            compilationResult[result.key] = result
          })
          compile(solcSnapshot, sources[files], false, function (result) {
            compilationResult[result.key] = result
          })
        }
      }
    }
  })
  return compilationResult
}

function compile (solcSnapshot, source, optimization, runs, addCompilationResult) {
  var missingInputs = []
  try {
    var input = compilerInput(source, {optimize: optimization, runs: runs})
    var result = solcSnapshot.compileStandardWrapper(input, function (path) {
      missingInputs.push(path)
    })
    input = input.replace(/(\t)|(\n)|(\\n)|( )/g, '')
  } catch (e) {
    console.log(e)
  }
  if (result && (result.error || (result.errors && result.errors.length > 0))) {
    console.log(result.error, result.errors)
  }
  if (result) {
    console.log(result.error, result.errors)
  }
  var ret = {
    key: input,
    source: source,
    optimization: optimization,
    missingInputs: missingInputs,
    result: result
  }
  addCompilationResult(ret)
}

function replaceSolCompiler (results, solcSnapshot) {
  const compilerPath = path.resolve(__dirname + '/../test-browser/mockcompiler/compiler.js') // eslint-disable-line
  const soljsonPath = path.resolve(__dirname + '/../soljson.js') // eslint-disable-line

  fs.readFile(compilerPath, 'utf8', function (error, data) {
    if (error) {
      console.log(error)
      process.exit(1)
      return
    }
    console.log(solcSnapshot.version())
    data = data + '\n\nvar mockCompilerVersion = \'' + solcSnapshot.version() + '\''
    data = data + '\n\nvar mockData = ' + JSON.stringify(results) + ';\n'
    fs.writeFile(soljsonPath, data, 'utf8', function (error) {
      if (error) {
        console.log(error)
        process.exit(1)
        return
      }
    })
  })
}
