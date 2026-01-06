import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";

task("transfer-proxy-admin", "Transfers ownership of the TransparentUpgradeableProxy's ProxyAdmin")
  .addParam("proxy", "Address of the TransparentUpgradeableProxy (e.g., ERC20Safe or Bridge)")
  .addParam("newowner", "New owner address for the ProxyAdmin")
  .addOptionalParam("walletIndex", "Wallet derivation index to use for signing", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const proxyAddress = taskArgs.proxy;
    const newOwner = taskArgs.newowner;
    const walletIndex = taskArgs.walletIndex;

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const signer = signers[walletIndex];
    console.log("Signer:", signer.address, `(index: ${walletIndex})`);

    // Get the ProxyAdmin address from the proxy
    const proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(proxyAddress);
    console.log("Proxy address:", proxyAddress);
    console.log("ProxyAdmin address:", proxyAdminAddress);

    // ProxyAdmin ABI for transferOwnership
    const proxyAdminAbi = [
      "function owner() view returns (address)",
      "function transferOwnership(address newOwner) external",
    ];

    const proxyAdmin = new hre.ethers.Contract(proxyAdminAddress, proxyAdminAbi, signer);

    // Get current owner
    const currentOwner = await proxyAdmin.owner();
    console.log("Current ProxyAdmin owner:", currentOwner);
    console.log("New owner:", newOwner);

    if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`Signer ${signer.address} is not the current owner of ProxyAdmin`);
    }

    console.log("\nTransferring ownership...");
    const tx = await proxyAdmin.transferOwnership(newOwner, getDeployOptions(taskArgs));
    await tx.wait();

    console.log("✅ ProxyAdmin ownership transferred successfully!");
    console.log("Transaction hash:", tx.hash);

    // Verify
    const newOwnerVerified = await proxyAdmin.owner();
    console.log("Verified new owner:", newOwnerVerified);
  });

task("get-proxy-admin", "Gets the ProxyAdmin address and owner for a TransparentUpgradeableProxy")
  .addParam("proxy", "Address of the TransparentUpgradeableProxy")
  .setAction(async (taskArgs, hre) => {
    const proxyAddress = taskArgs.proxy;

    // Get the ProxyAdmin address
    const proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(proxyAddress);
    
    // Get implementation address
    const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

    // ProxyAdmin ABI
    const proxyAdminAbi = [
      "function owner() view returns (address)",
    ];

    const proxyAdmin = new hre.ethers.Contract(proxyAdminAddress, proxyAdminAbi, hre.ethers.provider);
    const owner = await proxyAdmin.owner();

    console.log("=== Proxy Info ===");
    console.log("Proxy address:", proxyAddress);
    console.log("ProxyAdmin address:", proxyAdminAddress);
    console.log("ProxyAdmin owner:", owner);
    console.log("Implementation address:", implementationAddress);
  });
