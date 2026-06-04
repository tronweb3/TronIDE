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
import { TraceManager } from '../src/trace/traceManager'
import { CodeManager } from '../src/code/codeManager'
import { SourceLocationTracker } from '../src/source/sourceLocationTracker'
import { compilerInput } from './helpers/compilerHelper'
const web3Test = require('./resources/testWeb3.ts')
const compiler = require('solc')

tape('SourceLocationTracker', function (t) {
  t.test('SourceLocationTracker.getSourceLocationFromVMTraceIndex - simple contract', async function (st) {
    const traceManager = new TraceManager({ web3: web3Test })
    const codeManager = new CodeManager(traceManager)

    let output = compiler.compile(compilerInput(contracts))
    output = JSON.parse(output)

    codeManager.codeResolver.cacheExecutingCode('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', '0x' + output.contracts['test.sol']['test'].evm.deployedBytecode.object)

    const tx = web3Test.eth.getTransaction('0x20ef65b8b186ca942fcccd634f37074dde49b541c27994fc7596740ef44cfd52')

    traceManager.resolveTrace(tx).then(async () => {
      const sourceLocationTracker = new SourceLocationTracker(codeManager, { debugWithGeneratedSources: false })

      try {
        const map = await sourceLocationTracker.getSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 0, output.contracts)
        st.equal(map['file'], 0)
        st.equal(map['start'], 0)
      } catch (e) {
        console.log(e)
      }
      st.end()
    }).catch((e) => {
      t.fail(' - traceManager.resolveTrace - failed ')
      console.error(e)
    })
  })

  t.test('SourceLocationTracker.getSourceLocationFromVMTraceIndex - ABIEncoder V2 contract', { skip: true }, async function (st) {
    const traceManager = new TraceManager({ web3: web3Test })
    const codeManager = new CodeManager(traceManager)

    let output = compiler.compile(compilerInput(ABIEncoderV2))
    output = JSON.parse(output)

    codeManager.codeResolver.cacheExecutingCode('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', '0x' + output.contracts['test.sol']['test'].evm.deployedBytecode.object)

    const tx = web3Test.eth.getTransaction('0x20ef65b8b186ca942fcccd634f37074dde49b541c27994fc7596740ef44cfd53')

    traceManager.resolveTrace(tx).then(async () => {
      try {
        // with debugWithGeneratedSources: false
        const sourceLocationTracker = new SourceLocationTracker(codeManager, { debugWithGeneratedSources: false })

        let map = await sourceLocationTracker.getSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 0, output.contracts)
        console.log(map)
        st.equal(map['file'], 0)
        st.equal(map['start'], 35)

        map = await sourceLocationTracker.getSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 59, output.contracts)
        st.equal(map['file'], 1) // 1 refers to the generated source (pragma experimental ABIEncoderV2)

        map = await sourceLocationTracker.getValidSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 59, output.contracts)
        st.equal(map['file'], 0) // 1 refers to the generated source (pragma experimental ABIEncoderV2)
        st.equal(map['start'], 303)
        st.equal(map['length'], 448)

        map = await sourceLocationTracker.getValidSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 50, output.contracts)
        st.equal(map['file'], 0) // 0 refers to the initial solidity code. see source below (ABIEncoderV2)
        st.equal(map['start'], 303)
        st.equal(map['length'], 448)
      } catch (e) {
        console.log(e)
      }

      try {
        // with debugWithGeneratedSources: true
        const sourceLocationTracker = new SourceLocationTracker(codeManager, { debugWithGeneratedSources: true })

        let map = await sourceLocationTracker.getSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 0, output.contracts)
        console.log(map)
        st.equal(map['file'], 0)
        st.equal(map['start'], 35)

        map = await sourceLocationTracker.getSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 59, output.contracts)
        st.equal(map['file'], 1) // 1 refers to the generated source (pragma experimental ABIEncoderV2)

        map = await sourceLocationTracker.getValidSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 59, output.contracts)
        st.equal(map['file'], 1) // 1 refers to the generated source (pragma experimental ABIEncoderV2)
        st.equal(map['start'], 1632)
        st.equal(map['length'], 32)

        map = await sourceLocationTracker.getValidSourceLocationFromVMTraceIndex('0x0d3a18d64dfe4f927832ab58d6451cecc4e517c5', 50, output.contracts)
        st.equal(map['file'], 0) // 0 refers to the initial solidity code. see source below (ABIEncoderV2)
        st.equal(map['start'], 303)
        st.equal(map['length'], 448)
      } catch (e) {
        console.log(e)
      }
      st.end()
    }).catch(() => {
      t.fail(' - traceManager.resolveTrace - failed ')
    })
  })
})

const contracts = `contract test {
    function f1() public returns (uint) {
        uint t = 4;
        return t;
    }
    
    function f2() public {
        
    }
}
`

const ABIEncoderV2 = `pragma experimental ABIEncoderV2;

contract test {
    // 000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000015b38da6a701c568545dcfcb03fcb875f56beddc4
    // 0000000000000000000000000000000000000000000000000000000000000002
    function testg (bytes calldata userData) external returns (bytes memory, bytes32, bytes32, uint) {
        bytes32 idAsk = abi.decode(userData[:33], (bytes32));
        bytes32 idOffer = abi.decode(userData[32:64], (bytes32));
        // bytes4 sellerAddress = abi.decode(userData[:4], (bytes4));       
        bytes memory ro  = abi.encodePacked(msg.sender, msg.sender, idAsk, idOffer);
        return (ro, idAsk, idOffer, userData.length);
    }
    
    
    function testgp (bytes calldata userData) external returns (bytes4) {
        return  abi.decode(userData[:4], (bytes4));
    }
}
`
