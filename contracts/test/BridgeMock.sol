//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import "../Bridge.sol";

contract BridgeMock is Bridge {
    function initialize(address[] memory board, uint256 initialQuorum, ERC20Safe erc20Safe) public override initializer {
        Bridge.initialize(board, initialQuorum, erc20Safe);
    }

    function proxyTransfer(address tokenAddress, uint256 amount, address recipientAddress) external returns (bool) {
        return safe.transfer(tokenAddress, amount, recipientAddress);
    }

    // Mock function to test recoverLostFunds through bridge
    function recoverLostFunds(address tokenAddress, address recipient) external {
        safe.recoverLostFunds(tokenAddress, recipient);
    }

    // Mock function to whitelist token directly (for tests that use BridgeMock as bridge)
    function whitelistTokenDirect(
        address token,
        uint256 minimumAmount,
        uint256 maximumAmount,
        bool mintBurn,
        bool native,
        uint256 totalBalance,
        uint256 mintBalance,
        uint256 burnBalance
    ) external {
        safe.whitelistToken(token, minimumAmount, maximumAmount, mintBurn, native, totalBalance, mintBalance, burnBalance);
    }
}
