// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Vendored, and only reachable through a NESTED dependency: the remapping target lib/inner is absent.
abstract contract Owned {
    address public owner;
    modifier onlyOwned() { _checkOwned(); _; }
    function _checkOwned() internal view { if (owner != msg.sender) revert(); }
    function transferOwned(address to) public onlyOwned { owner = to; }
}
