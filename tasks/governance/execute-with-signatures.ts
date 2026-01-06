import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

/**
 * Signs a transaction hash using the provided signer.
 * Uses EIP-191 personal sign format.
 */
async function signTransactionHash(signer: any, txHash: string): Promise<string> {
  // Sign the hash using personal sign (eth_sign style)
  const signature = await signer.signMessage(
    Buffer.from(txHash.slice(2), "hex")
  );
  return signature;
}

task("multisig-execute-with-signatures", "Executes a transaction using off-chain signatures from specified wallet indices")
  .addParam("target", "Target contract address")
  .addOptionalParam("value", "ETH value to send (in wei)", "0")
  .addParam("data", "Encoded function call data (hex string)")
  .addParam("walletIndices", "Comma-separated wallet indices to sign with (e.g., '0,1,2')")
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const target = taskArgs.target;
    const value = taskArgs.value;
    const data = taskArgs.data;
    const walletIndicesStr = taskArgs.walletIndices;

    // Parse wallet indices
    const walletIndices = walletIndicesStr.split(",").map((s: string) => parseInt(s.trim()));
    
    const signers = await hre.ethers.getSigners();
    
    // Validate wallet indices
    for (const idx of walletIndices) {
      if (idx >= signers.length) {
        throw new Error(`Wallet index ${idx} out of range. Available: 0-${signers.length - 1}`);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    // Get current nonce
    const nonce = await multisig.getCurrentNonce();
    const threshold = await multisig.threshold();

    console.log("=== Execute With Signatures ===\n");
    console.log("MultisigAdmin:", multisigAddress);
    console.log("Target:", target);
    console.log("Value:", value, "wei");
    console.log("Data:", data);
    console.log("Nonce:", nonce.toString());
    console.log("Threshold:", threshold.toString());
    console.log("Signing with wallet indices:", walletIndices.join(", "));
    console.log("");

    if (walletIndices.length < Number(threshold)) {
      throw new Error(`Not enough signers. Need at least ${threshold} signatures, got ${walletIndices.length}`);
    }

    // Get the transaction hash to sign
    const txHash = await multisig.getTransactionHash(target, value, data, nonce);
    console.log("Transaction hash:", txHash);

    // Collect signatures
    const signatures: string[] = [];
    console.log("\nCollecting signatures...");
    
    for (const idx of walletIndices) {
      const signer = signers[idx];
      const signature = await signTransactionHash(signer, txHash);
      signatures.push(signature);
      console.log(`  ✓ Signed by wallet ${idx}: ${signer.address}`);
    }

    console.log("\nExecuting transaction...");

    // Execute with signatures (use first signer as the executor)
    const executor = signers[walletIndices[0]];
    const tx = await multisig.connect(executor).executeWithSignatures(
      target,
      value,
      data,
      signatures,
      getDeployOptions(taskArgs)
    );
    await tx.wait();

    console.log("\n✅ Transaction executed successfully!");
    console.log("Transaction hash:", tx.hash);
  });

task("multisig-execute-with-provided-signatures", "Executes a transaction using pre-collected signatures")
  .addParam("target", "Target contract address")
  .addOptionalParam("value", "ETH value to send (in wei)", "0")
  .addParam("data", "Encoded function call data (hex string)")
  .addParam("signatures", "JSON array of signature hex strings")
  .addOptionalParam("walletIndex", "Wallet index to use as executor", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const target = taskArgs.target;
    const value = taskArgs.value;
    const data = taskArgs.data;
    const walletIndex = taskArgs.walletIndex;

    // Parse signatures
    let signatures: string[];
    try {
      signatures = JSON.parse(taskArgs.signatures);
    } catch (e) {
      throw new Error("Failed to parse signatures. Ensure it's a valid JSON array of hex strings.");
    }

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const executor = signers[walletIndex];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    const nonce = await multisig.getCurrentNonce();
    const threshold = await multisig.threshold();

    console.log("=== Execute With Provided Signatures ===\n");
    console.log("MultisigAdmin:", multisigAddress);
    console.log("Target:", target);
    console.log("Value:", value, "wei");
    console.log("Data:", data);
    console.log("Nonce:", nonce.toString());
    console.log("Threshold:", threshold.toString());
    console.log("Signatures provided:", signatures.length);
    console.log("Executor:", executor.address, `(index: ${walletIndex})`);
    console.log("");

    if (signatures.length < Number(threshold)) {
      console.warn(`⚠️  Warning: Only ${signatures.length} signatures provided, but threshold is ${threshold}`);
    }

    console.log("Executing transaction...");

    const tx = await multisig.connect(executor).executeWithSignatures(
      target,
      value,
      data,
      signatures,
      getDeployOptions(taskArgs)
    );
    await tx.wait();

    console.log("\n✅ Transaction executed successfully!");
    console.log("Transaction hash:", tx.hash);
  });

task("multisig-sign-transaction", "Signs a transaction hash for off-chain collection (does not execute)")
  .addParam("target", "Target contract address")
  .addOptionalParam("value", "ETH value to send (in wei)", "0")
  .addParam("data", "Encoded function call data (hex string)")
  .addOptionalParam("walletIndex", "Wallet index to sign with", 0, types.int)
  .addOptionalParam("nonce", "Nonce to use (defaults to current nonce from contract)", undefined, types.int)
  .setAction(async (taskArgs, hre) => {
    const target = taskArgs.target;
    const value = taskArgs.value;
    const data = taskArgs.data;
    const walletIndex = taskArgs.walletIndex;

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const signer = signers[walletIndex];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    // Use provided nonce or get current from contract
    const nonce = taskArgs.nonce !== undefined ? taskArgs.nonce : await multisig.getCurrentNonce();

    console.log("=== Sign Transaction ===\n");
    console.log("MultisigAdmin:", multisigAddress);
    console.log("Target:", target);
    console.log("Value:", value, "wei");
    console.log("Data:", data);
    console.log("Nonce:", nonce.toString());
    console.log("Signer:", signer.address, `(index: ${walletIndex})`);
    console.log("");

    // Get transaction hash
    const txHash = await multisig.getTransactionHash(target, value, data, nonce);
    console.log("Transaction hash:", txHash);

    // Sign
    const signature = await signTransactionHash(signer, txHash);
    
    console.log("\n=== Signature ===\n");
    console.log(signature);
    console.log("\nCopy this signature and collect others to use with multisig-execute-with-provided-signatures");
  });
