// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The blocklist view exposed by Circle's FiatToken (USDC and EURC on Arc).
interface IFiatTokenBlocklist {
    function isBlacklisted(address account) external view returns (bool);
}
