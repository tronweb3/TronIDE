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

module.exports = {
  contract: `
contract miscLocal {
        enum enumDef {
            one,
            two, 
            three, 
            four
        }
        constructor () public {
            bool boolFalse = false;
            bool boolTrue = true;
            enumDef testEnum;
            testEnum = enumDef.three;
            address sender = msg.sender;
            bytes1 _bytes1 = hex"99";
            bytes1 __bytes1 = hex"99";
            bytes2 __bytes2 = hex"99AB";
            bytes4 __bytes4 = hex"99FA";
            bytes6 __bytes6 = hex"99";
            bytes7 __bytes7 = hex"993567";
            bytes8 __bytes8 = hex"99ABD417";
            bytes9 __bytes9 = hex"99156744AF";
            bytes13 __bytes13 = hex"991234234253";
            bytes16 __bytes16 = hex"99AFAD234324";
            bytes24 __bytes24 = hex"99AFAD234324";
            bytes32 __bytes32 = hex"9999ABD41799ABD417";
        }
  }

  contract miscLocal2 {
      constructor () public {
           bytes memory dynbytes = "dynamicbytes";
           string memory smallstring = "test_test_test";
        }
  }
`
}
