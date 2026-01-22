import "@nomicfoundation/hardhat-toolbox";
import { getDeployOptions } from "./args/deployOptions";

task("deposit-with-permit", "Deposits token using EIP-2612 permit (no prior approval needed)")
  .addParam("address", "Address of the token to be sent (must support EIP-2612)")
  .addParam("amount", "Amount we want to deposit (full value, with decimals)")
  .addParam("receiver", "Klever Blockchain address hex encoded of the receiver")
  .addOptionalParam("deadline", "Permit deadline in seconds from now (default: 3600)", "3600")
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
    const deadlineOffset = parseInt(taskArgs.deadline);

    // Get the token contract with permit interface
    const tokenAbi = [
      "function name() view returns (string)",
      "function nonces(address owner) view returns (uint256)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)",
      "function balanceOf(address) view returns (uint256)"
    ];
    const token = new hre.ethers.Contract(tokenAddress, tokenAbi, signer);

    // Get current block timestamp and set deadline
    const block = await hre.ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + deadlineOffset;

    // Get the nonce for the signer
    const nonce = await token.nonces(signer.address);
    const tokenName = await token.name();

    console.log("Token:", tokenName);
    console.log("Amount:", amount);
    console.log("Receiver:", receiver);
    console.log("Deadline:", deadline);
    console.log("Nonce:", nonce.toString());

    // Get chain ID
    const network = await hre.ethers.provider.getNetwork();
    const chainId = network.chainId;

    // Build the permit signature
    const domain = {
      name: tokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: tokenAddress
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };

    const message = {
      owner: signer.address,
      spender: safeAddress,
      value: amount,
      nonce: nonce,
      deadline: deadline
    };

    console.log("Signing permit message...");
    const signature = await signer.signTypedData(domain, types, message);
    const sig = hre.ethers.Signature.from(signature);

    console.log("Permit signature obtained");
    console.log("v:", sig.v);
    console.log("r:", sig.r);
    console.log("s:", sig.s);

    // Execute depositWithPermit
    console.log("Executing depositWithPermit...");
    const tx = await safe.depositWithPermit(
      tokenAddress,
      amount,
      Buffer.from(receiver, "hex"),
      deadline,
      sig.v,
      sig.r,
      sig.s,
      getDeployOptions(taskArgs)
    );

    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt!.blockNumber);
    console.log("Deposit with permit successful!");
  });
