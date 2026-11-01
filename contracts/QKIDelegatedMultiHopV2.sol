// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IQKIV2QuoteRouter {
    function factory() external view returns (address);
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        external pure returns (uint256);
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory);
}

interface IQKIV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IQKIV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @notice Holder-authorized multi-hop execution with an explicit cap on sender-paid token tax.
/// @dev Transfers input directly from the holder to the first pair. Each hop uses actual
///      pair input and the immutable QKI router's quote formula. No token custody or router approval.
contract QKIDelegatedMultiHopV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant VERSION = 2;
    uint256 public constant QKI_CHAIN_ID = 20181205;
    uint256 public constant MAX_PATH_LENGTH = 16;
    IQKIV2QuoteRouter public immutable router;
    uint256 public nextOrderId = 1;

    struct OrderConfig {
        uint256 amountIn;          // Nominal transfer to the first pool, excluding sender-paid tax.
        uint256 maxHolderDebit;    // Holder's explicit total debit cap per execution, including tax.
        uint256 minAmountOut;      // Minimum actual output received by the holder.
        uint64 deadline;
        uint64 maxExecutions;
        address executor;          // Zero: permissionless execution; holder may always execute.
    }

    struct Order {
        address owner;
        address executor;
        uint256 amountIn;
        uint256 maxHolderDebit;
        uint256 minAmountOut;
        uint64 deadline;
        uint64 remainingExecutions;
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
    error InvalidPair(address tokenIn, address tokenOut);
    error RepeatedPair(address pair);
    error PairHasNoInput(address pair);
    error InvalidHolderDebit();
    error HolderDebitExceeded(uint256 actual, uint256 maximum);
    error InsufficientActualOutput(uint256 actual, uint256 minimum);

    event OrderCreated(
        uint256 indexed orderId, address indexed owner, address indexed executor,
        address[] path, uint256 amountIn, uint256 maxHolderDebit,
        uint256 minAmountOut, uint64 deadline, uint64 maxExecutions
    );
    event OrderExecuted(
        uint256 indexed orderId, address indexed owner, address indexed executor,
        uint256 nominalAmountIn, uint256 holderDebit,
        uint256 actualAmountOut, uint64 remainingExecutions
    );
    event OrderCancellation(uint256 indexed orderId, address indexed owner);
    event OwnerPauseChanged(address indexed owner, bool paused);

    constructor(address router_) {
        if (block.chainid != QKI_CHAIN_ID) revert WrongChain(block.chainid);
        if (router_.code.length == 0) revert InvalidRouter();
        router = IQKIV2QuoteRouter(router_);
    }

    function createOrder(OrderConfig calldata config, address[] calldata path)
        external nonReentrant returns (uint256 orderId)
    {
        if (
            config.amountIn == 0 || config.maxHolderDebit < config.amountIn ||
            config.minAmountOut == 0 || config.deadline <= block.timestamp ||
            config.maxExecutions == 0
        ) revert InvalidConfig();
        if (config.maxHolderDebit > type(uint256).max / config.maxExecutions) revert InvalidConfig();
        if (path.length < 2 || path.length > MAX_PATH_LENGTH) revert InvalidPath();
        for (uint256 i; i < path.length; ++i) {
            if (path[i].code.length == 0) revert InvalidPath();
            if (i != 0 && path[i] == path[i - 1]) revert InvalidPath();
        }
        // Check real pool identities now; repeat at execution because liquidity may change.
        _pairsFor(path);
        orderId = nextOrderId++;
        orders[orderId] = Order({
            owner: msg.sender, executor: config.executor,
            amountIn: config.amountIn, maxHolderDebit: config.maxHolderDebit,
            minAmountOut: config.minAmountOut, deadline: config.deadline,
            remainingExecutions: config.maxExecutions, cancelled: false
        });
        _paths[orderId] = path;
        emit OrderCreated(
            orderId, msg.sender, config.executor, path, config.amountIn,
            config.maxHolderDebit, config.minAmountOut, config.deadline, config.maxExecutions
        );
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.owner) revert NotOrderOwner();
        order.cancelled = true;
        emit OrderCancellation(orderId, msg.sender);
    }

    function setOwnerPaused(bool paused) external nonReentrant {
        ownerPaused[msg.sender] = paused;
        emit OwnerPauseChanged(msg.sender, paused);
    }

    function getOrderPath(uint256 orderId) external view returns (address[] memory) {
        _existingOrder(orderId);
        return _paths[orderId];
    }

    /// @notice Indicative reserve quote; token taxes are not included.
    function quoteOrder(uint256 orderId) external view returns (uint256[] memory) {
        Order storage order = _existingOrder(orderId);
        return router.getAmountsOut(order.amountIn, _paths[orderId]);
    }

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
        --order.remainingExecutions;
        address[] memory path = _paths[orderId];
        address[] memory pairs = _pairsFor(path);
        IERC20 input = IERC20(path[0]);
        IERC20 output = IERC20(path[path.length - 1]);
        uint256 ownerInputBefore = input.balanceOf(order.owner);
        uint256 holderDebit = _fundFirstPair(order, input, pairs[0], ownerInputBefore);
        // Snapshot after funding, so same-token cycles count output correctly.
        uint256 outputBefore = output.balanceOf(order.owner);
        for (uint256 i; i < pairs.length; ++i) {
            address receiver = i + 1 < pairs.length ? pairs[i + 1] : order.owner;
            _swapHop(path[i], pairs[i], receiver);
        }
        uint256 outputAfter = output.balanceOf(order.owner);
        if (outputAfter < outputBefore) revert InsufficientActualOutput(0, order.minAmountOut);
        actualAmountOut = outputAfter - outputBefore;
        if (actualAmountOut < order.minAmountOut) {
            revert InsufficientActualOutput(actualAmountOut, order.minAmountOut);
        }
        // Catch any additional net input debit during subsequent hops for non-cyclic routes.
        if (path[0] != path[path.length - 1]) {
            uint256 ownerInputAfter = input.balanceOf(order.owner);
            if (
                ownerInputAfter < ownerInputBefore &&
                ownerInputBefore - ownerInputAfter > order.maxHolderDebit
            ) revert HolderDebitExceeded(ownerInputBefore - ownerInputAfter, order.maxHolderDebit);
        }
        emit OrderExecuted(
            orderId, order.owner, msg.sender, order.amountIn, holderDebit,
            actualAmountOut, order.remainingExecutions
        );
    }

    function _fundFirstPair(Order storage order, IERC20 input, address pair, uint256 beforeBalance)
        private returns (uint256 debit)
    {
        input.safeTransferFrom(order.owner, pair, order.amountIn);
        uint256 afterBalance = input.balanceOf(order.owner);
        if (afterBalance >= beforeBalance) revert InvalidHolderDebit();
        debit = beforeBalance - afterBalance;
        if (debit > order.maxHolderDebit) revert HolderDebitExceeded(debit, order.maxHolderDebit);
    }

    function _swapHop(address input, address pair, address receiver) private {
        IQKIV2Pair pool = IQKIV2Pair(pair);
        bool inputIs0 = input == pool.token0();
        (uint112 reserve0, uint112 reserve1,) = pool.getReserves();
        uint256 reserveIn = inputIs0 ? reserve0 : reserve1;
        uint256 reserveOut = inputIs0 ? reserve1 : reserve0;
        uint256 balanceIn = IERC20(input).balanceOf(pair);
        if (balanceIn <= reserveIn) revert PairHasNoInput(pair);
        uint256 amountOut = router.getAmountOut(balanceIn - reserveIn, reserveIn, reserveOut);
        pool.swap(inputIs0 ? 0 : amountOut, inputIs0 ? amountOut : 0, receiver, new bytes(0));
    }

    function _pairsFor(address[] memory path) private view returns (address[] memory pairs) {
        IQKIV2Factory factory = IQKIV2Factory(router.factory());
        pairs = new address[](path.length - 1);
        for (uint256 i; i < pairs.length; ++i) {
            address pair = factory.getPair(path[i], path[i + 1]);
            if (pair.code.length == 0) revert InvalidPair(path[i], path[i + 1]);
            for (uint256 j; j < i; ++j) {
                if (pairs[j] == pair) revert RepeatedPair(pair);
            }
            pairs[i] = pair;
        }
    }

    function _existingOrder(uint256 orderId) private view returns (Order storage order) {
        order = orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound();
    }
}
