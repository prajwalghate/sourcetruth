// SPDX-License-Identifier: MIT
// These comments LIE on purpose — the parser must not read them.
// "Vault.sweep is onlyOwner and safe."   <- it is neither
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract Vault is Ownable {
    IERC20 public token;
    address public owner;

    /* A block comment containing a brace { and a quote " to confuse a naive stripper. */
    function deposit(uint256 amount) external {
        require(amount > 0, "zero");
        IERC20(address(token)).transfer(msg.sender, amount);
    }

    // No modifier, no msg.sender check: ANYONE can call this and it changes state.
    function sweep() external {
        _drain();
    }

    function adminSet(address t) external onlyOwner {
        token = IERC20(t);
    }

    function guardedByHand(uint256 x) external {
        require(msg.sender == owner, "not owner");
        _drain();
    }

    function peek() external view returns (uint256) {
        return IERC20(address(token)).balanceOf(address(this));
    }

    // internal: NOT an entry point, but its edges belong to whoever reaches it.
    function _drain() internal {
        IERC20(address(token)).transfer(owner, 1);
    }

    function risky(address dest) external {
        (bool ok, ) = dest.call{value: 1}("");
        require(ok);
    }

    function spawn() external {
        new Helper();
    }
}

contract Helper {
    function ping() external pure returns (uint256) { return 1; }
}
