import { BigNumber } from "bignumber.js";
import BN = require("bn.js");
import ABI = require("ethereumjs-abi");
import { Context } from "./context";
import { ensure } from "./ensure";
import { MultiHashUtil } from "./multihash";
import { OrderInfo, Spendable } from "./types";

export class OrderUtil {

  private context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  public async updateBrokerAndInterceptor(order: OrderInfo) {
    if (!order.broker) {
       order.broker = order.owner;
    } else {
      const [registered, brokerInterceptor] = await this.context.orderBrokerRegistry.getBroker(
        order.owner,
        order.broker,
      );
      order.valid = order.valid && ensure(registered, "order broker is not registered");
      order.brokerInterceptor =
        (brokerInterceptor === "0x0000000000000000000000000000000000000000") ? undefined : brokerInterceptor;
    }
  }

  public async validateInfo(order: OrderInfo) {
    let valid = true;
    valid = valid && ensure(order.owner ? true : false, "invalid order owner");
    valid = valid && ensure(order.tokenS ? true : false, "invalid order tokenS");
    valid = valid && ensure(order.tokenB ? true : false, "invalid order tokenB");
    valid = valid && ensure(order.amountS !== 0, "invalid order amountS");
    valid = valid && ensure(order.amountB !== 0, "invalid order amountB");
    valid = valid && ensure(order.feePercentage < this.context.feePercentageBase, "invalid fee percentage");
    valid = valid && ensure(order.waiveFeePercentage <= this.context.feePercentageBase, "invalid waive percentage");
    valid = valid && ensure(order.waiveFeePercentage >= -this.context.feePercentageBase, "invalid waive percentage");
    valid = valid && ensure(order.tokenSFeePercentage < this.context.feePercentageBase, "invalid tokenS percentage");
    valid = valid && ensure(order.tokenBFeePercentage < this.context.feePercentageBase, "invalid tokenB percentage");
    valid = valid && ensure(order.walletSplitPercentage <= 100, "invalid wallet split percentage");

    const blockTimestamp = this.context.blockTimestamp;
    valid = valid && ensure(order.validSince <= blockTimestamp, "order is too early to match");
    valid = valid && ensure(order.validUntil ? order.validUntil > blockTimestamp : true, "order is expired");

    order.valid = order.valid && valid;
  }

  public async checkBrokerSignature(order: OrderInfo) {
    let signatureValid = true;
    // If the order was already partially filled we don't have to check the signature again
    if (order.filledAmountS > 0) {
      signatureValid = true;
    } else if (!order.sig) {
      const orderHashHex = "0x" + order.hash.toString("hex");
      const isRegistered = await this.context.orderRegistry.isOrderHashRegistered(order.broker,
                                                                                  orderHashHex);
      const isOnchainOrder = await this.context.orderBook.orderSubmitted(orderHashHex);
      signatureValid = isRegistered || isOnchainOrder;
    } else {
      const multiHashUtil = new MultiHashUtil();
      signatureValid = multiHashUtil.verifySignature(order.broker, order.hash, order.sig);
    }
    order.valid = order.valid && ensure(signatureValid, "invalid order signature");
  }

  public checkDualAuthSignature(order: OrderInfo, miningHash: Buffer) {
    if (order.dualAuthSig) {
      const multiHashUtil = new MultiHashUtil();
      const signatureValid = multiHashUtil.verifySignature(order.dualAuthAddr, miningHash, order.dualAuthSig);
      order.valid = order.valid && ensure(signatureValid, "invalid order dual auth signature");
    }
  }

  public getOrderHash(order: OrderInfo) {
    const args = [
      this.toBN(order.amountS),
      this.toBN(order.amountB),
      this.toBN(order.feeAmount),
      order.validSince ? this.toBN(order.validSince) : this.toBN(0),
      order.validUntil ? this.toBN(order.validUntil) : this.toBN(0),
      order.owner,
      order.tokenS,
      order.tokenB,
      order.dualAuthAddr ? order.dualAuthAddr : "0x0",
      order.broker ? order.broker : "0x0",
      order.orderInterceptor ? order.orderInterceptor : "0x0",
      order.walletAddr ? order.walletAddr : "0x0",
      order.tokenRecipient,
      order.feeToken,
      order.walletSplitPercentage,
      this.toBN(order.feePercentage),
      this.toBN(order.tokenSFeePercentage),
      this.toBN(order.tokenBFeePercentage),
      order.allOrNone,
    ];
    const argTypes = [
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "address",
      "address",
      "address",
      "address",
      "address",
      "address",
      "address",
      "address",
      "address",
      "uint16",
      "uint16",
      "uint16",
      "uint16",
      "bool",
    ];
    const orderHash = ABI.soliditySHA3(argTypes, args);
    return orderHash;
  }

  public toOrderBookSubmitParams(orderInfo: OrderInfo) {
    const emptyAddrBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

    const numberToBytes32Str = (n: number) => {
      if (n === undefined) {
        n = 0;
      }
      const encoded = ABI.rawEncode(["uint256"], [this.toBN(n)]);
      return "0x" + encoded.toString("hex");
    };

    const addressToBytes32Str = (addr: string) => {
      if (addr) {
        const encoded = ABI.rawEncode(["address"], [addr]);
        return "0x" + encoded.toString("hex");
      } else {
        return emptyAddrBytes32;
      }
    };

    const bytes32Array: string[] = [];
    bytes32Array.push(addressToBytes32Str(orderInfo.owner));
    bytes32Array.push(addressToBytes32Str(orderInfo.tokenS));
    bytes32Array.push(addressToBytes32Str(orderInfo.tokenB));
    bytes32Array.push(numberToBytes32Str(orderInfo.amountS));
    bytes32Array.push(numberToBytes32Str(orderInfo.amountB));
    bytes32Array.push(numberToBytes32Str(orderInfo.validSince));
    bytes32Array.push(addressToBytes32Str(orderInfo.broker));
    bytes32Array.push(addressToBytes32Str(orderInfo.orderInterceptor));

    bytes32Array.push(addressToBytes32Str(orderInfo.walletAddr));
    bytes32Array.push(numberToBytes32Str(orderInfo.validUntil));
    bytes32Array.push(addressToBytes32Str(orderInfo.feeToken));
    bytes32Array.push(numberToBytes32Str(orderInfo.feeAmount));
    bytes32Array.push(numberToBytes32Str(orderInfo.feePercentage));
    bytes32Array.push(numberToBytes32Str(orderInfo.tokenSFeePercentage));
    bytes32Array.push(numberToBytes32Str(orderInfo.tokenBFeePercentage));
    bytes32Array.push(addressToBytes32Str(orderInfo.tokenRecipient));
    bytes32Array.push(numberToBytes32Str(orderInfo.walletSplitPercentage));

    if (orderInfo.allOrNone) {
      bytes32Array.push(numberToBytes32Str(1));
    } else {
      bytes32Array.push(numberToBytes32Str(0));
    }

    return bytes32Array;
  }

  public checkP2P(orderInfo: OrderInfo) {
    orderInfo.P2P = (orderInfo.tokenSFeePercentage > 0 || orderInfo.tokenBFeePercentage > 0);
  }

  public async getSpendableS(order: OrderInfo) {
    const spendable = await this.getSpendable(order.tokenS,
                                              order.owner,
                                              order.broker,
                                              order.brokerInterceptor,
                                              order.tokenSpendableS,
                                              order.brokerSpendableS);
    return spendable;
  }

  public async getSpendableFee(order: OrderInfo) {
    const spendable = await this.getSpendable(order.feeToken,
                                              order.owner,
                                              order.broker,
                                              order.brokerInterceptor,
                                              order.tokenSpendableFee,
                                              order.brokerSpendableFee);
    return spendable;
  }

  public async reserveAmountS(order: OrderInfo,
                              amount: number) {
    assert((await this.getSpendableS(order)) >= amount, "spendableS >= reserve amount");
    order.tokenSpendableS.reserved += amount;
  }

  public async reserveAmountFee(order: OrderInfo,
                                amount: number) {
    assert((await this.getSpendableFee(order)) >= amount, "spendableFee >= reserve amount");
    order.tokenSpendableFee.reserved += amount;
  }

  public resetReservations(order: OrderInfo) {
    order.tokenSpendableS.reserved = 0;
    order.tokenSpendableFee.reserved = 0;
  }

  public async getERC20Spendable(spender: string,
                                 tokenAddress: string,
                                 owner: string) {
    const token = this.context.ERC20Contract.at(tokenAddress);
    const balance = await token.balanceOf(owner);
    const allowance = await token.allowance(owner, spender);
    const spendable = Math.min(balance, allowance);
    return spendable;
  }

  public async getBrokerAllowance(tokenAddr: string,
                                  owner: string,
                                  broker: string,
                                  brokerInterceptor: string) {
    try {
      return await this.context.BrokerInterceptorContract.at(brokerInterceptor).getAllowance(
          owner,
          broker,
          tokenAddr,
      );
    } catch {
      return 0;
    }
  }

  private async getSpendable(token: string,
                             owner: string,
                             broker: string,
                             brokerInterceptor: string,
                             tokenSpendable: Spendable,
                             brokerSpendable: Spendable) {
    if (!tokenSpendable.initialized) {
      tokenSpendable.amount = await this.getERC20Spendable(this.context.tradeDelegate.address,
                                                           token,
                                                           owner);
      tokenSpendable.initialized = true;
    }
    let spendable = tokenSpendable.amount;
    if (brokerInterceptor) {
      if (!brokerSpendable.initialized) {
        brokerSpendable.amount = await this.getBrokerAllowance(token,
                                                                  owner,
                                                                  broker,
                                                                  brokerInterceptor);
        brokerSpendable.initialized = true;
      }
      spendable = (brokerSpendable.amount < spendable) ? brokerSpendable.amount : spendable;
    }
    return spendable - tokenSpendable.reserved;
  }

  private toBN(n: number) {
    return new BN((new BigNumber(n)).toString(10), 10);
  }
}
