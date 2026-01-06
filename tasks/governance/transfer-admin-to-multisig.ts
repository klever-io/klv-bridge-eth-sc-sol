import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";
import { AdminRole } from "../../typechain";

task("transfer-admin-to-multisig", "Transfers admin rights of Safe and/or Bridge to the MultisigAdmin")
  .addFlag("safe", "Transfer admin of ERC20Safe to MultisigAdmin")
  .addFlag("bridge", "Transfer admin of Bridge to MultisigAdmin")
  .addOptionalParam("walletIndex", "Wallet derivation index to use for signing", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const transferSafe = taskArgs.safe;
    const transferBridge = taskArgs.bridge;
    const walletIndex = taskArgs.walletIndex;

    if (!transferSafe && !transferBridge) {
      throw new Error("Specify at least one of --safe or --bridge flags");
    }

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const adminWallet = signers[walletIndex];
    console.log("Current Admin Address:", adminWallet.address, `(index: ${walletIndex})`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json. Deploy it first.");
    }

    console.log("MultisigAdmin Address:", multisigAddress);
    console.log("");

    if (transferSafe) {
      const safeAddress = config["erc20Safe"];
      if (!safeAddress) {
        throw new Error("ERC20Safe address not found in setup.config.json");
      }

      const safeFactory = await hre.ethers.getContractFactory("ERC20Safe");
      const safe = safeFactory.attach(safeAddress).connect(adminWallet) as AdminRole;

      console.log("Transferring ERC20Safe admin to MultisigAdmin...");
      const tx = await safe.transferAdmin(multisigAddress, getDeployOptions(taskArgs));
      await tx.wait();
      console.log("✅ ERC20Safe admin transferred. Tx:", tx.hash);
    }

    if (transferBridge) {
      const bridgeAddress = config["bridge"];
      if (!bridgeAddress) {
        throw new Error("Bridge address not found in setup.config.json");
      }

      const bridgeFactory = await hre.ethers.getContractFactory("Bridge");
      const bridge = bridgeFactory.attach(bridgeAddress).connect(adminWallet) as AdminRole;

      console.log("Transferring Bridge admin to MultisigAdmin...");
      const tx = await bridge.transferAdmin(multisigAddress, getDeployOptions(taskArgs));
      await tx.wait();
      console.log("✅ Bridge admin transferred. Tx:", tx.hash);
    }

    console.log("");
    console.log("Admin transfer complete. All admin operations now require multisig approval.");
  });
