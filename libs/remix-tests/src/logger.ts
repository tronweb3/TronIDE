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

import colors from 'colors'
import winston, { Logger, LoggerOptions } from 'winston'
import timestamp from 'time-stamp'
import supportsColor from 'color-support'

function hasFlag (flag: string) {
  return ((typeof (process) !== 'undefined') && (process.argv.indexOf('--' + flag) !== -1))
}

function addColor (str: string) {
  if (hasFlag('no-color')) {
    return str
  }

  if (hasFlag('color')) {
    return colors.gray(str)
  }

  if (supportsColor()) {
    return colors.gray(str)
  }

  return str
}
function getTimestamp () {
  return '[' + addColor(timestamp('HH:mm:ss')) + ']'
}
// create winston logger format
const logFmt = winston.format.printf((info) => {
  return `${getTimestamp()} ${info.level}: ${info.message}`
})

class Log {
  logger: Logger
  constructor () {
    this.logger = winston.createLogger({
      level: 'info',
      transports: [new winston.transports.Console()],
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        logFmt
      )
    })
  }

  setVerbosity (v: LoggerOptions['level']): void {
    this.logger.configure({
      level: v,
      transports: [new winston.transports.Console()],
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        logFmt
      )
    })
  }
}

export default Log
