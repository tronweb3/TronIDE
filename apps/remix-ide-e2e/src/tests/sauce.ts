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


// const https = require('https')

export default function sauce (callback: VoidFunction): void {
  if (typeof callback === 'function') return callback()
  /*
  const currentTest = this.client.currentTest
  const username = this.client.options.username
  const sessionId = this.client.capabilities['webdriver.remote.sessionid']
  const accessKey = this.client.options.accessKey

  if (!username || !accessKey || !sessionId) {
    console.log(this.client)
    console.log('No username, accessKey or sessionId')
    return callback()
  }

  const passed = currentTest.results.passed === currentTest.results.tests

  const data = JSON.stringify({passed})

  const requestPath = `/rest/v1/${username}/jobs/${sessionId}`

  function responseCallback (res) {
    res.setEncoding('utf8')
    console.log('Response: ', res.statusCode, JSON.stringify(res.headers))
    res.on('data', function onData (chunk) {
      console.log('BODY: ' + chunk)
    })
    res.on('end', function onEnd () {
      console.info('Finished updating saucelabs')
      callback()
    })
  }

  try {
    console.log('Updating saucelabs', requestPath)

    const req = https.request({
      hostname: 'saucelabs.com',
      path: requestPath,
      method: 'PUT',
      auth: `${username}:${accessKey}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, responseCallback)

    req.on('error', function onError (e) {
      console.log('problem with request: ' + e.message)
    })
    req.write(data)
    req.end()
  } catch (error) {
    console.log('Error', error)
    callback()
  }
  */
}
