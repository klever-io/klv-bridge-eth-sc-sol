import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

task("multisig-submit-transaction", "Submits a new transaction to the MultisigAdmin for confirmation")
  .addParam("target", "Target contract address")
  .addOptionalParam("value", "ETH value to send (in wei)", "0")
  .addParam("data", "Encoded function call data (hex string)")
  .addOptionalParam("walletIndex", "Wallet derivation index to use for signing", 0, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
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

    console.log("Submitting transaction to MultisigAdmin at:", multisigAddress);
    console.log("Target:", target);
    console.log("Value:", value);
    console.log("Data:", data);

    const tx = await multisig.submitTransaction(target, value, data, getDeployOptions(taskArgs));
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
    }

    console.log("Transaction hash:", tx.hash);
  });
