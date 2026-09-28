// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {Mandate} from "../src/Mandate.sol";
import {MandateFactory} from "../src/MandateFactory.sol";
import {MockFiatToken} from "./mocks/MockFiatToken.sol";

abstract contract Base is Test {
    MockFiatToken internal usdc;
    MockFiatToken internal eurc;
    PayeeRegistry internal registry;
    MandateFactory internal factory;
    Mandate internal mandate;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal agent = makeAddr("agent");
    address internal agentFallback = makeAddr("agentFallback");
    address internal approver = makeAddr("approver");

    uint256 internal constant PAYEE_PK = 0xA11CE;
    uint256 internal constant NEW_PAYEE_PK = 0xA11CE2;
    uint256 internal constant ATTACKER_PK = 0xBAD;
    address internal payee;
    address internal newPayee;
    address internal attacker;

    bytes32 internal constant SALT = keccak256("payer-salt");
    bytes32 internal payeeRef;

    uint64 internal constant FIRST_BIND_COOLDOWN = 1 hours;
    uint64 internal constant CHANGE_COOLDOWN = 3 days;
    uint64 internal constant PERIOD = 30 days;
    bytes32 internal constant DECISION = keccak256("decision-log-head");

    function setUp() public virtual {
        vm.warp(1_790_000_000); // Sep 2026
        usdc = new MockFiatToken("USD Coin", "USDC");
        eurc = new MockFiatToken("Euro Coin", "EURC");
        registry = new PayeeRegistry(address(usdc));
        factory = new MandateFactory(registry);
        registry.setFactory(address(factory));

        payee = vm.addr(PAYEE_PK);
        newPayee = vm.addr(NEW_PAYEE_PK);
        attacker = vm.addr(ATTACKER_PK);

        mandate = _createMandate(defaultCaps());
        payeeRef = keccak256(abi.encode(SALT, "vendor:acme-design"));

        usdc.mint(treasury, 1_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(mandate), 100_000e6);
    }

    // ------------------------------------------------------------------ setup helpers

    function defaultCaps() internal pure returns (Mandate.Caps memory) {
        return
            Mandate.Caps({
                orgPeriodCap: 50_000e6, payeePeriodCap: 10_000e6, claimMax: 5_000e6, coSignThreshold: 2_000e6
            });
    }

    function _params(Mandate.Caps memory k) internal view returns (Mandate.InitParams memory p) {
        address[] memory agents = new address[](2);
        agents[0] = agent;
        agents[1] = agentFallback;
        address[] memory approvers = new address[](1);
        approvers[0] = approver;
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        Mandate.Caps[] memory caps = new Mandate.Caps[](1);
        caps[0] = k;
        p = Mandate.InitParams({
            owner: owner,
            treasury: treasury,
            agents: agents,
            approvers: approvers,
            tokens: tokens,
            caps: caps,
            periodLength: PERIOD,
            firstBindCooldown: FIRST_BIND_COOLDOWN,
            changeCooldown: CHANGE_COOLDOWN,
            tier: 1
        });
    }

    function _createMandate(Mandate.Caps memory k) internal returns (Mandate) {
        return Mandate(factory.createMandate(_params(k)));
    }

    function _openSlot(Mandate m, bytes32 ref) internal {
        bytes32[] memory refs = new bytes32[](1);
        refs[0] = ref;
        vm.prank(owner);
        m.openSlots(refs);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _bindWithSig(Mandate m, bytes32 ref, uint256 pk, uint256 nonce) internal {
        address who = vm.addr(pk);
        uint64 validUntil = uint64(block.timestamp + 1 days);
        bytes32 digest = registry.bindDigest(address(m), ref, who, bytes32(0), 0, nonce, validUntil);
        registry.bindWithSig(address(m), ref, who, bytes32(0), 0, nonce, validUntil, _sig(pk, digest));
    }

    /// Open the slot, let the payee bind with its own key, and wait out the first-bind cooldown.
    function _onboard(Mandate m, bytes32 ref, uint256 pk) internal {
        _openSlot(m, ref);
        _bindWithSig(m, ref, pk, uint256(keccak256(abi.encode(address(m), ref, pk))));
        vm.warp(block.timestamp + FIRST_BIND_COOLDOWN);
    }

    // ------------------------------------------------------------------ claim helpers

    function _claim(bytes32 ref, uint256 amount, string memory invoice, uint256 nonce)
        internal
        view
        returns (Mandate.Claim memory)
    {
        return Mandate.Claim({
            payeeRef: ref,
            token: address(usdc),
            amount: amount,
            refHash: keccak256(abi.encode(SALT, invoice)),
            periodStart: uint64(block.timestamp - 30 days),
            periodEnd: uint64(block.timestamp),
            nonce: nonce,
            validUntil: uint64(block.timestamp + 7 days)
        });
    }

    function _signClaim(Mandate m, Mandate.Claim memory c, uint256 pk) internal view returns (bytes memory) {
        return _sig(pk, m.claimIdOf(c));
    }

    function _settle(Mandate m, Mandate.Claim memory c, bytes memory payeeSig)
        internal
        returns (Mandate.Outcome, Mandate.Reason)
    {
        vm.prank(agent);
        return m.settle(abi.encode(c), payeeSig, DECISION);
    }

    function _check(Mandate m, Mandate.Claim memory c, bytes memory payeeSig)
        internal
        view
        returns (Mandate.Outcome o, Mandate.Reason r)
    {
        (o, r,,,) = m.check(abi.encode(c), payeeSig);
    }

    function _cosign(Mandate m, Mandate.Claim memory c) internal {
        vm.prank(approver);
        m.cosign(abi.encode(c));
    }

    function assertOutcome(Mandate.Outcome o, Mandate.Reason r, Mandate.Outcome eo, Mandate.Reason er) internal pure {
        assertEq(uint256(o), uint256(eo), "outcome");
        assertEq(uint256(r), uint256(er), "reason");
    }
}
