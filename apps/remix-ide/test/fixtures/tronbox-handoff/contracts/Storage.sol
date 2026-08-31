// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Storage {
    uint256 private value;

    function store(uint256 nextValue) external {
        value = nextValue;
    }

    function retrieve() external view returns (uint256) {
        return value;
    }
}
