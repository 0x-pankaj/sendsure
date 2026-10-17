// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @notice Stand-in for Arc's USDC on a local fork of Arc mainnet (scripts/rehearse-mainnet.sh). Arc's USDC
///         moves balances through an Arc-only precompile that anvil cannot run, so the rehearsal puts this
///         code at 0x3600… instead. Same EIP-712 domain as the real one (name "USDC", version "2", the
///         chain's id, 0x3600…), EIP-2612 permit, 6 decimals, a blocklist. Test helper only, never deployed.
contract RehearsalUSDC is ERC20, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    mapping(address account => bool) public isBlacklisted;

    constructor() ERC20("USDC", "USDC") EIP712("USDC", "2") {}

    /// Constants, not storage: at 0x3600… the storage slots belong to the real token's proxy.
    function name() public pure override returns (string memory) {
        return "USDC";
    }

    function symbol() public pure override returns (string memory) {
        return "USDC";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function version() external pure returns (string memory) {
        return "2";
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function blacklist(address account, bool value) external {
        isBlacklisted[account] = value;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(block.timestamp <= deadline, "permit expired");
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));
        require(ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) == owner, "invalid signature");
        _approve(owner, spender, value);
    }

    function nonces(address owner) public view override returns (uint256) {
        return super.nonces(owner);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
    }
}
