// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./Middle.sol";
import "./Interfaces.sol";
import "@inner/access/Owned.sol";
import "@vendor/Share.sol";
import "@gone/Missing.sol";

contract Flows is Middle, Owned, Share {
    using SafeLib for IToken;
    IStrategy public strategy;
    mapping(address => bool) public keepers;
    mapping(uint256 => IStrategy) public strategies;
    event statusChanged(uint256 v);

    constructor() { manager = msg.sender; }

    function setStrategy(IStrategy s) external { onlyManager(); strategy = s; }             // helper guard, inherited
    function maybeGuarded(uint256 v) external { if (v > 0) { onlyManager(); } emit statusChanged(v); }  // NOT credited
    function either() external { require(msg.sender == manager || msg.sender == owner, "no"); }
    function keeperOnly() external { require(keepers[msg.sender], "!keeper"); }
    function reversed() external { if (manager != msg.sender) revert(); }

    function viaStateVar() external { strategy.harvest(); }                                   // typed state var
    function viaParam(IStrategy s) external { s.harvest(); }                                  // typed param
    function viaLocal(address a) external { IStrategy s = IStrategy(a); s.harvest(); }        // typed local
    function viaMapping(uint256 i) external { strategies[i].harvest(); }                      // mapping value type
    function viaUsing(address to) external { token.safeTransfer(to, 1); }                     // using-for on a contract type
    function viaLibrary(address to) external { SafeLib.safeTransfer(token, to, 1); }          // static library call
    function pureMath(uint256 x) external pure returns (uint256) { return SafeLib.scaled(x); } // pure library: not a call
    function viaThis() external { this.viaStateVar(); }                                       // external self-call
    function sendsEth(address payable to) external { to.transfer(1); }                       // ETH send
    function unknownReceiver(bytes memory data) external { (abi.decode(data, (address))).code; blackBox().harvest(); }
    function multiLine() external {
        IStrategy(address(strategy))
            .harvest();
    }
    function overloaded() external { _over(); }
    function overloadedArg() external { _over(1); }
    function _over() internal { strategy.harvest(); }
    function _over(uint256) internal { token.transfer(manager, 1); }
    function throughHelper(address to) external { _move(to, 1); }                            // inherited helper's edge
    function _beforeDeposit(uint256) internal override { onlyManager(); strategy.harvest(); } // override the vendored hook
    function blackBox() internal view returns (IStrategy) { return strategy; }
}
