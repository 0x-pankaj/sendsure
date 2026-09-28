// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {Mandate} from "../src/Mandate.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";

contract PayeeRegistryTest is Base {
    uint64 internal validUntil;

    function setUp() public override {
        super.setUp();
        validUntil = uint64(block.timestamp + 1 days);
    }

    function _bindSig(address org, bytes32 ref, uint256 pk, uint256 nonce) internal view returns (bytes memory) {
        return _sig(pk, registry.bindDigest(org, ref, vm.addr(pk), bytes32(0), 0, nonce, validUntil));
    }

    // ------------------------------------------------------------------ binding

    function test_BindNeedsAnOpenSlot() public {
        bytes memory sig = _bindSig(address(mandate), payeeRef, PAYEE_PK, 1);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistry.BadState.selector, PayeeRegistry.State.NONE));
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, sig);
    }

    function test_BindWithSigRecordsAProvenBinding() public {
        _openSlot(mandate, payeeRef);
        registry.bindWithSig(
            address(mandate),
            payeeRef,
            payee,
            bytes32(0),
            0,
            1,
            validUntil,
            _bindSig(address(mandate), payeeRef, PAYEE_PK, 1)
        );
        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(mandate), payeeRef);
        assertEq(p.payout, payee);
        assertEq(uint256(p.state), uint256(PayeeRegistry.State.BOUND));
        assertEq(uint256(p.tier), uint256(PayeeRegistry.Tier.PROVEN));
        assertEq(p.version, 1);
        assertEq(p.activeAt, block.timestamp + FIRST_BIND_COOLDOWN);
        assertEq(p.anchors, 0, "no independent evidence yet");
    }

    function test_BindRejectsAnotherKeysSignature() public {
        _openSlot(mandate, payeeRef);
        bytes memory attackerSig =
            _sig(ATTACKER_PK, registry.bindDigest(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil));
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, attackerSig);
    }

    function test_BindSignatureCannotBeReplayed() public {
        _openSlot(mandate, payeeRef);
        bytes memory sig = _bindSig(address(mandate), payeeRef, PAYEE_PK, 1);
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, sig);
        vm.prank(owner);
        mandate.revokePayee(payeeRef);
        _openSlot(mandate, payeeRef);
        vm.expectRevert(PayeeRegistry.NonceUsed.selector);
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, sig);
    }

    function test_BindSignatureIsBoundToOneOrg() public {
        Mandate other = _createMandate(defaultCaps());
        _openSlot(other, payeeRef);
        bytes memory sigForFirstOrg = _bindSig(address(mandate), payeeRef, PAYEE_PK, 1);
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        registry.bindWithSig(address(other), payeeRef, payee, bytes32(0), 0, 1, validUntil, sigForFirstOrg);
    }

    function test_ExpiredBindIsRejected() public {
        _openSlot(mandate, payeeRef);
        bytes memory sig = _bindSig(address(mandate), payeeRef, PAYEE_PK, 1);
        vm.warp(validUntil + 1);
        vm.expectRevert(PayeeRegistry.Expired.selector);
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, sig);
    }

    function test_BlocklistedAddressCannotBind() public {
        _openSlot(mandate, payeeRef);
        usdc.blacklist(payee, true);
        bytes memory sig = _bindSig(address(mandate), payeeRef, PAYEE_PK, 1);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistry.Blocklisted.selector, payee));
        registry.bindWithSig(address(mandate), payeeRef, payee, bytes32(0), 0, 1, validUntil, sig);
    }

    function test_SmartAccountBindsBySendingTheTransaction() public {
        _openSlot(mandate, payeeRef);
        address smartAccount = makeAddr("passkeyAccount");
        vm.prank(smartAccount);
        registry.bind(address(mandate), payeeRef, bytes32(0), 0);
        assertEq(registry.payeeOf(address(mandate), payeeRef).payout, smartAccount);
    }

    function test_OnlyFactoryMandatesCanRegisterAsOrgs() public {
        vm.prank(attacker);
        vm.expectRevert(PayeeRegistry.NotFactoryMandate.selector);
        registry.registerOrg(0, 1 days);

        vm.expectRevert(PayeeRegistry.FactoryAlreadySet.selector);
        registry.setFactory(attacker);
    }

    // ------------------------------------------------------------------ changes

    function _bound() internal {
        _openSlot(mandate, payeeRef);
        registry.bindWithSig(
            address(mandate),
            payeeRef,
            payee,
            bytes32(0),
            0,
            1,
            validUntil,
            _bindSig(address(mandate), payeeRef, PAYEE_PK, 1)
        );
    }

    function test_ChangeNeedsBothKeys() public {
        _bound();
        bytes32 digest = registry.changeDigest(address(mandate), payeeRef, payee, newPayee, 5, validUntil);

        vm.expectRevert(PayeeRegistry.BadSignature.selector); // old key only
        registry.requestChange(address(mandate), payeeRef, newPayee, 5, validUntil, _sig(PAYEE_PK, digest), "");

        vm.expectRevert(PayeeRegistry.BadSignature.selector); // new key only
        registry.requestChange(address(mandate), payeeRef, newPayee, 5, validUntil, "", _sig(NEW_PAYEE_PK, digest));

        registry.requestChange(
            address(mandate), payeeRef, newPayee, 5, validUntil, _sig(PAYEE_PK, digest), _sig(NEW_PAYEE_PK, digest)
        );
        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(mandate), payeeRef);
        assertEq(p.payout, payee, "old payout until the cooldown ends");
        assertTrue(p.changePending);

        vm.warp(block.timestamp + CHANGE_COOLDOWN);
        p = registry.payeeOf(address(mandate), payeeRef);
        assertEq(p.payout, newPayee);
        assertEq(p.version, 2);
        assertFalse(p.changePending);

        registry.finalizeChange(address(mandate), payeeRef);
        assertEq(registry.bindingOf(address(mandate), payeeRef).payout, newPayee);
    }

    function test_SmartAccountChangeByProposal() public {
        _bound();
        address newAccount = makeAddr("newPasskeyAccount");
        vm.prank(newAccount);
        registry.proposeNewPayout(address(mandate), payeeRef);
        vm.prank(payee);
        registry.requestChange(address(mandate), payeeRef, newAccount, 9, validUntil, "", "");
        assertTrue(registry.payeeOf(address(mandate), payeeRef).changePending);
    }

    function test_OrgCanCancelAPendingChange() public {
        _bound();
        bytes32 digest = registry.changeDigest(address(mandate), payeeRef, payee, newPayee, 5, validUntil);
        registry.requestChange(
            address(mandate), payeeRef, newPayee, 5, validUntil, _sig(PAYEE_PK, digest), _sig(NEW_PAYEE_PK, digest)
        );
        vm.prank(approver);
        mandate.cancelPayeeChange(payeeRef);
        vm.warp(block.timestamp + CHANGE_COOLDOWN);
        assertEq(registry.payeeOf(address(mandate), payeeRef).payout, payee);
    }

    function test_RevokeThenRebindBumpsTheVersion() public {
        _bound();
        vm.prank(owner);
        mandate.revokePayee(payeeRef);
        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(mandate), payeeRef);
        assertEq(uint256(p.state), uint256(PayeeRegistry.State.REVOKED));
        assertEq(p.payout, address(0));

        _openSlot(mandate, payeeRef);
        registry.bindWithSig(
            address(mandate),
            payeeRef,
            payee,
            bytes32(0),
            0,
            2,
            validUntil,
            _bindSig(address(mandate), payeeRef, PAYEE_PK, 2)
        );
        assertEq(registry.payeeOf(address(mandate), payeeRef).version, 2, "a re-bind is a new payout version");
    }

    // ------------------------------------------------------------------ real payout accounts (any chain)

    function test_RealAccountCommitRules() public {
        _bound();
        bytes32 commit = keccak256(abi.encode(SALT, "solana:mainnet:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"));
        uint8 offchain = registry.PROOF_OFFCHAIN_SIGNATURE();
        uint8 payerAttested = registry.PROOF_PAYER_ATTESTED();

        vm.prank(payee);
        registry.setRealAccount(address(mandate), payeeRef, commit, offchain);

        vm.prank(payee);
        vm.expectRevert(PayeeRegistry.BadProofType.selector);
        registry.setRealAccount(address(mandate), payeeRef, commit, payerAttested);

        vm.prank(owner);
        mandate.setPayeeRealAccount(payeeRef, commit);
        assertEq(registry.bindingOf(address(mandate), payeeRef).realProofType, payerAttested);
    }
}
