// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {PayeeRegistry} from "./PayeeRegistry.sol";
import {IFiatTokenBlocklist} from "./interfaces/IFiatTokenBlocklist.sol";

/// @title Mandate
/// @notice One per organisation (an EIP-1167 clone made by MandateFactory). The payer's own wallet
///         (`treasury`) gives this contract a capped ERC-20 allowance. An agent can ask to pay a claim,
///         but only `settle()` moves money, and only when every rule below passes:
///           - the payee's address is bound in the PayeeRegistry, active, not frozen, not changing;
///           - the claim is signed by that payout key (or submitted on-chain from it);
///           - the invoice reference was never paid before, and the claim is not expired or replayed;
///           - the amount fits the per-claim max, the per-payee and org caps for the period (caps start at 0);
///           - the treasury's allowance and balance cover it, and neither side is on the token's blocklist;
///           - an approver has co-signed on-chain when the claim is above the threshold, goes to a new or
///             changed payout, or goes to a payer-attested address.
///         `check()` runs the exact same rules without moving anything (an honest dry run).
contract Mandate is EIP712, ReentrancyGuard, Initializable {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Outcome {
        PAYABLE,
        ALREADY_SETTLED,
        ESCALATED,
        REFUSED
    }

    enum Reason {
        NONE,
        PAUSED,
        TOKEN_NOT_ALLOWED,
        ZERO_AMOUNT,
        EXPIRED,
        BAD_PERIOD,
        NONCE_USED,
        PAYEE_NOT_BOUND,
        PAYEE_FROZEN,
        PAYEE_CHANGE_PENDING,
        PAYEE_COOLDOWN,
        PAYEE_IS_CONTROLLER,
        PAYEE_BLOCKLISTED,
        TREASURY_BLOCKLISTED,
        BAD_SIGNATURE,
        DUPLICATE_REF,
        OVER_CLAIM_MAX,
        OVER_PAYEE_CAP,
        OVER_ORG_CAP,
        INSUFFICIENT_ALLOWANCE,
        INSUFFICIENT_BALANCE,
        NEEDS_COSIGN_ATTESTED_PAYEE,
        NEEDS_COSIGN_NEW_PAYOUT,
        NEEDS_COSIGN_ABOVE_THRESHOLD
    }

    /// @dev `refHash` = keccak256(payer salt, normalised invoice reference). It never contains the amount,
    ///      so the same invoice cannot be paid twice at two different amounts.
    struct Claim {
        bytes32 payeeRef;
        address token;
        uint256 amount;
        bytes32 refHash;
        uint64 periodStart;
        uint64 periodEnd;
        uint256 nonce;
        uint64 validUntil;
    }

    struct Caps {
        uint128 orgPeriodCap;
        uint128 payeePeriodCap;
        uint128 claimMax;
        uint128 coSignThreshold;
    }

    struct InitParams {
        address owner;
        address treasury;
        address[] agents;
        address[] approvers;
        address[] tokens;
        Caps[] caps;
        uint64 periodLength;
        uint64 firstBindCooldown;
        uint64 changeCooldown;
        uint8 tier;
    }

    struct Evaluation {
        Outcome outcome;
        Reason reason;
        address payout;
        uint32 version;
    }

    // ------------------------------------------------------------------ constants

    uint8 public constant TIER_PRODUCTION = 1;
    uint8 public constant TIER_SANDBOX = 2;
    uint64 public constant MIN_PERIOD_LENGTH = 1 hours;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(bytes32 payeeRef,address token,uint256 amount,bytes32 refHash,uint64 periodStart,uint64 periodEnd,uint256 nonce,uint64 validUntil)"
    );

    // ------------------------------------------------------------------ storage

    PayeeRegistry public registry;
    address public owner;
    address public pendingOwner;
    address public treasury;
    uint8 public tier;
    bool public paused;
    uint64 public periodEpoch;
    uint64 public periodLength;

    mapping(address account => bool) public isAgent;
    mapping(address account => bool) public isApprover;
    mapping(address token => bool) public tokenAllowed;
    mapping(address token => Caps) public caps;

    mapping(bytes32 obligationId => bool) public settled;
    mapping(bytes32 payeeRef => mapping(bytes32 refHash => bytes32 claimId)) public usedRef;
    mapping(bytes32 payeeRef => mapping(uint256 nonce => bool)) public claimNonceUsed;
    mapping(bytes32 claimId => address approver) public cosignedBy;
    /// The payout address that submitted a claim on-chain; it authorises the claim only while it is still the payout.
    mapping(bytes32 claimId => address payout) public submittedBy;
    mapping(bytes32 payeeRef => uint32 version) public lastPaidVersion;
    mapping(address token => mapping(uint256 period => uint256 amount)) public orgSpent;
    mapping(address token => mapping(bytes32 payeeRef => mapping(uint256 period => uint256 amount))) public payeeSpent;

    uint64 public anchorSeq;
    bytes32 public anchorHead;

    // ------------------------------------------------------------------ events

    event Initialized(address indexed owner, address indexed treasury, uint8 tier);
    event Settled(
        bytes32 indexed obligationId,
        bytes32 indexed claimId,
        bytes32 indexed payeeRef,
        address token,
        uint256 amount,
        address payout,
        bytes32 decisionHash
    );
    event AlreadySettled(bytes32 indexed obligationId, bytes32 indexed claimId, bytes32 decisionHash);
    event Refused(bytes32 indexed obligationId, bytes32 indexed claimId, Reason reason, bytes32 decisionHash);
    event Escalated(bytes32 indexed obligationId, bytes32 indexed claimId, Reason reason, bytes32 decisionHash);
    event Cosigned(bytes32 indexed claimId, bytes32 indexed payeeRef, address token, uint256 amount, address approver);
    event CosignRevoked(bytes32 indexed claimId, address by);
    event ClaimSubmitted(bytes32 indexed claimId, bytes32 indexed payeeRef);
    event ClaimWithdrawn(bytes32 indexed claimId, bytes32 indexed payeeRef);
    event Anchored(bytes32 head, uint64 seq);
    event Screened(bytes32 indexed payeeRef, bytes32 screenRef);
    event PausedBy(address indexed account);
    event UnpausedBy(address indexed account);
    event CapsSet(
        address indexed token, uint128 orgPeriodCap, uint128 payeePeriodCap, uint128 claimMax, uint128 coSignThreshold
    );
    event TokenAllowed(address indexed token, bool allowed);
    event AgentSet(address indexed agent, bool allowed);
    event ApproverSet(address indexed approver, bool allowed);
    event TreasurySet(address indexed treasury);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ------------------------------------------------------------------ errors

    error NotOwner();
    error NotAgent();
    error NotApprover();
    error NotOwnerOrApprover();
    error NotOwnerOrAgent();
    error NotPayee();
    error ZeroAddress();
    error BadInit();
    error RoleConflict(address account);
    error BadSequence();
    error AlreadySettledError();
    error RefInUse();

    // ------------------------------------------------------------------ setup

    constructor() EIP712("SendSure Mandate", "1") {
        _disableInitializers();
    }

    function initialize(InitParams calldata p, PayeeRegistry registry_) external initializer {
        if (p.owner == address(0) || p.treasury == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        if (
            p.agents.length == 0 || p.approvers.length == 0 || p.tokens.length == 0 || p.tokens.length != p.caps.length
                || p.periodLength < MIN_PERIOD_LENGTH || (p.tier != TIER_PRODUCTION && p.tier != TIER_SANDBOX)
        ) revert BadInit();

        registry = registry_;
        owner = p.owner;
        treasury = p.treasury;
        tier = p.tier;
        periodEpoch = uint64(block.timestamp);
        periodLength = p.periodLength;

        for (uint256 i; i < p.approvers.length; ++i) {
            _setApprover(p.approvers[i], true);
        }
        for (uint256 i; i < p.agents.length; ++i) {
            _setAgent(p.agents[i], true);
        }
        for (uint256 i; i < p.tokens.length; ++i) {
            _allowToken(p.tokens[i], true);
            _setCaps(p.tokens[i], p.caps[i]);
        }

        registry_.registerOrg(p.firstBindCooldown, p.changeCooldown);
        emit Initialized(p.owner, p.treasury, p.tier);
    }

    // ------------------------------------------------------------------ modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (!isAgent[msg.sender]) revert NotAgent();
        _;
    }

    modifier onlyApprover() {
        if (!isApprover[msg.sender]) revert NotApprover();
        _;
    }

    modifier onlyOwnerOrApprover() {
        if (msg.sender != owner && !isApprover[msg.sender]) revert NotOwnerOrApprover();
        _;
    }

    modifier onlyOwnerOrAgent() {
        if (msg.sender != owner && !isAgent[msg.sender]) revert NotOwnerOrAgent();
        _;
    }

    // ------------------------------------------------------------------ paying

    /// @notice The only function that moves money. It never reverts on a policy failure: it emits
    ///         Refused, Escalated or AlreadySettled and moves nothing, so every decision leaves a trace.
    ///         Flat ABI on purpose: the Circle CLI passes every argument as a string.
    /// @param claim abi.encode(Claim)
    /// @param payeeSig EIP-712 signature by the bound payout (empty if the payee submitted the claim on-chain)
    /// @param decisionHash head of the agent's hash-chained decision log for this decision
    function settle(bytes calldata claim, bytes calldata payeeSig, bytes32 decisionHash)
        external
        nonReentrant
        onlyAgent
        returns (Outcome, Reason)
    {
        Claim memory c = abi.decode(claim, (Claim));
        bytes32 claimId = claimIdOf(c);
        bytes32 oid = obligationIdOf(c.payeeRef, c.refHash);
        Evaluation memory e = _evaluate(c, claimId, payeeSig);

        if (e.outcome == Outcome.ALREADY_SETTLED) {
            emit AlreadySettled(oid, claimId, decisionHash);
            return (e.outcome, e.reason);
        }
        if (e.outcome == Outcome.REFUSED) {
            emit Refused(oid, claimId, e.reason, decisionHash);
            return (e.outcome, e.reason);
        }
        if (e.outcome == Outcome.ESCALATED) {
            emit Escalated(oid, claimId, e.reason, decisionHash);
            return (e.outcome, e.reason);
        }

        // Effects first, then the single transfer.
        settled[oid] = true;
        usedRef[c.payeeRef][c.refHash] = claimId;
        claimNonceUsed[c.payeeRef][c.nonce] = true;
        uint256 period = currentPeriod();
        orgSpent[c.token][period] += c.amount;
        payeeSpent[c.token][c.payeeRef][period] += c.amount;
        lastPaidVersion[c.payeeRef] = e.version;

        IERC20(c.token).safeTransferFrom(treasury, e.payout, c.amount);
        emit Settled(oid, claimId, c.payeeRef, c.token, c.amount, e.payout, decisionHash);
        return (Outcome.PAYABLE, Reason.NONE);
    }

    /// @notice Honest dry run: the same rules as settle(), read-only.
    function check(bytes calldata claim, bytes calldata payeeSig)
        external
        view
        returns (Outcome outcome, Reason reason, bytes32 claimId, bytes32 obligationId, address payout)
    {
        Claim memory c = abi.decode(claim, (Claim));
        claimId = claimIdOf(c);
        obligationId = obligationIdOf(c.payeeRef, c.refHash);
        Evaluation memory e = _evaluate(c, claimId, payeeSig);
        return (e.outcome, e.reason, claimId, obligationId, e.payout);
    }

    /// @notice An approver approves this exact claim (payee, token, amount, invoice ref, nonce) on-chain.
    function cosign(bytes calldata claim) external onlyApprover {
        Claim memory c = abi.decode(claim, (Claim));
        bytes32 claimId = claimIdOf(c);
        if (settled[obligationIdOf(c.payeeRef, c.refHash)]) revert AlreadySettledError();
        cosignedBy[claimId] = msg.sender;
        emit Cosigned(claimId, c.payeeRef, c.token, c.amount, msg.sender);
    }

    function revokeCosign(bytes32 claimId) external {
        address approver = cosignedBy[claimId];
        if (msg.sender != approver && msg.sender != owner) revert NotOwnerOrApprover();
        delete cosignedBy[claimId];
        emit CosignRevoked(claimId, msg.sender);
    }

    /// @notice For payees whose account cannot produce an ECDSA signature (e.g. a passkey smart account):
    ///         submitting the claim from the bound payout address authorises it. It also reserves the
    ///         invoice reference so no other amount can be claimed for it.
    function submitClaim(bytes calldata claim) external {
        Claim memory c = abi.decode(claim, (Claim));
        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(this), c.payeeRef);
        if (p.state != PayeeRegistry.State.BOUND || p.changePending || msg.sender != p.payout) revert NotPayee();
        bytes32 claimId = claimIdOf(c);
        if (settled[obligationIdOf(c.payeeRef, c.refHash)]) revert AlreadySettledError();
        bytes32 prior = usedRef[c.payeeRef][c.refHash];
        if (prior != bytes32(0) && prior != claimId) revert RefInUse();
        usedRef[c.payeeRef][c.refHash] = claimId;
        submittedBy[claimId] = msg.sender;
        emit ClaimSubmitted(claimId, c.payeeRef);
    }

    /// @notice The payee withdraws an unpaid on-chain claim (e.g. to correct the amount).
    function withdrawClaim(bytes calldata claim) external {
        Claim memory c = abi.decode(claim, (Claim));
        bytes32 claimId = claimIdOf(c);
        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(this), c.payeeRef);
        if (msg.sender != p.payout || submittedBy[claimId] == address(0)) revert NotPayee();
        if (settled[obligationIdOf(c.payeeRef, c.refHash)]) revert AlreadySettledError();
        delete submittedBy[claimId];
        if (usedRef[c.payeeRef][c.refHash] == claimId) delete usedRef[c.payeeRef][c.refHash];
        emit ClaimWithdrawn(claimId, c.payeeRef);
    }

    // ------------------------------------------------------------------ agent records

    /// @notice Anchor the head of the hash-chained decision log, so holds and escalations that never call
    ///         settle() still leave an on-chain trace.
    function anchor(bytes32 head, uint64 seq) external onlyAgent {
        if (seq != anchorSeq + 1) revert BadSequence();
        anchorSeq = seq;
        anchorHead = head;
        emit Anchored(head, seq);
    }

    /// @notice Record a reference to an off-chain screening result for a payee (e.g. an OFAC list check).
    function recordScreening(bytes32 payeeRef, bytes32 screenRef) external onlyAgent {
        emit Screened(payeeRef, screenRef);
    }

    // ------------------------------------------------------------------ payees (this org's slots in the registry)

    function openSlots(bytes32[] calldata payeeRefs) external onlyOwnerOrAgent {
        registry.openSlots(payeeRefs);
    }

    function freezePayee(bytes32 payeeRef) external onlyOwnerOrApprover {
        registry.freeze(payeeRef);
    }

    function unfreezePayee(bytes32 payeeRef) external onlyOwner {
        registry.unfreeze(payeeRef);
    }

    function revokePayee(bytes32 payeeRef) external onlyOwnerOrApprover {
        registry.revoke(payeeRef);
    }

    function cancelPayeeChange(bytes32 payeeRef) external onlyOwnerOrApprover {
        registry.cancelChange(address(this), payeeRef);
    }

    function attestPayee(bytes32 payeeRef, address payout, uint8 anchors) external onlyOwner {
        if (isAgent[payout] || isApprover[payout] || payout == owner || payout == treasury) {
            revert RoleConflict(payout);
        }
        registry.attest(payeeRef, payout, anchors);
    }

    function setPayeeAnchors(bytes32 payeeRef, uint8 anchors) external onlyOwner {
        registry.setAnchors(payeeRef, anchors);
    }

    function setPayeeRealAccount(bytes32 payeeRef, bytes32 commit) external onlyOwner {
        registry.setRealAccount(address(this), payeeRef, commit, registry.PROOF_PAYER_ATTESTED());
    }

    // ------------------------------------------------------------------ policy (every change emits an event)

    function pause() external onlyOwnerOrApprover {
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    function setCaps(address token, Caps calldata newCaps) external onlyOwner {
        _setCaps(token, newCaps);
    }

    function allowToken(address token, bool allowed) external onlyOwner {
        _allowToken(token, allowed);
    }

    function setAgent(address agent, bool allowed) external onlyOwner {
        _setAgent(agent, allowed);
    }

    function setApprover(address approver, bool allowed) external onlyOwner {
        _setApprover(approver, allowed);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        if (isAgent[newTreasury]) revert RoleConflict(newTreasury);
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (isAgent[newOwner]) revert RoleConflict(newOwner);
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ views

    function claimIdOf(Claim memory c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_TYPEHASH,
                    c.payeeRef,
                    c.token,
                    c.amount,
                    c.refHash,
                    c.periodStart,
                    c.periodEnd,
                    c.nonce,
                    c.validUntil
                )
            )
        );
    }

    /// @notice One obligation per (org, payee, invoice reference). The amount is deliberately not part of it.
    function obligationIdOf(bytes32 payeeRef, bytes32 refHash) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), payeeRef, refHash));
    }

    function currentPeriod() public view returns (uint256) {
        return (block.timestamp - periodEpoch) / periodLength;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internal

    function _evaluate(Claim memory c, bytes32 claimId, bytes calldata payeeSig)
        internal
        view
        returns (Evaluation memory e)
    {
        bytes32 prior = usedRef[c.payeeRef][c.refHash];
        if (settled[obligationIdOf(c.payeeRef, c.refHash)]) {
            e.outcome = prior == claimId ? Outcome.ALREADY_SETTLED : Outcome.REFUSED;
            e.reason = prior == claimId ? Reason.NONE : Reason.DUPLICATE_REF;
            return e;
        }
        e.outcome = Outcome.REFUSED;
        if (paused) return _reason(e, Reason.PAUSED);
        if (!tokenAllowed[c.token]) return _reason(e, Reason.TOKEN_NOT_ALLOWED);
        if (c.amount == 0) return _reason(e, Reason.ZERO_AMOUNT);
        if (block.timestamp > c.validUntil) return _reason(e, Reason.EXPIRED);
        if (c.periodEnd < c.periodStart) return _reason(e, Reason.BAD_PERIOD);
        if (claimNonceUsed[c.payeeRef][c.nonce]) return _reason(e, Reason.NONCE_USED);

        PayeeRegistry.PayeeInfo memory p = registry.payeeOf(address(this), c.payeeRef);
        if (p.state == PayeeRegistry.State.FROZEN) return _reason(e, Reason.PAYEE_FROZEN);
        if (p.state != PayeeRegistry.State.BOUND) return _reason(e, Reason.PAYEE_NOT_BOUND);
        if (p.changePending) return _reason(e, Reason.PAYEE_CHANGE_PENDING);
        if (block.timestamp < p.activeAt) return _reason(e, Reason.PAYEE_COOLDOWN);
        if (isAgent[p.payout] || isApprover[p.payout] || p.payout == owner || p.payout == treasury) {
            return _reason(e, Reason.PAYEE_IS_CONTROLLER);
        }
        IFiatTokenBlocklist blocklist = IFiatTokenBlocklist(c.token);
        if (blocklist.isBlacklisted(p.payout)) return _reason(e, Reason.PAYEE_BLOCKLISTED);
        if (blocklist.isBlacklisted(treasury)) return _reason(e, Reason.TREASURY_BLOCKLISTED);
        // A PROVEN payee must authorise the claim itself. An ATTESTED address cannot sign on Arc, so an
        // approver's co-sign stands in for it, and that co-sign is required on every payment (below).
        bool attested = p.tier == PayeeRegistry.Tier.ATTESTED;
        if (!attested && submittedBy[claimId] != p.payout && !_isSignedBy(claimId, payeeSig, p.payout)) {
            return _reason(e, Reason.BAD_SIGNATURE);
        }
        if (prior != bytes32(0) && prior != claimId) return _reason(e, Reason.DUPLICATE_REF);

        Caps memory k = caps[c.token];
        uint256 period = currentPeriod();
        uint256 payeePaid = payeeSpent[c.token][c.payeeRef][period];
        if (c.amount > k.claimMax) return _reason(e, Reason.OVER_CLAIM_MAX);
        if (payeePaid + c.amount > k.payeePeriodCap) return _reason(e, Reason.OVER_PAYEE_CAP);
        if (orgSpent[c.token][period] + c.amount > k.orgPeriodCap) return _reason(e, Reason.OVER_ORG_CAP);
        if (IERC20(c.token).allowance(treasury, address(this)) < c.amount) {
            return _reason(e, Reason.INSUFFICIENT_ALLOWANCE);
        }
        if (IERC20(c.token).balanceOf(treasury) < c.amount) return _reason(e, Reason.INSUFFICIENT_BALANCE);

        e.payout = p.payout;
        e.version = p.version;

        // Valid claim. Does a human have to sign first?
        address approver = cosignedBy[claimId];
        if (approver == address(0) || !isApprover[approver]) {
            e.outcome = Outcome.ESCALATED;
            if (attested) return _reason(e, Reason.NEEDS_COSIGN_ATTESTED_PAYEE);
            if (lastPaidVersion[c.payeeRef] != p.version) return _reason(e, Reason.NEEDS_COSIGN_NEW_PAYOUT);
            if (payeePaid + c.amount > k.coSignThreshold) return _reason(e, Reason.NEEDS_COSIGN_ABOVE_THRESHOLD);
        }
        e.outcome = Outcome.PAYABLE;
        e.reason = Reason.NONE;
    }

    function _reason(Evaluation memory e, Reason r) private pure returns (Evaluation memory) {
        e.reason = r;
        return e;
    }

    function _isSignedBy(bytes32 digest, bytes calldata signature, address expected) internal pure returns (bool) {
        if (signature.length == 0) return false;
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
    }

    function _setCaps(address token, Caps memory k) internal {
        caps[token] = k;
        emit CapsSet(token, k.orgPeriodCap, k.payeePeriodCap, k.claimMax, k.coSignThreshold);
    }

    function _allowToken(address token, bool allowed) internal {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function _setAgent(address agent, bool allowed) internal {
        if (agent == address(0)) revert ZeroAddress();
        if (allowed && (isApprover[agent] || agent == owner || agent == treasury)) revert RoleConflict(agent);
        isAgent[agent] = allowed;
        emit AgentSet(agent, allowed);
    }

    function _setApprover(address approver, bool allowed) internal {
        if (approver == address(0)) revert ZeroAddress();
        if (allowed && isAgent[approver]) revert RoleConflict(approver);
        isApprover[approver] = allowed;
        emit ApproverSet(approver, allowed);
    }
}
