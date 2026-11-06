// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal tokens for exercising balance-delta failure paths.
contract MockBalanceEdgeToken {
    enum Mode {
        ZeroDelta,
        Decrease
    }

    Mode public immutable mode;
    uint256 public reportedBalance = 100;
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(Mode mode_) {
        mode = mode_;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function balanceOf(address) external view returns (uint256) {
        return reportedBalance;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        from;
        to;
        amount;
        if (mode == Mode.Decrease) reportedBalance -= 1;
        return true;
    }
}

contract MockWithdrawBalanceDecreaseToken {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowance;
    address public beneficiary;
    bool public transferCalled;

    function setBeneficiary(address beneficiary_) external {
        beneficiary = beneficiary_;
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == beneficiary) return transferCalled ? 0 : 1;
        return balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        require(balances[from] >= amount, "insufficient balance");
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        transferCalled = true;
        return true;
    }
}

/// @notice Returns an empty response for balanceOf, simulating a broken token.
contract MockMalformedBalanceToken {
    fallback() external {
        assembly {
            return(0, 0)
        }
    }
}
