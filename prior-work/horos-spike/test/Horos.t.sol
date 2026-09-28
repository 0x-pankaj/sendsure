// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Horos.sol";

/// Each test is one of the six error classes the essay says a trial balance cannot catch.
contract HorosTest is Test {
    Horos h;
    address agent    = address(0xA6E7);
    address approver = address(0xAFFF);
    address vendor   = address(0xBEEF);
    address attacker = address(0xBAD1);
    address manager  = address(0x111A);
    bytes32 vid      = keccak256("acme-dev-studio");

    function setUp() public {
        h = new Horos(agent, approver);
        h.setVendorPayout(vid, vendor, keccak256("screen-2026-09-14-clear"));
        // age the payout address past the cooldown
        vm.warp(block.timestamp + 10 days);
    }

    function _ob(uint256 invoiced, uint256 ordered) internal view returns (Horos.Obligation memory o) {
        o = Horos.Obligation({
            vendorId: vid,
            amount: invoiced,
            orderAmount: ordered,
            notBefore: 0,
            notAfter: 0,
            order:    Horos.Half({doc: keccak256("PO-1001"),      signer: manager}),
            delivery: Horos.Half({doc: keccak256("GRN-1001"),     signer: manager}),
            invoice:  Horos.Half({doc: keccak256("INV-1001"),     signer: vendor})
        });
    }

    function _id(uint256 amt) internal view returns (bytes32) {
        return h.obligationId(vid, "INV-1001", amt);
    }

    // ---- the happy path still works: an agent can pay without asking anyone -------------

    function test_HappyPath_AgentPaysUnattended() public {
        uint256 amt = 5_000_000; // $5.00
        Horos.Obligation memory o = _ob(amt, amt);
        bytes32 id = _id(amt);
        vm.prank(agent);
        Horos.Outcome out = h.settle(id, o, false, keccak256("decision-1"));
        assertEq(uint8(out), uint8(Horos.Outcome.Paid));
        assertTrue(h.settled(id));
    }

    // ---- error of commission: paying the right amount to the WRONG party ----------------
    // The one thing the essay says no reconciliation catches.

    function test_PayeeSubstitution_Refused() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        o.invoice.signer = attacker;           // attacker sends a "corrected bank details" invoice
        (Horos.Outcome out, string memory why) = h.check(_id(amt), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Refused));
        assertEq(why, "invoice not signed by vendor of record");
    }

    function test_PayoutChanged_EscalatesUntilCooldownOrSecondSignature() public {
        uint256 amt = 5_000_000;
        h.setVendorPayout(vid, attacker, keccak256("screen-new"));  // vendor "changes bank details"
        Horos.Obligation memory o = _ob(amt, amt);
        o.invoice.signer = attacker;

        (Horos.Outcome out, string memory why) = h.check(_id(amt), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Escalated));
        assertEq(why, "payout address changed recently; second signature required");

        // a human signs -> allowed
        (out, ) = h.check(_id(amt), o, true);
        assertEq(uint8(out), uint8(Horos.Outcome.Paid));

        // or the address simply ages past the cooldown
        vm.warp(block.timestamp + 73 hours);
        (out, ) = h.check(_id(amt), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Paid));
    }

    // ---- fictitious entry: an invoice with no order and no delivery ---------------------

    function test_NoDocument_NoPayment() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        o.delivery.doc = bytes32(0);
        (Horos.Outcome out, string memory why) = h.check(_id(amt), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Refused));
        assertEq(why, "missing delivery witness");
    }

    /// the seller may not supply the measuring cup -- prior art 06, the agoranomoi
    function test_VendorCannotWitnessOwnDelivery() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        o.delivery.signer = vendor;
        (Horos.Outcome out, string memory why) = h.check(_id(amt), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Refused));
        assertEq(why, "delivery witness is the vendor");
    }

    // ---- error of original entry, twice over: the retry that pays twice ----------------

    function test_Idempotent_RetryIsNoop() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        bytes32 id = _id(amt);
        vm.startPrank(agent);
        h.settle(id, o, false, keccak256("decision-1"));
        Horos.Outcome second = h.settle(id, o, false, keccak256("decision-2"));
        vm.stopPrank();
        assertEq(uint8(second), uint8(Horos.Outcome.Refused));
        // the original decision record is preserved, not overwritten
        assertEq(h.settledBy(id), keccak256("decision-1"));
    }

    // ---- compensating error: the residue that silently becomes a rounding expense -------

    function test_VarianceInsideTolerance_IsEmittedNotAbsorbed() public {
        uint256 ordered  = 5_000_000;
        uint256 invoiced = 5_005_000;  // $0.005 over, inside the $0.01 tolerance
        Horos.Obligation memory o = _ob(invoiced, ordered);
        bytes32 id = _id(invoiced);
        vm.expectEmit(true, false, false, true);
        emit Horos.Variance(id, ordered, invoiced, int256(5_000));
        vm.prank(agent);
        h.settle(id, o, false, keccak256("d"));
    }

    function test_VarianceOutsideTolerance_Escalates() public {
        uint256 ordered  = 5_000_000;
        uint256 invoiced = 5_500_000;  // 50c over
        Horos.Obligation memory o = _ob(invoiced, ordered);
        (Horos.Outcome out, string memory why) = h.check(_id(invoiced), o, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Escalated));
        assertEq(why, "variance exceeds declared tolerance");
    }

    // ---- the boundary the agent cannot talk its way past --------------------------------

    function test_BudgetCap_AgentCannotExceed() public {
        bytes32 bkey = h.budgetKey(vid);
        h.setBudget(bkey, 6_000_000);   // $6 for this vendor this period

        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        bytes32 id1 = _id(amt);
        vm.prank(agent);
        h.settle(id1, o, false, keccak256("d1"));

        // a second $5 invoice would breach the $6 cap
        uint256 amt2 = 5_000_000;
        Horos.Obligation memory o2 = _ob(amt2, amt2);
        bytes32 id2 = h.obligationId(vid, "INV-1002", amt2);
        (Horos.Outcome out, string memory why) = h.check(id2, o2, false);
        assertEq(uint8(out), uint8(Horos.Outcome.Escalated));
        assertEq(why, "budget exceeded");
    }

    function test_OnlyAgentMaySettle() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        bytes32 id = _id(amt);
        vm.prank(attacker);
        vm.expectRevert(Horos.NotAgent.selector);
        h.settle(id, o, false, keccak256("d"));
    }

    // ---- the dry run is the same code path as the write --------------------------------

    function test_CheckMatchesSettle_DryRunIsHonest() public {
        uint256 amt = 5_000_000;
        Horos.Obligation memory o = _ob(amt, amt);
        bytes32 id = _id(amt);
        (Horos.Outcome predicted, ) = h.check(id, o, false);
        vm.prank(agent);
        Horos.Outcome actual = h.settle(id, o, false, keccak256("d"));
        assertEq(uint8(predicted), uint8(actual));
    }
}
