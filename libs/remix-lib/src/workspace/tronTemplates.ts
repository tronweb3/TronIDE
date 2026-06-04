export interface TronTemplate {
  id: string
  name: string
  path: string
  description: string
  content: string
}

export const TRON_TEMPLATES: TronTemplate[] = [
  {
    id: 'simple-storage',
    name: 'SimpleStorage',
    path: 'contracts/SimpleStorage.sol',
    description: 'Minimal storage contract for Nile or local VM deployment.',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 private value;

    function set(uint256 newValue) public {
        value = newValue;
    }

    function get() public view returns (uint256) {
        return value;
    }
}
`
  },
  {
    id: 'trc10-receiver',
    name: 'TRC10 Receiver',
    path: 'contracts/TRC10Receiver.sol',
    description: 'Example contract documenting TRC10 tokenValue/tokenId deploy and call tests.',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TRC10Receiver {
    event Received(address indexed sender, uint256 callValue, uint256 tokenValue);

    function receiveToken(uint256 tokenValue) public payable {
        emit Received(msg.sender, msg.value, tokenValue);
    }
}
`
  },
  {
    id: 'trc20-minimal',
    name: 'TRC20 Minimal',
    path: 'contracts/TRC20Minimal.sol',
    description: 'Minimal TRC20-style token for compile and deploy smoke tests.',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TRC20Minimal {
    string public name = "TRC20 Minimal";
    string public symbol = "T20";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;

    constructor(uint256 initialSupply) {
        balanceOf[msg.sender] = initialSupply;
    }
}
`
  },
  {
    id: 'library-deploy',
    name: 'Library Deployment',
    path: 'contracts/LibraryDeployment.sol',
    description: 'Library linking smoke template.',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library MathLib {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
}

contract LibraryDeployment {
    function sum(uint256 a, uint256 b) public pure returns (uint256) {
        return MathLib.add(a, b);
    }
}
`
  }
]

export function getTronTemplate (id: string): TronTemplate | undefined {
  return TRON_TEMPLATES.find((template) => template.id === id)
}
