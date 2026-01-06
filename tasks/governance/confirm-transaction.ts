import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

task("multisig-confirm-transaction", "Confirms a pending transaction in the MultisigAdmin")
  .addParam("txid", "Transaction ID to confirm", undefined, types.int)
  .addOptionalParam("walletIndex", "Wallet derivation index to use for signing", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const txId = taskArgs.txid;
    const walletIndex = taskArgs.walletIndex;

    const signers = await hre.ethers.getSigners();
    if (walletIndex >= signers.length) {
      throw new Error(`Wallet index ${walletIndex} out of range. Available: 0-${signers.length - 1}`);
    }
    const signer = signers[walletIndex];
    console.log("Signer Address:", signer.address, `(index: ${walletIndex})`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress).connect(signer) as MultisigAdmin;

    console.log("Confirming transaction ID:", txId);

    const tx = await multisig.confirmTransaction(txId, getDeployOptions(taskArgs));
    await tx.wait();

    const confirmationCount = await multisig.getConfirmationCount(txId);
    const threshold = await multisig.threshold();

    console.log("Transaction hash:", tx.hash);
    console.log("Confirmation count:", confirmationCount.toString(), "/", threshold.toString());
    
    if (confirmationCount >= threshold) {
      console.log("✅ Threshold met! Transaction can be executed.");
    } else {
      console.log(`⏳ Waiting for ${threshold - confirmationCount} more confirmation(s).`);
    }
  });
