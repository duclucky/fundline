// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// FundlineBatchRouter settles a one-to-many USDC payout (payroll, speaker fees, refunds)
// in a single transaction: the payer approves the total once, then one call distributes
// USDC from the payer directly to each recipient. payBatchWithMemo adds an opt-in,
// per-recipient on-chain memo (e.g. "Salary March 2026"), emitted as a log only.
//
// Non-custodial invariant: the only fund movement is transferFrom(payer -> recipient).
// The contract never holds a balance and has no owner, admin, or withdraw path. A batch
// is atomic: if any single transfer fails, the whole transaction reverts, so a payroll
// run can never be left half paid.
contract FundlineBatchRouter {
    address public immutable usdc;

    // Upper bound on recipients per call; the practical limit is block gas, so the UI
    // should keep batches well below this and split larger payrolls across transactions.
    uint256 public constant MAX_BATCH = 256;
    // Per-recipient memo cap, in bytes. Payroll references are short.
    uint256 public constant MAX_MEMO_BYTES = 256;

    event BatchPaid(bytes32 indexed batchId, address indexed payer, uint256 totalAmount, uint256 count);
    event BatchItemPaid(
        bytes32 indexed batchId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        bytes memo
    );

    error InvalidBatch();
    error LengthMismatch();
    error EmptyBatch();
    error BatchTooLarge();
    error InvalidRecipient();
    error InvalidAmount();
    error MemoTooLarge();
    error TransferFailed();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidRecipient();
        usdc = usdc_;
    }

    // Distribute USDC to many recipients in one transaction, no on-chain memo.
    function payBatch(
        bytes32 batchId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 n = _check(batchId, recipients.length, amounts.length);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += _send(batchId, recipients[i], amounts[i], "");
        }
        emit BatchPaid(batchId, msg.sender, total, n);
    }

    // Same distribution, plus an opt-in per-recipient memo recorded on-chain. memos must
    // line up 1:1 with recipients; pass empty bytes for a recipient to skip its memo.
    function payBatchWithMemo(
        bytes32 batchId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes[] calldata memos
    ) external {
        uint256 n = _check(batchId, recipients.length, amounts.length);
        if (memos.length != n) revert LengthMismatch();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (memos[i].length > MAX_MEMO_BYTES) revert MemoTooLarge();
            total += _send(batchId, recipients[i], amounts[i], memos[i]);
        }
        emit BatchPaid(batchId, msg.sender, total, n);
    }

    function _check(bytes32 batchId, uint256 lenA, uint256 lenB) internal pure returns (uint256) {
        if (batchId == bytes32(0)) revert InvalidBatch();
        if (lenA != lenB) revert LengthMismatch();
        if (lenA == 0) revert EmptyBatch();
        if (lenA > MAX_BATCH) revert BatchTooLarge();
        return lenA;
    }

    function _send(bytes32 batchId, address to, uint256 amount, bytes memory memo) internal returns (uint256) {
        if (to == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        bool ok = IERC20(usdc).transferFrom(msg.sender, to, amount);
        if (!ok) revert TransferFailed();
        emit BatchItemPaid(batchId, msg.sender, to, amount, memo);
        return amount;
    }
}
