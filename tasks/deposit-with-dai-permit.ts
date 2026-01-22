import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "./args/deployOptions";

task("deposit-with-dai-permit", "Deposits token using DAI-style permit (no prior approval needed)")
  .addParam("address", "Address of the token to be sent (must support DAI-style permit)")
  .addParam("amount", "Amount we want to deposit (full value, with decimals)")
  .addParam("receiver", "Klever Blockchain address hex encoded of the receiver")
  .addOptionalParam("expiry", "Permit expiry in seconds from now (default: 3600)", "3600")
  .addOptionalParam("price", "Gas price in gwei for this transaction", undefined)
  .setAction(async (taskArgs, hre) => {
    const fs = require("fs");
    const filename = "setup.config.json";
    let config = JSON.parse(fs.readFileSync(filename, "utf8"));
    const [signer] = await hre.ethers.getSigners();
    const safeAddress = config["erc20Safe"];

    console.log("Signer address:", signer.address);
    console.log("Safe address:", safeAddress);

    const safeContractFactory = await hre.ethers.getContractFactory("ERC20Safe");
    const safe = safeContractFactory.attach(safeAddress).connect(signer);

    const tokenAddress = taskArgs.address;
    const amount = taskArgs.amount;
    const receiver = taskArgs.receiver;
    const expiryOffset = parseInt(taskArgs.expiry);

    // Get the token contract with DAI permit interface
    const tokenAbi = [
      "function name() view returns (string)",
      "function nonces(address owner) view returns (uint256)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)",
      "function balanceOf(address) view returns (uint256)"
    ];
    const token = new hre.ethers.Contract(tokenAddress, tokenAbi, signer);

    // Get current block timestamp and set expiry
    const block = await hre.ethers.provider.getBlock("latest");
    const expiry = block!.timestamp + expiryOffset;

    // Get the nonce for the signer
    const nonce = await token.nonces(signer.address);
    const tokenName = await token.name();

    console.log("Token:", tokenName);
    console.log("Amount:", amount);
    console.log("Receiver:", receiver);
    console.log("Expiry:", expiry);
    console.log("Nonce:", nonce.toString());

    // Get chain ID
    const network = await hre.ethers.provider.getNetwork();
    const chainId = network.chainId;

    // Build the DAI-style permit signature
    const domain = {
      name: tokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: tokenAddress
    };

    const types = {
      Permit: [
        { name: "holder", type: "address" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "allowed", type: "bool" }
      ]
    };

    const message = {
      holder: signer.address,
      spender: safeAddress,
      nonce: nonce,
      expiry: expiry,
      allowed: true
    };

    console.log("Signing DAI-style permit message...");
    const signature = await signer.signTypedData(domain, types, message);
    const sig = hre.ethers.Signature.from(signature);

    console.log("Permit signature obtained");
    console.log("v:", sig.v);
    console.log("r:", sig.r);
    console.log("s:", sig.s);

    // Execute depositWithDAIPermit
    console.log("Executing depositWithDAIPermit...");
    const tx = await safe.depositWithDAIPermit(
      tokenAddress,
      amount,
      Buffer.from(receiver, "hex"),
      nonce,
      expiry,
      sig.v,
      sig.r,
      sig.s,
      getDeployOptions(taskArgs)
    );

    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt!.blockNumber);
    console.log("Deposit with DAI permit successful!");
  });
