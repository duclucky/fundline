// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PaymentRouter {
    address public immutable usdc;

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        address token
    );

    error InvalidInvoice();
    error InvalidMerchant();
    error InvalidAmount();
    error TransferFailed();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidMerchant();
        usdc = usdc_;
    }

    function payInvoice(bytes32 invoiceId, address merchant, uint256 amount) external {
        if (invoiceId == bytes32(0)) revert InvalidInvoice();
        if (merchant == address(0)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();

        bool ok = IERC20(usdc).transferFrom(msg.sender, merchant, amount);
        if (!ok) revert TransferFailed();

        emit InvoicePaid(invoiceId, msg.sender, merchant, amount, usdc);
    }
}
