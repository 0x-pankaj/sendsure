// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IFiatTokenBlocklist} from "./interfaces/IFiatTokenBlocklist.sol";

interface IMandateFactoryRegistryView {
    function isMandate(address org) external view returns (bool);
}

/// @title PayeeRegistry
/// @notice Payees prove their own payout address. An org (a Mandate created by the factory) opens a
///         slot for each payee; the payee binds that slot with the payout key itself, either by calling
///         `bind` from the payout address or by signing an EIP-712 `Bind` that anyone may relay.
///         A change of payout needs the old key AND the new key, and only takes effect after the org's
///         change cooldown. Nothing here stores names, invoice numbers or amounts.
contract PayeeRegistry is EIP712 {
    // ------------------------------------------------------------------ types

    enum State {
        NONE,
        OPEN,
        BOUND,
        FROZEN,
        REVOKED
    }

    /// PROVEN: the payout key itself signed or sent the binding.
    /// ATTESTED: the payer vouched for an address that cannot sign on Arc (e.g. an exchange address).
    enum Tier {
        NONE,
        PROVEN,
        ATTESTED
    }

    struct Org {
        bool registered;
        uint64 firstBindCooldown;
        uint64 changeCooldown;
    }

    struct Binding {
        address payout;
        State state;
        Tier tier;
        uint8 anchors;
        uint32 version;
        uint64 activeAt;
        address pendingPayout;
        uint64 pendingAt;
        bytes32 realAccountCommit;
        uint8 realProofType;
    }

    /// @notice The binding as a Mandate should see it right now (a matured change is already applied).
    struct PayeeInfo {
        address payout;
        State state;
        Tier tier;
        uint8 anchors;
        uint32 version;
        uint64 activeAt;
        bool changePending;
    }

    // ------------------------------------------------------------------ constants

    uint64 public constant MAX_FIRST_BIND_COOLDOWN = 1 days;
    uint64 public constant MIN_CHANGE_COOLDOWN = 1 days;
    uint64 public constant MAX_CHANGE_COOLDOWN = 30 days;

    /// Independent evidence the payer has recorded for a binding (bitmask).
    uint8 public constant ANCHOR_PAYER_CONFIRMED = 1;
    uint8 public constant ANCHOR_DOMAIN_PROOF = 2;
    uint8 public constant ANCHOR_PRIOR_PAYMENT = 4;

    /// How the "real payout account" commitment (e.g. a Solana or Tron address, CAIP-10) was proven.
    uint8 public constant PROOF_NONE = 0;
    uint8 public constant PROOF_EVM_SIGNATURE = 1;
    uint8 public constant PROOF_OFFCHAIN_SIGNATURE = 2;
    uint8 public constant PROOF_PAYER_ATTESTED = 3;

    bytes32 public constant BIND_TYPEHASH = keccak256(
        "Bind(address org,bytes32 payeeRef,address payout,bytes32 realAccountCommit,uint8 realProofType,uint256 nonce,uint64 validUntil)"
    );
    bytes32 public constant CHANGE_TYPEHASH = keccak256(
        "ChangePayout(address org,bytes32 payeeRef,address oldPayout,address newPayout,uint256 nonce,uint64 validUntil)"
    );

    // ------------------------------------------------------------------ storage

    IFiatTokenBlocklist public immutable usdc;
    address public immutable deployer;
    address public factory;

    mapping(address org => Org) public orgs;
    mapping(address org => mapping(bytes32 payeeRef => Binding)) internal _bindings;
    /// A smart-account payee's proposed new payout, valid only for the binding version it was made against.
    mapping(address org => mapping(bytes32 payeeRef => mapping(address newPayout => uint32 version))) public proposedAt;
    mapping(address signer => mapping(uint256 nonce => bool)) public nonceUsed;

    // ------------------------------------------------------------------ events

    event FactorySet(address indexed factory);
    event OrgRegistered(address indexed org, uint64 firstBindCooldown, uint64 changeCooldown);
    event SlotOpened(address indexed org, bytes32 indexed payeeRef);
    event Bound(
        address indexed org,
        bytes32 indexed payeeRef,
        address indexed payout,
        Tier tier,
        uint32 version,
        uint64 activeAt
    );
    event AnchorsSet(address indexed org, bytes32 indexed payeeRef, uint8 anchors);
    event RealAccountSet(address indexed org, bytes32 indexed payeeRef, bytes32 commit, uint8 proofType);
    event ChangeProposed(address indexed org, bytes32 indexed payeeRef, address indexed newPayout);
    event ChangeRequested(address indexed org, bytes32 indexed payeeRef, address indexed newPayout, uint64 effectiveAt);
    event ChangeCancelled(address indexed org, bytes32 indexed payeeRef);
    event Changed(address indexed org, bytes32 indexed payeeRef, address oldPayout, address newPayout, uint32 version);
    event Frozen(address indexed org, bytes32 indexed payeeRef);
    event Unfrozen(address indexed org, bytes32 indexed payeeRef);
    event Revoked(address indexed org, bytes32 indexed payeeRef);

    // ------------------------------------------------------------------ errors

    error NotDeployer();
    error FactoryAlreadySet();
    error NotFactoryMandate();
    error AlreadyRegistered();
    error BadCooldown();
    error NotOrg();
    error BadState(State state);
    error ZeroAddress();
    error Blocklisted(address account);
    error PayoutIsOrg();
    error BadProofType();
    error Expired();
    error NonceUsed();
    error BadSignature();
    error NotPayout();
    error SamePayout();
    error ChangeAlreadyPending();
    error NoPendingChange();
    error ChangeNotMature();
    error AttestedCannotChange();

    constructor(address usdc_) EIP712("SendSure PayeeRegistry", "1") {
        usdc = IFiatTokenBlocklist(usdc_);
        deployer = msg.sender;
    }

    // ------------------------------------------------------------------ setup

    /// @notice One-time link to the MandateFactory. Only factory-created Mandates can register as orgs.
    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Called once by a new Mandate during its initialisation. Cooldowns can never change.
    function registerOrg(uint64 firstBindCooldown, uint64 changeCooldown) external {
        if (factory == address(0) || !IMandateFactoryRegistryView(factory).isMandate(msg.sender)) {
            revert NotFactoryMandate();
        }
        if (orgs[msg.sender].registered) revert AlreadyRegistered();
        if (
            firstBindCooldown > MAX_FIRST_BIND_COOLDOWN || changeCooldown < MIN_CHANGE_COOLDOWN
                || changeCooldown > MAX_CHANGE_COOLDOWN
        ) revert BadCooldown();
        orgs[msg.sender] = Org({registered: true, firstBindCooldown: firstBindCooldown, changeCooldown: changeCooldown});
        emit OrgRegistered(msg.sender, firstBindCooldown, changeCooldown);
    }

    modifier onlyOrg() {
        if (!orgs[msg.sender].registered) revert NotOrg();
        _;
    }

    // ------------------------------------------------------------------ org actions (msg.sender is the Mandate)

    /// @notice Open slots for invited payees. `payeeRef` = keccak256(payer salt, vendor id), so it is
    ///         unguessable and doubles as the invite secret.
    function openSlots(bytes32[] calldata payeeRefs) external onlyOrg {
        for (uint256 i; i < payeeRefs.length; ++i) {
            Binding storage b = _bindings[msg.sender][payeeRefs[i]];
            if (b.state != State.NONE && b.state != State.REVOKED) revert BadState(b.state);
            b.state = State.OPEN;
            emit SlotOpened(msg.sender, payeeRefs[i]);
        }
    }

    /// @notice For payout addresses that cannot sign on Arc. An ATTESTED payee is never paid without a
    ///         human co-sign (enforced by the Mandate).
    function attest(bytes32 payeeRef, address payout, uint8 anchors) external onlyOrg {
        Binding storage b = _bindings[msg.sender][payeeRef];
        if (b.state != State.OPEN) revert BadState(b.state);
        _checkPayout(msg.sender, payout);
        b.payout = payout;
        b.state = State.BOUND;
        b.tier = Tier.ATTESTED;
        b.anchors = anchors;
        b.version += 1;
        b.activeAt = uint64(block.timestamp) + orgs[msg.sender].firstBindCooldown;
        emit Bound(msg.sender, payeeRef, payout, Tier.ATTESTED, b.version, b.activeAt);
        emit AnchorsSet(msg.sender, payeeRef, anchors);
    }

    /// @notice Record independent evidence for a binding (payer confirmed it out of band, domain proof,
    ///         or a prior real payment). Off-chain matching answers MATCH only when an anchor exists.
    function setAnchors(bytes32 payeeRef, uint8 anchors) external onlyOrg {
        Binding storage b = _bindings[msg.sender][payeeRef];
        if (b.state != State.BOUND && b.state != State.FROZEN) revert BadState(b.state);
        b.anchors = anchors;
        emit AnchorsSet(msg.sender, payeeRef, anchors);
    }

    function freeze(bytes32 payeeRef) external onlyOrg {
        Binding storage b = _bindings[msg.sender][payeeRef];
        if (b.state != State.BOUND) revert BadState(b.state);
        b.state = State.FROZEN;
        emit Frozen(msg.sender, payeeRef);
    }

    function unfreeze(bytes32 payeeRef) external onlyOrg {
        Binding storage b = _bindings[msg.sender][payeeRef];
        if (b.state != State.FROZEN) revert BadState(b.state);
        b.state = State.BOUND;
        emit Unfrozen(msg.sender, payeeRef);
    }

    /// @notice Revoke a binding. Recovery is a new invite: the org re-opens the slot and the payee binds again.
    function revoke(bytes32 payeeRef) external onlyOrg {
        Binding storage b = _bindings[msg.sender][payeeRef];
        if (b.state == State.NONE || b.state == State.REVOKED) revert BadState(b.state);
        b.state = State.REVOKED;
        b.payout = address(0);
        b.tier = Tier.NONE;
        b.anchors = 0;
        b.pendingPayout = address(0);
        b.pendingAt = 0;
        emit Revoked(msg.sender, payeeRef);
    }

    // ------------------------------------------------------------------ payee actions

    /// @notice Bind by sending the transaction from the payout address itself (works for smart accounts,
    ///         e.g. a passkey account whose first user operation also deploys it).
    function bind(address org, bytes32 payeeRef, bytes32 realAccountCommit, uint8 realProofType) external {
        _bind(org, payeeRef, msg.sender, realAccountCommit, realProofType);
    }

    /// @notice Bind with an EIP-712 signature from the payout EOA; anyone (a sponsored relayer) may submit it.
    function bindWithSig(
        address org,
        bytes32 payeeRef,
        address payout,
        bytes32 realAccountCommit,
        uint8 realProofType,
        uint256 nonce,
        uint64 validUntil,
        bytes calldata signature
    ) external {
        if (block.timestamp > validUntil) revert Expired();
        _useNonce(payout, nonce);
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(BIND_TYPEHASH, org, payeeRef, payout, realAccountCommit, realProofType, nonce, validUntil)
            )
        );
        if (!_isSignedBy(digest, signature, payout)) revert BadSignature();
        _bind(org, payeeRef, payout, realAccountCommit, realProofType);
    }

    /// @notice A smart-account payee proposes its new payout from the new address; the old payout then
    ///         calls `requestChange` without signatures.
    function proposeNewPayout(address org, bytes32 payeeRef) external {
        Binding storage b = _bindings[org][payeeRef];
        if (b.state != State.BOUND) revert BadState(b.state);
        proposedAt[org][payeeRef][msg.sender] = b.version;
        emit ChangeProposed(org, payeeRef, msg.sender);
    }

    /// @notice Request a new payout. Both keys must agree: the old payout (as msg.sender or `oldSig`) and
    ///         the new payout (as msg.sender, `newSig`, or a prior `proposeNewPayout`). The change takes
    ///         effect only after the org's change cooldown; until then payments are held.
    function requestChange(
        address org,
        bytes32 payeeRef,
        address newPayout,
        uint256 nonce,
        uint64 validUntil,
        bytes calldata oldSig,
        bytes calldata newSig
    ) external {
        Binding storage b = _bindings[org][payeeRef];
        _settleMaturedChange(org, payeeRef, b);
        if (b.state != State.BOUND) revert BadState(b.state);
        if (b.tier != Tier.PROVEN) revert AttestedCannotChange();
        if (b.pendingPayout != address(0)) revert ChangeAlreadyPending();
        if (newPayout == b.payout) revert SamePayout();
        if (block.timestamp > validUntil) revert Expired();
        _checkPayout(org, newPayout);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CHANGE_TYPEHASH, org, payeeRef, b.payout, newPayout, nonce, validUntil))
        );
        address oldPayout = b.payout;
        if (msg.sender != oldPayout && !_isSignedBy(digest, oldSig, oldPayout)) revert BadSignature();
        if (
            msg.sender != newPayout && proposedAt[org][payeeRef][newPayout] != b.version
                && !_isSignedBy(digest, newSig, newPayout)
        ) revert BadSignature();
        _useNonce(oldPayout, nonce);

        delete proposedAt[org][payeeRef][newPayout];
        b.pendingPayout = newPayout;
        b.pendingAt = uint64(block.timestamp) + orgs[org].changeCooldown;
        emit ChangeRequested(org, payeeRef, newPayout, b.pendingAt);
    }

    /// @notice The current payout or the org can cancel a pending change (e.g. it was not really them).
    function cancelChange(address org, bytes32 payeeRef) external {
        Binding storage b = _bindings[org][payeeRef];
        if (b.pendingPayout == address(0)) revert NoPendingChange();
        if (msg.sender != b.payout && msg.sender != org) revert NotPayout();
        b.pendingPayout = address(0);
        b.pendingAt = 0;
        emit ChangeCancelled(org, payeeRef);
    }

    /// @notice Anyone can write a matured change into storage. Views already treat it as applied.
    function finalizeChange(address org, bytes32 payeeRef) external {
        Binding storage b = _bindings[org][payeeRef];
        if (b.pendingPayout == address(0)) revert NoPendingChange();
        if (block.timestamp < b.pendingAt) revert ChangeNotMature();
        _settleMaturedChange(org, payeeRef, b);
    }

    /// @notice The payee (from its payout address) or the org (as payer-attested) records a salted
    ///         commitment to the account the payee is really paid on, on any chain (CAIP-10 style).
    function setRealAccount(address org, bytes32 payeeRef, bytes32 commit, uint8 proofType) external {
        Binding storage b = _bindings[org][payeeRef];
        if (b.state != State.BOUND && b.state != State.FROZEN) revert BadState(b.state);
        if (msg.sender == org) {
            if (proofType != PROOF_PAYER_ATTESTED) revert BadProofType();
        } else {
            if (msg.sender != b.payout) revert NotPayout();
            if (proofType == PROOF_PAYER_ATTESTED || proofType > PROOF_PAYER_ATTESTED) revert BadProofType();
        }
        b.realAccountCommit = commit;
        b.realProofType = proofType;
        emit RealAccountSet(org, payeeRef, commit, proofType);
    }

    // ------------------------------------------------------------------ views

    function payeeOf(address org, bytes32 payeeRef) external view returns (PayeeInfo memory info) {
        Binding storage b = _bindings[org][payeeRef];
        info = PayeeInfo({
            payout: b.payout,
            state: b.state,
            tier: b.tier,
            anchors: b.anchors,
            version: b.version,
            activeAt: b.activeAt,
            changePending: b.pendingPayout != address(0)
        });
        if (b.pendingPayout != address(0) && block.timestamp >= b.pendingAt) {
            info.payout = b.pendingPayout;
            info.anchors = 0;
            info.version = b.version + 1;
            info.activeAt = b.pendingAt;
            info.changePending = false;
        }
    }

    function bindingOf(address org, bytes32 payeeRef) external view returns (Binding memory) {
        return _bindings[org][payeeRef];
    }

    function bindDigest(
        address org,
        bytes32 payeeRef,
        address payout,
        bytes32 realAccountCommit,
        uint8 realProofType,
        uint256 nonce,
        uint64 validUntil
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(BIND_TYPEHASH, org, payeeRef, payout, realAccountCommit, realProofType, nonce, validUntil)
            )
        );
    }

    function changeDigest(
        address org,
        bytes32 payeeRef,
        address oldPayout,
        address newPayout,
        uint256 nonce,
        uint64 validUntil
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CHANGE_TYPEHASH, org, payeeRef, oldPayout, newPayout, nonce, validUntil))
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internal

    function _bind(address org, bytes32 payeeRef, address payout, bytes32 realAccountCommit, uint8 realProofType)
        internal
    {
        if (!orgs[org].registered) revert NotOrg();
        Binding storage b = _bindings[org][payeeRef];
        if (b.state != State.OPEN) revert BadState(b.state);
        if (realProofType == PROOF_PAYER_ATTESTED || realProofType > PROOF_PAYER_ATTESTED) revert BadProofType();
        _checkPayout(org, payout);
        b.payout = payout;
        b.state = State.BOUND;
        b.tier = Tier.PROVEN;
        b.anchors = 0;
        b.version += 1;
        b.activeAt = uint64(block.timestamp) + orgs[org].firstBindCooldown;
        b.realAccountCommit = realAccountCommit;
        b.realProofType = realProofType;
        emit Bound(org, payeeRef, payout, Tier.PROVEN, b.version, b.activeAt);
        if (realAccountCommit != bytes32(0)) emit RealAccountSet(org, payeeRef, realAccountCommit, realProofType);
    }

    function _settleMaturedChange(address org, bytes32 payeeRef, Binding storage b) internal {
        if (b.pendingPayout == address(0) || block.timestamp < b.pendingAt) return;
        address oldPayout = b.payout;
        b.payout = b.pendingPayout;
        b.version += 1;
        b.activeAt = b.pendingAt;
        b.anchors = 0;
        b.realAccountCommit = bytes32(0);
        b.realProofType = PROOF_NONE;
        b.pendingPayout = address(0);
        b.pendingAt = 0;
        emit Changed(org, payeeRef, oldPayout, b.payout, b.version);
    }

    function _checkPayout(address org, address payout) internal view {
        if (payout == address(0)) revert ZeroAddress();
        if (payout == org) revert PayoutIsOrg();
        if (address(usdc) != address(0) && usdc.isBlacklisted(payout)) revert Blocklisted(payout);
    }

    function _useNonce(address signer, uint256 nonce) internal {
        if (nonceUsed[signer][nonce]) revert NonceUsed();
        nonceUsed[signer][nonce] = true;
    }

    function _isSignedBy(bytes32 digest, bytes calldata signature, address expected) internal pure returns (bool) {
        if (signature.length == 0) return false;
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
    }
}
