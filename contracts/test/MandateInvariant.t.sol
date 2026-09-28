// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {Mandate} from "../src/Mandate.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {MockFiatToken} from "./mocks/MockFiatToken.sol";

/// Drives random claims, co-signs, allowance changes and time jumps against one Mandate.
contract Handler is Test {
    Mandate internal mandate;
    PayeeRegistry internal registry;
    MockFiatToken internal usdc;
    address internal agent;
    address internal approver;
    address internal treasury;
    bytes32 internal salt;

    bytes32[] public refs;
    uint256[] internal pks;

    bytes32[] public settledIds;
    mapping(address => bool) public isPayout;
    uint256 public ghostPaid;
    uint256[] public periodsSeen;
    uint256 public nonceCounter;
    mapping(uint256 reason => uint256 count) public reasonCount;

    constructor(
        Mandate mandate_,
        PayeeRegistry registry_,
        MockFiatToken usdc_,
        address agent_,
        address approver_,
        address treasury_,
        bytes32 salt_,
        bytes32[] memory refs_,
        uint256[] memory pks_
    ) {
        mandate = mandate_;
        registry = registry_;
        usdc = usdc_;
        agent = agent_;
        approver = approver_;
        treasury = treasury_;
        salt = salt_;
        refs = refs_;
        pks = pks_;
        for (uint256 i; i < pks_.length; ++i) {
            isPayout[vm.addr(pks_[i])] = true;
        }
    }

    function pay(uint256 who, uint256 amount, uint256 invoice, bool withCosign, uint8 forgeSeed) external {
        bool forge = forgeSeed % 5 == 0; // one claim in five is signed by the wrong key
        who = bound(who, 0, refs.length - 1);
        amount = bound(amount, 1, 7_000e6);
        invoice = bound(invoice, 0, 40);
        Mandate.Claim memory c = Mandate.Claim({
            payeeRef: refs[who],
            token: address(usdc),
            amount: amount,
            refHash: keccak256(abi.encode(salt, who, invoice)),
            periodStart: uint64(block.timestamp),
            periodEnd: uint64(block.timestamp),
            nonce: ++nonceCounter,
            validUntil: uint64(block.timestamp + 1 days)
        });
        uint256 signer = forge ? 0xBAD : pks[who];
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer, mandate.claimIdOf(c));
        if (withCosign) {
            vm.prank(approver);
            try mandate.cosign(abi.encode(c)) {} catch {}
        }
        address payout = registry.payeeOf(address(mandate), refs[who]).payout;
        uint256 before = usdc.balanceOf(payout);

        vm.prank(agent);
        (Mandate.Outcome o, Mandate.Reason why) =
            mandate.settle(abi.encode(c), abi.encodePacked(r, s, v), keccak256("d"));
        reasonCount[uint256(why)]++;

        if (o == Mandate.Outcome.PAYABLE) {
            assertFalse(forge, "a forged claim was paid");
            assertEq(usdc.balanceOf(payout), before + amount, "payout received exactly the amount");
            ghostPaid += amount;
            settledIds.push(mandate.obligationIdOf(c.payeeRef, c.refHash));
            periodsSeen.push(mandate.currentPeriod());
        } else {
            assertEq(usdc.balanceOf(payout), before, "nothing moved");
        }
    }

    function setAllowance(uint256 amount) external {
        vm.prank(treasury);
        usdc.approve(address(mandate), bound(amount, 0, 200_000e6));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 12 days));
    }

    function settledCount() external view returns (uint256) {
        return settledIds.length;
    }

    function periodsCount() external view returns (uint256) {
        return periodsSeen.length;
    }
}

contract MandateInvariantTest is Base {
    Handler internal handler;
    uint256 internal treasuryStart;

    function setUp() public override {
        super.setUp();
        bytes32[] memory refs = new bytes32[](3);
        uint256[] memory pks = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            refs[i] = keccak256(abi.encode(SALT, "vendor", i));
            pks[i] = 0x1000 + i;
            _onboard(mandate, refs[i], pks[i]);
        }
        treasuryStart = usdc.balanceOf(treasury);
        handler = new Handler(mandate, registry, usdc, agent, approver, treasury, SALT, refs, pks);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = Handler.pay.selector;
        selectors[1] = Handler.setAllowance.selector;
        selectors[2] = Handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// Proves the runs are not vacuous: record how much was actually paid in each run.
    function afterInvariant() external view {
        console.log(
            "settled payments in this run:", handler.settledCount(), "total paid (USDC units):", handler.ghostPaid()
        );
        for (uint256 i; i < 24; ++i) {
            uint256 n = handler.reasonCount(i);
            if (n > 0) console.log("reason", i, "count", n);
        }
    }

    /// Every token that left the treasury went to a bound payee address, and the totals match.
    function invariant_MoneyOnlyGoesToBoundPayees() public view {
        uint256 n = usdc.transferCount();
        uint256 outOfTreasury;
        for (uint256 i; i < n; ++i) {
            (address from, address to, uint256 value) = usdc.transfers(i);
            if (from == treasury) {
                assertTrue(handler.isPayout(to), "paid an address that is not a bound payee");
                outOfTreasury += value;
            }
        }
        assertEq(outOfTreasury, handler.ghostPaid(), "treasury outflow equals settled payments");
        assertEq(treasuryStart - usdc.balanceOf(treasury), handler.ghostPaid());
    }

    /// A settled obligation stays settled.
    function invariant_SettledNeverFlipsBack() public view {
        for (uint256 i; i < handler.settledCount(); ++i) {
            assertTrue(mandate.settled(handler.settledIds(i)));
        }
    }

    /// The org cap holds in every period that saw a payment.
    function invariant_OrgCapHoldsEveryPeriod() public view {
        (uint128 orgCap,,,) = mandate.caps(address(usdc));
        for (uint256 i; i < handler.periodsCount(); ++i) {
            assertLe(mandate.orgSpent(address(usdc), handler.periodsSeen(i)), orgCap);
        }
    }
}
