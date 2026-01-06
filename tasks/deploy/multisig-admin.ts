import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "../args/deployOptions";
import { task, types } from "hardhat/config";

task("deploy-multisig-admin", "Deploys the MultisigAdmin contract")
  .addParam(
    "owners",
    "JSON Array containing all owner addresses for the multisig",
  )
  .addParam("threshold", "Number of confirmations required to execute a transaction", undefined, types.int)
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const owners: string[] = JSON.parse(taskArgs.owners);
    const threshold = taskArgs.threshold;

    // Validate inputs
    if (owners.length === 0) {
      throw new Error("At least one owner is required");
    }
    if (threshold <= 0 || threshold > owners.length) {
      throw new Error(`Invalid threshold: must be between 1 and ${owners.length}`);
    }

    console.log("Owners:", owners);
    console.log("Threshold:", threshold);

    const [adminWallet] = await hre.ethers.getSigners();
    console.log("Deployer Address:", adminWallet.address);

    const MultisigAdmin = (await hre.ethers.getContractFactory("MultisigAdmin")).connect(adminWallet);
    const multisigContract = await MultisigAdmin.deploy(owners, threshold, getDeployOptions(taskArgs));
    await multisigContract.waitForDeployment();

    console.log("MultisigAdmin deployed to:", multisigContract.target);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const filename = "setup.config.json";
    const config = JSON.parse(fs.readFileSync(filename, "utf8"));
    config.multisigAdmin = multisigContract.target;
    config.multisigOwners = owners;
    config.multisigThreshold = threshold;

    fs.writeFileSync(filename, JSON.stringify(config));
    console.log("Configuration saved to", filename);
  });
