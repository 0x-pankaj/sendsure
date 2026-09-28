// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Mandate} from "./Mandate.sol";
import {PayeeRegistry} from "./PayeeRegistry.sol";

/// @title MandateFactory
/// @notice Creates one Mandate (an EIP-1167 clone) per organisation and registers it as an org in the
///         PayeeRegistry. The owner is always passed in explicitly; it is never the caller by default.
contract MandateFactory {
    address public immutable implementation;
    PayeeRegistry public immutable registry;

    mapping(address org => bool) public isMandate;
    address[] public allMandates;

    event MandateCreated(address indexed org, address indexed owner, address indexed treasury, uint8 tier);

    constructor(PayeeRegistry registry_) {
        registry = registry_;
        implementation = address(new Mandate());
    }

    function createMandate(Mandate.InitParams calldata p) external returns (address org) {
        org = Clones.clone(implementation);
        isMandate[org] = true;
        allMandates.push(org);
        Mandate(org).initialize(p, registry);
        emit MandateCreated(org, p.owner, p.treasury, p.tier);
    }

    function mandateCount() external view returns (uint256) {
        return allMandates.length;
    }
}
