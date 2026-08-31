const DEFAULT_COOLDOWN_MS = 650

// A leading-edge guard is safer than a plain debounce for Home actions: the
// first click runs immediately, while duplicate clicks are ignored until the
// action settles and the short cooldown has elapsed.
export class HomeActionGate {
  constructor (options = {}) {
    this.cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : DEFAULT_COOLDOWN_MS
    this.actions = new Map()
  }

  run (key, action, element) {
    const now = Date.now()
    const active = this.actions.get(key)
    if (active && (active.pending || now < active.releaseAt)) return active.promise

    const state = {
      element,
      pending: true,
      promise: null,
      releaseAt: now + this.cooldownMs,
      timer: null,
      wasDisabled: Boolean(element && 'disabled' in element && element.disabled)
    }
    this.actions.set(key, state)
    this._setBusy(state, true)

    let result
    try {
      result = action()
    } catch (error) {
      result = Promise.reject(error)
    }

    state.promise = Promise.resolve(result)
    const settle = () => {
      state.pending = false
      if (this.actions.get(key) !== state) return
      const remaining = Math.max(0, state.releaseAt - Date.now())
      state.timer = setTimeout(() => this._release(key, state), remaining)
    }
    // Provide both handlers so cleanup also runs after a rejection without
    // creating a second unhandled rejected promise.
    state.promise.then(settle, settle)
    return state.promise
  }

  clear () {
    this.actions.forEach((state) => {
      if (state.timer) clearTimeout(state.timer)
      this._setBusy(state, false)
    })
    this.actions.clear()
  }

  _release (key, state) {
    if (this.actions.get(key) !== state) return
    this.actions.delete(key)
    this._setBusy(state, false)
  }

  _setBusy (state, busy) {
    const element = state.element
    if (!element) return
    if ('disabled' in element) element.disabled = busy ? true : state.wasDisabled
    if (busy) {
      element.setAttribute('aria-busy', 'true')
      if (!('disabled' in element)) element.setAttribute('aria-disabled', 'true')
    } else {
      element.removeAttribute('aria-busy')
      if (!('disabled' in element)) element.removeAttribute('aria-disabled')
    }
  }
}
