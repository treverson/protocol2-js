import fs = require("fs");
import { Contracts } from "./contracts";
import { Tax } from "./tax";
import Web3 = require("web3");

export class Context {

  public contracts: Contracts;
  public web3: Web3;

  public blockNumber: number;
  public blockTimestamp: number;
  public lrcAddress: string;
  public tax: Tax;
  public feePercentageBase: number;

  public tokenRegistry: any;
  public tradeDelegate: any;
  public orderBrokerRegistry: any;
  public minerBrokerRegistry: any;
  public orderRegistry: any;
  public minerRegistry: any;
  public feeHolder: any;

  constructor(contracts: Contracts,
              web3: Web3,
              blockNumber: number,
              blockTimestamp: number,
              tokenRegistryAddress: string,
              tradeDelegateAddress: string,
              orderBrokerRegistryAddress: string,
              minerBrokerRegistryAddress: string,
              orderRegistryAddress: string,
              minerRegistryAddress: string,
              feeHolderAddress: string,
              lrcAddress: string,
              tax: Tax,
              feePercentageBase: number) {
    this.contracts = contracts;
    this.web3 = web3;
    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;
    this.lrcAddress = lrcAddress;
    this.tax = tax;
    this.feePercentageBase = feePercentageBase;

    this.tokenRegistry = contracts.TokenRegistryContract.at(tokenRegistryAddress);
    this.tradeDelegate = contracts.TradeDelegateContract.at(tradeDelegateAddress);
    this.orderBrokerRegistry = contracts.BrokerRegistryContract.at(orderBrokerRegistryAddress);
    this.minerBrokerRegistry = contracts.BrokerRegistryContract.at(minerBrokerRegistryAddress);
    this.orderRegistry = contracts.OrderRegistryContract.at(orderRegistryAddress);
    this.minerRegistry = contracts.MinerRegistryContract.at(minerRegistryAddress);
    this.feeHolder = contracts.FeeHolderContract.at(feeHolderAddress);
  }
}
