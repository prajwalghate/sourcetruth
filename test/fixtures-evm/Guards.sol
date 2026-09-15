// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A reentrancy lock, a liveness check and an unknown modifier are GUARDS, not principals. Every
// function below that carries only those is callable by anyone, and must be reported that way.
contract Guarded is ERC20 {
    bool private locked;
    address public admin;

    modifier nonReentrant() { require(!locked, "re"); locked = true; _; locked = false; }
    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier whenLive() { require(block.timestamp > 0, "dead"); _; }
    modifier gate() { require(_msgSender() == admin, "gate"); _; }

    constructor() ERC20("Name", "SYM") {}

    function withdrawAll() external nonReentrant { locked = false; }
    function setAdmin(address a) external onlyAdmin { admin = a; }
    function pokeLive() external whenLive { locked = false; }
    function mystery() external auth { locked = true; }
    function gated() external gate { locked = true; }
}
