// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./Interfaces.sol";
// The guard is a plain FUNCTION, two levels up — not a modifier.
abstract contract Base {
    address public manager;
    IToken public token;
    function onlyManager() internal view { require(msg.sender == manager, "!manager"); }
    function _move(address to, uint256 a) internal { token.transfer(to, a); }
}
