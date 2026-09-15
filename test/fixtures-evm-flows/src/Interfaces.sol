// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IToken { function transfer(address to, uint256 amount) external returns (bool); function balanceOf(address a) external view returns (uint256); }
interface IStrategy { function harvest() external; function manager() external view returns (address); }
library SafeLib {
    function safeTransfer(IToken t, address to, uint256 a) internal { require(t.transfer(to, a)); }
    function scaled(uint256 x) internal pure returns (uint256) { return x * 2; }
}
