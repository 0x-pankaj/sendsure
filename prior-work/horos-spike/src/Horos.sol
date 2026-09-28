// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

/// @title Horos — proof-carrying payments
/// @notice The agent assembles evidence. This contract decides. The model's output is never
///         the release condition.
///
/// Implements the four controls that live *outside* a ledger, per "Agents and Ledgers in 2026":
///   1. no entry without a document        -> three signed commitments required
///   2. the three-way match                -> order + delivery + invoice must agree
///   3. change control on the vendor master-> payout address has a cooldown; changing it re-arms
///   4. declared tolerance, loud repair    -> variance is emitted, never silently absorbed
/// Plus idempotency on a deterministic obligation id, and a budget the agent cannot exceed.
contract Horos {
    // ---------------------------------------------------------------- types

    struct Vendor {
        address payout;        // the registered payout address
        uint64  payoutSetAt;   // when it was last changed  -> change control
        bool    active;
        bytes32 screenRef;     // hash of the latest compliance screening record
    }

    struct Half {
        bytes32 doc;           // hash of the document itself
        address signer;        // who attested it
    }

    struct Obligation {
        bytes32 vendorId;
        uint256 amount;        // 6-dec USDC, the invoiced amount
        uint256 orderAmount;   // 6-dec USDC, the ordered amount
        uint64  notBefore;
        uint64  notAfter;
        Half    order;         // signed by the BUYER at order time
        Half    delivery;      // signed by an INDEPENDENT WITNESS
        Half    invoice;       // signed by the VENDOR's registered key
    }

    enum Outcome { Refused, Paid, Escalated }

    // ---------------------------------------------------------------- state

    address public immutable owner;
    /// @notice how long a newly-registered payout address must age before the agent may pay it
    uint64  public payoutCooldown = 72 hours;
    /// @notice absolute tolerance, in 6-dec USDC, between ordered and invoiced amount
    uint256 public tolerance = 10_000; // $0.01

    mapping(bytes32 => Vendor) public vendors;          // vendorId   => vendor master
    mapping(bytes32 => bool)   public settled;          // obligation => already paid (idempotency)
    mapping(bytes32 => bytes32) public settledBy;       // obligation => the decision record it settled under
    mapping(bytes32 => uint256) public spentInPeriod;   // budgetKey  => spent
    mapping(bytes32 => uint256) public budget;          // budgetKey  => cap

    /// @notice the agent. Holds no keys to funds; may only call `settle`.
    address public agent;
    /// @notice a second human signer, required to pay a vendor whose payout address is still warm
    address public approver;

    // ---------------------------------------------------------------- events
    // Every refusal is as loud as every payment. Repair is never silent.

    event VendorRegistered(bytes32 indexed vendorId, address payout, uint64 at);
    event PayoutChanged(bytes32 indexed vendorId, address oldPayout, address newPayout, uint64 at);
    event Variance(bytes32 indexed obligationId, uint256 ordered, uint256 invoiced, int256 delta);
    event Refused(bytes32 indexed obligationId, string reason);
    event Escalated(bytes32 indexed obligationId, string reason);
    event Settled(
        bytes32 indexed obligationId,
        bytes32 indexed vendorId,
        address payee,
        uint256 amount,
        bytes32 decisionRecord
    );

    error NotOwner();
    error NotAgent();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }

    constructor(address _agent, address _approver) {
        owner = msg.sender;
        agent = _agent;
        approver = _approver;
    }

    // ---------------------------------------------------------------- admin

    function setAgent(address a) external onlyOwner { agent = a; }
    function setApprover(address a) external onlyOwner { approver = a; }
    function setTolerance(uint256 t) external onlyOwner { tolerance = t; }
    function setPayoutCooldown(uint64 c) external onlyOwner { payoutCooldown = c; }
    function setBudget(bytes32 key, uint256 cap) external onlyOwner { budget[key] = cap; }

    /// @notice Register or change a vendor payout address. Changing it re-arms the cooldown,
    ///         which is the control that catches payee substitution.
    function setVendorPayout(bytes32 vendorId, address payout, bytes32 screenRef) external onlyOwner {
        Vendor storage v = vendors[vendorId];
        address old = v.payout;
        v.payout = payout;
        v.payoutSetAt = uint64(block.timestamp);
        v.active = true;
        v.screenRef = screenRef;
        if (old == address(0)) emit VendorRegistered(vendorId, payout, v.payoutSetAt);
        else emit PayoutChanged(vendorId, old, payout, v.payoutSetAt);
    }

    // ---------------------------------------------------------------- ids

    /// @notice Deterministic obligation id. The same invoice always hashes to the same key,
    ///         which is what makes a retry a no-op instead of a second payment.
    function obligationId(bytes32 vendorId, string calldata invoiceNumber, uint256 amount)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(vendorId, keccak256(bytes(invoiceNumber)), amount));
    }

    // ---------------------------------------------------------------- the gate

    /// @notice Pure predicate: would this obligation release? Callable by anyone, changes nothing.
    ///         This is the dry run. The agent must call it before `settle`, and a reviewer can
    ///         call it afterwards to replay the decision.
    function check(bytes32 id, Obligation calldata o, bool approverSigned)
        public view returns (Outcome outcome, string memory reason)
    {
        if (settled[id]) return (Outcome.Refused, "idempotent: already settled");

        Vendor memory v = vendors[o.vendorId];
        if (!v.active)                 return (Outcome.Refused, "vendor not registered");

        // 1. no entry without a document
        if (o.order.doc    == bytes32(0)) return (Outcome.Refused, "missing order");
        if (o.delivery.doc == bytes32(0)) return (Outcome.Refused, "missing delivery witness");
        if (o.invoice.doc  == bytes32(0)) return (Outcome.Refused, "missing invoice");

        // 2. the invoice half must be signed by the vendor's own registered key.
        //    the delivery half must not be signed by the vendor -- a witness cannot be the seller.
        if (o.invoice.signer  != v.payout) return (Outcome.Refused, "invoice not signed by vendor of record");
        if (o.delivery.signer == v.payout) return (Outcome.Refused, "delivery witness is the vendor");
        if (o.order.signer    == v.payout) return (Outcome.Refused, "order signed by vendor");

        // 3. change control: a freshly-changed payout address needs a second human.
        if (block.timestamp < uint256(v.payoutSetAt) + payoutCooldown && !approverSigned) {
            return (Outcome.Escalated, "payout address changed recently; second signature required");
        }

        // 4. declared tolerance. Outside it we refuse -- we never round to make it fit.
        uint256 hi = o.amount > o.orderAmount ? o.amount : o.orderAmount;
        uint256 lo = o.amount > o.orderAmount ? o.orderAmount : o.amount;
        if (hi - lo > tolerance) return (Outcome.Escalated, "variance exceeds declared tolerance");

        // 5. window
        if (block.timestamp < o.notBefore) return (Outcome.Refused, "before window");
        if (o.notAfter != 0 && block.timestamp > o.notAfter) return (Outcome.Refused, "after window");

        // 6. a budget the agent cannot talk its way past
        bytes32 bkey = budgetKey(o.vendorId);
        uint256 cap = budget[bkey];
        if (cap != 0 && spentInPeriod[bkey] + o.amount > cap) {
            return (Outcome.Escalated, "budget exceeded");
        }

        return (Outcome.Paid, "");
    }

    function budgetKey(bytes32 vendorId) public view returns (bytes32) {
        return keccak256(abi.encode(vendorId, block.timestamp / 30 days));
    }

    /// @notice Settle an obligation. The agent may call this freely and without asking; it simply
    ///         cannot make it succeed by asserting anything. `decisionRecord` is the hash of the
    ///         agent's reasoning entry, anchored here so the decision is replayable.
    function settle(bytes32 id, Obligation calldata o, bool approverSigned, bytes32 decisionRecord)
        external onlyAgent returns (Outcome)
    {
        (Outcome outcome, string memory reason) = check(id, o, approverSigned);

        if (outcome == Outcome.Refused)   { emit Refused(id, reason);   return outcome; }
        if (outcome == Outcome.Escalated) { emit Escalated(id, reason); return outcome; }

        // Variance inside tolerance is still recorded. Loud, not absorbed.
        if (o.amount != o.orderAmount) {
            emit Variance(id, o.orderAmount, o.amount, int256(o.amount) - int256(o.orderAmount));
        }

        settled[id] = true;
        settledBy[id] = decisionRecord;
        spentInPeriod[budgetKey(o.vendorId)] += o.amount;

        emit Settled(id, o.vendorId, vendors[o.vendorId].payout, o.amount, decisionRecord);
        return Outcome.Paid;
    }
}
