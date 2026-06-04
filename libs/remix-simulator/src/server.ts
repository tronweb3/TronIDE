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

import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import expressWs from 'express-ws'
import { Provider } from './provider'
import { log } from './utils/logs'
const app = express()

class Server {
  provider
  rpcOnly

  constructor (options) {
    this.provider = new Provider(options)
    this.provider
      .init()
      .then(() => {
        log('Provider initiated')
      })
      .catch((error) => {
        log(error)
      })
    this.rpcOnly = options.rpc
  }

  start (host, port) {
    const wsApp = expressWs(app)

    app.use(cors())
    app.use(bodyParser.urlencoded({ extended: true }))
    app.use(bodyParser.json())

    app.get('/', (req, res) => {
      res.send('Welcome to remix-simulator')
    })

    if (this.rpcOnly) {
      app.use((req, res) => {
        this.provider.sendAsync(req.body, (err, jsonResponse) => {
          if (err) {
            return res.send(JSON.stringify({ error: err }))
          }
          res.send(jsonResponse)
        })
      })
    } else {
      wsApp.app.ws('/', (ws, req) => {
        ws.on('message', (msg) => {
          this.provider.sendAsync(JSON.parse(msg.toString()), (err, jsonResponse) => {
            if (err) {
              return ws.send(JSON.stringify({ error: err }))
            }
            ws.send(JSON.stringify(jsonResponse))
          })
        })

        this.provider.on('data', (result) => {
          ws.send(JSON.stringify(result))
        })
      })
    }

    app.listen(port, host, () => {
      log('Remix Simulator listening on ws://' + host + ':' + port)
      if (!this.rpcOnly) {
        log('http json-rpc is deprecated and disabled by default. To enable it use --rpc')
      }
    })
  }
}

module.exports = Server
