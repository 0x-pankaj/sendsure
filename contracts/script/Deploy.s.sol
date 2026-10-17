// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {MandateFactory} from "../src/MandateFactory.sol";

/// Deploys PayeeRegistry and MandateFactory to Arc and links them.
/// Testnet: forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
/// Mainnet beta (real money, not audited): DEPLOYER_PRIVATE_KEY from .env.mainnet, --rpc-url arc_mainnet
/// USDC is at the same address on both chains.
contract Deploy is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (PayeeRegistry registry, MandateFactory factory) {
        require(block.chainid == 5042002 || block.chainid == 5042, "Arc testnet or mainnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        registry = new PayeeRegistry(ARC_USDC);
        factory = new MandateFactory(registry);
        registry.setFactory(address(factory));
        vm.stopBroadcast();
        console.log("PayeeRegistry:", address(registry));
        console.log("MandateFactory:", address(factory));
        console.log("Mandate implementation:", factory.implementation());
    }
}
