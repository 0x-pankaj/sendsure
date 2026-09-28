// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {Mandate} from "../src/Mandate.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";

contract MandateTest is Base {
    Mandate.Outcome internal constant PAYABLE = Mandate.Outcome.PAYABLE;
    Mandate.Outcome internal constant ALREADY_SETTLED = Mandate.Outcome.ALREADY_SETTLED;
    Mandate.Outcome internal constant ESCALATED = Mandate.Outcome.ESCALATED;
    Mandate.Outcome internal constant REFUSED = Mandate.Outcome.REFUSED;

    function setUp() public override {
        super.setUp();
        _onboard(mandate, payeeRef, PAYEE_PK);
    }

    /// Pay INV-001 for `amount`: the first payment to a new payee needs a co-sign.
    function _payFirst(uint256 amount) internal returns (Mandate.Claim memory c, bytes memory sig) {
        c = _claim(payeeRef, amount, "INV-001", 1);
        sig = _signClaim(mandate, c, PAYEE_PK);
        _cosign(mandate, c);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
    }

    // ================================================================== the normal path

    function test_FirstPaymentToNewPayeeEscalatesThenPaysAfterCosign() public {
        Mandate.Claim memory c = _claim(payeeRef, 1_000e6, "INV-001", 1);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);

        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_NEW_PAYOUT);
        assertEq(usdc.balanceOf(payee), 0, "nothing moves while escalated");

        _cosign(mandate, c);
        (o, r) = _settle(mandate, c, sig);
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        assertEq(usdc.balanceOf(payee), 1_000e6);
        assertEq(usdc.balanceOf(treasury), 1_000_000e6 - 1_000e6);
    }

    function test_RoutinePaymentBelowThresholdNeedsNoCosign() public {
        _payFirst(1_000e6);
        Mandate.Claim memory c = _claim(payeeRef, 500e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        assertEq(usdc.balanceOf(payee), 1_500e6);
    }

    function test_SplitInvoicesAreSummedAgainstTheThreshold() public {
        _payFirst(1_000e6);
        // 1,000 already paid this period + 1,500 = 2,500, above the 2,000 threshold.
        Mandate.Claim memory c = _claim(payeeRef, 1_500e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_ABOVE_THRESHOLD);
    }

    function test_SmartAccountPayeeAuthorisesByOnChainSubmission() public {
        bytes32 ref = keccak256(abi.encode(SALT, "vendor:passkey-contractor"));
        address smartAccount = makeAddr("passkeySmartAccount");
        _openSlot(mandate, ref);
        vm.prank(smartAccount);
        registry.bind(address(mandate), ref, bytes32(0), 0);
        vm.warp(block.timestamp + FIRST_BIND_COOLDOWN);

        Mandate.Claim memory c = _claim(ref, 300e6, "INV-SA-1", 1);
        vm.prank(smartAccount);
        mandate.submitClaim(abi.encode(c));
        _cosign(mandate, c);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, "");
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        assertEq(usdc.balanceOf(smartAccount), 300e6);
    }

    function test_CheckMatchesSettle(uint256 amount, bool withCosign) public {
        _payFirst(1_000e6);
        amount = bound(amount, 1, 12_000e6);
        Mandate.Claim memory c = _claim(payeeRef, amount, "INV-FUZZ", 7);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);
        if (withCosign) _cosign(mandate, c);
        (Mandate.Outcome o1, Mandate.Reason r1) = _check(mandate, c, sig);
        uint256 before = usdc.balanceOf(payee);
        (Mandate.Outcome o2, Mandate.Reason r2) = _settle(mandate, c, sig);
        assertOutcome(o2, r2, o1, r1);
        assertEq(usdc.balanceOf(payee) - before, o2 == PAYABLE ? amount : 0, "moves only when payable");
    }

    // ================================================================== the six spike exploits, now refused

    /// Spike exploit 1: the agent passed "approver signed: true" itself.
    function test_Refuses_AgentSelfAssertedApproval() public {
        _payFirst(1_000e6);
        Mandate.Claim memory c = _claim(payeeRef, 1_500e6, "INV-002", 2);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);

        vm.prank(agent);
        vm.expectRevert(Mandate.NotApprover.selector);
        mandate.cosign(abi.encode(c));

        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_ABOVE_THRESHOLD);
        assertEq(usdc.balanceOf(payee), 1_000e6, "no money without a real approver");
    }

    /// Spike exploit 2: a fresh caller-chosen ID paid the same bill twice.
    function test_Refuses_SameBillTwice() public {
        (Mandate.Claim memory c, bytes memory sig) = _payFirst(1_000e6);

        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, ALREADY_SETTLED, Mandate.Reason.NONE);

        Mandate.Claim memory again = _claim(payeeRef, 1_000e6, "INV-001", 99);
        (o, r) = _settle(mandate, again, _signClaim(mandate, again, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.DUPLICATE_REF);
        assertEq(usdc.balanceOf(payee), 1_000e6, "paid once");
    }

    /// Spike exploit 3: the same invoice at another amount counted as a new obligation.
    function test_Refuses_SameInvoiceAtNewAmount() public {
        _payFirst(1_000e6);
        Mandate.Claim memory c = _claim(payeeRef, 1_200e6, "INV-001", 2);
        // An approver cannot even co-sign a second amount for an invoice that is already paid.
        vm.prank(approver);
        vm.expectRevert(Mandate.AlreadySettledError.selector);
        mandate.cosign(abi.encode(c));
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.DUPLICATE_REF);
    }

    /// Spike exploit 4: a budget that was never set had no limit.
    function test_Refuses_WhenNoBudgetWasSet() public {
        Mandate m = _createMandate(Mandate.Caps(0, 0, 0, 0));
        vm.prank(treasury);
        usdc.approve(address(m), type(uint256).max);
        _onboard(m, payeeRef, PAYEE_PK);

        Mandate.Claim memory c = _claim(payeeRef, 1e6, "INV-1", 1);
        vm.prank(approver);
        m.cosign(abi.encode(c));
        (Mandate.Outcome o, Mandate.Reason r) = _settle(m, c, _signClaim(m, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.OVER_CLAIM_MAX);

        // A token allowed later also pays nothing until its caps are set.
        vm.prank(owner);
        mandate.allowToken(address(eurc), true);
        Mandate.Claim memory e = _claim(payeeRef, 1e6, "INV-EUR-1", 5);
        e.token = address(eurc);
        (o, r) = _settle(mandate, e, _signClaim(mandate, e, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.OVER_CLAIM_MAX);
    }

    /// Spike exploit 5: the owner could rewrite a payee's address and zero the cooldown.
    function test_Refuses_OwnerRewritingPayee() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistry.BadState.selector, PayeeRegistry.State.BOUND));
        mandate.attestPayee(payeeRef, attacker, 0);

        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.NotOrg.selector);
        registry.attest(payeeRef, attacker, 0);

        uint64 validUntil = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        registry.requestChange(address(mandate), payeeRef, attacker, 1, validUntil, "", "");

        vm.prank(address(mandate));
        vm.expectRevert(PayeeRegistry.AlreadyRegistered.selector);
        registry.registerOrg(0, 1 days);

        Mandate.InitParams memory p = _params(defaultCaps());
        p.changeCooldown = 0;
        vm.expectRevert(PayeeRegistry.BadCooldown.selector);
        factory.createMandate(p);

        assertEq(registry.payeeOf(address(mandate), payeeRef).payout, payee, "payout unchanged");
    }

    /// Spike exploit 6: settle() moved no money. Now it moves exactly the amount, once, to the bound payout.
    function test_SettleMovesExactAmountToTheBoundPayout() public {
        uint256 before = usdc.transferCount();
        _payFirst(1_234_567_890);
        assertEq(usdc.transferCount(), before + 1, "exactly one transfer");
        (address from, address to, uint256 value) = usdc.transfers(before);
        assertEq(from, treasury);
        assertEq(to, registry.payeeOf(address(mandate), payeeRef).payout);
        assertEq(value, 1_234_567_890);
    }

    // ================================================================== more refusals

    function test_Refuses_ForgedSignature() public {
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        _cosign(mandate, c);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, ATTACKER_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.BAD_SIGNATURE);
    }

    function test_Refuses_ClaimReplayedOnAnotherOrg() public {
        Mandate other = _createMandate(defaultCaps());
        _onboard(other, payeeRef, PAYEE_PK);
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        bytes memory sigForFirstOrg = _signClaim(mandate, c, PAYEE_PK);
        vm.prank(approver);
        other.cosign(abi.encode(c));
        (Mandate.Outcome o, Mandate.Reason r) = _settle(other, c, sigForFirstOrg);
        assertOutcome(o, r, REFUSED, Mandate.Reason.BAD_SIGNATURE);
    }

    function test_Refuses_WhenAllowanceRevoked() public {
        _payFirst(1_000e6);
        vm.prank(treasury);
        usdc.approve(address(mandate), 0);
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.INSUFFICIENT_ALLOWANCE);
    }

    function test_Refuses_BlocklistedPayee() public {
        _payFirst(1_000e6);
        usdc.blacklist(payee, true);
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAYEE_BLOCKLISTED);
    }

    function test_Refuses_ExpiredClaim() public {
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        c.validUntil = uint64(block.timestamp - 1);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.EXPIRED);
    }

    function test_Refuses_OverClaimMax() public {
        Mandate.Claim memory c = _claim(payeeRef, 5_000e6 + 1, "INV-001", 1);
        _cosign(mandate, c);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.OVER_CLAIM_MAX);
    }

    function test_Refuses_OverPayeeCapThenResetsNextPeriod() public {
        _payFirst(5_000e6);
        Mandate.Claim memory c2 = _claim(payeeRef, 5_000e6, "INV-002", 2);
        bytes memory sig2 = _signClaim(mandate, c2, PAYEE_PK);
        _cosign(mandate, c2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c2, sig2);
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);

        Mandate.Claim memory c3 = _claim(payeeRef, 1e6, "INV-003", 3);
        bytes memory sig3 = _signClaim(mandate, c3, PAYEE_PK);
        _cosign(mandate, c3);
        (o, r) = _settle(mandate, c3, sig3);
        assertOutcome(o, r, REFUSED, Mandate.Reason.OVER_PAYEE_CAP);

        vm.warp(block.timestamp + PERIOD);
        Mandate.Claim memory c4 = _claim(payeeRef, 1e6, "INV-003", 4); // same invoice, fresh claim in the new period
        (o, r) = _settle(mandate, c4, _signClaim(mandate, c4, PAYEE_PK));
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
    }

    function test_Refuses_OverOrgCap() public {
        vm.prank(owner);
        mandate.setCaps(address(usdc), Mandate.Caps(1_500e6, 10_000e6, 5_000e6, 2_000e6));
        _payFirst(1_000e6);
        Mandate.Claim memory c = _claim(payeeRef, 600e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.OVER_ORG_CAP);
    }

    function test_Refuses_FrozenPayee() public {
        _payFirst(1_000e6);
        vm.prank(approver);
        mandate.freezePayee(payeeRef);
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-002", 2);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAYEE_FROZEN);

        vm.prank(owner);
        mandate.unfreezePayee(payeeRef);
        (o, r) = _settle(mandate, c, sig);
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
    }

    function test_Refuses_WhenPaused_AndOnlyOwnerUnpauses() public {
        vm.prank(approver);
        mandate.pause();
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAUSED);

        vm.prank(approver);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.unpause();
        vm.prank(owner);
        mandate.unpause();
        assertFalse(mandate.paused());
    }

    function test_Refuses_PayingAController() public {
        bytes32 ref = keccak256(abi.encode(SALT, "vendor:approver-self"));
        _openSlot(mandate, ref);
        vm.prank(approver);
        registry.bind(address(mandate), ref, bytes32(0), 0);
        vm.warp(block.timestamp + FIRST_BIND_COOLDOWN);
        Mandate.Claim memory c = _claim(ref, 100e6, "INV-X", 1);
        vm.prank(approver);
        mandate.submitClaim(abi.encode(c));
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, "");
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAYEE_IS_CONTROLLER);
    }

    function test_Refuses_DuringFirstBindCooldown() public {
        bytes32 ref = keccak256(abi.encode(SALT, "vendor:fresh"));
        _openSlot(mandate, ref);
        _bindWithSig(mandate, ref, NEW_PAYEE_PK, 42);
        Mandate.Claim memory c = _claim(ref, 100e6, "INV-F", 1);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, NEW_PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAYEE_COOLDOWN);
    }

    function test_OnlyAgentsCanSettle() public {
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);
        vm.prank(approver);
        vm.expectRevert(Mandate.NotAgent.selector);
        mandate.settle(abi.encode(c), sig, DECISION);
        vm.prank(agentFallback);
        mandate.settle(abi.encode(c), sig, DECISION); // the fallback agent key works too
    }

    // ================================================================== wallet changes

    function test_WalletChangeScam_AttackerCannotRedirect() public {
        _payFirst(1_000e6);
        uint64 validUntil = uint64(block.timestamp + 1 days);
        bytes32 digest = registry.changeDigest(address(mandate), payeeRef, payee, attacker, 1, validUntil);
        bytes memory attackerSig = _sig(ATTACKER_PK, digest);

        // "We changed our wallet": only the new (attacker) key agrees, the payee's old key does not.
        vm.prank(attacker);
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        registry.requestChange(address(mandate), payeeRef, attacker, 1, validUntil, "", attackerSig);

        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(payee), 1_100e6);
    }

    function test_LegitChangeHoldsPaymentsThenNeedsCosign() public {
        _payFirst(1_000e6);
        uint64 validUntil = uint64(block.timestamp + 1 days);
        bytes32 digest = registry.changeDigest(address(mandate), payeeRef, payee, newPayee, 7, validUntil);
        registry.requestChange(
            address(mandate), payeeRef, newPayee, 7, validUntil, _sig(PAYEE_PK, digest), _sig(NEW_PAYEE_PK, digest)
        );

        Mandate.Claim memory c = _claim(payeeRef, 500e6, "INV-002", 2);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.PAYEE_CHANGE_PENDING);

        vm.warp(block.timestamp + CHANGE_COOLDOWN);
        // The old key no longer authorises claims.
        (o, r) = _settle(mandate, c, _signClaim(mandate, c, PAYEE_PK));
        assertOutcome(o, r, REFUSED, Mandate.Reason.BAD_SIGNATURE);

        bytes memory newSig = _signClaim(mandate, c, NEW_PAYEE_PK);
        (o, r) = _settle(mandate, c, newSig);
        assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_NEW_PAYOUT);

        _cosign(mandate, c);
        (o, r) = _settle(mandate, c, newSig);
        assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        assertEq(usdc.balanceOf(newPayee), 500e6);
    }

    // ================================================================== payer-attested addresses

    function test_AttestedPayeeNeedsCosignEveryTime() public {
        bytes32 ref = keccak256(abi.encode(SALT, "vendor:exchange-deposit"));
        address exchangeAddress = makeAddr("exchangeDeposit");
        _openSlot(mandate, ref);
        uint8 payerConfirmed = registry.ANCHOR_PAYER_CONFIRMED();
        vm.prank(owner);
        mandate.attestPayee(ref, exchangeAddress, payerConfirmed);
        vm.warp(block.timestamp + FIRST_BIND_COOLDOWN);

        for (uint256 i = 1; i <= 2; ++i) {
            Mandate.Claim memory c = _claim(ref, 10e6, string(abi.encodePacked("INV-EX-", vm.toString(i))), i);
            (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, "");
            assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_ATTESTED_PAYEE);
            _cosign(mandate, c);
            (o, r) = _settle(mandate, c, "");
            assertOutcome(o, r, PAYABLE, Mandate.Reason.NONE);
        }
        assertEq(usdc.balanceOf(exchangeAddress), 20e6);
    }

    // ================================================================== records and roles

    function test_AnchorsDecisionLogInSequence() public {
        vm.startPrank(agent);
        mandate.anchor(keccak256("head-1"), 1);
        mandate.anchor(keccak256("head-2"), 2);
        vm.expectRevert(Mandate.BadSequence.selector);
        mandate.anchor(keccak256("head-4"), 4);
        vm.stopPrank();
        assertEq(mandate.anchorHead(), keccak256("head-2"));
    }

    function test_RoleConflictsAreRejected() public {
        Mandate.InitParams memory p = _params(defaultCaps());
        p.approvers[0] = agent; // the agent can never approve its own payments
        vm.expectRevert(abi.encodeWithSelector(Mandate.RoleConflict.selector, agent));
        factory.createMandate(p);

        p = _params(defaultCaps());
        p.agents[0] = owner;
        vm.expectRevert(abi.encodeWithSelector(Mandate.RoleConflict.selector, owner));
        factory.createMandate(p);
    }

    function test_CosignCanBeRevokedByTheApprover() public {
        Mandate.Claim memory c = _claim(payeeRef, 100e6, "INV-001", 1);
        bytes memory sig = _signClaim(mandate, c, PAYEE_PK);
        _cosign(mandate, c);
        bytes32 claimId = mandate.claimIdOf(c);
        vm.prank(approver);
        mandate.revokeCosign(claimId);
        (Mandate.Outcome o, Mandate.Reason r) = _settle(mandate, c, sig);
        assertOutcome(o, r, ESCALATED, Mandate.Reason.NEEDS_COSIGN_NEW_PAYOUT);
    }
}
