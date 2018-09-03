import assert = require("assert");
import { BigNumber } from "bignumber.js";
import BN = require("bn.js");
import promisify = require("es6-promisify");
import util = require("util");
import { Bitstream } from "../src/bitstream";
import { Context } from "../src/context";
import { Contracts } from "../src/contracts";
import { expectThrow } from "../src/expectThrow";
import { ProtocolSimulator } from "../src/protocol_simulator";
import { ringsInfoList, tokenSymbols } from "./rings_config";
import { RingsGenerator } from "../src/rings_generator";
import { Tax } from "../src/tax";
import { OrderExpectation, OrderInfo, RingsInfo, SignAlgorithm, SimulatorReport, TransferItem } from "../src/types";
import Web3 = require("web3");

// Manually set these for now...
const exchangeAddress = "0x6bc55ad52ec17015a0fa70679497bfd04bb683ff";
const symbolRegistryAddress = "0xa999a85add2a467d28d79dcba903d5fdb16a0917";

const web3 = new Web3();
web3.setProvider(new Web3.providers.HttpProvider("http://localhost:8545"));
const accounts = web3.eth.accounts;
web3.eth.defaultAccount = accounts[0];

const deployer = accounts[0];
const miner = accounts[0];
const feeRecipient = accounts[0];
const orderOwners = accounts.slice(5, 9);
const orderDualAuthAddr = accounts.slice(1, 4);
const transactionOrigin = /*miner*/ accounts[1];
const broker1 = accounts[1];
const wallet1 = accounts[3];

let contracts: Contracts;
let defaultContext: Context;

let exchange: any;
let tokenRegistry: any;
let symbolRegistry: any;
let tradeDelegate: any;
let orderRegistry: any;
let minerRegistry: any;
let dummyBrokerInterceptor: any;
let lrcAddress: string;
let wethAddress: string;
let walletSplitPercentage: number;
let feePercentageBase: number;
let tax: Tax;

let tokenRegistryAddress: string;
let tradeDelegateAddress: string;
let orderBrokerRegistryAddress: string;
let minerBrokerRegistryAddress: string;
let orderRegistryAddress: string;
let minerRegistryAddress: string;
let feeHolderAddress: string;

const tokenSymbolAddrMap = new Map();
const tokenInstanceMap = new Map();
const allTokens: any[] = [];

const assertNumberEqualsWithPrecision = (n1: number, n2: number, description: string, precision: number = 12) =>  {
  const numStr1 = (n1 / 1e18).toFixed(precision);
  const numStr2 = (n2 / 1e18).toFixed(precision);
  return assert.equal(Number(numStr1), Number(numStr2), description);
}

const getDefaultContext = () => {
  const currBlockNumber = web3.eth.blockNumber;
  const currBlockTimestamp = web3.eth.getBlock(currBlockNumber).timestamp;
  // Pass in the block number and the block time stamp so we can more accurately reproduce transactions
  const context = new Context(contracts,
                              web3,
                              currBlockNumber,
                              currBlockTimestamp,
                              tokenRegistryAddress,
                              tradeDelegateAddress,
                              orderBrokerRegistryAddress,
                              minerBrokerRegistryAddress,
                              orderRegistryAddress,
                              minerRegistryAddress,
                              feeHolderAddress,
                              lrcAddress,
                              tax,
                              feePercentageBase);
  return context;
};

const initializeTradeDelegate = async () => {
  // await tradeDelegate.authorizeAddress(exchangeAddress, {from: deployer});

  const walletSplitPercentageBN = await tradeDelegate.walletSplitPercentage();
  walletSplitPercentage = walletSplitPercentageBN.toNumber();

  for (const token of allTokens) {
    // approve once for all orders:
    for (const orderOwner of orderOwners) {
      await token.approve(tradeDelegate.address, 1e32, {from: orderOwner});
    }
  }
};

const setupOrder = async (order: OrderInfo, index: number) => {
  if (order.owner === undefined) {
    const accountIndex = index % orderOwners.length;
    order.owner = orderOwners[accountIndex];
  } else if (order.owner !== undefined && !order.owner.startsWith("0x")) {
    const accountIndex = parseInt(order.owner, 10);
    assert(accountIndex >= 0 && accountIndex < orderOwners.length, "Invalid owner index");
    order.owner = orderOwners[accountIndex];
  }
  if (!order.tokenS.startsWith("0x")) {
    order.tokenS = await symbolRegistry.getAddressBySymbol(order.tokenS);
  }
  if (!order.tokenB.startsWith("0x")) {
    order.tokenB = await symbolRegistry.getAddressBySymbol(order.tokenB);
  }
  if (order.feeToken && !order.feeToken.startsWith("0x")) {
    order.feeToken = await symbolRegistry.getAddressBySymbol(order.feeToken);
  }
  if (order.feeAmount === undefined) {
    order.feeAmount = 1e18;
  }
  if (order.feePercentage === undefined && order.feeAmount > 0) {
    order.feePercentage = 20;  // == 2.0%
  }
  if (!order.dualAuthSignAlgorithm) {
    order.dualAuthSignAlgorithm = SignAlgorithm.Ethereum;
  }
  if (order.dualAuthAddr === undefined && order.dualAuthSignAlgorithm !== SignAlgorithm.None) {
    const accountIndex = index % orderDualAuthAddr.length;
    order.dualAuthAddr = orderDualAuthAddr[accountIndex];
  }
  if (!order.allOrNone) {
    order.allOrNone = false;
  }
  if (!order.validSince) {
    // Set the order validSince time to a bit before the current timestamp;
    order.validSince = web3.eth.getBlock(web3.eth.blockNumber).timestamp - 1000;
  }
  if (!order.walletAddr && index > 0) {
    order.walletAddr = wallet1;
  }
  if (order.tokenRecipient !== undefined && !order.tokenRecipient.startsWith("0x")) {
    const accountIndex = parseInt(order.tokenRecipient, 10);
    assert(accountIndex >= 0 && accountIndex < orderOwners.length, "Invalid token recipient index");
    order.tokenRecipient = orderOwners[accountIndex];
  }
  // Fill in defaults (default, so these will not get serialized)
  order.tokenRecipient = order.tokenRecipient ? order.tokenRecipient : order.owner;
  order.feeToken = order.feeToken ? order.feeToken : lrcAddress;
  order.feeAmount = order.feeAmount ? order.feeAmount : 0;
  order.feePercentage = order.feePercentage ? order.feePercentage : 0;
  order.waiveFeePercentage = order.waiveFeePercentage ? order.waiveFeePercentage : 0;
  order.tokenSFeePercentage = order.tokenSFeePercentage ? order.tokenSFeePercentage : 0;
  order.tokenBFeePercentage = order.tokenBFeePercentage ? order.tokenBFeePercentage : 0;

  // setup initial balances:
  const tokenS = contracts.DummyTokenContract.at(order.tokenS);
  await tokenS.setBalance(order.owner, (order.balanceS !== undefined) ? order.balanceS : order.amountS);
  const feeToken = order.feeToken ? order.feeToken : lrcAddress;
  const balanceFee = (order.balanceFee !== undefined) ? order.balanceFee : (order.feeAmount * 2);
  if (feeToken === order.tokenS) {
    tokenS.addBalance(order.owner, balanceFee);
  } else {
    const tokenFee = contracts.DummyTokenContract.at(feeToken);
    await tokenFee.setBalance(order.owner, balanceFee);
  }
};

const assertEqualsRingsInfo = (ringsInfoA: RingsInfo, ringsInfoB: RingsInfo) => {
  // Blacklist properties we don't want to check.
  // We don't whitelist because we might forget to add them here otherwise.
  const ringsInfoPropertiesToSkip = ["description", "signAlgorithm", "hash", "expected"];
  const orderPropertiesToSkip = [
    "maxAmountS", "fillAmountS", "fillAmountB", "fillAmountFee", "splitS", "brokerInterceptor",
    "valid", "hash", "delegateContract", "signAlgorithm", "dualAuthSignAlgorithm", "index", "lrcAddress",
    "balanceS", "balanceFee", "tokenSpendableS", "tokenSpendableFee",
    "brokerSpendableS", "brokerSpendableFee",
  ];
  // Make sure to get the keys from both objects to make sure we get all keys defined in both
  for (const key of [...Object.keys(ringsInfoA), ...Object.keys(ringsInfoB)]) {
    if (ringsInfoPropertiesToSkip.every((x) => x !== key)) {
      if (key === "rings") {
        assert.equal(ringsInfoA.rings.length, ringsInfoB.rings.length,
                     "Number of rings does not match");
        for (let r = 0; r < ringsInfoA.rings.length; r++) {
          assert.equal(ringsInfoA.rings[r].length, ringsInfoB.rings[r].length,
                       "Number of orders in rings does not match");
          for (let o = 0; o < ringsInfoA.rings[r].length; o++) {
            assert.equal(ringsInfoA.rings[r][o], ringsInfoB.rings[r][o],
                         "Order indices in rings do not match");
          }
        }
      } else if (key === "orders") {
        assert.equal(ringsInfoA.orders.length, ringsInfoB.orders.length,
                     "Number of orders does not match");
        for (let o = 0; o < ringsInfoA.orders.length; o++) {
          for (const orderKey of [...Object.keys(ringsInfoA.orders[o]), ...Object.keys(ringsInfoB.orders[o])]) {
            if (orderPropertiesToSkip.every((x) => x !== orderKey)) {
              assert.equal(ringsInfoA.orders[o][orderKey], ringsInfoB.orders[o][orderKey],
                           "Order property '" + orderKey + "' does not match");
            }
          }
        }
      } else {
          assert.equal(ringsInfoA[key], ringsInfoB[key],
                       "RingInfo property '" + key + "' does not match");
      }
    }
  }
};

interface OrderSettlement {
  amountS: number;
  amountB: number;
  amountFee: number;
  amountFeeS: number;
  amountFeeB: number;
  amountTaxFee: number;
  amountTaxS: number;
  amountTaxB: number;
}

const calculateOrderSettlement = (order: OrderInfo,
                                  orderExpectation: OrderExpectation,
                                  P2P: boolean) => {
  if (P2P) {
    // Fill amounts
    const amountS = order.amountS * orderExpectation.filledFraction;
    let amountB = order.amountB * orderExpectation.filledFraction;
    // Taker gets the margin
    if (orderExpectation.marginP2PFraction) {
      amountB += order.amountB * orderExpectation.marginP2PFraction;
    }

    // Fees
    let amountFeeS = Math.floor((amountS * defaultContext.feePercentageBase) /
                                (defaultContext.feePercentageBase - order.tokenSFeePercentage)) - amountS;
    let amountFeeB = Math.floor(amountB * order.tokenBFeePercentage / defaultContext.feePercentageBase);
    // No fees need to be paid when the order has no wallet
    if (!order.walletAddr) {
      amountFeeS = 0;
      amountFeeB = 0;
    }

    // Taxes
    const amountTaxS = tax.calculateTax(order.tokenS, false, true, amountFeeS);
    const amountTaxB = tax.calculateTax(order.tokenB, false, true, amountFeeB);

    const orderSettlement: OrderSettlement = {
      amountS,
      amountB,
      amountFee: 0,
      amountFeeS,
      amountFeeB,
      amountTaxFee: 0,
      amountTaxS,
      amountTaxB,
    };
    return orderSettlement;
  } else {
    // Fill amounts
    let amountS = order.amountS * orderExpectation.filledFraction;
    let amountB = order.amountB * orderExpectation.filledFraction;

    // Fees
    let amountFee = order.feeAmount * orderExpectation.filledFraction;
    let amountFeeB = Math.floor(amountB * order.feePercentage / defaultContext.feePercentageBase);
    // Waive fees before tax
    if (order.waiveFeePercentage > 0) {
      amountFee -= Math.floor(amountFee * order.waiveFeePercentage / defaultContext.feePercentageBase);
      amountFeeB -= Math.floor(amountFeeB * order.waiveFeePercentage / defaultContext.feePercentageBase);
    } else if(order.waiveFeePercentage < 0) {
      amountFee = 0;
      amountFeeB = 0;
    }
    // Pay in either feeToken or tokenB
    if (orderExpectation.payFeeInTokenB) {
      amountFee = 0;
    } else {
      amountFeeB = 0;
    }

    // Taxes
    const amountTaxFee = tax.calculateTax(order.feeToken, false, false, amountFee);
    const amountTaxB = tax.calculateTax(order.tokenB, false, false, amountFeeB);

    const orderSettlement: OrderSettlement = {
      amountS,
      amountB,
      amountFee,
      amountFeeS: 0,
      amountFeeB,
      amountTaxFee,
      amountTaxS: 0,
      amountTaxB,
    };
    return orderSettlement;
  }
};

const assertRings = (reverted: boolean,
                     report: SimulatorReport,
                     ringsInfo: RingsInfo) => {
  // Check if the transaction should revert
  assert.equal(reverted, ringsInfo.expected.revert ? ringsInfo.expected.revert : false,
               "Transaction should revert when expected");
  if(reverted) {
    return;
  }

  // Copy balances before
  const expectedBalances: { [id: string]: any; } = {};
  for (const token of Object.keys(report.balancesBefore)) {
    for (const owner of Object.keys(report.balancesBefore[token])) {
      if (!expectedBalances[token]) {
        expectedBalances[token] = {};
      }
      expectedBalances[token][owner] = report.balancesBefore[token][owner];
    }
  }
  // Intialize filled amounts
  const expectedfilledAmounts: { [id: string]: any; } = {};
  for (const order of ringsInfo.orders) {
    const orderHash = order.hash.toString("hex");
    if (!expectedfilledAmounts[orderHash]) {
      expectedfilledAmounts[orderHash] = 0;
    }
  }

  // Simulate order settlement in rings using the given expectations
  for (const [r, ring] of ringsInfo.rings.entries()) {
    if (ringsInfo.expected.rings[r].fail) {
      continue;
    }
    for (const [o, orderIndex] of ring.entries()) {
      const order = ringsInfo.orders[orderIndex];
      const orderSettlement = calculateOrderSettlement(order,
                                                       ringsInfo.expected.rings[r].orders[o],
                                                       ringsInfo.expected.rings[r].P2P);

      // Balances
      const totalS = orderSettlement.amountS + orderSettlement.amountFeeS + orderSettlement.amountTaxS;
      const totalB = orderSettlement.amountB - orderSettlement.amountFeeB - orderSettlement.amountTaxB;
      const totalFee = orderSettlement.amountFee + orderSettlement.amountTaxFee;
      // console.log("totalS: " + totalS / 1e18);
      // console.log("totalB: " + totalB / 1e18);
      // console.log("totalFee: " + totalFee / 1e18);
      expectedBalances[order.tokenS][order.owner] -= totalS;
      expectedBalances[order.tokenB][order.tokenRecipient] += totalB;
      expectedBalances[order.feeToken][order.owner] -= totalFee;

      // Filled
      const expectedFilledAmount = order.amountS * ringsInfo.expected.rings[r].orders[o].filledFraction;
      expectedfilledAmounts[order.hash.toString("hex")] += expectedFilledAmount;
    }
  }

  // Check balances
  for (const token of Object.keys(expectedBalances)) {
    for (const owner of Object.keys(expectedBalances[token])) {
      // console.log("[Sim]" + owner + ":" + token + " = " + report.balancesAfter[token][owner] / 1e18);
      // console.log("[Exp]" + owner + ":" + token + " = " + expectedBalances[token][owner] / 1e18);
      assertNumberEqualsWithPrecision(report.balancesAfter[token][owner], expectedBalances[token][owner],
                                      "Balance should match expected value");
    }
  }
  // Check filled
  for (const order of ringsInfo.orders) {
    const orderHash = order.hash.toString("hex");
    assertNumberEqualsWithPrecision(report.filledAmounts[orderHash], expectedfilledAmounts[orderHash],
                                    "Order filled amount should match expected value");
  }
};

const setupRings = async (ringsInfo: RingsInfo) => {
  if (ringsInfo.transactionOrigin === undefined) {
    ringsInfo.transactionOrigin = transactionOrigin;
    ringsInfo.feeRecipient = feeRecipient;
    ringsInfo.miner = miner;
  } else {
    if (!ringsInfo.transactionOrigin.startsWith("0x")) {
      const accountIndex = parseInt(ringsInfo.transactionOrigin, 10);
      assert(accountIndex >= 0 && accountIndex < orderOwners.length, "Invalid owner index");
      ringsInfo.transactionOrigin = orderOwners[accountIndex];
    }
    ringsInfo.feeRecipient = undefined;
    ringsInfo.miner = undefined;
}
  for (const [i, order] of ringsInfo.orders.entries()) {
    await setupOrder(order, i);
  }
};

const submitRings = async (context: Context, ringsInfo: RingsInfo) => {
  const ringsGenerator = new RingsGenerator(context);
  await ringsGenerator.setupRingsAsync(ringsInfo);
  const bs = ringsGenerator.toSubmitableParam(ringsInfo);

  const simulator = new ProtocolSimulator(walletSplitPercentage, context);
  const txOrigin = ringsInfo.transactionOrigin ? ringsInfo.transactionOrigin : transactionOrigin;
  const deserializedRingsInfo = simulator.deserialize(bs, txOrigin);
  assertEqualsRingsInfo(deserializedRingsInfo, ringsInfo);
  let reverted = false;
  let report: any = {
    ringMinedEvents: [],
    transferItems: [],
    feeBalances: [],
    filledAmounts: [],
    balancesBefore: [],
    balancesAfter: [],
  };
  try {
    report = await simulator.simulateAndReport(deserializedRingsInfo);
    reverted = false;
  } catch {
    reverted = true;
  }
  // report = await simulator.simulateAndReport(deserializedRingsInfo);
  return {reverted, report};
};

before( async () => {
  console.log("Setting up simulator...");
  contracts = new Contracts(web3);
  const exchangeImpl = contracts.ExchangeImplContract.at(exchangeAddress);
  symbolRegistry = contracts.SymbolRegistryContract.at(symbolRegistryAddress);

  tokenRegistryAddress = await exchangeImpl.tokenRegistryAddress();
  tradeDelegateAddress = await exchangeImpl.delegateAddress();
  orderBrokerRegistryAddress = await exchangeImpl.orderBrokerRegistryAddress();
  minerBrokerRegistryAddress = await exchangeImpl.minerBrokerRegistryAddress();
  orderRegistryAddress = await exchangeImpl.orderRegistryAddress();
  minerRegistryAddress = await exchangeImpl.minerRegistryAddress();
  feeHolderAddress = await exchangeImpl.feeHolderAddress();

  tokenRegistry = contracts.ExchangeImplContract.at(tokenRegistryAddress);
  tradeDelegate = contracts.TradeDelegateContract.at(tradeDelegateAddress);

  exchange = contracts.ExchangeContract.at(exchangeAddress);
  lrcAddress = await symbolRegistry.getAddressBySymbol("LRC");
  wethAddress = await symbolRegistry.getAddressBySymbol("WETH");

  for (const sym of tokenSymbols) {
    const addr = await symbolRegistry.getAddressBySymbol(sym);
    tokenSymbolAddrMap.set(sym, addr);
    const token = contracts.DummyTokenContract.at(addr);
    allTokens.push(token);
  }

  feePercentageBase = (await exchangeImpl.FEE_AND_TAX_PERCENTAGE_BASE()).toNumber();
  tax = new Tax((await exchangeImpl.TAX_MATCHING_CONSUMER_LRC()).toNumber(),
                (await exchangeImpl.TAX_MATCHING_CONSUMER_ETH()).toNumber(),
                (await exchangeImpl.TAX_MATCHING_CONSUMER_OTHER()).toNumber(),
                (await exchangeImpl.TAX_MATCHING_INCOME_LRC()).toNumber(),
                (await exchangeImpl.TAX_MATCHING_INCOME_ETH()).toNumber(),
                (await exchangeImpl.TAX_MATCHING_INCOME_OTHER()).toNumber(),
                (await exchangeImpl.TAX_P2P_CONSUMER_LRC()).toNumber(),
                (await exchangeImpl.TAX_P2P_CONSUMER_ETH()).toNumber(),
                (await exchangeImpl.TAX_P2P_CONSUMER_OTHER()).toNumber(),
                (await exchangeImpl.TAX_P2P_INCOME_LRC()).toNumber(),
                (await exchangeImpl.TAX_P2P_INCOME_ETH()).toNumber(),
                (await exchangeImpl.TAX_P2P_INCOME_OTHER()).toNumber(),
                (await exchangeImpl.FEE_AND_TAX_PERCENTAGE_BASE()).toNumber(),
                lrcAddress,
                wethAddress);

  await initializeTradeDelegate();

  defaultContext = getDefaultContext();

  console.log("Done.");
});

describe("simulate and report", () => {
  for (const ringsInfo of ringsInfoList) {
    it(ringsInfo.description, async () => {
      await setupRings(ringsInfo);
      const {reverted, report} = await submitRings(defaultContext, ringsInfo);
      assertRings(reverted, report, ringsInfo);
    });
  }
});