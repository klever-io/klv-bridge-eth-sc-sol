import "@nomicfoundation/hardhat-toolbox";

task("deploy-permit-tokens", "Deploys ERC20 contracts with EIP-2612 permit support")
  .addParam("name", "Name of the token to deploy")
  .addParam("symbol", "Symbol of the token to deploy")
  .addParam("decimals", "Num of decimals of the token to deploy")
  .setAction(async (taskArgs, hre) => {
    const fs = require("fs");
    const filename = "setup.config.json";
    const config = JSON.parse(fs.readFileSync(filename, "utf8"));
    console.log("Current contract addresses");
    const safeAddress = config["erc20Safe"];
    const safeContractFactory = await hre.ethers.getContractFactory("ERC20Safe");
    const safe = safeContractFactory.attach(safeAddress);
    console.log("Safe at: ", safe.target);

    const [adminWallet] = await hre.ethers.getSigners();
    console.log("Deploying with wallet: ", adminWallet.address);

    const tokenName = taskArgs.name;
    const tokenSymbol = taskArgs.symbol;
    const decimals = taskArgs.decimals;

    // Deploy PermitERC20 token
    const permitERC20Factory = await hre.ethers.getContractFactory("PermitERC20");
    const permitToken = await permitERC20Factory.deploy(tokenName, tokenSymbol, decimals);
    await permitToken.waitForDeployment();

    console.log("PermitERC20 Token deployed to:", permitToken.target);
    console.log("Token Name:", tokenName);
    console.log("Token Symbol:", tokenSymbol);
    console.log("Token supports EIP-2612 permit");
  });
