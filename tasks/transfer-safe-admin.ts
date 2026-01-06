import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "./args/deployOptions";

task("transfer-safe-admin", "Transfers admin rights of ERC20Safe to a new address")
  .addParam("address", "New admin address")
  .addOptionalParam("walletIndex", "Wallet derivation index to use for signing", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const newAdmin = taskArgs.address;
    const walletIndex = taskArgs.walletIndex;

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const adminWallet = signers[walletIndex];
    console.log("Current signer:", adminWallet.address, `(index: ${walletIndex})`);

    const fs = require("fs");
    const filename = "setup.config.json";
    const config = JSON.parse(fs.readFileSync(filename, "utf8"));
    const safeAddress = config["erc20Safe"];

    if (!safeAddress) {
      throw new Error("ERC20Safe address not found in setup.config.json");
    }

    const safeContractFactory = await hre.ethers.getContractFactory("ERC20Safe");
    const safe = safeContractFactory.attach(safeAddress).connect(adminWallet);

    console.log("ERC20Safe address:", safeAddress);
    console.log("Transferring admin to:", newAdmin);

    const tx = await safe.transferAdmin(newAdmin, getDeployOptions(taskArgs));
    await tx.wait();

    console.log("✅ Admin transferred successfully!");
    console.log("Transaction hash:", tx.hash);
  });
