//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title PermitERC20
 * @dev Test ERC20 token with EIP-2612 permit functionality for testing depositWithPermit
 */
contract PermitERC20 is ERC20, ERC20Permit {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) ERC20Permit(name) {
        // decimals_ is ignored as OZ ERC20 uses 18 by default
        // For testing purposes this is fine
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
