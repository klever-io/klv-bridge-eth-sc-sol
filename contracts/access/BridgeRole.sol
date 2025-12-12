// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./AdminRole.sol";

/**
 * @dev Collection of functions related to the address type
 */
library AddressLib {
    /**
     * @dev Returns true if `account` is a contract.
     */
    function isContract(address account) internal view returns (bool) {
        // This method relies on extcodesize, which returns 0 for contracts in
        // construction, since the code is only stored at the end of the
        // constructor execution.

        uint256 size;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}

/**
 * @title Operator Role Contract
 * @dev Simple role contract. Used for adding/removing operators
 */
contract BridgeRole is Initializable, AdminRole {
    using AddressLib for address;

    address private _bridge;

    event BridgeTransferred(address indexed previousBridge, address indexed newBridge);

    /**
     * @dev Initializes the bridge role and it's dependencies
     */
    function __BridgeRole_init() internal onlyInitializing {
        __AdminRole_init();
        __BridgeRole_init_unchained();
    }

    function __BridgeRole_init_unchained() internal onlyInitializing {
    }

    /**
     * @dev Returns the address of the current bridge.
     */
    function bridge() public view returns (address) {
        return _bridge;
    }

    /**
     * @dev Throws if called by any account other than the bridge.
     */
    modifier onlyBridge() {
        require(bridge() == msg.sender, "Access Control: sender is not Bridge");
        _;
    }

    /**
     * @dev Transfers bridge role of the contract to a new account (`newBridge`).
     * Can only be called by the current bridge (which requires relayer quorum),
     * or by admin if no bridge is set yet (initial setup).
     */
    function setBridge(address newBridge) public {
        // Allow admin to set initial bridge, or existing bridge to update
        if (_bridge == address(0)) {
            require(admin() == msg.sender, "Access Control: sender is not Admin");
        } else {
            require(_bridge == msg.sender, "Access Control: sender is not Bridge");
        }
        require(newBridge != address(0), "BridgeRole: new bridge is the zero address");
        require(newBridge != _bridge, "BridgeRole: same bridge");
        require(newBridge.isContract(), "BridgeRole: new bridge must be a contract");

        emit BridgeTransferred(_bridge, newBridge);
        _bridge = newBridge;
    }
}
