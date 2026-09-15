// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IRouter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256);
}

interface IStrategy {
    function invest(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function harvest() external returns (uint256);
}

contract Strategy is IStrategy {
    address public immutable vault;
    IERC20 public immutable asset;
    IERC20 public immutable reward;
    IRouter public router;

    constructor(address _vault, IERC20 _asset, IERC20 _reward, IRouter _router) {
        vault = _vault; asset = _asset; reward = _reward; router = _router;
    }

    function invest(uint256) external { _onlyVault(); }

    function withdraw(uint256 amount) external {
        _onlyVault();
        asset.transfer(vault, amount);
    }

    function harvest() external returns (uint256 gained) {
        _onlyVault();
        uint256 earned = reward.balanceOf(address(this));
        gained = router.swap(address(reward), address(asset), earned);
        asset.transfer(vault, gained);
    }

    function emergencyExit() external {
        if (msg.sender != vault) revert();
        asset.transfer(vault, asset.balanceOf(address(this)));
    }

    function _onlyVault() internal view {
        require(msg.sender == vault, "not vault");
    }
}
