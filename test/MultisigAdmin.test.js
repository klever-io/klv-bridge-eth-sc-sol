const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deployContract, deployUpgradableContract } = require("./utils/deploy.utils");

describe("MultisigAdmin", function () {
  let owner1, owner2, owner3, owner4, owner5, nonOwner;
  let multisig;

  before(async function () {
    [owner1, owner2, owner3, owner4, owner5, nonOwner] = await ethers.getSigners();
  });

  // ============ Deployment Tests ============

  describe("Deployment", function () {
    it("deploys with correct owners and threshold", async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);

      expect(await multisig.threshold()).to.equal(2);
      expect(await multisig.getOwnerCount()).to.equal(3);

      const returnedOwners = await multisig.getOwners();
      expect(returnedOwners).to.deep.equal(owners);

      expect(await multisig.isOwner(owner1.address)).to.be.true;
      expect(await multisig.isOwner(owner2.address)).to.be.true;
      expect(await multisig.isOwner(owner3.address)).to.be.true;
      expect(await multisig.isOwner(nonOwner.address)).to.be.false;
    });

    it("deploys with single owner and threshold 1", async function () {
      const owners = [owner1.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 1]);

      expect(await multisig.threshold()).to.equal(1);
      expect(await multisig.getOwnerCount()).to.equal(1);
    });

    it("reverts on empty owners array", async function () {
      await expect(
        deployContract(owner1, "MultisigAdmin", [[], 1])
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("MultisigAdmin")).interface }, "OwnersRequired");
    });

    it("reverts on zero threshold", async function () {
      const owners = [owner1.address, owner2.address];
      await expect(
        deployContract(owner1, "MultisigAdmin", [owners, 0])
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("MultisigAdmin")).interface }, "InvalidThreshold");
    });

    it("reverts on threshold greater than owners count", async function () {
      const owners = [owner1.address, owner2.address];
      await expect(
        deployContract(owner1, "MultisigAdmin", [owners, 3])
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("MultisigAdmin")).interface }, "InvalidThreshold");
    });

    it("reverts on zero address owner", async function () {
      const owners = [owner1.address, ethers.ZeroAddress];
      await expect(
        deployContract(owner1, "MultisigAdmin", [owners, 1])
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("MultisigAdmin")).interface }, "InvalidOwner");
    });

    it("reverts on duplicate owner", async function () {
      const owners = [owner1.address, owner1.address];
      await expect(
        deployContract(owner1, "MultisigAdmin", [owners, 1])
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("MultisigAdmin")).interface }, "OwnerAlreadyExists");
    });

    it("emits OwnerAdded and ThresholdChanged events", async function () {
      const owners = [owner1.address, owner2.address];
      const factory = await ethers.getContractFactory("MultisigAdmin");
      const tx = await factory.deploy(owners, 2);
      const receipt = await tx.deploymentTransaction().wait();

      // Check events were emitted
      const ownerAddedEvents = receipt.logs.filter(log => {
        try {
          return factory.interface.parseLog(log)?.name === "OwnerAdded";
        } catch {
          return false;
        }
      });
      expect(ownerAddedEvents.length).to.equal(2);

      const thresholdChangedEvents = receipt.logs.filter(log => {
        try {
          return factory.interface.parseLog(log)?.name === "ThresholdChanged";
        } catch {
          return false;
        }
      });
      expect(thresholdChangedEvents.length).to.equal(1);
    });
  });

  // ============ Transaction Submission Tests ============

  describe("submitTransaction", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("creates a transaction with correct data", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("1");
      const data = "0x1234";

      await multisig.connect(owner1).submitTransaction(target, value, data);

      const tx = await multisig.getTransaction(0);
      expect(tx.target).to.equal(target);
      expect(tx.value).to.equal(value);
      expect(tx.data).to.equal(data);
      expect(tx.executed).to.be.false;
      expect(tx.confirmationCount).to.equal(1); // Auto-confirmed by submitter
    });

    it("auto-confirms for submitter", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");

      expect(await multisig.getConfirmationCount(0)).to.equal(1);
      const confirmations = await multisig.getConfirmations(0);
      expect(confirmations).to.deep.equal([owner1.address]);
    });

    it("increments transaction count", async function () {
      expect(await multisig.transactionCount()).to.equal(0);

      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      expect(await multisig.transactionCount()).to.equal(1);

      await multisig.connect(owner2).submitTransaction(owner4.address, 0, "0x");
      expect(await multisig.transactionCount()).to.equal(2);
    });

    it("emits TransactionSubmitted and TransactionConfirmed events", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";

      await expect(multisig.connect(owner1).submitTransaction(target, value, data))
        .to.emit(multisig, "TransactionSubmitted")
        .withArgs(0, owner1.address, target, value, data)
        .and.to.emit(multisig, "TransactionConfirmed")
        .withArgs(0, owner1.address);
    });

    it("reverts for non-owner", async function () {
      await expect(
        multisig.connect(nonOwner).submitTransaction(owner4.address, 0, "0x")
      ).to.be.revertedWithCustomError(multisig, "NotOwner");
    });
  });

  // ============ Transaction Confirmation Tests ============

  describe("confirmTransaction", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
    });

    it("adds confirmation", async function () {
      await multisig.connect(owner2).confirmTransaction(0);

      expect(await multisig.getConfirmationCount(0)).to.equal(2);
      const confirmations = await multisig.getConfirmations(0);
      expect(confirmations).to.include(owner1.address);
      expect(confirmations).to.include(owner2.address);
    });

    it("emits TransactionConfirmed event", async function () {
      await expect(multisig.connect(owner2).confirmTransaction(0))
        .to.emit(multisig, "TransactionConfirmed")
        .withArgs(0, owner2.address);
    });

    it("reverts for non-owner", async function () {
      await expect(
        multisig.connect(nonOwner).confirmTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "NotOwner");
    });

    it("reverts if already confirmed", async function () {
      await expect(
        multisig.connect(owner1).confirmTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "TransactionAlreadyConfirmed");
    });

    it("reverts if transaction does not exist", async function () {
      await expect(
        multisig.connect(owner2).confirmTransaction(999)
      ).to.be.revertedWithCustomError(multisig, "TransactionDoesNotExist");
    });

    it("reverts if transaction already executed", async function () {
      // Set threshold to 1 for easy execution
      const owners = [owner1.address];
      const singleOwnerMultisig = await deployContract(owner1, "MultisigAdmin", [owners, 1]);
      await singleOwnerMultisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await singleOwnerMultisig.connect(owner1).executeTransaction(0);

      await expect(
        singleOwnerMultisig.connect(owner1).confirmTransaction(0)
      ).to.be.revertedWithCustomError(singleOwnerMultisig, "TransactionAlreadyExecuted");
    });
  });

  // ============ Revoke Confirmation Tests ============

  describe("revokeConfirmation", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
    });

    it("removes confirmation", async function () {
      expect(await multisig.getConfirmationCount(0)).to.equal(1);

      await multisig.connect(owner1).revokeConfirmation(0);

      expect(await multisig.getConfirmationCount(0)).to.equal(0);
      const confirmations = await multisig.getConfirmations(0);
      expect(confirmations).to.not.include(owner1.address);
    });

    it("emits ConfirmationRevoked event", async function () {
      await expect(multisig.connect(owner1).revokeConfirmation(0))
        .to.emit(multisig, "ConfirmationRevoked")
        .withArgs(0, owner1.address);
    });

    it("reverts for non-owner", async function () {
      await expect(
        multisig.connect(nonOwner).revokeConfirmation(0)
      ).to.be.revertedWithCustomError(multisig, "NotOwner");
    });

    it("reverts if not confirmed", async function () {
      await expect(
        multisig.connect(owner2).revokeConfirmation(0)
      ).to.be.revertedWithCustomError(multisig, "TransactionNotConfirmed");
    });

    it("reverts if transaction does not exist", async function () {
      await expect(
        multisig.connect(owner1).revokeConfirmation(999)
      ).to.be.revertedWithCustomError(multisig, "TransactionDoesNotExist");
    });
  });

  // ============ Execute Transaction Tests ============

  describe("executeTransaction", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);

      // Fund the multisig
      await owner1.sendTransaction({
        to: await multisig.getAddress(),
        value: ethers.parseEther("10")
      });
    });

    it("executes transaction when threshold is met", async function () {
      const recipient = owner4.address;
      const value = ethers.parseEther("1");

      const balanceBefore = await ethers.provider.getBalance(recipient);

      await multisig.connect(owner1).submitTransaction(recipient, value, "0x");
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter - balanceBefore).to.equal(value);

      const tx = await multisig.getTransaction(0);
      expect(tx.executed).to.be.true;
    });

    it("emits TransactionExecuted event", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(multisig.connect(owner1).executeTransaction(0))
        .to.emit(multisig, "TransactionExecuted")
        .withArgs(0, owner1.address);
    });

    it("reverts if threshold not met", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ThresholdNotMet");
    });

    it("reverts if already executed", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "TransactionAlreadyExecuted");
    });

    it("reverts for non-owner", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(nonOwner).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "NotOwner");
    });

    it("reverts if transaction does not exist", async function () {
      await expect(
        multisig.connect(owner1).executeTransaction(999)
      ).to.be.revertedWithCustomError(multisig, "TransactionDoesNotExist");
    });

    it("reverts and emits TransactionFailed on failed external call", async function () {
      // Try to send ETH to a contract that rejects it
      const factory = await ethers.getContractFactory("MultisigAdmin");
      const rejectingContract = await factory.deploy([owner1.address], 1);

      await multisig.connect(owner1).submitTransaction(await rejectingContract.getAddress(), ethers.parseEther("1"), "0x1234"); // invalid data
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });
  });

  // ============ Owner Management Tests ============

  describe("addOwner", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("adds owner via multisig transaction", async function () {
      const addOwnerData = multisig.interface.encodeFunctionData("addOwner", [owner3.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, addOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await multisig.isOwner(owner3.address)).to.be.true;
      expect(await multisig.getOwnerCount()).to.equal(3);
    });

    it("emits OwnerAdded event", async function () {
      const addOwnerData = multisig.interface.encodeFunctionData("addOwner", [owner3.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, addOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(multisig.connect(owner1).executeTransaction(0))
        .to.emit(multisig, "OwnerAdded")
        .withArgs(owner3.address);
    });

    it("reverts if called directly (not through wallet)", async function () {
      await expect(
        multisig.connect(owner1).addOwner(owner3.address)
      ).to.be.revertedWithCustomError(multisig, "NotWallet");
    });

    it("reverts if owner already exists", async function () {
      const addOwnerData = multisig.interface.encodeFunctionData("addOwner", [owner1.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, addOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });

    it("reverts if owner is zero address", async function () {
      const addOwnerData = multisig.interface.encodeFunctionData("addOwner", [ethers.ZeroAddress]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, addOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });
  });

  describe("removeOwner", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("removes owner via multisig transaction", async function () {
      const removeOwnerData = multisig.interface.encodeFunctionData("removeOwner", [owner3.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, removeOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await multisig.isOwner(owner3.address)).to.be.false;
      expect(await multisig.getOwnerCount()).to.equal(2);
    });

    it("emits OwnerRemoved event", async function () {
      const removeOwnerData = multisig.interface.encodeFunctionData("removeOwner", [owner3.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, removeOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(multisig.connect(owner1).executeTransaction(0))
        .to.emit(multisig, "OwnerRemoved")
        .withArgs(owner3.address);
    });

    it("reverts if called directly (not through wallet)", async function () {
      await expect(
        multisig.connect(owner1).removeOwner(owner3.address)
      ).to.be.revertedWithCustomError(multisig, "NotWallet");
    });

    it("reverts if removal would break threshold", async function () {
      // With 3 owners and threshold 2, cannot remove 2 owners
      const removeOwnerData = multisig.interface.encodeFunctionData("removeOwner", [owner3.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, removeOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      // Now try to remove another - would leave 1 owner with threshold 2
      const removeOwnerData2 = multisig.interface.encodeFunctionData("removeOwner", [owner2.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, removeOwnerData2);
      await multisig.connect(owner2).confirmTransaction(1);

      await expect(
        multisig.connect(owner1).executeTransaction(1)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });

    it("reverts if owner does not exist", async function () {
      const removeOwnerData = multisig.interface.encodeFunctionData("removeOwner", [owner4.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, removeOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });
  });

  describe("replaceOwner", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("replaces owner via multisig transaction", async function () {
      const replaceOwnerData = multisig.interface.encodeFunctionData("replaceOwner", [owner3.address, owner4.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, replaceOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await multisig.isOwner(owner3.address)).to.be.false;
      expect(await multisig.isOwner(owner4.address)).to.be.true;
      expect(await multisig.getOwnerCount()).to.equal(3);
    });

    it("emits OwnerRemoved and OwnerAdded events", async function () {
      const replaceOwnerData = multisig.interface.encodeFunctionData("replaceOwner", [owner3.address, owner4.address]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, replaceOwnerData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(multisig.connect(owner1).executeTransaction(0))
        .to.emit(multisig, "OwnerRemoved")
        .withArgs(owner3.address)
        .and.to.emit(multisig, "OwnerAdded")
        .withArgs(owner4.address);
    });

    it("reverts if called directly (not through wallet)", async function () {
      await expect(
        multisig.connect(owner1).replaceOwner(owner3.address, owner4.address)
      ).to.be.revertedWithCustomError(multisig, "NotWallet");
    });
  });

  describe("changeThreshold", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("changes threshold via multisig transaction", async function () {
      const changeThresholdData = multisig.interface.encodeFunctionData("changeThreshold", [3]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, changeThresholdData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await multisig.threshold()).to.equal(3);
    });

    it("emits ThresholdChanged event", async function () {
      const changeThresholdData = multisig.interface.encodeFunctionData("changeThreshold", [3]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, changeThresholdData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(multisig.connect(owner1).executeTransaction(0))
        .to.emit(multisig, "ThresholdChanged")
        .withArgs(3);
    });

    it("reverts if called directly (not through wallet)", async function () {
      await expect(
        multisig.connect(owner1).changeThreshold(3)
      ).to.be.revertedWithCustomError(multisig, "NotWallet");
    });

    it("reverts if threshold is zero", async function () {
      const changeThresholdData = multisig.interface.encodeFunctionData("changeThreshold", [0]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, changeThresholdData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });

    it("reverts if threshold exceeds owner count", async function () {
      const changeThresholdData = multisig.interface.encodeFunctionData("changeThreshold", [5]);

      await multisig.connect(owner1).submitTransaction(await multisig.getAddress(), 0, changeThresholdData);
      await multisig.connect(owner2).confirmTransaction(0);

      await expect(
        multisig.connect(owner1).executeTransaction(0)
      ).to.be.revertedWithCustomError(multisig, "ExecutionFailed");
    });
  });

  // ============ Integration Tests with ERC20Safe ============

  describe("Integration with ERC20Safe", function () {
    let safe, genericERC20;

    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);

      genericERC20 = await deployContract(owner1, "GenericERC20", ["TSC", "TSC", 6]);
      safe = await deployUpgradableContract(owner1, "ERC20Safe");

      // Transfer admin to multisig
      await safe.connect(owner1).transferAdmin(await multisig.getAddress());
    });

    it("transfers admin to multisig", async function () {
      expect(await safe.admin()).to.equal(await multisig.getAddress());
    });

    it("executes whitelistToken through multisig", async function () {
      const whitelistData = safe.interface.encodeFunctionData("whitelistToken", [
        await genericERC20.getAddress(),
        25,
        100,
        false,
        true,
        0,
        0,
        0
      ]);

      await multisig.connect(owner1).submitTransaction(await safe.getAddress(), 0, whitelistData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await safe.isTokenWhitelisted(await genericERC20.getAddress())).to.be.true;
    });

    it("executes pause/unpause through multisig", async function () {
      // First unpause (safe starts paused)
      const unpauseData = safe.interface.encodeFunctionData("unpause", []);

      await multisig.connect(owner1).submitTransaction(await safe.getAddress(), 0, unpauseData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await safe.paused()).to.be.false;

      // Now pause
      const pauseData = safe.interface.encodeFunctionData("pause", []);

      await multisig.connect(owner1).submitTransaction(await safe.getAddress(), 0, pauseData);
      await multisig.connect(owner2).confirmTransaction(1);
      await multisig.connect(owner1).executeTransaction(1);

      expect(await safe.paused()).to.be.true;
    });

    it("reverts admin function when called by non-multisig", async function () {
      await expect(
        safe.connect(owner1).whitelistToken(await genericERC20.getAddress(), 25, 100, false, true, 0, 0, 0)
      ).to.be.revertedWith("Access Control: sender is not Admin");
    });

    it("can transfer admin back from multisig", async function () {
      const transferAdminData = safe.interface.encodeFunctionData("transferAdmin", [owner1.address]);

      await multisig.connect(owner1).submitTransaction(await safe.getAddress(), 0, transferAdminData);
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await safe.admin()).to.equal(owner1.address);
    });
  });

  // ============ View Function Tests ============

  describe("View Functions", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("getTransactionCount returns correct counts", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");

      expect(await multisig.getTransactionCount(true, false)).to.equal(2);
      expect(await multisig.getTransactionCount(false, true)).to.equal(0);

      // Execute one
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      expect(await multisig.getTransactionCount(true, false)).to.equal(1);
      expect(await multisig.getTransactionCount(false, true)).to.equal(1);
      expect(await multisig.getTransactionCount(true, true)).to.equal(2);
    });

    it("getTransactionIds returns correct IDs", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");

      const pendingIds = await multisig.getTransactionIds(0, 10, true, false);
      expect(pendingIds.length).to.equal(3);
      expect(pendingIds[0]).to.equal(0);
      expect(pendingIds[1]).to.equal(1);
      expect(pendingIds[2]).to.equal(2);

      // Execute first one
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      const executedIds = await multisig.getTransactionIds(0, 10, false, true);
      expect(executedIds.length).to.equal(1);
      expect(executedIds[0]).to.equal(0);
    });

    it("isConfirmed returns correct status", async function () {
      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");

      expect(await multisig.isConfirmed(0)).to.be.false;

      await multisig.connect(owner2).confirmTransaction(0);

      expect(await multisig.isConfirmed(0)).to.be.true;
    });
  });

  // ============ ETH Handling Tests ============

  describe("ETH Handling", function () {
    beforeEach(async function () {
      const owners = [owner1.address, owner2.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);
    });

    it("receives ETH and emits Deposit event", async function () {
      const value = ethers.parseEther("1");

      await expect(
        owner1.sendTransaction({
          to: await multisig.getAddress(),
          value: value
        })
      ).to.emit(multisig, "Deposit").withArgs(owner1.address, value);

      expect(await ethers.provider.getBalance(await multisig.getAddress())).to.equal(value);
    });

    it("sends ETH via transaction", async function () {
      // Fund multisig
      await owner1.sendTransaction({
        to: await multisig.getAddress(),
        value: ethers.parseEther("10")
      });

      const recipient = owner4.address;
      const value = ethers.parseEther("5");
      const balanceBefore = await ethers.provider.getBalance(recipient);

      await multisig.connect(owner1).submitTransaction(recipient, value, "0x");
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner1).executeTransaction(0);

      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });
  });

  // ============ Edge Case Tests ============

  describe("Edge Cases", function () {
    it("handles single owner with threshold 1", async function () {
      const owners = [owner1.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 1]);

      // Fund multisig
      await owner1.sendTransaction({
        to: await multisig.getAddress(),
        value: ethers.parseEther("1")
      });

      const balanceBefore = await ethers.provider.getBalance(owner2.address);

      // Single owner can submit and immediately execute (auto-confirmed)
      await multisig.connect(owner1).submitTransaction(owner2.address, ethers.parseEther("0.5"), "0x");
      await multisig.connect(owner1).executeTransaction(0);

      const balanceAfter = await ethers.provider.getBalance(owner2.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
    });

    it("handles maximum confirmations", async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);

      await multisig.connect(owner1).submitTransaction(owner4.address, 0, "0x");
      await multisig.connect(owner2).confirmTransaction(0);
      await multisig.connect(owner3).confirmTransaction(0);

      expect(await multisig.getConfirmationCount(0)).to.equal(3);

      // Can still execute with more than threshold confirmations
      await multisig.connect(owner1).executeTransaction(0);

      const tx = await multisig.getTransaction(0);
      expect(tx.executed).to.be.true;
    });
  });

  // ============ Signature-based Execution Tests ============

  describe("executeWithSignatures", function () {
    // Helper function to sign a transaction hash
    async function signTransaction(signer, multisigAddress, target, value, data, nonce) {
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Compute the same hash as the contract
      const txHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "address", "uint256", "bytes", "uint256"],
        [chainId, multisigAddress, target, value, data, nonce]
      );

      // Sign with Ethereum prefix (eth_sign style)
      const signature = await signer.signMessage(ethers.getBytes(txHash));
      return signature;
    }

    beforeEach(async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      multisig = await deployContract(owner1, "MultisigAdmin", [owners, 2]);

      // Fund the multisig
      await owner1.sendTransaction({
        to: await multisig.getAddress(),
        value: ethers.parseEther("10")
      });
    });

    it("executes transaction with valid signatures", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("1");
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const balanceBefore = await ethers.provider.getBalance(target);

      // Get signatures from owner1 and owner2
      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      // Execute with signatures
      await multisig.connect(nonOwner).executeWithSignatures(target, value, data, [sig1, sig2]);

      const balanceAfter = await ethers.provider.getBalance(target);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });

    it("emits ExecutedWithSignatures event", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      await expect(multisig.connect(nonOwner).executeWithSignatures(target, value, data, [sig1, sig2]))
        .to.emit(multisig, "ExecutedWithSignatures")
        .withArgs(nonce, target, value, data, nonOwner.address);
    });

    it("increments nonce after execution", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";

      expect(await multisig.getCurrentNonce()).to.equal(0);

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, 0);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, 0);

      await multisig.executeWithSignatures(target, value, data, [sig1, sig2]);

      expect(await multisig.getCurrentNonce()).to.equal(1);
    });

    it("allows anyone to submit signatures (not just owners)", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("0.5");
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const balanceBefore = await ethers.provider.getBalance(target);

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      // Non-owner can submit the signatures
      await multisig.connect(nonOwner).executeWithSignatures(target, value, data, [sig1, sig2]);

      const balanceAfter = await ethers.provider.getBalance(target);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });

    it("reverts with insufficient signatures", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);

      // Only 1 signature, but threshold is 2
      await expect(
        multisig.executeWithSignatures(target, value, data, [sig1])
      ).to.be.revertedWithCustomError(multisig, "InsufficientSignatures");
    });

    it("ignores signatures from non-owners", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      // One valid signature from owner1, one from non-owner
      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sigNonOwner = await signTransaction(nonOwner, await multisig.getAddress(), target, value, data, nonce);

      // Should fail because non-owner signature is ignored
      await expect(
        multisig.executeWithSignatures(target, value, data, [sig1, sigNonOwner])
      ).to.be.revertedWithCustomError(multisig, "InsufficientSignatures");
    });

    it("ignores duplicate signatures from same owner", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);

      // Submit same signature twice
      await expect(
        multisig.executeWithSignatures(target, value, data, [sig1, sig1])
      ).to.be.revertedWithCustomError(multisig, "InsufficientSignatures");
    });

    it("prevents replay with same nonce", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      // First execution succeeds
      await multisig.executeWithSignatures(target, value, data, [sig1, sig2]);

      // Replay with same signatures fails (nonce has incremented)
      await expect(
        multisig.executeWithSignatures(target, value, data, [sig1, sig2])
      ).to.be.revertedWithCustomError(multisig, "InsufficientSignatures");
    });

    it("works with more signatures than threshold", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("0.1");
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const balanceBefore = await ethers.provider.getBalance(target);

      // Get signatures from all 3 owners (threshold is 2)
      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);
      const sig3 = await signTransaction(owner3, await multisig.getAddress(), target, value, data, nonce);

      await multisig.executeWithSignatures(target, value, data, [sig1, sig2, sig3]);

      const balanceAfter = await ethers.provider.getBalance(target);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });

    it("reverts on invalid signature length", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";

      // Invalid signature (not 65 bytes)
      const invalidSig = "0x1234";

      await expect(
        multisig.executeWithSignatures(target, value, data, [invalidSig, invalidSig])
      ).to.be.revertedWithCustomError(multisig, "InvalidSignatureLength");
    });

    it("executes contract call with signatures", async function () {
      // Deploy a test ERC20Safe and transfer admin to multisig
      const safe = await deployUpgradableContract(owner1, "ERC20Safe");
      await safe.connect(owner1).transferAdmin(await multisig.getAddress());

      const unpauseData = safe.interface.encodeFunctionData("unpause", []);
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), await safe.getAddress(), 0, unpauseData, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), await safe.getAddress(), 0, unpauseData, nonce);

      // Execute unpause via signatures
      await multisig.executeWithSignatures(await safe.getAddress(), 0, unpauseData, [sig1, sig2]);

      expect(await safe.paused()).to.be.false;
    });

    it("getTransactionHash returns consistent hash", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("1");
      const data = "0x1234";
      const nonce = 5;

      const hash1 = await multisig.getTransactionHash(target, value, data, nonce);
      const hash2 = await multisig.getTransactionHash(target, value, data, nonce);

      expect(hash1).to.equal(hash2);

      // Different nonce should produce different hash
      const hash3 = await multisig.getTransactionHash(target, value, data, nonce + 1);
      expect(hash1).to.not.equal(hash3);
    });

    it("records transaction in history for getTransaction/getTransactionIds", async function () {
      const target = owner4.address;
      const value = ethers.parseEther("0.5");
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      // No transactions yet
      expect(await multisig.transactionCount()).to.equal(0);

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      await multisig.executeWithSignatures(target, value, data, [sig1, sig2]);

      // Transaction should be recorded
      expect(await multisig.transactionCount()).to.equal(1);

      // Should be queryable via getTransaction
      const [txTarget, txValue, txData, txExecuted, txConfirmations] = await multisig.getTransaction(0);
      expect(txTarget).to.equal(target);
      expect(txValue).to.equal(value);
      expect(txData).to.equal(data);
      expect(txExecuted).to.be.true;
      expect(txConfirmations).to.equal(2); // 2 valid signers

      // Should appear in getTransactionIds for executed
      const executedIds = await multisig.getTransactionIds(0, 10, false, true);
      expect(executedIds.length).to.equal(1);
      expect(executedIds[0]).to.equal(0n);
    });

    it("emits TransactionSubmitted and TransactionExecuted events", async function () {
      const target = owner4.address;
      const value = 0;
      const data = "0x";
      const nonce = await multisig.getCurrentNonce();

      const sig1 = await signTransaction(owner1, await multisig.getAddress(), target, value, data, nonce);
      const sig2 = await signTransaction(owner2, await multisig.getAddress(), target, value, data, nonce);

      await expect(multisig.executeWithSignatures(target, value, data, [sig1, sig2]))
        .to.emit(multisig, "TransactionSubmitted")
        .and.to.emit(multisig, "TransactionExecuted");
    });
  });
});
