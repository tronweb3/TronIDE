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

export class EventManager {
  registered
  anonymous

  constructor () {
    this.registered = {}
    this.anonymous = {}
  }

  /*
    * Unregister a listener.
    * Note that if obj is a function. the unregistration will be applied to the dummy obj {}.
    *
    * @param {String} eventName  - the event name
    * @param {Object or Func} obj - object that will listen on this event
    * @param {Func} func         - function of the listeners that will be executed
  */
  unregister (eventName, obj, func) {
    if (!this.registered[eventName]) {
      return
    }
    if (obj instanceof Function) {
      func = obj
      obj = this.anonymous
    }
    for (const reg in this.registered[eventName]) {
      if ((this.registered[eventName][reg].obj === obj) && (this.registered[eventName][reg].func.toString() === func.toString())) {
        this.registered[eventName].splice(reg, 1)
      }
    }
  }

  /*
    * Register a new listener.
    * Note that if obj is a function, the function registration will be associated with the dummy object {}
    *
    * @param {String} eventName  - the event name
    * @param {Object or Func} obj - object that will listen on this event
    * @param {Func} func         - function of the listeners that will be executed
  */
  register (eventName, obj, func) {
    if (!this.registered[eventName]) {
      this.registered[eventName] = []
    }
    if (obj instanceof Function) {
      func = obj
      obj = this.anonymous
    }
    this.registered[eventName].push({ obj, func })
  }

  /*
    * trigger event.
    * Every listener have their associated function executed
    *
    * @param {String} eventName  - the event name
    * @param {Array}j - argument that will be passed to the executed function.
  */
  trigger (eventName, args) {
    if (!this.registered[eventName]) {
      return
    }
    for (const listener in this.registered[eventName]) {
      const l = this.registered[eventName][listener]
      if (l.func) l.func.apply(l.obj === this.anonymous ? {} : l.obj, args)
    }
  }
}
