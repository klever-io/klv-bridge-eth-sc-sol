# MultisigAdmin Contract

A threshold-based multisig wallet for managing admin operations on contracts.

## Overview

The `MultisigAdmin` contract allows multiple owners to collectively manage admin operations by requiring a minimum number of confirmations (threshold) before executing transactions. It can be used to replace single-owner admin patterns with more secure multi-signature governance.

## Features

- **On-chain transaction confirmation system** - All proposals and confirmations are recorded on-chain for transparency
- **Off-chain signature execution** - Gas-efficient alternative using collected signatures
- **Configurable owners and threshold** - Start with any number of owners and adjust later
- **Self-modification via multisig** - Owner/threshold changes require multisig approval
- **Generic execution capability** - Can call any function on any contract
- **ReentrancyGuard protection** - Prevents reentrancy attacks during execution
- **Auto-confirmation** - Transaction submitter automatically confirms
- **Replay protection** - Nonce-based protection for signature execution, chainId included in hash

## Contract Location

```
contracts/governance/MultisigAdmin.sol
```

## Security Considerations

> **Warning**: Starting with threshold 1 is less secure than a regular EOA (Externally Owned Account). If any single owner key is compromised, the multisig is compromised.

**Recommended configurations:**
- **Production**: 3-of-5 or 4-of-7 threshold
- **Development/Testing**: 2-of-3 threshold
- **Minimum secure**: 2-of-3 (never use 1-of-N in production)

## Deployment

### Using Hardhat

```javascript
const { ethers } = require("hardhat");

async function deployMultisig() {
  const [owner1, owner2, owner3] = await ethers.getSigners();

  const owners = [owner1.address, owner2.address, owner3.address];
  const threshold = 2; // 2-of-3

  const MultisigAdmin = await ethers.getContractFactory("MultisigAdmin");
  const multisig = await MultisigAdmin.deploy(owners, threshold);
  await multisig.waitForDeployment();

  console.log("MultisigAdmin deployed to:", await multisig.getAddress());
  return multisig;
}
```

### Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `_owners` | `address[]` | Array of initial owner addresses (1-50 owners) |
| `_threshold` | `uint256` | Number of confirmations required (1 ≤ threshold ≤ owners.length) |

## Usage Examples

### 1. Transfer Admin Rights to Multisig

After deploying the multisig, transfer admin rights from your EOA to the multisig contract:

```javascript
// Current admin transfers admin role to multisig
await erc20Safe.transferAdmin(multisigAddress);
await bridge.transferAdmin(multisigAddress);

// Verify
console.log("ERC20Safe admin:", await erc20Safe.admin()); // Should be multisig address
```

### 2. Submit a Transaction

Any owner can submit a transaction proposal:

```javascript
// Example: Whitelist a token on ERC20Safe
const whitelistData = erc20Safe.interface.encodeFunctionData("whitelistToken", [
  tokenAddress,    // token address
  25,              // min amount
  100,             // max amount
  false,           // mintBurn
  true,            // native
  0,               // totalBalance
  0,               // mintBalance
  0                // burnBalance
]);

// Submit transaction (automatically confirms for submitter)
const tx = await multisig.connect(owner1).submitTransaction(
  erc20SafeAddress,  // target contract
  0,                 // ETH value (usually 0)
  whitelistData      // encoded function call
);

const receipt = await tx.wait();
const txId = 0; // First transaction has ID 0
console.log("Transaction submitted with ID:", txId);
```

### 3. Confirm a Transaction

Other owners confirm the pending transaction:

```javascript
// Owner 2 confirms
await multisig.connect(owner2).confirmTransaction(txId);

// Check confirmation count
const confirmations = await multisig.getConfirmationCount(txId);
console.log("Confirmations:", confirmations.toString()); // "2"

// Check if threshold is met
const isConfirmed = await multisig.isConfirmed(txId);
console.log("Threshold met:", isConfirmed); // true (if threshold is 2)
```

### 4. Execute a Transaction

Once threshold is met, any owner can execute:

```javascript
// Execute the transaction
await multisig.connect(owner1).executeTransaction(txId);

// Verify the action was performed
const isWhitelisted = await erc20Safe.isTokenWhitelisted(tokenAddress);
console.log("Token whitelisted:", isWhitelisted); // true
```

### 5. Revoke Confirmation (Before Execution)

An owner can revoke their confirmation before the transaction is executed:

```javascript
await multisig.connect(owner2).revokeConfirmation(txId);
```

### 6. Add a New Owner

Owner management requires multisig approval:

```javascript
// Encode the addOwner call
const addOwnerData = multisig.interface.encodeFunctionData("addOwner", [newOwnerAddress]);

// Submit transaction to the multisig itself
await multisig.connect(owner1).submitTransaction(
  multisigAddress,  // target is the multisig itself
  0,
  addOwnerData
);

// Other owners confirm
await multisig.connect(owner2).confirmTransaction(txId);

// Execute
await multisig.connect(owner1).executeTransaction(txId);

// Verify
console.log("New owner added:", await multisig.isOwner(newOwnerAddress)); // true
```

### 7. Change Threshold

```javascript
const changeThresholdData = multisig.interface.encodeFunctionData("changeThreshold", [3]);

await multisig.connect(owner1).submitTransaction(multisigAddress, 0, changeThresholdData);
await multisig.connect(owner2).confirmTransaction(txId);
await multisig.connect(owner1).executeTransaction(txId);

console.log("New threshold:", (await multisig.threshold()).toString()); // "3"
```

### 8. Remove an Owner

```javascript
const removeOwnerData = multisig.interface.encodeFunctionData("removeOwner", [ownerToRemove]);

await multisig.connect(owner1).submitTransaction(multisigAddress, 0, removeOwnerData);
await multisig.connect(owner2).confirmTransaction(txId);
await multisig.connect(owner1).executeTransaction(txId);
```

> **Note**: Cannot remove an owner if it would cause `owners.length < threshold`

### 9. Replace an Owner

```javascript
const replaceOwnerData = multisig.interface.encodeFunctionData("replaceOwner", [
  oldOwnerAddress,
  newOwnerAddress
]);

await multisig.connect(owner1).submitTransaction(multisigAddress, 0, replaceOwnerData);
await multisig.connect(owner2).confirmTransaction(txId);
await multisig.connect(owner1).executeTransaction(txId);
```

### 10. Pause/Unpause Safe Contract

```javascript
// Pause
const pauseData = safe.interface.encodeFunctionData("pause", []);
await multisig.connect(owner1).submitTransaction(safeAddress, 0, pauseData);
await multisig.connect(owner2).confirmTransaction(txId);
await multisig.connect(owner1).executeTransaction(txId);

// Unpause
const unpauseData = safe.interface.encodeFunctionData("unpause", []);
await multisig.connect(owner1).submitTransaction(safeAddress, 0, unpauseData);
await multisig.connect(owner2).confirmTransaction(txId + 1);
await multisig.connect(owner1).executeTransaction(txId + 1);
```

---

## Off-Chain Signature Execution

As an alternative to on-chain confirmations, the contract supports gas-efficient off-chain signature collection. This is useful when:
- Gas costs are a concern
- Owners coordinate off-chain (e.g., via messaging)
- You want to batch signature collection before submitting

### How It Works

1. **Get the current nonce**: Call `getCurrentNonce()` to get the replay-protection nonce
2. **Compute the transaction hash**: Use `getTransactionHash()` or compute locally
3. **Collect signatures**: Each owner signs the hash using `eth_sign` (EIP-191 personal sign)
4. **Submit signatures**: Anyone can call `executeWithSignatures()` with the collected signatures

### Security Features

- **Nonce-based replay protection**: Each successful execution increments the nonce
- **Chain ID included**: Prevents cross-chain replay attacks
- **Contract address included**: Prevents cross-contract replay attacks
- **Duplicate signature detection**: Same owner can't sign twice

### 11. Execute with Signatures (Basic)

```javascript
const { ethers } = require("hardhat");

// Helper function to sign a transaction
async function signTransaction(signer, multisigAddress, target, value, data, nonce) {
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Compute the hash (same as contract's getTransactionHash)
  const txHash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "uint256", "bytes", "uint256"],
    [chainId, multisigAddress, target, value, data, nonce]
  );

  // Sign with eth_sign (adds Ethereum prefix automatically)
  const signature = await signer.signMessage(ethers.getBytes(txHash));
  return signature;
}

// Usage
const target = safeAddress;
const value = 0;
const data = safe.interface.encodeFunctionData("unpause", []);
const nonce = await multisig.getCurrentNonce();

// Collect signatures from owners
const sig1 = await signTransaction(owner1, multisigAddress, target, value, data, nonce);
const sig2 = await signTransaction(owner2, multisigAddress, target, value, data, nonce);

// Anyone can submit the signatures
await multisig.executeWithSignatures(target, value, data, [sig1, sig2]);
```

### 12. Execute with Signatures (Send ETH)

```javascript
// Send 1 ETH to recipient
const recipient = "0x1234...";
const value = ethers.parseEther("1");
const data = "0x"; // No function call, just ETH transfer
const nonce = await multisig.getCurrentNonce();

const sig1 = await signTransaction(owner1, multisigAddress, recipient, value, data, nonce);
const sig2 = await signTransaction(owner2, multisigAddress, recipient, value, data, nonce);

await multisig.executeWithSignatures(recipient, value, data, [sig1, sig2]);
```

### 13. Execute with Signatures (Contract Call)

```javascript
// Whitelist a token via signatures
const whitelistData = safe.interface.encodeFunctionData("whitelistToken", [
  tokenAddress, 25, 100, false, true, 0, 0, 0
]);
const nonce = await multisig.getCurrentNonce();

const sig1 = await signTransaction(owner1, multisigAddress, safeAddress, 0, whitelistData, nonce);
const sig2 = await signTransaction(owner2, multisigAddress, safeAddress, 0, whitelistData, nonce);
const sig3 = await signTransaction(owner3, multisigAddress, safeAddress, 0, whitelistData, nonce);

// Can include extra signatures (more than threshold)
await multisig.executeWithSignatures(safeAddress, 0, whitelistData, [sig1, sig2, sig3]);
```

### 14. Get Transaction Hash for Signing

```javascript
// Get the hash that owners need to sign
const nonce = await multisig.getCurrentNonce();
const txHash = await multisig.getTransactionHash(target, value, data, nonce);

console.log("Hash to sign:", txHash);
console.log("Current nonce:", nonce.toString());
```

### Signature Workflow Summary

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Coordinator prepares transaction                         │
│    - target, value, data                                    │
│    - Gets current nonce from contract                       │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Coordinator shares hash with owners                      │
│    - hash = getTransactionHash(target, value, data, nonce)  │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Each owner signs (off-chain)                             │
│    - signature = eth_sign(hash)                             │
│    - Sends signature back to coordinator                    │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Coordinator submits all signatures                       │
│    - executeWithSignatures(target, value, data, [sigs...])  │
│    - Can be called by anyone (not just owners)              │
└─────────────────────────────────────────────────────────────┘
```

---

## View Functions

### Get All Owners

```javascript
const owners = await multisig.getOwners();
console.log("Owners:", owners);
```

### Get Transaction Details

```javascript
const [target, value, data, executed, confirmationCount] = await multisig.getTransaction(txId);
console.log({
  target,
  value: value.toString(),
  data,
  executed,
  confirmations: confirmationCount.toString()
});
```

### Get Confirmations for a Transaction

```javascript
const confirmers = await multisig.getConfirmations(txId);
console.log("Confirmed by:", confirmers);
```

### Get Pending Transactions

```javascript
const pendingCount = await multisig.getTransactionCount(true, false);
const pendingIds = await multisig.getTransactionIds(0, 100, true, false);
console.log("Pending transactions:", pendingIds);
```

### Get Executed Transactions

```javascript
const executedCount = await multisig.getTransactionCount(false, true);
const executedIds = await multisig.getTransactionIds(0, 100, false, true);
console.log("Executed transactions:", executedIds);
```

## Events

| Event | Description |
|-------|-------------|
| `OwnerAdded(address indexed owner)` | Emitted when a new owner is added |
| `OwnerRemoved(address indexed owner)` | Emitted when an owner is removed |
| `ThresholdChanged(uint256 threshold)` | Emitted when threshold is changed |
| `Deposit(address indexed sender, uint256 value)` | Emitted when ETH is received |
| `TransactionSubmitted(uint256 indexed txId, address indexed submitter, address indexed target, uint256 value, bytes data)` | Emitted when a transaction is submitted |
| `TransactionConfirmed(uint256 indexed txId, address indexed owner)` | Emitted when an owner confirms |
| `ConfirmationRevoked(uint256 indexed txId, address indexed owner)` | Emitted when confirmation is revoked |
| `TransactionExecuted(uint256 indexed txId, address indexed executor)` | Emitted on successful execution |
| `TransactionFailed(uint256 indexed txId, bytes reason)` | Emitted when execution fails |
| `ExecutedWithSignatures(uint256 indexed nonce, address indexed target, uint256 value, bytes data, address executor)` | Emitted on successful signature-based execution |
| `SignatureExecutionFailed(uint256 indexed nonce, address indexed target, bytes reason)` | Emitted when signature-based execution fails |

## Error Codes

| Error | Description |
|-------|-------------|
| `NotOwner()` | Caller is not an owner |
| `NotWallet()` | Caller is not the wallet itself (for self-modification) |
| `TransactionDoesNotExist()` | Transaction ID does not exist |
| `TransactionAlreadyExecuted()` | Transaction was already executed |
| `TransactionAlreadyConfirmed()` | Caller already confirmed this transaction |
| `TransactionNotConfirmed()` | Caller has not confirmed this transaction |
| `ThresholdNotMet()` | Not enough confirmations to execute |
| `InvalidThreshold()` | Threshold is 0 or exceeds owner count |
| `InvalidOwner()` | Owner address is zero |
| `OwnerAlreadyExists()` | Address is already an owner |
| `OwnerDoesNotExist()` | Address is not an owner |
| `MaxOwnersReached()` | Cannot exceed 50 owners |
| `CannotRemoveOwner()` | Removal would break threshold requirement |
| `OwnersRequired()` | Must have at least one owner |
| `ExecutionFailed()` | External call failed |
| `InvalidSignatureLength()` | Signature is not 65 bytes |
| `InvalidSignature()` | Signature recovery failed (zero address) |
| `DuplicateSignature()` | Same owner signed twice (ignored, not error) |
| `InsufficientSignatures()` | Not enough valid owner signatures to meet threshold |

## Integration Checklist

- [ ] Deploy MultisigAdmin with initial owners and threshold
- [ ] Transfer admin rights from EOA to MultisigAdmin
- [ ] Verify all owners can submit/confirm transactions
- [ ] Test execution of admin functions through multisig
- [ ] Document owner addresses securely (hardware wallets recommended)
- [ ] Set up monitoring for multisig events

## Best Practices

1. **Use hardware wallets** for owner accounts
2. **Distribute keys** geographically and organizationally
3. **Test thoroughly** on testnet before mainnet deployment
4. **Monitor events** for unauthorized activity
5. **Have a recovery plan** if owners become unavailable
6. **Start with higher threshold** (e.g., 3-of-5) for critical contracts
7. **Document all pending transactions** off-chain for coordination

## Testing

Run the test suite:

```bash
npx hardhat test test/MultisigAdmin.test.js
```

Test coverage includes:
- Deployment validation
- Transaction lifecycle (submit, confirm, revoke, execute)
- Owner management (add, remove, replace, threshold)
- Signature-based execution (valid signatures, replay protection, duplicate detection)
- Integration with ERC20Safe
- Edge cases and security scenarios
