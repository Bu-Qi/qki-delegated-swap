// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockToken is ERC20 {
    uint256 public feeBps;
    uint256 public extraSenderFeeBps;
    bool public zeroFirst;
    bool public returnFalse;

    constructor(string memory name_) ERC20(name_, name_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint256 fee, uint256 extraFee, bool zeroFirst_, bool returnFalse_) external {
        feeBps = fee;
        extraSenderFeeBps = extraFee;
        zeroFirst = zeroFirst_;
        returnFalse = returnFalse_;
    }
    function approve(address spender, uint256 amount) public override returns (bool) {
        require(!zeroFirst || amount == 0 || allowance(msg.sender, spender) == 0, "ZERO_FIRST");
        return super.approve(spender, amount);
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (returnFalse) return false;
        return super.transferFrom(from, to, value);
    }
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = value * feeBps / 10_000;
        uint256 extra = value * extraSenderFeeBps / 10_000;
        super._update(from, to, value - fee);
        if (fee + extra != 0) super._update(from, address(0), fee + extra);
    }
}

contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external {
        require(amount == 0 || allowance[msg.sender][spender] == 0, "ZERO_FIRST");
        allowance[msg.sender][spender] = amount;
    }
    function transfer(address to, uint256 amount) external { _transfer(msg.sender, to, amount); }
    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
    }
    function _transfer(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockRouter {
    using SafeERC20 for IERC20;
    uint256 public numerator = 2;
    uint256 public denominator = 1;
    uint256 public spendBps = 10_000;
    bool public ignoreMinimum;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentrySucceeded;

    function configure(uint256 num, uint256 den, uint256 spend, bool ignoreMin) external {
        numerator = num;
        denominator = den;
        spendBps = spend;
        ignoreMinimum = ignoreMin;
    }
    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        public view returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; ++i) {
            amounts[i] = amounts[i - 1] * numerator / denominator;
        }
    }
    function swapExactTokensForTokens(
        uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline
    ) external returns (uint256[] memory amounts) {
        amounts = _swap(amountIn, minOut, path, to, deadline, false);
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline
    ) external {
        _swap(amountIn, minOut, path, to, deadline, true);
    }
    function _swap(
        uint256 amountIn, uint256 minOut, address[] calldata path,
        address to, uint256 deadline, bool feeMode
    ) private returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "EXPIRED");
        if (reentryTarget != address(0)) {
            (reentrySucceeded,) = reentryTarget.call(reentryData);
        }
        IERC20 input = IERC20(path[0]);
        uint256 beforeInput = input.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amountIn * spendBps / 10_000);
        uint256 actualInput = input.balanceOf(address(this)) - beforeInput;
        if (!feeMode && spendBps == 10_000) require(actualInput == amountIn, "INPUT_TAX");
        amounts = getAmountsOut(actualInput, path);
        IERC20 output = IERC20(path[path.length - 1]);
        uint256 beforeOutput = output.balanceOf(to);
        output.safeTransfer(to, amounts[amounts.length - 1]);
        if (!ignoreMinimum) require(output.balanceOf(to) - beforeOutput >= minOut, "MIN_OUT");
    }
}
