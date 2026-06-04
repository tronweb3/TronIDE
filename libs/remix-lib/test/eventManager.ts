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
import tape from 'tape'
import { EventManager } from '../src/eventManager'
tape('eventManager', function (t) {
  t.test('eventManager', function (st) {
    const events = new EventManager()
    const listenner = {}

    let trace = ''
    listenner['listen'] = function (data1) {
      trace += data1
    }
    const registeredFunction = function (data) {
      trace += data
    }
    events.register('event1', listenner, listenner['listen'])
    events.register('event2', registeredFunction, null)
    events.trigger('event1', ['event1'])
    events.trigger('event2', ['event2'])
    st.equal(trace, 'event1event2')

    events.unregister('event1', listenner['listen'], null)
    st.equal(events.registered['event1'].length, 1)
    st.equal(events.registered['event2'].length, 1)

    events.unregister('event1', listenner, listenner['listen'])
    st.equal(events.registered['event1'].length, 0)
    st.equal(events.registered['event2'].length, 1)

    events.unregister('event2', registeredFunction, null)
    st.equal(events.registered['event1'].length, 0)
    st.equal(events.registered['event2'].length, 0)
    st.end()
  })
})
