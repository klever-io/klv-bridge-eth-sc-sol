import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";

/**
 * Helper task to encode calldata for multisig transactions.
 * This generates the hex-encoded function call data needed for multisig-submit-transaction.
 * 
 * Usage:
 *   npx hardhat multisig-encode-calldata --contract safe --function whitelistToken --args '[...]'
 *   
 * Then use the output with:
 *   npx hardhat multisig-submit-transaction --target <address> --data <encoded-data>
 */

// Supported functions and their parameter descriptions
const SUPPORTED_FUNCTIONS: Record<string, Record<string, string[]>> = {
  safe: {
    whitelistToken: ["address token", "uint256 minAmount", "uint256 maxAmount", "bool mintBurn", "bool native", "uint256 totalBalance", "uint256 mintBalance", "uint256 burnBalance"],
    removeTokenFromWhitelist: ["address token"],
    setBatchBlockLimit: ["uint8 newBatchBlockLimit"],
    setBatchSettleLimit: ["uint8 newBatchSettleLimit"],
    setBatchSize: ["uint16 newBatchSize"],
    setTokenMinLimit: ["address token", "uint256 amount"],
    setTokenMaxLimit: ["address token", "uint256 amount"],
    initSupply: ["address tokenAddress", "uint256 amount"],
    initSupplyMintBurn: ["address tokenAddress", "uint256 mintAmount", "uint256 burnAmount"],
    resetTotalBalance: ["address tokenAddress"],
    recoverLostFunds: ["address tokenAddress"],
    setBridge: ["address newBridge"],
    pause: [],
    unpause: [],
    transferAdmin: ["address newAdmin"],
  },
  bridge: {
    setQuorum: ["uint256 newQuorum"],
    setBatchSettleLimit: ["uint8 newBatchSettleLimit"],
    addRelayer: ["address account"],
    removeRelayer: ["address account"],
    pause: [],
    unpause: [],
    transferAdmin: ["address newAdmin"],
  },
  multisig: {
    addOwner: ["address owner"],
    removeOwner: ["address owner"],
    replaceOwner: ["address oldOwner", "address newOwner"],
    changeThreshold: ["uint256 threshold"],
  },
  erc20: {
    approve: ["address spender", "uint256 amount"],
    transfer: ["address to", "uint256 amount"],
  },
};

task("multisig-encode-calldata", "Encodes function call data for use with multisig-submit-transaction")
  .addParam("contract", "Contract type: 'safe', 'bridge', 'multisig', or 'erc20'")
  .addParam("function", "Function name to encode")
  .addOptionalParam("args", "JSON array of function arguments", "[]")
  .addOptionalParam("token", "Token address (required for erc20 contract type)")
  .addFlag("list", "List all supported functions for the contract")
  .setAction(async (taskArgs, hre) => {
    const contractType = taskArgs.contract.toLowerCase();
    const functionName = taskArgs.function;
    const listFunctions = taskArgs.list;

    // Validate contract type
    if (!SUPPORTED_FUNCTIONS[contractType]) {
      console.error("Unsupported contract type:", contractType);
      console.error("Supported types:", Object.keys(SUPPORTED_FUNCTIONS).join(", "));
      return;
    }

    // List functions mode
    if (listFunctions) {
      console.log(`\n=== Supported functions for '${contractType}' ===\n`);
      for (const [fn, params] of Object.entries(SUPPORTED_FUNCTIONS[contractType])) {
        const paramStr = params.length > 0 ? params.join(", ") : "none";
        console.log(`  ${fn}(${paramStr})`);
      }
      console.log("\nUsage example:");
      console.log(`  npx hardhat multisig-encode-calldata --contract ${contractType} --function <functionName> --args '[...]'`);
      return;
    }

    // Validate function
    if (!SUPPORTED_FUNCTIONS[contractType][functionName]) {
      console.error(`Unsupported function '${functionName}' for contract '${contractType}'`);
      console.error("Supported functions:", Object.keys(SUPPORTED_FUNCTIONS[contractType]).join(", "));
      console.error("\nUse --list flag to see function signatures");
      return;
    }

    // Parse arguments
    let args: any[];
    try {
      args = JSON.parse(taskArgs.args);
    } catch (e) {
      console.error("Failed to parse args. Ensure it's valid JSON.");
      console.error("Example: --args '[\"0x1234...\", 100, true]'");
      return;
    }

    // Get contract factory based on type
    let contractFactory;
    let targetAddress: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync("setup.config.json", "utf8"));

    switch (contractType) {
      case "safe":
        contractFactory = await hre.ethers.getContractFactory("ERC20Safe");
        targetAddress = config.erc20Safe;
        break;
      case "bridge":
        contractFactory = await hre.ethers.getContractFactory("Bridge");
        targetAddress = config.bridge;
        break;
      case "multisig":
        contractFactory = await hre.ethers.getContractFactory("MultisigAdmin");
        targetAddress = config.multisigAdmin;
        break;
      case "erc20":
        if (!taskArgs.token) {
          console.error("Error: --token parameter is required for erc20 contract type");
          console.error("Example: --contract erc20 --function approve --token 0x... --args '[\"0xSpender\", \"1000000000000000000\"]'");
          return;
        }
        contractFactory = await hre.ethers.getContractFactory("GenericERC20");
        targetAddress = taskArgs.token;
        break;
    }

    if (!contractFactory) {
      console.error("Could not load contract factory");
      return;
    }

    // Encode the function call
    try {
      const calldata = contractFactory.interface.encodeFunctionData(functionName, args);
      
      console.log("\n=== Encoded Calldata ===\n");
      console.log("Contract:", contractType);
      console.log("Function:", functionName);
      console.log("Arguments:", JSON.stringify(args));
      console.log("Target:", targetAddress || "<not found in config>");
      console.log("\nCalldata:");
      console.log(calldata);
      
      console.log("\n=== Ready-to-use Command ===\n");
      if (targetAddress) {
        console.log(`npx hardhat multisig-submit-transaction --target ${targetAddress} --data "${calldata}" --network <network>`);
      } else {
        console.log(`npx hardhat multisig-submit-transaction --target <address> --data "${calldata}" --network <network>`);
      }
    } catch (e: any) {
      console.error("Failed to encode function call:", e.message);
      console.error("\nExpected parameters:", SUPPORTED_FUNCTIONS[contractType][functionName].join(", ") || "none");
      console.error("Provided arguments:", JSON.stringify(args));
    }
  });

task("multisig-list-functions", "Lists all supported functions for encoding calldata")
  .setAction(async () => {
    console.log("\n=== Supported Functions for Multisig Calldata Encoding ===\n");
    
    for (const [contract, functions] of Object.entries(SUPPORTED_FUNCTIONS)) {
      console.log(`\n--- ${contract.toUpperCase()} ---`);
      for (const [fn, params] of Object.entries(functions)) {
        const paramStr = params.length > 0 ? params.join(", ") : "none";
        console.log(`  ${fn}(${paramStr})`);
      }
    }
    
    console.log("\n\nUsage:");
    console.log("  npx hardhat multisig-encode-calldata --contract <type> --function <name> --args '<json-array>'");
    console.log("\nExamples:");
    console.log("  npx hardhat multisig-encode-calldata --contract safe --function pause --args '[]'");
    console.log('  npx hardhat multisig-encode-calldata --contract safe --function whitelistToken --args \'["0x...", 25, 100, false, true, 0, 0, 0]\'');
    console.log('  npx hardhat multisig-encode-calldata --contract bridge --function setQuorum --args \'[3]\'');
    console.log('  npx hardhat multisig-encode-calldata --contract multisig --function addOwner --args \'["0x..."]\'');
    console.log('  npx hardhat multisig-encode-calldata --contract erc20 --function approve --token 0xTokenAddr --args \'["0xSpender", "1000000000000000000"]\'');
  });
