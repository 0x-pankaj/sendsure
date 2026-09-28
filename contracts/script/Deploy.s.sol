// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {MandateFactory} from "../src/MandateFactory.sol";

/// Deploys PayeeRegistry and MandateFactory to Arc testnet and links them.
/// forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (PayeeRegistry registry, MandateFactory factory) {
        require(block.chainid == 5042002, "Arc testnet only");
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
