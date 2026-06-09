'use strict'

function disabledBzzMethod () {
  return Promise.reject(new Error('web3.bzz is disabled in TronIDE'))
}

function Bzz () {}

Bzz.prototype.setProvider = function setProvider () {
  return true
}

Bzz.prototype.givenProvider = null
Bzz.prototype.currentProvider = null
Bzz.prototype.upload = disabledBzzMethod
Bzz.prototype.download = disabledBzzMethod
Bzz.prototype.pick = disabledBzzMethod

module.exports = Bzz

