// An OpenZeppelin-style token: balanceOf is a function.
pragma solidity ^0.8.20;
contract ERC20 {
    mapping(address => uint256) private _b;
    function balanceOf(address a) public view virtual returns (uint256) { return _b[a]; }
}
