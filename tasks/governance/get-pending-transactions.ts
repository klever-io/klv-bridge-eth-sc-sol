import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

task("multisig-get-pending-transactions", "Gets all pending transactions in the MultisigAdmin")
  .addOptionalParam("from", "Starting index", "0")
  .addOptionalParam("limit", "Maximum number of transactions to return", "100")
  .setAction(async (taskArgs, hre) => {
    const from = parseInt(taskArgs.from);
    const limit = parseInt(taskArgs.limit);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    const transactionCount = await multisig.transactionCount();
    const threshold = await multisig.threshold();
    const to = Math.min(from + limit, Number(transactionCount));

    // Get pending transactions (not executed)
    const pendingIds = await multisig.getTransactionIds(from, to, true, false);

    console.log("=== Pending Transactions ===");
    console.log("MultisigAdmin:", multisigAddress);
    console.log("Threshold:", threshold.toString());
    console.log("Total transactions:", transactionCount.toString());
    console.log("Pending count:", pendingIds.length);
    console.log("");

    if (pendingIds.length === 0) {
      console.log("No pending transactions.");
      return;
    }

    for (const txId of pendingIds) {
      const [target, value, data, _, confirmationCount] = await multisig.getTransaction(txId);
      const confirmers = await multisig.getConfirmations(txId);

      console.log(`--- Transaction ${txId} ---`);
      console.log("  Target:", target);
      console.log("  Value:", value.toString(), "wei");
      console.log("  Data:", data.length > 66 ? data.slice(0, 66) + "..." : data);
      console.log("  Confirmations:", confirmationCount.toString(), "/", threshold.toString());
      console.log("  Confirmed by:", confirmers.length > 0 ? confirmers.join(", ") : "None");
      
      if (confirmationCount >= threshold) {
        console.log("  Status: ✅ Ready to execute");
      } else {
        console.log(`  Status: ⏳ Waiting for ${threshold - confirmationCount} more confirmation(s)`);
      }
      console.log("");
    }
  });
