// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Includes unmodified logic from OpenZeppelin Contracts v5.0.2 (MIT).

// File: @openzeppelin/contracts/token/ERC20/IERC20.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/IERC20.sol)


/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}



// File: @openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/extensions/IERC20Permit.sol)


/**
 * @dev Interface of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on {IERC20-approve}, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 *
 * ==== Security Considerations
 *
 * There are two important considerations concerning the use of `permit`. The first is that a valid permit signature
 * expresses an allowance, and it should not be assumed to convey additional meaning. In particular, it should not be
 * considered as an intention to spend the allowance in any specific way. The second is that because permits have
 * built-in replay protection and can be submitted by anyone, they can be frontrun. A protocol that uses permits should
 * take this into consideration and allow a `permit` call to fail. Combining these two aspects, a pattern that may be
 * generally recommended is:
 *
 * ```solidity
 * function doThingWithPermit(..., uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public {
 *     try token.permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
 *     doThing(..., value);
 * }
 *
 * function doThing(..., uint256 value) public {
 *     token.safeTransferFrom(msg.sender, address(this), value);
 *     ...
 * }
 * ```
 *
 * Observe that: 1) `msg.sender` is used as the owner, leaving no ambiguity as to the signer intent, and 2) the use of
 * `try/catch` allows the permit to fail and makes the code tolerant to frontrunning. (See also
 * {SafeERC20-safeTransferFrom}).
 *
 * Additionally, note that smart contract wallets (such as Argent or Safe) are not able to produce permit signatures, so
 * contracts should have entry points that don't rely on permit.
 */
interface IERC20Permit {
    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     *
     * IMPORTANT: The same issues {IERC20-approve} has related to transaction
     * ordering also apply here.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     *
     * For more information on the signature format, see the
     * https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP
     * section].
     *
     * CAUTION: See Security Considerations above.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256);

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}


// File: @openzeppelin/contracts/utils/Address.sol
// OpenZeppelin Contracts (last updated v5.0.0) (utils/Address.sol)


/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error AddressInsufficientBalance(address account);

    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedInnerCall();

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert AddressInsufficientBalance(address(this));
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert FailedInnerCall();
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {FailedInnerCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert AddressInsufficientBalance(address(this));
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {FailedInnerCall}) in case of an
     * unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {FailedInnerCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {FailedInnerCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            /// @solidity memory-safe-assembly
            assembly {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert FailedInnerCall();
        }
    }
}

// File: @openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/utils/SafeERC20.sol)






/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    using Address for address;

    /**
     * @dev An operation with an ERC20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We use {Address-functionCall} to perform this call, which verifies that
        // the target address contains contract code and also asserts for success in the low-level call.

        bytes memory returndata = address(token).functionCall(data);
        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silents catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We cannot use {Address-functionCall} here since this should return false
        // and not revert is the subcall reverts.

        (bool success, bytes memory returndata) = address(token).call(data);
        return success && (returndata.length == 0 || abi.decode(returndata, (bool))) && address(token).code.length > 0;
    }
}


// File: @openzeppelin/contracts/utils/ReentrancyGuard.sol
// OpenZeppelin Contracts (last updated v5.0.0) (utils/ReentrancyGuard.sol)


/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}

// File: contracts/QKIDelegatedMultiHop.sol
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
