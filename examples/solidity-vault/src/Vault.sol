// SPDX-License-Identifier: MIT
// A small yield vault, written to show what sourcetruth draws. Not production code.
pragma solidity ^0.8.20;

import "./Strategy.sol";

abstract contract Owned {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    function transferOwnership(address to) external onlyOwner { owner = to; }
}

contract Vault is Owned {
    IERC20 public immutable asset;
    IStrategy public strategy;
    mapping(address => uint256) public shares;
    mapping(address => bool) public keepers;
    uint256 public feeBps = 100;

    constructor(IERC20 _asset) { asset = _asset; owner = msg.sender; }

    function deposit(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += amount;
        _invest();
    }

    function withdraw(uint256 amount) external {
        shares[msg.sender] -= amount;
        strategy.withdraw(amount);
        asset.transfer(msg.sender, amount);
    }

    function harvest() external {
        _onlyKeeper();
        uint256 profit = strategy.harvest();
        _takeFee(profit);
        _invest();
    }

    function takeFee(uint256 amount) external { _takeFee(amount); }

    function setStrategy(IStrategy next) external onlyOwner { strategy = next; }
    function setKeeper(address keeper, bool allowed) external onlyOwner { keepers[keeper] = allowed; }

    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool ok, bytes memory out) = target.delegatecall(data);
        require(ok, "call failed");
        return out;
    }

    function _onlyKeeper() internal view {
        require(keepers[msg.sender], "not keeper");
    }

    function _invest() internal {
        uint256 idle = asset.balanceOf(address(this));
        if (idle > 0) {
            asset.transfer(address(strategy), idle);
            strategy.invest(idle);
        }
    }

    function _takeFee(uint256 amount) internal {
        asset.transfer(owner, amount * feeBps / 10_000);
    }
}
