pragma solidity ^0.8.20;

interface IToken { function transfer(address to, uint256 v) external returns (bool); }
interface IReceiver { function onReceived(address operator, bytes memory data) external returns (bytes4); }
error Bad(address to);

library ReceiverUtils {
    // Like OpenZeppelin's ERC721Utils: a typed call, and an assembly block that only re-throws.
    function check(address operator, address to, bytes memory data) internal {
        if (to.code.length > 0) {
            try IReceiver(to).onReceived(operator, data) returns (bytes4 r) {
                if (r != IReceiver.onReceived.selector) revert Bad(to);
            } catch (bytes memory reason) {
                assembly ("memory-safe") { revert(add(32, reason), mload(reason)) }
            }
        }
    }
}

library RawLib {
    // The receiver of the Yul call is the SECOND parameter, and it has a contract type.
    function pushVia(address who, IToken t) internal {
        assembly { pop(call(gas(), t, 0, 0, 0, 0, 0)) }
        who;
    }
    function pushAddr(address t, uint256 v) internal {
        assembly { pop(call(gas(), t, v, 0, 0, 0, 0)) }
    }
    // sha256 lives at address 2: a precompile, not a contract anyone deploys.
    function digest(bytes memory b) internal returns (bytes32 out) {
        assembly { pop(staticcall(gas(), 2, add(b, 32), mload(b), 0, 32)) out := mload(0) }
    }
    function isContract(address a) internal view returns (bool) { return a.code.length > 0; }
}
