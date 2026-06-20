// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// PaymentRouterV2 is a drop-in successor to PaymentRouter. It keeps the exact same
// payInvoice(bytes32,address,uint256) entry point and the exact same InvoicePaid event
// signature, so the existing payment and verification paths work unchanged when the
// configured router address is pointed here. It adds an optional payInvoiceWithMemo
// overload that emits an extra InvoiceMemo log carrying caller-supplied bytes (an
// on-chain, human-readable record of the invoice, opt in per payment). The memo is a
// log only: it is never stored and never affects fund movement.
//
// Non-custodial invariant (unchanged): the only fund movement is
// transferFrom(payer -> merchant). The contract holds no balance and has no owner,
// admin, or withdraw path. The memo cannot redirect or seize funds.
contract PaymentRouterV2 {
    address public immutable usdc;

    // Hard cap on memo size to keep gas bounded and block oversized calldata.
    uint256 public constant MAX_MEMO_BYTES = 2048;

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        address token
    );

    event InvoiceMemo(
        bytes32 indexed invoiceId,
        address indexed payer,
        bytes memo
    );

    error InvalidInvoice();
    error InvalidMerchant();
    error InvalidAmount();
    error TransferFailed();
    error MemoTooLarge();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidMerchant();
        usdc = usdc_;
    }

    // Backward-compatible entry point. Same selector and behavior as PaymentRouter.
    function payInvoice(bytes32 invoiceId, address merchant, uint256 amount) external {
        _pay(invoiceId, merchant, amount);
    }

    // Same settlement as payInvoice, plus an opt-in on-chain memo. Pass empty bytes to
    // emit no memo. The memo is bounded by MAX_MEMO_BYTES and emitted as a log only.
    function payInvoiceWithMemo(
        bytes32 invoiceId,
        address merchant,
        uint256 amount,
        bytes calldata memo
    ) external {
        if (memo.length > MAX_MEMO_BYTES) revert MemoTooLarge();
        _pay(invoiceId, merchant, amount);
        if (memo.length > 0) {
            emit InvoiceMemo(invoiceId, msg.sender, memo);
        }
    }

    function _pay(bytes32 invoiceId, address merchant, uint256 amount) internal {
        if (invoiceId == bytes32(0)) revert InvalidInvoice();
        if (merchant == address(0)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();

        bool ok = IERC20(usdc).transferFrom(msg.sender, merchant, amount);
        if (!ok) revert TransferFailed();

        emit InvoicePaid(invoiceId, msg.sender, merchant, amount, usdc);
    }
}
