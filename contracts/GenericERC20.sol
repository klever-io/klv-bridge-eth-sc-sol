//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GenericERC20 is ERC20 {
    uint8 private numDecimals;

    constructor(string memory tokenName, string memory tokenSymbol, uint8 providedNumDecimals) ERC20(tokenName, tokenSymbol) {
        numDecimals = providedNumDecimals;
    }

    function mint(address recipientAddress, uint256 amount) external {
        _mint(recipientAddress, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return numDecimals;
    }
}
