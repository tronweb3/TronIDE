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

import * as WS from 'ws'
import * as http from 'http'
import { WebsocketOpt, ServiceClient } from './types' // eslint-disable-line
import { getDomain } from './utils'
import { createClient } from '@remixproject/plugin-ws'
export default class WebSocket {
  server: http.Server
  wsServer: WS.Server

  constructor (public port: number, public opt: WebsocketOpt, public getclient: () => ServiceClient) {} //eslint-disable-line

  start (callback?: (ws: WS, client: ServiceClient, error?: Error) => void): void {
    this.server = http.createServer((request, response) => {
      console.log((new Date()) + ' Received request for ' + request.url)
      response.writeHead(404)
      response.end()
    })
    const loopback = '127.0.0.1'
    const listeners = {
      65520: 'remixd',
      65521: 'git',
      65522: 'hardhat',
      65523: 'slither'
    }

    this.server.on('error', (error: Error) => {
      if (callback)callback(null, null, error)
    })

    this.server.listen(this.port, loopback, () => {
      console.log('\x1b[32m%s\x1b[0m', `[INFO] ${new Date()} ${listeners[this.port]} is listening on ${loopback}:${this.port}`)
    })

    this.wsServer = new WS.Server({
      server: this.server,
      verifyClient: (info, done) => {
        if (!originIsAllowed(info.origin, this)) {
          done(false)
          console.log(`${new Date()} connection from origin  ${info.origin}`)
          return
        }
        done(true)
      }
    })
    this.wsServer.on('connection', (ws) => {
      const client = this.getclient()

      createClient(ws, client as any)
      if (callback) callback(ws, client)
    })
  }

  close (): void {
    if (this.wsServer) {
      this.wsServer.close(() => {
        this.server.close()
      })
    }
  }
}

function originIsAllowed (origin: string, self: WebSocket): boolean {
  if (self.opt.remixIdeUrl) {
    if (self.opt.remixIdeUrl.endsWith('/')) self.opt.remixIdeUrl = self.opt.remixIdeUrl.slice(0, -1)
    return origin === self.opt.remixIdeUrl || origin === getDomain(self.opt.remixIdeUrl)
  } else {
    try {
      // eslint-disable-next-line
      const origins = require('./origins.json')
      const domain = getDomain(origin)
      const { data } = origins

      if (data.includes(origin) || data.includes(domain)) {
        self.opt.remixIdeUrl = origin
        console.log('\x1b[33m%s\x1b[0m', '[WARN] You may now only use IDE at ' + self.opt.remixIdeUrl + ' to connect to that instance')
        return true
      } else {
        return false
      }
    } catch (e) {
      return false
    }
  }
}
