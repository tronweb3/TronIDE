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
import * as crypto from 'crypto'
import { WebsocketOpt, ServiceClient } from './types' // eslint-disable-line
import { getDomain } from './utils'
import { createClient } from '@remixproject/plugin-ws'
export default class WebSocket {
  server: http.Server
  wsServer: WS.Server
  private readonly sessionToken: string

  constructor (public port: number, public opt: WebsocketOpt, public getclient: () => ServiceClient) { //eslint-disable-line
    this.sessionToken = crypto.randomBytes(16).toString('hex')
  }

  start (callback?: (ws: WS, client: ServiceClient, error?: Error) => void): void {
    this.server = http.createServer((request, response) => {
      if (request.url === '/remixd-token' && request.method === 'GET') {
        const origin = typeof request.headers.origin === 'string' ? request.headers.origin : ''
        if (!originIsAllowed(origin, this)) {
          response.writeHead(403)
          response.end()
          return
        }
        response.setHeader('Access-Control-Allow-Origin', origin)
        response.setHeader('Vary', 'Origin')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/json')
        response.writeHead(200)
        response.end(JSON.stringify({ token: this.sessionToken }))
        return
      }
      // Do not log request.url: WebSocket upgrade URLs contain the session token.
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
        const token = sessionTokenFromUrl(info.req.url)
        if (!token || !safeTokenEqual(token, this.sessionToken)) {
          done(false)
          console.log(`${new Date()} rejected remixd connection with invalid session token`)
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

function sessionTokenFromUrl (rawUrl: string | undefined): string | null {
  if (typeof rawUrl !== 'string') return null
  try {
    const parsed = new URL(rawUrl, 'http://127.0.0.1')
    const token = parsed.searchParams.get('remixdToken')
    return token && /^[0-9a-f]{32}$/i.test(token) ? token : null
  } catch (e) {
    return null
  }
}

function safeTokenEqual (provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
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
