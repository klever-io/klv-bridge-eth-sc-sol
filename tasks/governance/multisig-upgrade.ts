import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";

/**
 * Task to upgrade a contract through the MultisigAdmin.
 * 
 * The upgrade process for TransparentUpgradeableProxy:
 * 1. Deploy new implementation contract
 * 2. Call ProxyAdmin.upgradeAndCall(proxy, newImpl, data) or ProxyAdmin.upgrade(proxy, newImpl)
 * 
 * Since ProxyAdmin is owned by MultisigAdmin, we need to execute the upgrade through multisig.
 */

task("multisig-upgrade-safe", "Upgrades the ERC20Safe contract through MultisigAdmin")
  .addOptionalParam("walletIndices", "Comma-separated wallet indices to sign with (e.g., '0,1,2')")
  .addOptionalParam("walletIndex", "Single wallet index for on-chain confirmation flow", 0, types.int)
  .addFlag("deploy", "Only deploy the new implementation (do not execute upgrade)")
  .addFlag("onchain", "Use on-chain confirmation flow instead of signatures")
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const walletIndex = taskArgs.walletIndex;
    const deployOnly = taskArgs.deploy;
    const useOnchain = taskArgs.onchain;

    const signers = await hre.ethers.getSigners();
    const deployer = signers[walletIndex];
    console.log("Deployer:", deployer.address, `(index: ${walletIndex})`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    
    const safeProxyAddress = config["erc20Safe"];
    const multisigAddress = config["multisigAdmin"];

    if (!safeProxyAddress) {
      throw new Error("ERC20Safe address not found in setup.config.json");
    }
    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    // Get ProxyAdmin address
    const proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(safeProxyAddress);
    const currentImplAddress = await hre.upgrades.erc1967.getImplementationAddress(safeProxyAddress);

    console.log("\n=== Current State ===");
    console.log("ERC20Safe Proxy:", safeProxyAddress);
    console.log("ProxyAdmin:", proxyAdminAddress);
    console.log("Current Implementation:", currentImplAddress);
    console.log("MultisigAdmin:", multisigAddress);

    // Step 1: Deploy new implementation
    console.log("\n=== Deploying New Implementation ===");
    const ERC20SafeFactory = (await hre.ethers.getContractFactory("ERC20Safe")).connect(deployer);
    
    // Validate the upgrade is safe
    await hre.upgrades.validateUpgrade(safeProxyAddress, ERC20SafeFactory);
    console.log("✅ Upgrade validation passed");

    // Deploy implementation only (not through proxy)
    const newImplAddress = await hre.upgrades.deployImplementation(ERC20SafeFactory, {
      kind: "transparent",
    });
    console.log("New Implementation deployed to:", newImplAddress);

    if (deployOnly) {
      console.log("\n=== Deploy Only Mode ===");
      console.log("New implementation deployed. To complete upgrade, run:");
      console.log(`\nnpx hardhat multisig-upgrade-proxy --proxy ${safeProxyAddress} --impl ${newImplAddress} --wallet-indices "0,1" --network <network>`);
      return;
    }

    // Step 2: Encode ProxyAdmin.upgradeAndCall or upgrade
    // ProxyAdmin interface
    const proxyAdminAbi = [
      "function upgradeAndCall(address proxy, address implementation, bytes memory data) external payable",
      "function upgrade(address proxy, address implementation) external",
    ];

    const proxyAdminInterface = new hre.ethers.Interface(proxyAdminAbi);
    
    // Use upgrade (no initialization call needed for existing proxy)
    const upgradeCalldata = proxyAdminInterface.encodeFunctionData("upgradeAndCall", [
      safeProxyAddress,
      newImplAddress,
      "0x", // empty data - no initialization call
    ]);

    console.log("\n=== Upgrade Calldata ===");
    console.log("Target (ProxyAdmin):", proxyAdminAddress);
    console.log("Calldata:", upgradeCalldata);

    // Step 3: Execute through multisig
    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress);
    const threshold = await multisig.threshold();

    if (useOnchain) {
      // On-chain confirmation flow
      console.log("\n=== Submitting Transaction (On-chain Flow) ===");
      const tx = await multisig.connect(deployer).submitTransaction(
        proxyAdminAddress,
        0,
        upgradeCalldata,
        getDeployOptions(taskArgs)
      );
      const receipt = await tx.wait();
      
      // Get transaction ID from event
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = multisig.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "TransactionSubmitted";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = multisig.interface.parseLog({ topics: event.topics as string[], data: event.data });
        console.log("Transaction submitted with ID:", parsed?.args.txId.toString());
        console.log("\nNext steps:");
        console.log(`1. Have other owners confirm: npx hardhat multisig-confirm-transaction --txid ${parsed?.args.txId} --wallet-index <n> --network <network>`);
        console.log(`2. Execute when threshold met: npx hardhat multisig-execute-transaction --txid ${parsed?.args.txId} --network <network>`);
      }
    } else {
      // Signature-based flow
      if (!taskArgs.walletIndices) {
        console.log("\n=== Ready for Signature Execution ===");
        console.log("To execute with signatures, run:");
        console.log(`\nnpx hardhat multisig-execute-with-signatures --target ${proxyAdminAddress} --data "${upgradeCalldata}" --wallet-indices "0,1" --network <network>`);
        return;
      }

      const walletIndices = taskArgs.walletIndices.split(",").map((s: string) => parseInt(s.trim()));
      
      if (walletIndices.length < Number(threshold)) {
        throw new Error(`Not enough signers. Need at least ${threshold} signatures, got ${walletIndices.length}`);
      }

      // Get nonce and hash
      const nonce = await multisig.getCurrentNonce();
      const txHash = await multisig.getTransactionHash(proxyAdminAddress, 0, upgradeCalldata, nonce);

      console.log("\n=== Collecting Signatures ===");
      console.log("Nonce:", nonce.toString());
      console.log("Transaction hash:", txHash);

      // Collect signatures
      const signatures: string[] = [];
      for (const idx of walletIndices) {
        const signer = signers[idx];
        const signature = await signer.signMessage(Buffer.from(txHash.slice(2), "hex"));
        signatures.push(signature);
        console.log(`  ✓ Signed by wallet ${idx}: ${signer.address}`);
      }

      console.log("\n=== Executing Upgrade ===");
      const tx = await multisig.connect(signers[walletIndices[0]]).executeWithSignatures(
        proxyAdminAddress,
        0,
        upgradeCalldata,
        signatures,
        getDeployOptions(taskArgs)
      );
      await tx.wait();

      console.log("✅ Upgrade executed successfully!");
      console.log("Transaction hash:", tx.hash);

      // Verify
      const newImpl = await hre.upgrades.erc1967.getImplementationAddress(safeProxyAddress);
      console.log("\nVerified new implementation:", newImpl);
    }
  });

task("multisig-upgrade-proxy", "Upgrades any proxy through MultisigAdmin with a pre-deployed implementation")
  .addParam("proxy", "Address of the TransparentUpgradeableProxy")
  .addParam("impl", "Address of the new implementation contract")
  .addOptionalParam("data", "Initialization calldata (default: empty)", "0x")
  .addParam("walletIndices", "Comma-separated wallet indices to sign with (e.g., '0,1,2')")
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const proxyAddress = taskArgs.proxy;
    const newImplAddress = taskArgs.impl;
    const initData = taskArgs.data;
    const walletIndices = taskArgs.walletIndices.split(",").map((s: string) => parseInt(s.trim()));

    const signers = await hre.ethers.getSigners();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    // Get ProxyAdmin address
    const proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(proxyAddress);
    const currentImplAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log("=== Upgrade Info ===");
    console.log("Proxy:", proxyAddress);
    console.log("ProxyAdmin:", proxyAdminAddress);
    console.log("Current Implementation:", currentImplAddress);
    console.log("New Implementation:", newImplAddress);
    console.log("MultisigAdmin:", multisigAddress);

    // Encode upgradeAndCall
    const proxyAdminAbi = [
      "function upgradeAndCall(address proxy, address implementation, bytes memory data) external payable",
    ];
    const proxyAdminInterface = new hre.ethers.Interface(proxyAdminAbi);
    const upgradeCalldata = proxyAdminInterface.encodeFunctionData("upgradeAndCall", [
      proxyAddress,
      newImplAddress,
      initData,
    ]);

    // Execute through multisig with signatures
    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress);
    const threshold = await multisig.threshold();

    if (walletIndices.length < Number(threshold)) {
      throw new Error(`Not enough signers. Need at least ${threshold} signatures, got ${walletIndices.length}`);
    }

    const nonce = await multisig.getCurrentNonce();
    const txHash = await multisig.getTransactionHash(proxyAdminAddress, 0, upgradeCalldata, nonce);

    console.log("\n=== Collecting Signatures ===");
    const signatures: string[] = [];
    for (const idx of walletIndices) {
      const signer = signers[idx];
      const signature = await signer.signMessage(Buffer.from(txHash.slice(2), "hex"));
      signatures.push(signature);
      console.log(`  ✓ Signed by wallet ${idx}: ${signer.address}`);
    }

    console.log("\n=== Executing Upgrade ===");
    const tx = await multisig.connect(signers[walletIndices[0]]).executeWithSignatures(
      proxyAdminAddress,
      0,
      upgradeCalldata,
      signatures,
      getDeployOptions(taskArgs)
    );
    await tx.wait();

    console.log("✅ Upgrade executed successfully!");
    console.log("Transaction hash:", tx.hash);

    // Verify
    const newImpl = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("\nVerified new implementation:", newImpl);
  });
