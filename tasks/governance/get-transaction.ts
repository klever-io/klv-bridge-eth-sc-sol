import "@nomicfoundation/hardhat-toolbox";
import { task, types } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

task("multisig-get-transaction", "Gets details of a transaction in the MultisigAdmin")
  .addParam("txid", "Transaction ID to query", undefined, types.int)
  .setAction(async (taskArgs, hre) => {
    const txId = taskArgs.txid;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    const [target, value, data, executed, confirmationCount] = await multisig.getTransaction(txId);
    const threshold = await multisig.threshold();
    const confirmers = await multisig.getConfirmations(txId);

    console.log("=== Transaction", txId, "===");
    console.log("Target:", target);
    console.log("Value:", value.toString(), "wei");
    console.log("Data:", data);
    console.log("Executed:", executed);
    console.log("Confirmations:", confirmationCount.toString(), "/", threshold.toString());
    console.log("Confirmed by:", confirmers.length > 0 ? confirmers.join(", ") : "None");
    
    if (!executed) {
      if (confirmationCount >= threshold) {
        console.log("Status: ✅ Ready to execute");
      } else {
        console.log(`Status: ⏳ Waiting for ${threshold - confirmationCount} more confirmation(s)`);
      }
    } else {
      console.log("Status: ✅ Already executed");
    }
  });
