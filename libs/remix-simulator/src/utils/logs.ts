/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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

import gray from 'ansi-gray'
import timestamp from 'time-stamp'
import supportsColor from 'color-support'

function hasFlag (flag) {
  return ((typeof (process) !== 'undefined') && (process.argv.indexOf('--' + flag) !== -1))
}

function addColor (str) {
  if (this.hasFlag('no-color')) {
    return str
  }

  if (this.hasFlag('color')) {
    return gray(str)
  }

  if (supportsColor()) {
    return gray(str)
  }

  return str
}

function stdout (arg) {
  if (typeof (process) === 'undefined' || !process.stdout) return
  process.stdout.write(arg)
}

function stderr (arg) {
  if (typeof (process) === 'undefined' || process.stderr) return
  process.stderr.write(arg)
}

function getTimestamp () {
  const coloredTimestamp = this.addColor(timestamp('HH:mm:ss'))
  return '[' + coloredTimestamp + ']'
}

export function log (...args: any[]) {
  const time = this.getTimestamp()
  this.stdout(time + ' ')
  console.log(args)
  return this
}

export function info (...args: any[]) {
  const time = this.getTimestamp()
  this.stdout(time + ' ')
  console.info(args)
  return this
}

export function dir (...args: any[]) {
  const time = this.getTimestamp()
  this.stdout(time + ' ')
  console.dir(args)
  return this
}

export function warn (...args: any[]) {
  const time = this.getTimestamp()
  this.stderr(time + ' ')
  console.warn(args)
  return this
}

export function error (...args: any[]) {
  const time = this.getTimestamp()
  this.stderr(time + ' ')
  console.error(args)
  return this
}
