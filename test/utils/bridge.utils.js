const { ethers } = require("hardhat");

function getExecuteTransferData(tokenAddresses, recipientAddresses, amounts, depositNonces, batchNonce) {
  const signMessageDefinition = ["address[]", "address[]", "uint256[]", "uint256[]", "uint256", "string"];
  const signMessageData = [
    recipientAddresses,
    tokenAddresses,
    amounts,
    depositNonces,
    batchNonce,
    "ExecuteBatchedTransfer",
  ];

  const abiCoder = new ethers.AbiCoder();
  const bytesToSign = abiCoder.encode(signMessageDefinition, signMessageData);
  const signData = ethers.keccak256(bytesToSign);

  return ethers.toBeArray(signData);
}

async function getSignaturesForExecuteTransfer(
  tokenAddresses,
  recipientAddresses,
  amounts,
  depositNonces,
  batchNonce,
  wallets,
) {
  const dataToSign = getExecuteTransferData(tokenAddresses, recipientAddresses, amounts, depositNonces, batchNonce);
  let signatures = [];
  for (const wallet of wallets) {
    const signature = await wallet.signMessage(dataToSign);
    signatures.push(signature);
  }
  return signatures;
}

// Generic signature generation for quorum-protected operations
async function getSignaturesForAction(params, actionString, wallets) {
  const abiCoder = new ethers.AbiCoder();
  const types = params.map(p => p.type);
  const values = params.map(p => p.value);
  types.push("string");
  values.push(actionString);
  
  const bytesToSign = abiCoder.encode(types, values);
  const signData = ethers.keccak256(bytesToSign);
  const dataToSign = ethers.toBeArray(signData);
  
  let signatures = [];
  for (const wallet of wallets) {
    const signature = await wallet.signMessage(dataToSign);
    signatures.push(signature);
  }
  return signatures;
}

async function getSignaturesForWhitelistToken(
  token,
  minimumAmount,
  maximumAmount,
  mintBurn,
  native,
  totalBalance,
  mintBalance,
  burnBalance,
  nonce,
  wallets
) {
  return getSignaturesForAction([
    { type: "address", value: token },
    { type: "uint256", value: minimumAmount },
    { type: "uint256", value: maximumAmount },
    { type: "bool", value: mintBurn },
    { type: "bool", value: native },
    { type: "uint256", value: totalBalance },
    { type: "uint256", value: mintBalance },
    { type: "uint256", value: burnBalance },
    { type: "uint256", value: nonce },
  ], "WhitelistToken", wallets);
}

async function getSignaturesForRemoveToken(token, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: token },
    { type: "uint256", value: nonce },
  ], "RemoveToken", wallets);
}

async function getSignaturesForSetTokenLimits(token, minAmount, maxAmount, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: token },
    { type: "uint256", value: minAmount },
    { type: "uint256", value: maxAmount },
    { type: "uint256", value: nonce },
  ], "SetTokenLimits", wallets);
}

async function getSignaturesForUpdateSafeBridge(newBridge, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: newBridge },
    { type: "uint256", value: nonce },
  ], "SetBridge", wallets);
}

async function getSignaturesForRecoverLostFunds(token, recipient, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: token },
    { type: "address", value: recipient },
    { type: "uint256", value: nonce },
  ], "RecoverFunds", wallets);
}

async function getSignaturesForResetTotalBalance(token, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: token },
    { type: "uint256", value: nonce },
  ], "ResetBalance", wallets);
}

async function getSignaturesForSetQuorum(newQuorum, nonce, wallets) {
  return getSignaturesForAction([
    { type: "uint256", value: newQuorum },
    { type: "uint256", value: nonce },
  ], "SetQuorum", wallets);
}

async function getSignaturesForUnpause(nonce, wallets) {
  return getSignaturesForAction([
    { type: "uint256", value: nonce },
  ], "Unpause", wallets);
}

async function getSignaturesForAddRelayer(account, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: account },
    { type: "uint256", value: nonce },
  ], "AddRelayer", wallets);
}

async function getSignaturesForRemoveRelayer(account, nonce, wallets) {
  return getSignaturesForAction([
    { type: "address", value: account },
    { type: "uint256", value: nonce },
  ], "RemoveRelayer", wallets);
}

module.exports = {
  getExecuteTransferData,
  getSignaturesForExecuteTransfer,
  getSignaturesForAction,
  getSignaturesForWhitelistToken,
  getSignaturesForRemoveToken,
  getSignaturesForSetTokenLimits,
  getSignaturesForUpdateSafeBridge,
  getSignaturesForRecoverLostFunds,
  getSignaturesForResetTotalBalance,
  getSignaturesForSetQuorum,
  getSignaturesForUnpause,
  getSignaturesForAddRelayer,
  getSignaturesForRemoveRelayer,
};
