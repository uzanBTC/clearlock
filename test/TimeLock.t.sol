// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { TimeLock } from "../src/TimeLock.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockTaxToken } from "./mocks/MockTaxToken.sol";
import { MockFlapTaxToken } from "./mocks/MockFlapTaxToken.sol";
import { MockNoReturnToken } from "./mocks/MockNoReturnToken.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";
import {
    MockBalanceEdgeToken,
    MockMalformedBalanceToken,
    MockWithdrawBalanceDecreaseToken
} from "./mocks/MockBalanceEdgeToken.sol";
import { MockFalseTransferToken } from "./mocks/MockFalseTransferToken.sol";
import { TestBase, Vm } from "./TestBase.sol";

contract TimeLockTest is TestBase {
    uint256 internal constant AMOUNT = 100 ether;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA11);
    address internal constant TAX_RECIPIENT = address(0x7A7);

    TimeLock internal timeLock;
    MockERC20 internal token;
    MockFlapTaxToken internal flapToken;
    uint256 internal unlockTime;

    function setUp() public {
        timeLock = new TimeLock();
        token = new MockERC20("Mock Token", "MOCK", 18);
        unlockTime = block.timestamp + 1 days;
        token.mint(ALICE, 1_000 ether);
        vm.prank(ALICE);
        token.approve(address(timeLock), type(uint256).max);
    }

    function testLockRecordsFlapStyleAmount() public {
        flapToken = new MockFlapTaxToken(500, 1_000, address(0xF00D), TAX_RECIPIENT);
        flapToken.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        flapToken.approve(address(timeLock), AMOUNT);

        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(flapToken), AMOUNT, unlockTime, BOB);

        (address lockedToken, address beneficiary, uint256 amount, uint256 expiry, bool withdrawn) =
            timeLock.locks(lockId);
        assertEq(lockId, 0);
        assertEq(lockedToken, address(flapToken));
        assertEq(beneficiary, BOB);
        assertEq(amount, AMOUNT);
        assertEq(expiry, unlockTime);
        assertFalse(withdrawn);
        assertEq(timeLock.totalLocked(address(flapToken)), AMOUNT);
        assertEq(timeLock.locksCount(), 1);
    }

    function testFlapStyleWalletTransfersDoNotTaxLockOrWithdraw() public {
        flapToken = new MockFlapTaxToken(500, 1_000, address(0xF00D), TAX_RECIPIENT);
        flapToken.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        flapToken.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(flapToken), AMOUNT, unlockTime, BOB);

        vm.warp(unlockTime);
        uint256 before = flapToken.balanceOf(BOB);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        assertEq(flapToken.balanceOf(BOB) - before, AMOUNT);
        assertEq(timeLock.totalLocked(address(flapToken)), 0);
    }

    function testLockRejectsInvalidInputs() public {
        vm.expectRevert();
        timeLock.lock(address(0), AMOUNT, unlockTime, BOB);
        vm.expectRevert();
        timeLock.lock(address(token), AMOUNT, unlockTime, address(0));
        vm.expectRevert();
        timeLock.lock(address(token), 0, unlockTime, BOB);
        vm.expectRevert();
        timeLock.lock(address(token), AMOUNT, block.timestamp, BOB);
        vm.expectRevert();
        timeLock.lock(address(token), AMOUNT, block.timestamp - 1, BOB);
    }

    function testLockRequiresAllowanceAndBalance() public {
        vm.startPrank(BOB);
        vm.expectRevert();
        timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        vm.stopPrank();

        vm.prank(ALICE);
        token.approve(address(timeLock), AMOUNT - 1);
        vm.prank(ALICE);
        vm.expectRevert();
        timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
    }

    function testTaxedInboundRecordsNetAndTaxedOutboundReverts() public {
        MockTaxToken taxToken = new MockTaxToken(1_000, TAX_RECIPIENT);
        taxToken.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        taxToken.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(taxToken), AMOUNT, unlockTime, BOB);
        uint256 net = AMOUNT * 9_000 / 10_000;
        (,, uint256 recordedAmount,,) = timeLock.locks(lockId);
        assertEq(recordedAmount, net);

        vm.warp(unlockTime);
        vm.prank(BOB);
        vm.expectRevert();
        timeLock.withdraw(lockId);
        (,,,, bool withdrawn) = timeLock.locks(lockId);
        assertFalse(withdrawn);
        assertEq(timeLock.totalLocked(address(taxToken)), net);
    }

    function testNoReturnTokenWorks() public {
        MockNoReturnToken noReturn = new MockNoReturnToken();
        noReturn.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        noReturn.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(noReturn), AMOUNT, unlockTime, BOB);
        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        assertEq(noReturn.balanceOf(BOB), AMOUNT);
    }

    function testWithdrawBeforeExpiryAndUnauthorizedCallsRevert() public {
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        vm.expectRevert();
        vm.prank(ALICE);
        timeLock.withdraw(lockId);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.withdraw(99);
    }

    function testWithdrawAtExpiryAndDuplicateWithdrawReverts() public {
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        assertEq(token.balanceOf(BOB), AMOUNT);
        assertEq(timeLock.totalLocked(address(token)), 0);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.withdraw(lockId);
    }

    function testTransferLockSupportsOTCAndKeepsExpiry() public {
        vm.expectRevert(bytes("lock not found"));
        vm.prank(BOB);
        timeLock.transferLock(99, CAROL);

        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        vm.prank(BOB);
        timeLock.transferLock(lockId, CAROL);
        vm.prank(CAROL);
        timeLock.transferLock(lockId, BOB);
        (, address beneficiary, uint256 amount, uint256 expiry, bool withdrawn) =
            timeLock.locks(lockId);
        assertEq(beneficiary, BOB);
        assertEq(amount, AMOUNT);
        assertEq(expiry, unlockTime);
        assertFalse(withdrawn);

        vm.expectRevert();
        vm.prank(CAROL);
        timeLock.transferLock(lockId, ALICE);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.transferLock(lockId, address(0));

        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.transferLock(lockId, ALICE);
    }

    function testTimeLockEmitsNoEvents() public {
        vm.recordLogs();
        vm.prank(ALICE);
        uint256 id = timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(timeLock));
        }

        vm.recordLogs();
        vm.prank(BOB);
        timeLock.transferLock(id, CAROL);
        assertEq(vm.getRecordedLogs().length, 0);

        vm.warp(unlockTime);
        vm.recordLogs();
        vm.prank(CAROL);
        timeLock.withdraw(id);
        logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(timeLock));
        }
        assertEq(token.balanceOf(CAROL), AMOUNT);
    }

    function testMultipleLocksAndTokensSettleIndependently() public {
        MockERC20 other = new MockERC20("Other", "OTHER", 18);
        other.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        other.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 first = timeLock.lock(address(token), AMOUNT, unlockTime, BOB);
        vm.prank(ALICE);
        uint256 second = timeLock.lock(address(other), AMOUNT / 2, unlockTime + 1, CAROL);
        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(first);
        assertEq(timeLock.totalLocked(address(token)), 0);
        assertEq(timeLock.totalLocked(address(other)), AMOUNT / 2);
        (,,,, bool secondWithdrawn) = timeLock.locks(second);
        assertFalse(secondWithdrawn);
    }

    function testReentrantLockIsBlocked() public {
        MockReentrantToken reentrant = new MockReentrantToken();
        reentrant.mint(ALICE, AMOUNT);
        reentrant.configureLockCallback(address(timeLock), unlockTime, BOB);
        vm.prank(ALICE);
        reentrant.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        timeLock.lock(address(reentrant), AMOUNT, unlockTime, BOB);
        assertEq(timeLock.locksCount(), 1);
    }

    function testReentrantWithdrawIsBlocked() public {
        MockReentrantToken reentrant = new MockReentrantToken();
        reentrant.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        reentrant.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(reentrant), AMOUNT, unlockTime, BOB);
        reentrant.configureWithdrawCallback(address(timeLock), lockId);
        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        assertEq(reentrant.balanceOf(BOB), AMOUNT);
    }

    function testBalanceDeltaFailurePathsRevert() public {
        MockBalanceEdgeToken zeroDelta =
            new MockBalanceEdgeToken(MockBalanceEdgeToken.Mode.ZeroDelta);
        vm.expectRevert();
        timeLock.lock(address(zeroDelta), 1, unlockTime, BOB);

        MockBalanceEdgeToken decreased =
            new MockBalanceEdgeToken(MockBalanceEdgeToken.Mode.Decrease);
        vm.expectRevert();
        timeLock.lock(address(decreased), 1, unlockTime, BOB);

        MockMalformedBalanceToken malformed = new MockMalformedBalanceToken();
        vm.expectRevert();
        timeLock.lock(address(malformed), 1, unlockTime, BOB);
    }

    function testFalseTransferReturnRevertsAndPreservesLock() public {
        MockFalseTransferToken falseTransfer = new MockFalseTransferToken();
        falseTransfer.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        falseTransfer.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(falseTransfer), AMOUNT, unlockTime, BOB);
        vm.warp(unlockTime);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        (,,,, bool withdrawn) = timeLock.locks(lockId);
        assertFalse(withdrawn);
    }

    function testWithdrawRejectsDecreasingRecipientBalance() public {
        MockWithdrawBalanceDecreaseToken edge = new MockWithdrawBalanceDecreaseToken();
        edge.setBeneficiary(BOB);
        edge.mint(ALICE, AMOUNT);
        vm.prank(ALICE);
        edge.approve(address(timeLock), AMOUNT);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(edge), AMOUNT, unlockTime, BOB);
        vm.warp(unlockTime);
        vm.expectRevert();
        vm.prank(BOB);
        timeLock.withdraw(lockId);
    }

    function testFuzzFlapTaxRatesAndAmounts(
        uint256 amountSeed,
        uint256 buyTaxSeed,
        uint256 sellTaxSeed
    ) public {
        uint256 amount = amountSeed % 1e24 + 1;
        uint256 buyTax = buyTaxSeed % 10_001;
        uint256 sellTax = sellTaxSeed % 10_001;
        MockFlapTaxToken fuzzToken =
            new MockFlapTaxToken(buyTax, sellTax, address(0xF00D), TAX_RECIPIENT);
        fuzzToken.mint(ALICE, amount);
        vm.prank(ALICE);
        fuzzToken.approve(address(timeLock), amount);
        vm.prank(ALICE);
        uint256 lockId = timeLock.lock(address(fuzzToken), amount, unlockTime, BOB);
        (,, uint256 recorded,,) = timeLock.locks(lockId);
        assertEq(recorded, amount);
        vm.warp(unlockTime);
        vm.prank(BOB);
        timeLock.withdraw(lockId);
        assertEq(fuzzToken.balanceOf(BOB), amount);
    }
}

contract TimeLockInvariantHandler is TestBase {
    TimeLock private immutable timeLock;
    MockERC20 private immutable token;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    constructor(TimeLock timeLock_, MockERC20 token_) {
        timeLock = timeLock_;
        token = token_;
        token_.mint(address(this), 1_000_000 ether);
        token_.approve(address(timeLock_), type(uint256).max);
        createLock(99 ether, 0);
    }

    function createLock(uint256 seed, uint256 duration) public {
        uint256 available = token.balanceOf(address(this));
        if (available == 0) return;
        uint256 amount = seed % available + 1;
        timeLock.lock(address(token), amount, block.timestamp + duration % 1 days + 1, ALICE);
    }

    function transferLock(uint256 seed) public {
        uint256 id = seed % timeLock.locksCount();
        (, address beneficiary,,, bool withdrawn) = timeLock.locks(id);
        if (withdrawn) return;
        vm.prank(beneficiary);
        timeLock.transferLock(id, beneficiary == ALICE ? BOB : ALICE);
    }

    function settleLock(uint256 seed) public {
        uint256 id = seed % timeLock.locksCount();
        (, address beneficiary,, uint256 unlockTime, bool withdrawn) = timeLock.locks(id);
        if (withdrawn) return;
        if (block.timestamp < unlockTime) vm.warp(unlockTime);
        vm.prank(beneficiary);
        timeLock.withdraw(id);
    }
}

contract TimeLockInvariantTest is TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    TimeLock internal timeLock;
    MockERC20 internal token;
    TimeLockInvariantHandler internal handler;

    function setUp() public {
        timeLock = new TimeLock();
        token = new MockERC20("Invariant Token", "INV", 18);
        handler = new TimeLockInvariantHandler(timeLock, token);
    }

    function invariant_contractBalanceCoversTotalLocked() public view {
        uint256 remaining;
        uint256 count = timeLock.locksCount();
        for (uint256 id; id < count; ++id) {
            (,, uint256 amount,, bool withdrawn) = timeLock.locks(id);
            if (!withdrawn) remaining += amount;
        }
        uint256 total = timeLock.totalLocked(address(token));
        assertEq(total, remaining);
        assertTrue(token.balanceOf(address(timeLock)) >= total);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetArtifactSelectors()
        external
        pure
        returns (FuzzArtifactSelector[] memory targets)
    {
        targets = new FuzzArtifactSelector[](0);
    }

    function targetArtifacts() external pure returns (string[] memory targets) {
        targets = new string[](0);
    }

    function excludeArtifacts() external pure returns (string[] memory targets) {
        targets = new string[](0);
    }

    function excludeContracts() external pure returns (address[] memory targets) {
        targets = new address[](0);
    }

    function targetSenders() external pure returns (address[] memory targets) {
        targets = new address[](0);
    }

    function excludeSenders() external pure returns (address[] memory targets) {
        targets = new address[](0);
    }

    function targetInterfaces() external pure returns (FuzzInterface[] memory targets) {
        targets = new FuzzInterface[](0);
    }

    function targetSelectors() external pure returns (FuzzSelector[] memory targets) {
        targets = new FuzzSelector[](0);
    }

    function excludeSelectors() external pure returns (FuzzSelector[] memory targets) {
        targets = new FuzzSelector[](0);
    }
}
