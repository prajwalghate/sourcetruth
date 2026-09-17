// A solmate-style token: balanceOf is a public mapping, not a function.
pragma solidity ^0.8.20;
contract ERC20 {
    mapping(address => uint256) public balanceOf;
}
