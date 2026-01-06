import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { MultisigAdmin } from "../../typechain";

task("multisig-get-info", "Gets information about the MultisigAdmin contract")
  .setAction(async (taskArgs, hre) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));
    const multisigAddress = config["multisigAdmin"];

    if (!multisigAddress) {
      throw new Error("MultisigAdmin address not found in setup.config.json");
    }

    const multisigFactory = await hre.ethers.getContractFactory("MultisigAdmin");
    const multisig = multisigFactory.attach(multisigAddress) as MultisigAdmin;

    const owners = await multisig.getOwners();
    const threshold = await multisig.threshold();
    const transactionCount = await multisig.transactionCount();
    const nonce = await multisig.getCurrentNonce();
    const balance = await hre.ethers.provider.getBalance(multisigAddress);

    // Count pending and executed
    const pendingCount = await multisig.getTransactionCount(true, false);
    const executedCount = await multisig.getTransactionCount(false, true);

    console.log("=== MultisigAdmin Info ===");
    console.log("Address:", multisigAddress);
    console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
    console.log("");
    console.log("=== Configuration ===");
    console.log("Threshold:", threshold.toString());
    console.log("Owner count:", owners.length);
    console.log("Owners:");
    owners.forEach((owner: string, i: number) => {
      console.log(`  ${i + 1}. ${owner}`);
    });
    console.log("");
    console.log("=== Transactions ===");
    console.log("Total:", transactionCount.toString());
    console.log("Pending:", pendingCount.toString());
    console.log("Executed:", executedCount.toString());
    console.log("Signature nonce:", nonce.toString());
  });
