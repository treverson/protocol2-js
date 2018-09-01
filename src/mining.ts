import assert = require("assert");
import BN = require("bn.js");
import ABI = require("ethereumjs-abi");
import { Context } from "./context";
import { MultiHashUtil } from "./multihash";
import { OrderUtil } from "./order";
import { Ring } from "./ring";
import { OrderInfo, TransferItem } from "./types";

export class Mining {

  public feeRecipient: string;

  public miner?: string;
  public sig?: string;

  public hash?: Buffer;
  public interceptor?: string;

  private context: Context;

  private multiHashUtil = new MultiHashUtil();

  constructor(context: Context,
              feeRecipient: string,
              miner: string,
              sig: string) {
    this.context = context;
    this.feeRecipient = feeRecipient;
    this.miner = miner;
    this.sig = sig;
  }

  public async updateMinerAndInterceptor() {
    if (!this.miner) {
      this.miner = this.feeRecipient;
    } else {
      const [registered, interceptor] = await this.context.minerBrokerRegistry.getBroker(
        this.feeRecipient,
        this.miner,
      );
      // assert(registered, "miner unregistered");
      if (registered) {
        this.interceptor = interceptor;
      }
    }
  }

  public updateHash(rings: Ring[]) {
    let ringHashes = rings[0].hash;
    for (let i = 1; i < rings.length; i++) {
      ringHashes = this.xor(ringHashes, rings[i].hash);
    }
    const args = [
      this.feeRecipient,
      this.miner ? this.miner : "0x0",
      "0x" + ringHashes.toString("hex"),
    ];
    const argTypes = [
      "address",
      "address",
      "bytes32",
    ];
    this.hash = ABI.soliditySHA3(argTypes, args);
  }

  public checkMinerSignature(transactionOrigin: string) {
    if (!this.sig) {
      return (transactionOrigin === this.miner);
    } else {
      return this.multiHashUtil.verifySignature(this.miner, this.hash, this.sig);
    }
  }

  private xor(s1: Buffer, s2: Buffer) {
    assert(s1.length === s2.length, "can't xor buffers of unequal length");
    const x1 = new BN(s1.toString("hex"), 16);
    const x2 = new BN(s2.toString("hex"), 16);
    const result = x1.xor(x2);
    return new Buffer(result.toString(16, s1.length), "hex");
  }
}
