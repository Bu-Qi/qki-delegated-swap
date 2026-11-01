// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Matches the observed QANB behavior: sender balance AND allowance include the extra fee.
contract SenderTaxToken is ERC20 {
    uint256 public senderFeeBps;
    uint256 public receiverFeeBps;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentrySucceeded;
    bool public rejectZero;
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint256 senderFee, uint256 receiverFee, bool rejectZero_) external {
        senderFeeBps = senderFee;
        receiverFeeBps = receiverFee;
        rejectZero = rejectZero_;
    }
    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        require(!rejectZero || value != 0, "ZERO_TRANSFER");
        _spendAllowance(from, msg.sender, value + value * senderFeeBps / 10_000);
        if (reentryTarget != address(0)) (reentrySucceeded,) = reentryTarget.call(reentryData);
        _transfer(from, to, value);
        return true;
    }
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) { super._update(from, to, value); return; }
        uint256 senderFee = value * senderFeeBps / 10_000;
        uint256 receiverFee = value * receiverFeeBps / 10_000;
        super._update(from, to, value - receiverFee);
        if (senderFee + receiverFee != 0) super._update(from, address(0), senderFee + receiverFee);
    }
}

contract ConstantProductPair {
    using SafeERC20 for IERC20;
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private stamp;
    bool private locked;
    constructor(address a, address b) { token0 = a < b ? a : b; token1 = a < b ? b : a; }
    function getReserves() external view returns (uint112, uint112, uint32) { return (reserve0, reserve1, stamp); }
    function sync() external { _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this))); }
    function swap(uint256 out0, uint256 out1, address to, bytes calldata) external {
        require(!locked, "LOCKED"); locked = true;
        require(out0 != 0 || out1 != 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        require(out0 < reserve0 && out1 < reserve1, "INSUFFICIENT_LIQUIDITY");
        require(to != token0 && to != token1, "INVALID_TO");
        if (out0 != 0) IERC20(token0).safeTransfer(to, out0);
        if (out1 != 0) IERC20(token1).safeTransfer(to, out1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 in0 = b0 > uint256(reserve0) - out0 ? b0 - (uint256(reserve0) - out0) : 0;
        uint256 in1 = b1 > uint256(reserve1) - out1 ? b1 - (uint256(reserve1) - out1) : 0;
        require(in0 != 0 || in1 != 0, "INSUFFICIENT_INPUT_AMOUNT");
        require((b0 * 1000 - in0 * 3) * (b1 * 1000 - in1 * 3) >= uint256(reserve0) * reserve1 * 1_000_000, "K");
        _update(b0, b1); locked = false;
    }
    function _update(uint256 b0, uint256 b1) private {
        require(b0 <= type(uint112).max && b1 <= type(uint112).max, "OVERFLOW");
        reserve0 = uint112(b0); reserve1 = uint112(b1); stamp = uint32(block.timestamp);
    }
}

contract ConstantProductFactory {
    mapping(address => mapping(address => address)) public getPair;
    function createPair(address a, address b) external returns (address pair) {
        require(a != b && getPair[a][b] == address(0), "INVALID_PAIR");
        pair = address(new ConstantProductPair(a, b)); getPair[a][b] = pair; getPair[b][a] = pair;
    }
}

contract ConstantProductQuoteRouter {
    address public immutable factory;
    constructor(address factory_) { factory = factory_; }
    function getAmountOut(uint256 amount, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amount != 0 && reserveIn != 0 && reserveOut != 0, "BAD_QUOTE");
        return amount * 997 * reserveOut / (reserveIn * 1000 + amount * 997);
    }
    function getAmountsOut(uint256 amount, address[] calldata path) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length); amounts[0] = amount;
        for (uint256 i; i + 1 < path.length; ++i) {
            ConstantProductPair p = ConstantProductPair(ConstantProductFactory(factory).getPair(path[i], path[i + 1]));
            (uint112 r0, uint112 r1,) = p.getReserves();
            amounts[i + 1] = getAmountOut(amounts[i], path[i] == p.token0() ? r0 : r1, path[i] == p.token0() ? r1 : r0);
        }
    }
}
