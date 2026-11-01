// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IQKIRouterV2 {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

/// @title QKIDelegatedMultiHop
/// @notice The token holder records fixed trade conditions; a keeper pays gas to execute them.
/// @dev Immutable router, no administrator, no arbitrary calls and no keeper payment.
///      Uses ERC20/WQKI only. Native QKI must be wrapped by its holder first.
contract QKIDelegatedMultiHop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant QKI_CHAIN_ID = 20181205;
    uint256 public constant MAX_PATH_LENGTH = 16;
    IQKIRouterV2 public immutable router;
    uint256 public nextOrderId = 1;

    struct OrderConfig {
        uint256 amountIn;          // Holder debit per successful execution, raw token units.
        uint256 minAmountOut;      // Minimum actual holder receipt, raw output token units.
        uint64 deadline;           // Absolute UNIX timestamp in seconds.
        uint64 maxExecutions;      // Finite limit; 1 means a single successful execution.
        address executor;          // address(0): anyone. Holder may always execute as well.
        bool feeOnTransfer;        // Router02 supporting-fee-on-transfer function.
    }

    struct Order {
        address owner;
        address executor;
        uint256 amountIn;
        uint256 minAmountOut;
        uint64 deadline;
        uint64 remainingExecutions;
        bool feeOnTransfer;
        bool cancelled;
    }

    mapping(uint256 => Order) public orders;
    mapping(uint256 => address[]) private _paths;
    mapping(address => bool) public ownerPaused;

    error WrongChain(uint256 actualChainId);
    error InvalidRouter();
    error InvalidConfig();
    error InvalidPath();
    error OrderNotFound();
    error NotOrderOwner();
    error ExecutorNotAllowed();
    error OrderCancelled();
    error OrderExpired();
    error ExecutionsExhausted();
    error OwnerPaused();
    error UnexpectedHolderDebit();
    error UnexpectedInputReceipt();
    error UnexpectedInputRemainder();
    error InsufficientActualOutput(uint256 actual, uint256 minimum);

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address indexed executor,
        address[] path,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 deadline,
        uint64 maxExecutions,
        bool feeOnTransfer
    );
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed owner,
        address indexed executor,
        uint256 holderAmountIn,
        uint256 routerAmountIn,
        uint256 actualAmountOut,
        uint64 remainingExecutions
    );
    event OrderCancellation(uint256 indexed orderId, address indexed owner);
    event OwnerPauseChanged(address indexed owner, bool paused);

    /// @param router_ The verified QKI DEX router. The linked website currently uses
    ///        0x3c91FD5247B050A1536F24D012a17a618EEFbfCA.
    constructor(address router_) {
        if (block.chainid != QKI_CHAIN_ID) revert WrongChain(block.chainid);
        if (router_.code.length == 0) revert InvalidRouter();
        router = IQKIRouterV2(router_);
    }

    /// @notice Called by the holder, independently of ERC20 approve(this, budget).
    /// @dev No owner or recipient argument: another address cannot impersonate a holder.
    ///      A changed route/amount/minimum requires cancellation and a new order.
    function createOrder(OrderConfig calldata config, address[] calldata path)
        external nonReentrant returns (uint256 orderId)
    {
        if (
            config.amountIn == 0 || config.minAmountOut == 0 ||
            config.deadline <= block.timestamp || config.maxExecutions == 0
        ) revert InvalidConfig();
        if (config.amountIn > type(uint256).max / config.maxExecutions) revert InvalidConfig();
        if (path.length < 2 || path.length > MAX_PATH_LENGTH) revert InvalidPath();
        for (uint256 i; i < path.length; ++i) {
            if (path[i].code.length == 0) revert InvalidPath();
            if (i != 0 && path[i] == path[i - 1]) revert InvalidPath();
        }

        orderId = nextOrderId++;
        orders[orderId] = Order({
            owner: msg.sender,
            executor: config.executor,
            amountIn: config.amountIn,
            minAmountOut: config.minAmountOut,
            deadline: config.deadline,
            remainingExecutions: config.maxExecutions,
            feeOnTransfer: config.feeOnTransfer,
            cancelled: false
        });
        _paths[orderId] = path;
        emit OrderCreated(
            orderId, msg.sender, config.executor, path, config.amountIn,
            config.minAmountOut, config.deadline, config.maxExecutions, config.feeOnTransfer
        );
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.owner) revert NotOrderOwner();
        order.cancelled = true;
        emit OrderCancellation(orderId, msg.sender);
    }

    /// @notice Pause/unpause every order belonging to the caller.
    function setOwnerPaused(bool paused) external nonReentrant {
        ownerPaused[msg.sender] = paused;
        emit OwnerPauseChanged(msg.sender, paused);
    }

    function getOrderPath(uint256 orderId) external view returns (address[] memory) {
        _existingOrder(orderId);
        return _paths[orderId];
    }

    /// @notice Indicative reserve quote only; transfer taxes and future state are not included.
    function quoteOrder(uint256 orderId) external view returns (uint256[] memory) {
        Order storage order = _existingOrder(orderId);
        return router.getAmountsOut(order.amountIn, _paths[orderId]);
    }

    /// @notice Keeper supplies only the order ID, never the owner's trade parameters.
    /// @return actualAmountOut Actual output received by the holder; gas is not deducted.
    function executeOrder(uint256 orderId)
        external nonReentrant returns (uint256 actualAmountOut)
    {
        Order storage order = _existingOrder(orderId);
        if (order.cancelled) revert OrderCancelled();
        if (ownerPaused[order.owner]) revert OwnerPaused();
        if (block.timestamp > order.deadline) revert OrderExpired();
        if (order.remainingExecutions == 0) revert ExecutionsExhausted();
        if (
            order.executor != address(0) && msg.sender != order.executor &&
            msg.sender != order.owner
        ) revert ExecutorNotAllowed();

        // Decrement before external calls; any later revert restores this and all token changes.
        --order.remainingExecutions;
        address[] memory path = _paths[orderId];
        IERC20 input = IERC20(path[0]);
        IERC20 output = IERC20(path[path.length - 1]);
        (uint256 inputBalanceBefore, uint256 received) = _pullInput(order, input);

        // Snapshot AFTER the pull: essential when input and output are the same token.
        uint256 ownerOutputBefore = output.balanceOf(order.owner);
        input.forceApprove(address(router), received);
        if (order.feeOnTransfer) {
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                received, order.minAmountOut, path, order.owner, order.deadline
            );
        } else {
            router.swapExactTokensForTokens(
                received, order.minAmountOut, path, order.owner, order.deadline
            );
        }
        input.forceApprove(address(router), 0);

        // Never spend historical donations, leave part of this pull behind, or reuse them later.
        if (input.balanceOf(address(this)) != inputBalanceBefore) revert UnexpectedInputRemainder();
        uint256 ownerOutputAfter = output.balanceOf(order.owner);
        if (ownerOutputAfter < ownerOutputBefore) {
            revert InsufficientActualOutput(0, order.minAmountOut);
        }
        actualAmountOut = ownerOutputAfter - ownerOutputBefore;
        if (actualAmountOut < order.minAmountOut) {
            revert InsufficientActualOutput(actualAmountOut, order.minAmountOut);
        }
        emit OrderExecuted(
            orderId, order.owner, msg.sender, order.amountIn, received,
            actualAmountOut, order.remainingExecutions
        );
    }

    function _pullInput(Order storage order, IERC20 input)
        private returns (uint256 inputBalanceBefore, uint256 received)
    {
        inputBalanceBefore = input.balanceOf(address(this));
        uint256 ownerInputBefore = input.balanceOf(order.owner);
        input.safeTransferFrom(order.owner, address(this), order.amountIn);
        uint256 ownerInputAfter = input.balanceOf(order.owner);
        if (
            ownerInputAfter > ownerInputBefore ||
            ownerInputBefore - ownerInputAfter != order.amountIn
        ) revert UnexpectedHolderDebit();

        uint256 inputBalanceAfter = input.balanceOf(address(this));
        if (inputBalanceAfter <= inputBalanceBefore) revert UnexpectedInputReceipt();
        received = inputBalanceAfter - inputBalanceBefore;
        if (received > order.amountIn) revert UnexpectedInputReceipt();
        if (!order.feeOnTransfer && received != order.amountIn) revert UnexpectedInputReceipt();
    }

    function _existingOrder(uint256 orderId) private view returns (Order storage order) {
        order = orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound();
    }
}
