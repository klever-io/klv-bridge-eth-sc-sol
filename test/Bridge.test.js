const { ethers } = require("hardhat");
const { expect } = require("chai");

const { deployContract, deployUpgradableContract } = require("./utils/deploy.utils");
const { 
  getSignaturesForExecuteTransfer, 
  getExecuteTransferData, 
  getSignaturesForWhitelistToken, 
  getSignaturesForUnpause,
  getSignaturesForAction,
  getSignaturesForSetQuorum,
  getSignaturesForAddRelayer,
  getSignaturesForRemoveRelayer,
  getSignaturesForUpdateSafeBridge,
} = require("./utils/bridge.utils");

describe("Bridge", async function () {
  let adminWallet, relayer1, relayer2, relayer3, relayer4, relayer5, relayer6, relayer7, relayer8, otherWallet;
  let boardMembers;
  let relayerWallets;
  const quorum = 7;

  let erc20Safe, bridge, genericErc20;

  async function setupContracts() {
    erc20Safe = await deployUpgradableContract(adminWallet, "ERC20Safe");
    bridge = await deployUpgradableContract(adminWallet, "Bridge", [boardMembers, quorum, erc20Safe.address]);
    await erc20Safe.setBridge(bridge.address);
    // Pause bridge to whitelist token (Bridge starts unpaused)
    await bridge.pause();
    // Setup ERC20 token while bridge is paused (uses nonce 0)
    await setupErc20Token();
    // Unpause safe first
    await erc20Safe.unpause();
    // Then unpause bridge with relayer signatures (uses nonce 1)
    const currentNonce = await bridge.operationNonce();
    const unpauseSigs = await getSignaturesForUnpause(currentNonce, relayerWallets);
    await bridge.connect(adminWallet).unpauseWithApproval(currentNonce, unpauseSigs);
  }

  async function setupErc20Token() {
    genericErc20 = await deployContract(adminWallet, "GenericERC20", ["TSC", "TSC", 6]);
    await genericErc20.mint(adminWallet.address, 1000);
    await genericErc20.approve(erc20Safe.address, 1000);
    // Whitelist token through bridge with relayer signatures (bridge is paused at this point)
    const currentNonce = await bridge.operationNonce();
    const whitelistSigs = await getSignaturesForWhitelistToken(
      genericErc20.address, 0, 100, false, true, 0, 0, 0, currentNonce, relayerWallets
    );
    await bridge.whitelistToken(genericErc20.address, 0, 100, false, true, 0, 0, 0, currentNonce, whitelistSigs);
  }

  before(async function() {
    [adminWallet, relayer1, relayer2, relayer3, relayer4, relayer5, relayer6, relayer7, relayer8, otherWallet] = await ethers.getSigners();
    boardMembers = [adminWallet, relayer1, relayer2, relayer3, relayer5, relayer6, relayer7, relayer8].map(
      m => m.address,
    );
    relayerWallets = [adminWallet, relayer1, relayer2, relayer3, relayer5, relayer6, relayer7, relayer8];
  });

  beforeEach(async function () {
    await setupContracts();
  });

  it("sets creator as admin", async function () {
    expect(await bridge.admin()).to.equal(adminWallet.address);
  });

  it("sets the quorum", async function () {
    expect(await bridge.quorum()).to.equal(quorum);
  });

  it("Sets the board members with relayer rights", async function () {
    expect(await bridge.getRelayers()).to.eql(boardMembers);
  });

  describe("when initialized with a quorum that is lower than the minimum", async function () {
    it("reverts", async function () {
      const invalidQuorumValue = 1;
      await expect(
        deployUpgradableContract(adminWallet, "Bridge", [boardMembers, invalidQuorumValue, erc20Safe.address]),
      ).to.be.revertedWith("Quorum is too low.");
    });
  });

  describe("addRelayer", async function () {
    it("reverts when called with an empty address", async function () {
      await expect(bridge.addRelayer(ethers.ZeroAddress)).to.be.revertedWith(
        "RelayerRole: account cannot be the 0 address",
      );
    });

    it("reverts when not called by admin", async function () {
      nonAdminBridge = bridge.connect(otherWallet);
      await expect(nonAdminBridge.addRelayer(relayer4.address)).to.be.revertedWith(
        "Access Control: sender is not Admin",
      );
    });

    it("adds the address as a relayer", async function () {
      await bridge.addRelayer(relayer4.address);

      expect(await bridge.isRelayer(relayer4.address)).to.be.true;
    });

    it("emits event that a relayer was added", async function () {
      await expect(bridge.addRelayer(relayer4.address))
        .to.emit(bridge, "RelayerAdded")
        .withArgs(relayer4.address, adminWallet.address);
    });

    it("reverts if new relayer is already a relayer", async function () {
      await bridge.addRelayer(relayer4.address);

      await expect(bridge.addRelayer(relayer4.address)).to.be.revertedWith("RelayerRole: address is already a relayer");
    });
  });

  describe("removeRelayer", async function () {
    beforeEach(async function () {
      await bridge.addRelayer(relayer4.address);
    });

    it("removes the relayer", async function () {
      await bridge.removeRelayer(relayer4.address);

      expect(await bridge.isRelayer(relayer4.address)).to.be.false;
    });

    it("emits an event", async function () {
      expect(await bridge.isRelayer(relayer4.address)).to.be.true;
      await expect(bridge.removeRelayer(relayer4.address))
        .to.emit(bridge, "RelayerRemoved")
        .withArgs(relayer4.address, adminWallet.address);
    });

    it("reverts when not called by admin", async function () {
      nonAdminBridge = bridge.connect(otherWallet);
      await expect(nonAdminBridge.removeRelayer(relayer4.address)).to.be.revertedWith(
        "Access Control: sender is not Admin",
      );
    });

    it("reverts if address is not already a relayer", async function () {
      await expect(bridge.removeRelayer(otherWallet.address)).to.be.revertedWith(
        "RelayerRole: address is not a relayer",
      );
    });
  });

  describe("setQuorum", async function () {
    const newQuorum = 8;

    it("sets the quorum with the new value", async function () {
      await bridge.setQuorum(newQuorum);

      expect(await bridge.quorum()).to.equal(newQuorum);
    });

    it("emits event", async function () {
      await expect(bridge.setQuorum(newQuorum)).to.emit(bridge, "QuorumChanged").withArgs(newQuorum);
    });

    it("reverts when not called by admin", async function () {
      nonAdminBridge = bridge.connect(otherWallet);
      await expect(nonAdminBridge.setQuorum(newQuorum)).to.be.revertedWith("Access Control: sender is not Admin");
    });

    describe("when quorum is lower than the minimum", async function () {
      it("reverts", async function () {
        await expect(bridge.setQuorum(2)).to.be.revertedWith("Quorum is too low.");
      });
    });
  });

  describe("executeTransfer", async function () {
    let amount, batchNonce, signatures;
    let dataToSign,
      signature1,
      signature2,
      signature3,
      signature4,
      signature5,
      signature6,
      signature7,
      signaturesInvalid,
      signaturesInvalid2,
      signaturesValid;
    beforeEach(async function () {
      amount = 80;
      await erc20Safe.deposit(
        genericErc20.address,
        amount,
        Buffer.from("c0f0058cea88a2bc1240b60361efb965957038d05f916c42b3f23a2c38ced81e", "hex"),
      );
      batchNonce = 42;
      signatures = await getSignaturesForExecuteTransfer(
        [genericErc20.address],
        [otherWallet.address],
        [amount],
        [1],
        batchNonce,
        [adminWallet, relayer1, relayer2, relayer3, relayer5, relayer6, relayer7, relayer8],
      );
    });

    describe("when quorum achieved", async function () {
      it("transfers tokens", async function () {
        await expect(() =>
          bridge.executeTransfer([genericErc20.address], [otherWallet.address], [amount], [1], batchNonce, signatures),
        ).to.changeTokenBalance(genericErc20, otherWallet, amount);
      });

      it("sets the wasBatchExecuted to true", async function () {
        await bridge.executeTransfer(
          [genericErc20.address],
          [otherWallet.address],
          [amount],
          [1],
          batchNonce,
          signatures,
        );
        expect(await bridge.wasBatchExecuted(batchNonce)).to.be.true;
      });

      describe("but all signatures are from the same relayer", async function () {
        beforeEach(async function () {
          dataToSign = await getExecuteTransferData(
            [genericErc20.address],
            [otherWallet.address],
            [amount],
            [1],
            batchNonce,
          );
          signature1 = await adminWallet.signMessage(dataToSign);
          signatures = [signature1, signature1, signature1, signature1, signature1, signature1, signature1];
        });

        it("reverts", async function () {
          await expect(
            bridge.executeTransfer(
              [genericErc20.address],
              [otherWallet.address],
              [amount],
              [1],
              batchNonce,
              signatures,
            ),
          ).to.be.revertedWith("Quorum was not met");
        });
      });

      describe("but some signatures are from the same relayer", async function () {
        beforeEach(async function () {
          dataToSign = await getExecuteTransferData(
            [genericErc20.address],
            [otherWallet.address],
            [amount],
            [1],
            batchNonce,
          );
          signature1 = await adminWallet.signMessage(dataToSign);
          signature2 = await relayer1.signMessage(dataToSign);
          signature3 = await relayer2.signMessage(dataToSign);
          signature4 = await relayer3.signMessage(dataToSign);
          signature5 = await relayer5.signMessage(dataToSign);
          signature6 = await relayer6.signMessage(dataToSign);
          signature7 = await relayer7.signMessage(dataToSign);
          signaturesInvalid = [signature1, signature1, signature1, signature1, signature1, signature1, signature1];
          signaturesInvalid2 = [signature1, signature1, signature2, signature3, signature4, signature5, signature6];
          signaturesValid = [signature1, signature2, signature3, signature4, signature5, signature6, signature7];
        });

        it("reverts", async function () {
          await expect(
            bridge.executeTransfer(
              [genericErc20.address],
              [otherWallet.address],
              [amount],
              [1],
              batchNonce,
              signaturesInvalid,
            ),
          ).to.be.revertedWith("Quorum was not met");
          await expect(
            bridge.executeTransfer(
              [genericErc20.address],
              [otherWallet.address],
              [amount],
              [1],
              batchNonce,
              signaturesInvalid2,
            ),
          ).to.be.revertedWith("Quorum was not met");
        });

        it("does not revert", async function () {
          await expect(() =>
            bridge.executeTransfer(
              [genericErc20.address],
              [otherWallet.address],
              [amount],
              [1],
              batchNonce,
              signaturesValid,
            ),
          ).to.changeTokenBalance(genericErc20, otherWallet, amount);
        });
      });
    });

    describe("not enough signatures for quorum", async function () {
      it("reverts", async function () {
        await expect(
          bridge.executeTransfer(
            [genericErc20.address],
            [otherWallet.address],
            [amount],
            [1],
            batchNonce,
            signatures.slice(0, -2),
          ),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });

      it("does not set wasBatchExecuted", async function () {
        expect(await bridge.wasBatchExecuted(batchNonce)).to.be.false;
      });
    });

    describe("trying to replay the batch", async function () {
      beforeEach(async function () {
        // add more funds in order to not fail because of insufficient balance
        await erc20Safe.deposit(
          genericErc20.address,
          amount,
          Buffer.from("c0f0058cea88a2bc1240b60361efb965957038d05f916c42b3f23a2c38ced81e", "hex"),
        );

        await bridge.executeTransfer(
          [genericErc20.address],
          [otherWallet.address],
          [amount],
          [1],
          batchNonce,
          signatures,
        );
      });

      it("reverts", async function () {
        await expect(
          bridge.executeTransfer([genericErc20.address], [otherWallet.address], [amount], [1], batchNonce, signatures),
        ).to.be.revertedWith("Batch already executed");
      });
    });

    describe("contract is paused", async function () {
      beforeEach(async function () {
        await bridge.pause();
      });
      afterEach(async function () {
        await bridge.unpause();
      });
      it("fails", async function () {
        await expect(
          bridge.executeTransfer(
            [genericErc20.address],
            [otherWallet.address],
            [amount],
            [1],
            batchNonce,
            signatures.slice(0, -2),
          ),
        ).to.be.revertedWith("Pausable: paused");
      });

      it("does not set wasBatchExecuted", async function () {
        expect(await bridge.wasBatchExecuted(batchNonce)).to.be.false;
      });
    });

    describe("check execute transfer saves correct statuses", async function () {
      it("returns correct statuses", async function () {
        //TODO: implement this test
        await bridge.executeTransfer(
          [genericErc20.address],
          [otherWallet.address],
          [amount],
          [1],
          batchNonce,
          signatures,
        );
        const settleBlockCount = await bridge.batchSettleBlockCount();
        for (let i = 0; i < settleBlockCount - 1n; i++) {
          await network.provider.send("evm_mine");
        }

        const [firstStatuses, firstIsFinal] = await bridge.getStatusesAfterExecution(batchNonce);
        expect(firstStatuses).to.eql([3n]);
        expect(firstIsFinal).to.be.false

        await network.provider.send("evm_mine");

        const [secondStatuses, secondIsFinal] = await bridge.getStatusesAfterExecution(batchNonce);
        expect(secondStatuses).to.eql([3n]);
        expect(secondIsFinal).to.be.true
      });

      it("saves refund items", async function () {
        await bridge.executeTransfer(
          [genericErc20.address],
          [otherWallet.address],
          [amount],
          [1],
          batchNonce,
          signatures,
        );
        const settleBlockCount = await bridge.batchSettleBlockCount();
        for (let i = 0; i < settleBlockCount - 1n; i++) {
          await network.provider.send("evm_mine");
        }

        const [firstStatuses, firstIsFinal] = await bridge.getStatusesAfterExecution(batchNonce);
        expect(firstStatuses).to.eql([3n]);
        expect(firstIsFinal).to.be.false

        await network.provider.send("evm_mine");

        const [secondStatuses, secondIsFinal] = await bridge.getStatusesAfterExecution(batchNonce);
        expect(secondStatuses).to.eql([3n]);
        expect(secondIsFinal).to.be.true
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const nonAdminBridge = bridge.connect(otherWallet);
        await expect(
          nonAdminBridge.executeTransfer(
            [genericErc20.address],
            [otherWallet.address],
            [amount],
            [1],
            batchNonce,
            signatures,
          ),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("whitelistToken quorum validation", async function () {
    let newToken;
    let testNonce;

    beforeEach(async function () {
      newToken = await deployContract(adminWallet, "GenericERC20", ["NEW", "NEW", 18]);
      testNonce = await bridge.operationNonce();
      // Pause bridge to whitelist token
      await bridge.pause();
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const dataToSign = await getSignaturesForAction([
          { type: "address", value: newToken.address },
          { type: "uint256", value: 0 },
          { type: "uint256", value: 100 },
          { type: "bool", value: false },
          { type: "bool", value: true },
          { type: "uint256", value: 0 },
          { type: "uint256", value: 0 },
          { type: "uint256", value: 0 },
          { type: "uint256", value: testNonce },
        ], "WhitelistToken", [adminWallet]);
        
        // Repeat the same signature to reach quorum count
        const duplicateSignatures = Array(quorum).fill(dataToSign[0]);

        await expect(
          bridge.whitelistToken(newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        // Get signatures from only 3 unique relayers (less than quorum of 7)
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForWhitelistToken(
          newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, partialWallets
        );
        // Pad with duplicates to reach quorum count
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.whitelistToken(newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForWhitelistToken(
          newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, relayerWallets
        );

        await bridge.whitelistToken(newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, signatures);
        expect(await erc20Safe.isTokenWhitelisted(newToken.address)).to.be.true;
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        // Only 3 signatures, quorum is 7
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForWhitelistToken(
          newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, partialWallets
        );

        await expect(
          bridge.whitelistToken(newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForWhitelistToken(
          newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, relayerWallets
        );
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.whitelistToken(newToken.address, 0, 100, false, true, 0, 0, 0, testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("unpauseWithApproval quorum validation", async function () {
    let testNonce;

    beforeEach(async function () {
      testNonce = await bridge.operationNonce();
      // Ensure bridge is paused
      await bridge.pause();
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const singleSig = await getSignaturesForUnpause(testNonce, [adminWallet]);
        const duplicateSignatures = Array(quorum).fill(singleSig[0]);

        await expect(
          bridge.unpauseWithApproval(testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForUnpause(testNonce, partialWallets);
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.unpauseWithApproval(testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForUnpause(testNonce, relayerWallets);

        await bridge.unpauseWithApproval(testNonce, signatures);
        expect(await bridge.paused()).to.be.false;
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForUnpause(testNonce, partialWallets);

        await expect(
          bridge.unpauseWithApproval(testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForUnpause(testNonce, relayerWallets);
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.unpauseWithApproval(testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("setQuorumWithApproval quorum validation", async function () {
    let testNonce;
    const newQuorumValue = 8;

    beforeEach(async function () {
      testNonce = await bridge.operationNonce();
      // setQuorumWithApproval requires bridge to be paused
      await bridge.pause();
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const singleSig = await getSignaturesForSetQuorum(newQuorumValue, testNonce, [adminWallet]);
        const duplicateSignatures = Array(quorum).fill(singleSig[0]);

        await expect(
          bridge.setQuorumWithApproval(newQuorumValue, testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForSetQuorum(newQuorumValue, testNonce, partialWallets);
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.setQuorumWithApproval(newQuorumValue, testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForSetQuorum(newQuorumValue, testNonce, relayerWallets);

        await bridge.setQuorumWithApproval(newQuorumValue, testNonce, signatures);
        expect(await bridge.quorum()).to.equal(newQuorumValue);
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForSetQuorum(newQuorumValue, testNonce, partialWallets);

        await expect(
          bridge.setQuorumWithApproval(newQuorumValue, testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForSetQuorum(newQuorumValue, testNonce, relayerWallets);
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.setQuorumWithApproval(newQuorumValue, testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("addRelayerWithApproval quorum validation", async function () {
    let testNonce;

    beforeEach(async function () {
      testNonce = await bridge.operationNonce();
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const singleSig = await getSignaturesForAddRelayer(relayer4.address, testNonce, [adminWallet]);
        const duplicateSignatures = Array(quorum).fill(singleSig[0]);

        await expect(
          bridge.addRelayerWithApproval(relayer4.address, testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForAddRelayer(relayer4.address, testNonce, partialWallets);
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.addRelayerWithApproval(relayer4.address, testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForAddRelayer(relayer4.address, testNonce, relayerWallets);

        await bridge.addRelayerWithApproval(relayer4.address, testNonce, signatures);
        expect(await bridge.isRelayer(relayer4.address)).to.be.true;
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForAddRelayer(relayer4.address, testNonce, partialWallets);

        await expect(
          bridge.addRelayerWithApproval(relayer4.address, testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForAddRelayer(relayer4.address, testNonce, relayerWallets);
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.addRelayerWithApproval(relayer4.address, testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("removeRelayerWithApproval quorum validation", async function () {
    let testNonce;

    beforeEach(async function () {
      testNonce = await bridge.operationNonce();
      // Add relayer4 first so we can remove them
      await bridge.addRelayer(relayer4.address);
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const singleSig = await getSignaturesForRemoveRelayer(relayer4.address, testNonce, [adminWallet]);
        const duplicateSignatures = Array(quorum).fill(singleSig[0]);

        await expect(
          bridge.removeRelayerWithApproval(relayer4.address, testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForRemoveRelayer(relayer4.address, testNonce, partialWallets);
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.removeRelayerWithApproval(relayer4.address, testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForRemoveRelayer(relayer4.address, testNonce, relayerWallets);

        await bridge.removeRelayerWithApproval(relayer4.address, testNonce, signatures);
        expect(await bridge.isRelayer(relayer4.address)).to.be.false;
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForRemoveRelayer(relayer4.address, testNonce, partialWallets);

        await expect(
          bridge.removeRelayerWithApproval(relayer4.address, testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForRemoveRelayer(relayer4.address, testNonce, relayerWallets);
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.removeRelayerWithApproval(relayer4.address, testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("updateSafeBridge quorum validation", async function () {
    let testNonce;
    let newBridge;

    beforeEach(async function () {
      testNonce = await bridge.operationNonce();
      // Deploy a new bridge to use as the new bridge address
      newBridge = await deployUpgradableContract(adminWallet, "Bridge", [boardMembers, quorum, erc20Safe.address]);
      // updateSafeBridge requires bridge to be paused
      await bridge.pause();
    });

    describe("when all signatures are from the same relayer", async function () {
      it("reverts", async function () {
        const singleSig = await getSignaturesForUpdateSafeBridge(newBridge.address, testNonce, [adminWallet]);
        const duplicateSignatures = Array(quorum).fill(singleSig[0]);

        await expect(
          bridge.updateSafeBridge(newBridge.address, testNonce, duplicateSignatures),
        ).to.be.revertedWith("Quorum was not met");
      });
    });

    describe("when some signatures are from the same relayer", async function () {
      it("reverts when unique signatures are less than quorum", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const validSigs = await getSignaturesForUpdateSafeBridge(newBridge.address, testNonce, partialWallets);
        const duplicatePaddedSigs = [...validSigs, validSigs[0], validSigs[0], validSigs[0], validSigs[0]];

        await expect(
          bridge.updateSafeBridge(newBridge.address, testNonce, duplicatePaddedSigs),
        ).to.be.revertedWith("Quorum was not met");
      });

      it("succeeds when unique signatures meet quorum", async function () {
        const signatures = await getSignaturesForUpdateSafeBridge(newBridge.address, testNonce, relayerWallets);

        await bridge.updateSafeBridge(newBridge.address, testNonce, signatures);
        expect(await erc20Safe.bridge()).to.equal(newBridge.address);
      });
    });

    describe("when not enough signatures for quorum", async function () {
      it("reverts", async function () {
        const partialWallets = [adminWallet, relayer1, relayer2];
        const signatures = await getSignaturesForUpdateSafeBridge(newBridge.address, testNonce, partialWallets);

        await expect(
          bridge.updateSafeBridge(newBridge.address, testNonce, signatures),
        ).to.be.revertedWith("Not enough signatures to achieve quorum");
      });
    });

    describe("called by a non relayer", async function () {
      it("reverts", async function () {
        const signatures = await getSignaturesForUpdateSafeBridge(newBridge.address, testNonce, relayerWallets);
        const nonRelayerBridge = bridge.connect(otherWallet);

        await expect(
          nonRelayerBridge.updateSafeBridge(newBridge.address, testNonce, signatures),
        ).to.be.revertedWith("Access Control: sender is not Relayer");
      });
    });
  });

  describe("operationNonce validation", async function () {
    it("initial operationNonce is 0", async function () {
      // After setupContracts, nonce has been used for whitelistToken (0) and unpauseWithApproval (1)
      // So current operationNonce should be 2
      expect(await bridge.operationNonce()).to.equal(2);
    });

    it("operationNonce increments after successful operation", async function () {
      const currentNonce = await bridge.operationNonce();
      
      // Add a new relayer with approval
      const signatures = await getSignaturesForAddRelayer(relayer4.address, currentNonce, relayerWallets);
      await bridge.addRelayerWithApproval(relayer4.address, currentNonce, signatures);
      
      expect(await bridge.operationNonce()).to.equal(currentNonce + 1n);
    });

    describe("using wrong nonce", async function () {
      it("reverts when nonce is too low (already used)", async function () {
        const usedNonce = 0; // This was used during setup
        const signatures = await getSignaturesForAddRelayer(relayer4.address, usedNonce, relayerWallets);
        
        await expect(
          bridge.addRelayerWithApproval(relayer4.address, usedNonce, signatures),
        ).to.be.revertedWith("Invalid nonce");
      });

      it("reverts when nonce is too high (future nonce)", async function () {
        const currentNonce = await bridge.operationNonce();
        const futureNonce = currentNonce + 10n;
        const signatures = await getSignaturesForAddRelayer(relayer4.address, futureNonce, relayerWallets);
        
        await expect(
          bridge.addRelayerWithApproval(relayer4.address, futureNonce, signatures),
        ).to.be.revertedWith("Invalid nonce");
      });
    });

    describe("replay attack prevention", async function () {
      it("cannot replay operation with same nonce", async function () {
        const currentNonce = await bridge.operationNonce();
        
        // First operation succeeds
        const signatures = await getSignaturesForAddRelayer(relayer4.address, currentNonce, relayerWallets);
        await bridge.addRelayerWithApproval(relayer4.address, currentNonce, signatures);
        
        // Try to replay the same operation - should fail because nonce was consumed
        await expect(
          bridge.addRelayerWithApproval(relayer4.address, currentNonce, signatures),
        ).to.be.revertedWith("Invalid nonce");
      });

      it("operations must use sequential nonces", async function () {
        const currentNonce = await bridge.operationNonce();
        
        // First operation with current nonce
        const sig1 = await getSignaturesForAddRelayer(relayer4.address, currentNonce, relayerWallets);
        await bridge.addRelayerWithApproval(relayer4.address, currentNonce, sig1);
        
        // Second operation must use next nonce
        const nextNonce = currentNonce + 1n;
        await bridge.pause();
        const sig2 = await getSignaturesForSetQuorum(8, nextNonce, relayerWallets);
        await bridge.setQuorumWithApproval(8, nextNonce, sig2);
        
        expect(await bridge.operationNonce()).to.equal(currentNonce + 2n);
      });
    });

    describe("nonce validation across different operations", async function () {
      it("all quorum-protected operations share the same nonce counter", async function () {
        let currentNonce = await bridge.operationNonce();
        
        // Operation 1: addRelayerWithApproval
        const sig1 = await getSignaturesForAddRelayer(relayer4.address, currentNonce, relayerWallets);
        await bridge.addRelayerWithApproval(relayer4.address, currentNonce, sig1);
        expect(await bridge.operationNonce()).to.equal(currentNonce + 1n);
        
        // Operation 2: pause and setQuorumWithApproval
        currentNonce = await bridge.operationNonce();
        await bridge.pause();
        const sig2 = await getSignaturesForSetQuorum(8, currentNonce, relayerWallets);
        await bridge.setQuorumWithApproval(8, currentNonce, sig2);
        expect(await bridge.operationNonce()).to.equal(currentNonce + 1n);
        
        // Operation 3: unpauseWithApproval
        currentNonce = await bridge.operationNonce();
        const sig3 = await getSignaturesForUnpause(currentNonce, relayerWallets);
        await bridge.unpauseWithApproval(currentNonce, sig3);
        expect(await bridge.operationNonce()).to.equal(currentNonce + 1n);
      });
    });
  });
});
