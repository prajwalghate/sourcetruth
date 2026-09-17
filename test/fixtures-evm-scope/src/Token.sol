pragma solidity ^0.8.20;
import {ERC20 as SolmateERC20} from "@a/ERC20.sol";
import {ERC20} from "@b/ERC20.sol";
import {Both} from "@b/Base.sol";
import {ReceiverUtils, RawLib, IToken} from "@b/Utils.sol";

struct Quote { uint256 value; uint256 at; }
interface IOracle { function quote(address a) external view returns (Quote memory); }
library Math { function mulWad(uint256 a, uint256 b) internal pure returns (uint256) { return a * b / 1e18; } }

contract Token is ERC20, Both {
    using RawLib for address;
    using Math for uint256;
    IOracle public oracle;
    IToken public token;
    address public raw;

    function units(address a) external view returns (uint256) { return balanceOf(a); }
    function safeGive(address to, bytes calldata data) external { ReceiverUtils.check(msg.sender, to, data); }
    function pushTyped() external { RawLib.pushVia(raw, token); }
    function pushRaw() external { raw.pushAddr(1); }
    function digest(bytes memory b) external returns (bytes32) { return RawLib.digest(b); }
    function priced(address a) external view returns (uint256) { return oracle.quote(a).value.mulWad(2); }
    function fold(uint256 x) external returns (uint256) { return _apply(_double, x); }
    function unbound(function(uint256) pure returns (uint256) f, uint256 x) external returns (uint256) { return f(x); }
    function checkIt(address a) external returns (bool) { return a.isContract(); }

    function _apply(function(uint256) returns (uint256) f, uint256 x) internal returns (uint256) { return f(x); }
    function _double(uint256 x) internal returns (uint256) { token.transfer(raw, x); return x * 2; }
}
