// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Behaves like Circle's FiatToken for these tests: 6 decimals, and a blocklist that makes any
///         transfer from or to a blocklisted account revert. Records every transfer for invariant checks.
contract MockFiatToken is ERC20 {
    mapping(address account => bool) public isBlacklisted;

    struct TransferRecord {
        address from;
        address to;
        uint256 value;
    }

    TransferRecord[] public transfers;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function blacklist(address account, bool value) external {
        isBlacklisted[account] = value;
    }

    function transferCount() external view returns (uint256) {
        return transfers.length;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
        if (from != address(0)) transfers.push(TransferRecord(from, to, value));
    }
}
