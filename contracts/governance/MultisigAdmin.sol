// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultisigAdmin
 * @author Klever
 * @notice A threshold-based multisig wallet for managing admin operations on contracts.
 * @dev This contract allows multiple owners to collectively manage admin operations
 * by requiring a minimum number of confirmations (threshold) before executing transactions.
 *
 * Key features:
 * - On-chain transaction confirmation system
 * - Off-chain signature-based execution (gas efficient alternative)
 * - Configurable owners and threshold
 * - Self-modification requires multisig approval
 * - Generic execution capability (can call any contract/function)
 * - ReentrancyGuard protection
 *
 * Security considerations:
 * - Starting with threshold 1 is less secure than an EOA
 * - Recommended to use threshold >= 2 with multiple owners in production
 * - All owner/threshold changes must pass through multisig approval
 */
contract MultisigAdmin is ReentrancyGuard {
    // ============ Structs ============

    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    // ============ Constants ============

    uint256 public constant MAX_OWNERS = 50;
    string private constant SIGNATURE_PREFIX = "\x19Ethereum Signed Message:\n32";

    // ============ State Variables ============

    mapping(address => bool) public isOwner;
    address[] public owners;
    uint256 public threshold;

    uint256 public transactionCount;
    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;

    // Nonce for off-chain signature execution (replay protection)
    uint256 public nonce;

    // ============ Events ============

    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);
    event Deposit(address indexed sender, uint256 value);
    event TransactionSubmitted(
        uint256 indexed txId,
        address indexed submitter,
        address indexed target,
        uint256 value,
        bytes data
    );
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TransactionFailed(uint256 indexed txId, bytes reason);

    // Events for signature-based execution
    event ExecutedWithSignatures(
        uint256 indexed nonce,
        address indexed target,
        uint256 value,
        bytes data,
        address executor
    );
    event SignatureExecutionFailed(
        uint256 indexed nonce,
        address indexed target,
        bytes reason
    );

    // ============ Errors ============

    error NotOwner();
    error NotWallet();
    error TransactionDoesNotExist();
    error TransactionAlreadyExecuted();
    error TransactionAlreadyConfirmed();
    error TransactionNotConfirmed();
    error ThresholdNotMet();
    error InvalidThreshold();
    error InvalidOwner();
    error OwnerAlreadyExists();
    error OwnerDoesNotExist();
    error MaxOwnersReached();
    error CannotRemoveOwner();
    error OwnersRequired();
    error ExecutionFailed();

    // Errors for signature-based execution
    error InvalidSignatureLength();
    error InvalidSignature();
    error DuplicateSignature();
    error InsufficientSignatures();

    // ============ Modifiers ============

    /**
     * @dev Throws if called by any account other than an owner.
     */
    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    /**
     * @dev Throws if called by any account other than the wallet itself.
     * Used for self-modification functions (add/remove owner, change threshold).
     */
    modifier onlyWallet() {
        if (msg.sender != address(this)) revert NotWallet();
        _;
    }

    /**
     * @dev Throws if transaction does not exist.
     */
    modifier txExists(uint256 _txId) {
        if (_txId >= transactionCount) revert TransactionDoesNotExist();
        _;
    }

    /**
     * @dev Throws if transaction has already been executed.
     */
    modifier notExecuted(uint256 _txId) {
        if (transactions[_txId].executed) revert TransactionAlreadyExecuted();
        _;
    }

    /**
     * @dev Throws if caller has already confirmed the transaction.
     */
    modifier notConfirmed(uint256 _txId) {
        if (confirmations[_txId][msg.sender]) revert TransactionAlreadyConfirmed();
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Initializes the multisig with a list of owners and a threshold.
     * @param _owners Array of initial owner addresses
     * @param _threshold Number of confirmations required to execute a transaction
     */
    constructor(address[] memory _owners, uint256 _threshold) {
        if (_owners.length == 0) revert OwnersRequired();
        if (_owners.length > MAX_OWNERS) revert MaxOwnersReached();
        if (_threshold == 0 || _threshold > _owners.length) revert InvalidThreshold();

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            if (owner == address(0)) revert InvalidOwner();
            if (isOwner[owner]) revert OwnerAlreadyExists();

            isOwner[owner] = true;
            owners.push(owner);

            emit OwnerAdded(owner);
        }

        threshold = _threshold;
        emit ThresholdChanged(_threshold);
    }

    // ============ Receive ETH ============

    /**
     * @notice Allows the contract to receive ETH.
     */
    receive() external payable {
        if (msg.value > 0) {
            emit Deposit(msg.sender, msg.value);
        }
    }

    // ============ Owner Management (onlyWallet) ============

    /**
     * @notice Adds a new owner to the multisig.
     * @dev Can only be called by the wallet itself (through a confirmed transaction).
     * @param _owner Address of the new owner
     */
    function addOwner(address _owner) external onlyWallet {
        if (_owner == address(0)) revert InvalidOwner();
        if (isOwner[_owner]) revert OwnerAlreadyExists();
        if (owners.length >= MAX_OWNERS) revert MaxOwnersReached();

        isOwner[_owner] = true;
        owners.push(_owner);

        emit OwnerAdded(_owner);
    }

    /**
     * @notice Removes an owner from the multisig.
     * @dev Can only be called by the wallet itself (through a confirmed transaction).
     * Will revert if removal would cause owner count to fall below threshold.
     * @param _owner Address of the owner to remove
     */
    function removeOwner(address _owner) external onlyWallet {
        if (!isOwner[_owner]) revert OwnerDoesNotExist();
        if (owners.length - 1 < threshold) revert CannotRemoveOwner();

        isOwner[_owner] = false;

        // Remove from array
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == _owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(_owner);
    }

    /**
     * @notice Replaces an existing owner with a new one.
     * @dev Can only be called by the wallet itself (through a confirmed transaction).
     * @param _oldOwner Address of the owner to replace
     * @param _newOwner Address of the new owner
     */
    function replaceOwner(address _oldOwner, address _newOwner) external onlyWallet {
        if (!isOwner[_oldOwner]) revert OwnerDoesNotExist();
        if (_newOwner == address(0)) revert InvalidOwner();
        if (isOwner[_newOwner]) revert OwnerAlreadyExists();

        // Update mapping
        isOwner[_oldOwner] = false;
        isOwner[_newOwner] = true;

        // Update array
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == _oldOwner) {
                owners[i] = _newOwner;
                break;
            }
        }

        emit OwnerRemoved(_oldOwner);
        emit OwnerAdded(_newOwner);
    }

    /**
     * @notice Changes the confirmation threshold.
     * @dev Can only be called by the wallet itself (through a confirmed transaction).
     * @param _threshold New threshold value
     */
    function changeThreshold(uint256 _threshold) external onlyWallet {
        if (_threshold == 0 || _threshold > owners.length) revert InvalidThreshold();

        threshold = _threshold;
        emit ThresholdChanged(_threshold);
    }

    // ============ Transaction Management (onlyOwner) ============

    /**
     * @notice Submits a new transaction for confirmation.
     * @dev The submitter automatically confirms the transaction.
     * @param _target Target contract address
     * @param _value ETH value to send with the transaction
     * @param _data Encoded function call data
     * @return txId The ID of the newly created transaction
     */
    function submitTransaction(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyOwner returns (uint256 txId) {
        txId = transactionCount;

        transactions[txId] = Transaction({
            target: _target,
            value: _value,
            data: _data,
            executed: false,
            confirmations: 0
        });

        transactionCount++;

        emit TransactionSubmitted(txId, msg.sender, _target, _value, _data);

        // Auto-confirm for submitter
        _confirm(txId);
    }

    /**
     * @notice Confirms a pending transaction.
     * @param _txId Transaction ID to confirm
     */
    function confirmTransaction(uint256 _txId)
        external
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
        notConfirmed(_txId)
    {
        _confirm(_txId);
    }

    /**
     * @notice Revokes a previous confirmation.
     * @param _txId Transaction ID to revoke confirmation for
     */
    function revokeConfirmation(uint256 _txId)
        external
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
    {
        if (!confirmations[_txId][msg.sender]) revert TransactionNotConfirmed();

        confirmations[_txId][msg.sender] = false;
        transactions[_txId].confirmations--;

        emit ConfirmationRevoked(_txId, msg.sender);
    }

    /**
     * @notice Executes a confirmed transaction.
     * @dev Requires the transaction to have reached the threshold of confirmations.
     * @param _txId Transaction ID to execute
     */
    function executeTransaction(uint256 _txId)
        external
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
        nonReentrant
    {
        Transaction storage txn = transactions[_txId];

        if (txn.confirmations < threshold) revert ThresholdNotMet();

        txn.executed = true;

        (bool success, bytes memory result) = txn.target.call{value: txn.value}(txn.data);

        if (success) {
            emit TransactionExecuted(_txId, msg.sender);
        } else {
            txn.executed = false;
            emit TransactionFailed(_txId, result);
            revert ExecutionFailed();
        }
    }

    // ============ Off-Chain Signature Execution ============

    /**
     * @notice Executes a transaction using off-chain collected signatures.
     * @dev This is a gas-efficient alternative to on-chain confirmations.
     * Signatures must be from unique owners and meet the threshold.
     * Uses a nonce for replay protection.
     * @param _target Target contract address
     * @param _value ETH value to send
     * @param _data Encoded function call data
     * @param _signatures Array of signatures from owners (65 bytes each)
     */
    function executeWithSignatures(
        address _target,
        uint256 _value,
        bytes calldata _data,
        bytes[] calldata _signatures
    ) external nonReentrant {
        if (_signatures.length < threshold) revert InsufficientSignatures();

        // Compute the hash that was signed
        bytes32 txHash = getTransactionHash(_target, _value, _data, nonce);
        bytes32 ethSignedHash = _getEthSignedMessageHash(txHash);

        // Verify signatures and count unique valid signers
        uint256 validSigners = 0;
        address[] memory signers = new address[](_signatures.length);

        for (uint256 i = 0; i < _signatures.length; i++) {
            address signer = _recoverSigner(ethSignedHash, _signatures[i]);

            // Check if signer is an owner
            if (!isOwner[signer]) {
                continue;
            }

            // Check for duplicate signatures
            bool isDuplicate = false;
            for (uint256 j = 0; j < validSigners; j++) {
                if (signers[j] == signer) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                signers[validSigners] = signer;
                validSigners++;
            }
        }

        if (validSigners < threshold) revert InsufficientSignatures();

        // Record and execute
        _recordAndExecute(_target, _value, _data, validSigners);
    }

    /**
     * @dev Internal function to record transaction and execute for signature-based execution.
     * @param _target Target contract address
     * @param _value ETH value to send
     * @param _data Encoded function call data
     * @param _validSigners Number of valid signers
     */
    function _recordAndExecute(
        address _target,
        uint256 _value,
        bytes calldata _data,
        uint256 _validSigners
    ) internal {
        // Increment nonce before execution (prevents replay)
        uint256 currentNonce = nonce;
        nonce++;

        // Record transaction for history
        uint256 txId = transactionCount;
        transactions[txId] = Transaction({
            target: _target,
            value: _value,
            data: _data,
            executed: true,
            confirmations: _validSigners
        });
        transactionCount++;

        // Execute the transaction
        (bool success, bytes memory result) = _target.call{value: _value}(_data);

        if (success) {
            emit TransactionSubmitted(txId, msg.sender, _target, _value, _data);
            emit TransactionExecuted(txId, msg.sender);
            emit ExecutedWithSignatures(currentNonce, _target, _value, _data, msg.sender);
        } else {
            // Note: No need to reset executed flag - revert rolls back all state changes
            emit TransactionFailed(txId, result);
            emit SignatureExecutionFailed(currentNonce, _target, result);
            revert ExecutionFailed();
        }
    }

    /**
     * @notice Computes the hash of a transaction for signing.
     * @dev Owners should sign this hash to approve a transaction.
     * The hash includes chainId and contract address to prevent cross-chain/cross-contract replay.
     * @param _target Target contract address
     * @param _value ETH value
     * @param _data Encoded function call data
     * @param _nonce Transaction nonce (use current nonce for pending transactions)
     * @return The transaction hash to sign
     */
    function getTransactionHash(
        address _target,
        uint256 _value,
        bytes calldata _data,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                _target,
                _value,
                _data,
                _nonce
            )
        );
    }

    /**
     * @notice Returns the current nonce for signature-based execution.
     * @dev Use this to get the nonce when preparing signatures.
     * @return Current nonce value
     */
    function getCurrentNonce() external view returns (uint256) {
        return nonce;
    }

    // ============ View Functions ============

    /**
     * @notice Returns the list of all owners.
     * @return Array of owner addresses
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    /**
     * @notice Returns the number of owners.
     * @return Number of owners
     */
    function getOwnerCount() external view returns (uint256) {
        return owners.length;
    }

    /**
     * @notice Returns transaction details.
     * @param _txId Transaction ID
     * @return target Target contract address
     * @return value ETH value
     * @return data Encoded function call data
     * @return executed Whether the transaction has been executed
     * @return confirmationCount Number of confirmations
     */
    function getTransaction(uint256 _txId)
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory data,
            bool executed,
            uint256 confirmationCount
        )
    {
        Transaction storage txn = transactions[_txId];
        return (txn.target, txn.value, txn.data, txn.executed, txn.confirmations);
    }

    /**
     * @notice Returns the number of confirmations for a transaction.
     * @param _txId Transaction ID
     * @return Number of confirmations
     */
    function getConfirmationCount(uint256 _txId) external view returns (uint256) {
        return transactions[_txId].confirmations;
    }

    /**
     * @notice Checks if a transaction has reached the confirmation threshold.
     * @param _txId Transaction ID
     * @return True if threshold is met
     */
    function isConfirmed(uint256 _txId) external view returns (bool) {
        return transactions[_txId].confirmations >= threshold;
    }

    /**
     * @notice Returns the list of owners who have confirmed a transaction.
     * @param _txId Transaction ID
     * @return Array of addresses that have confirmed
     */
    function getConfirmations(uint256 _txId) external view returns (address[] memory) {
        address[] memory confirmationsTemp = new address[](owners.length);
        uint256 count = 0;

        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[_txId][owners[i]]) {
                confirmationsTemp[count] = owners[i];
                count++;
            }
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = confirmationsTemp[i];
        }

        return result;
    }

    /**
     * @notice Returns the count of transactions based on their status.
     * @param _pending Include pending transactions
     * @param _executed Include executed transactions
     * @return count Number of transactions matching the criteria
     */
    function getTransactionCount(bool _pending, bool _executed) external view returns (uint256 count) {
        for (uint256 i = 0; i < transactionCount; i++) {
            if ((_pending && !transactions[i].executed) || (_executed && transactions[i].executed)) {
                count++;
            }
        }
    }

    /**
     * @notice Returns a list of transaction IDs based on their status.
     * @param _from Starting index
     * @param _to Ending index (exclusive)
     * @param _pending Include pending transactions
     * @param _executed Include executed transactions
     * @return txIds Array of transaction IDs
     */
    function getTransactionIds(
        uint256 _from,
        uint256 _to,
        bool _pending,
        bool _executed
    ) external view returns (uint256[] memory txIds) {
        uint256[] memory txIdsTemp = new uint256[](_to - _from);
        uint256 count = 0;

        for (uint256 i = _from; i < _to && i < transactionCount; i++) {
            if ((_pending && !transactions[i].executed) || (_executed && transactions[i].executed)) {
                txIdsTemp[count] = i;
                count++;
            }
        }

        txIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            txIds[i] = txIdsTemp[i];
        }
    }

    // ============ Internal Functions ============

    /**
     * @dev Internal function to confirm a transaction.
     * @param _txId Transaction ID to confirm
     */
    function _confirm(uint256 _txId) internal {
        confirmations[_txId][msg.sender] = true;
        transactions[_txId].confirmations++;

        emit TransactionConfirmed(_txId, msg.sender);
    }

    /**
     * @dev Computes the Ethereum signed message hash.
     * @param _hash The hash to wrap with the Ethereum prefix
     * @return The Ethereum signed message hash
     */
    function _getEthSignedMessageHash(bytes32 _hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(SIGNATURE_PREFIX, _hash));
    }

    /**
     * @dev Recovers the signer address from a signature.
     * @param _ethSignedHash The Ethereum signed message hash
     * @param _signature The signature bytes (65 bytes: r, s, v)
     * @return The recovered signer address
     */
    function _recoverSigner(bytes32 _ethSignedHash, bytes calldata _signature) internal pure returns (address) {
        if (_signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        // Extract r, s, v from signature
        assembly {
            // First 32 bytes after length prefix
            r := calldataload(_signature.offset)
            // Next 32 bytes
            s := calldataload(add(_signature.offset, 32))
            // Final byte
            v := byte(0, calldataload(add(_signature.offset, 64)))
        }

        // Adjust v for geth canonical values (0 or 1 -> 27 or 28)
        if (v == 0 || v == 1) {
            v += 27;
        }

        // EIP-2: Reject signatures with s-value in upper half of secp256k1 curve order
        // This prevents signature malleability attacks
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature();
        }

        // v must be 27 or 28
        if (v != 27 && v != 28) {
            revert InvalidSignature();
        }

        address signer = ecrecover(_ethSignedHash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();

        return signer;
    }
}
