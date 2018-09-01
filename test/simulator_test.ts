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
import { OrderInfo, RingsInfo, SignAlgorithm, TransferItem } from "../src/types";
import Web3 = require("web3");

// Manually set these for now...
const exchangeAddress = "0xec806710efe04d1aea5ecc4124a457622d1a7ac9";
const symbolRegistryAddress = "0x452ee98a9b3598b7d0cc6ee90a87ba799f2ec025";

const web3 = new Web3();
web3.setProvider(new Web3.providers.HttpProvider("http://localhost:8545"));
const accounts = web3.eth.accounts;
web3.eth.defaultAccount = accounts[0];

const deployer = accounts[0];
const miner = accounts[9];
const orderOwners = accounts.slice(5, 8);
const orderDualAuthAddr = accounts.slice(1, 4);
const transactionOrigin = /*miner*/ accounts[1];
const broker1 = accounts[1];
const wallet1 = accounts[3];

let contracts: Contracts;

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

  /*for (const token of allTokens) {
    // approve once for all orders:
    for (const orderOwner of orderOwners) {
      await token.approve(tradeDelegate.address, 1e32, {from: orderOwner});
    }
  }*/
};

const setupOrder = async (order: OrderInfo, index: number, limitFeeTokenAmount?: boolean) => {
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
  if (!limitFeeTokenAmount) {
    const feeToken = order.feeToken ? order.feeToken : lrcAddress;
    const balanceFee = (order.balanceFee !== undefined) ? order.balanceFee : (order.feeAmount * 2);
    if (feeToken === order.tokenS) {
      tokenS.addBalance(order.owner, balanceFee);
    } else {
      const tokenFee = contracts.DummyTokenContract.at(feeToken);
      await tokenFee.setBalance(order.owner, balanceFee);
    }
  }
};

const submitRings = async (context: Context, ringsInfo: RingsInfo, eventFromBlock: number) => {
  const ringsGenerator = new RingsGenerator(context);
  await ringsGenerator.setupRingsAsync(ringsInfo);
  const bs = ringsGenerator.toSubmitableParam(ringsInfo);

  const simulator = new ProtocolSimulator(walletSplitPercentage, context);
  const txOrigin = ringsInfo.transactionOrigin ? ringsInfo.transactionOrigin : transactionOrigin;
  const deserializedRingsInfo = simulator.deserialize(bs, txOrigin);
  // assertEqualsRingsInfo(deserializedRingsInfo, ringsInfo);
  let shouldThrow = false;
  let report: any = {
    ringMinedEvents: [],
    transferItems: [],
    feeBalances: [],
    filledAmounts: [],
  };
  //try {
  report = await simulator.simulateAndReport(deserializedRingsInfo);
  /*} catch {
    shouldThrow = true;
  }*/
  return report;
};

before( async () => {
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
});

it("simulate and report", async () => {
  const ringsInfo: RingsInfo = {
    rings: [[0, 1]],
    orders: [
      {
        tokenS: tokenSymbols[1],
        tokenB: tokenSymbols[2],
        amountS: 35e17,
        amountB: 22e17,
      },
      {
        tokenS: tokenSymbols[2],
        tokenB: tokenSymbols[1],
        amountS: 23e17,
        amountB: 31e17,
      },
    ],
    transactionOrigin,
    miner,
    feeRecipient: miner,
  };

  for (const [i, order] of ringsInfo.orders.entries()) {
    await setupOrder(order, i);
  }

  const context = getDefaultContext();
  const report = await submitRings(context, ringsInfo, web3.eth.blockNumber);
  console.log(report);
});