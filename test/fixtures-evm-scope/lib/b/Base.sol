pragma solidity ^0.8.20;
// `Both is Impl, IFace`: the interface is listed last, so a depth-first walk visits it FIRST.
interface IFace { function tell() external returns (uint256); }
contract Impl is IFace { function tell() public virtual returns (uint256) { return 1; } }
abstract contract Both is Impl, IFace {}
