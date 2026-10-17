// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test helper for scripts/rehearse-mainnet.ts: answers like an org (owner(), isAgent(), openSlots()) but
///         was not made by SendSure's MandateFactory. SendSure must never send a transaction to it.
contract FakeOrg {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isAgent(address) external pure returns (bool) {
        return true;
    }

    function openSlots(bytes32[] calldata) external {}
}
