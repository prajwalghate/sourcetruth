// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// A vendored parent whose public deposit() calls a hook the child overrides.
abstract contract Share {
    function deposit(uint256 amount) public virtual { _beforeDeposit(amount); }
    function _beforeDeposit(uint256 amount) internal virtual {}
}
