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
import * as txHelper from '../src/execution/txHelper'

tape('getFunction', function (st) {
  st.plan(6)
  let fn = txHelper.getFunction(JSON.parse(abi), 'o((address,uint256))')
  st.equal(fn.name, 'o')

  fn = txHelper.getFunction(JSON.parse(abi), 'i(bytes32)')
  st.equal(fn.name, 'i')

  fn = txHelper.getFunction(JSON.parse(abi), 'o1(string,(address,uint256),int256,int256[][3],(address,uint256)[3][])')
  st.equal(fn.name, 'o1')

  fn = txHelper.getConstructorInterface(JSON.parse(abi))
  st.equal(fn.type, 'constructor')

  fn = txHelper.getFallbackInterface(JSON.parse(abi))
  st.equal(fn.type, 'fallback')

  fn = txHelper.getReceiveInterface(JSON.parse(abi))
  st.equal(fn.type, 'receive')
})

tape('txHelper.encodeParams surfaces a missing required parameter by name and type', function (st) {
  st.plan(4)
  // Regression for f81047316: an under-supplied non-bool arg used to fail with a
  // cryptic `invalid BigNumber string (value="")` from the AbiCoder; a missing
  // bool used to silently encode `false` (a wrong-but-successful tx).
  st.throws(
    () => txHelper.encodeParams({ inputs: [{ name: 'amount', type: 'uint256' }] }, []),
    /Missing value for parameter "amount" \(uint256\)/,
    'missing uint256 names the parameter and its type'
  )
  st.throws(
    () => txHelper.encodeParams({ inputs: [{ name: 'flag', type: 'bool' }] }, []),
    /Missing value for bool parameter "flag"/,
    'missing bool keeps the bool-specific message'
  )
  st.throws(
    () => txHelper.encodeParams({ inputs: [{ name: '', type: 'address' }] }, []),
    /Missing value for parameter "arg0" \(address\)/,
    'an unnamed missing parameter falls back to argN'
  )
  st.doesNotThrow(
    () => txHelper.encodeParams({ inputs: [{ name: 'amount', type: 'uint256' }] }, ['1']),
    'a fully-supplied call encodes without the missing-parameter error'
  )
})

const abi = `[
	{
		"constant": false,
		"inputs": [
			{
				"name": "_param",
				"type": "bytes32"
			}
		],
		"name": "i",
		"outputs": [
			{
				"name": "_t",
				"type": "bytes32"
			}
		],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"constant": false,
		"inputs": [
			{
				"name": "_g",
				"type": "string"
			},
			{
				"components": [
					{
						"name": "addr",
						"type": "address"
					},
					{
						"name": "age",
						"type": "uint256"
					}
				],
				"name": "_p",
				"type": "tuple"
			},
			{
				"name": "_pg",
				"type": "int256"
			},
			{
				"name": "",
				"type": "int256[][3]"
			},
			{
				"components": [
					{
						"name": "addr",
						"type": "address"
					},
					{
						"name": "age",
						"type": "uint256"
					}
				],
				"name": "",
				"type": "tuple[3][]"
			}
		],
		"name": "o1",
		"outputs": [],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"constant": false,
		"inputs": [
			{
				"components": [
					{
						"name": "addr",
						"type": "address"
					},
					{
						"name": "age",
						"type": "uint256"
					}
				],
				"name": "_p",
				"type": "tuple"
			}
		],
		"name": "o",
		"outputs": [],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"name": "_g",
				"type": "bytes32"
			},
			{
				"components": [
					{
						"name": "addr",
						"type": "address"
					},
					{
						"name": "age",
						"type": "uint256"
					}
				],
				"name": "u",
				"type": "tuple"
			}
		],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "constructor"
	},
	{
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "fallback"
	},
	{
		"payable": true,
		"stateMutability": "payable",
		"type": "receive"
	}
]`
