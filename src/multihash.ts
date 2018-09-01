import assert = require("assert");
import { BigNumber } from "bignumber.js";
import BN = require("bn.js");
import promisify = require("es6-promisify");
import ABI = require("ethereumjs-abi");
import ethUtil = require("ethereumjs-util");
import Web3 = require("web3");
import { Bitstream } from "./bitstream";
import { OrderInfo, RingsInfo, SignAlgorithm } from "./types";

export class MultiHashUtil {

  public async signOrderAsync(web3:Web3, order: OrderInfo) {
    const signer = order.broker ? order.broker : order.owner;
    return await this.signAsync(web3, order.signAlgorithm, order.hash, signer);
  }

  public async signAsync(web3: Web3, algorithm: SignAlgorithm, hash: Buffer, address: string) {
    // Default to standard Ethereum signing
    algorithm = Object.is(algorithm, undefined) ? SignAlgorithm.Ethereum : algorithm;

    const sig = new Bitstream();
    sig.addNumber(algorithm, 1);
    switch (+algorithm) {
      case SignAlgorithm.Ethereum:
        await this.signEthereumAsync(web3, sig, hash, address);
        return sig.getData();
      case SignAlgorithm.EIP712:
        await this.signEIP712Async(sig, hash, address);
        return sig.getData();
      case SignAlgorithm.None:
        return null;
      default:
        throw Error("Unsupported hashing algorithm: " + algorithm);
    }
  }

  public verifySignature(signer: string, hash: Buffer, multihash: string) {
    const bitstream = new Bitstream(multihash);
    assert(bitstream.length() >= 2, "invalid multihash format");
    const algorithm = bitstream.extractUint8(0);
    const size = bitstream.extractUint8(1);
    assert.equal(bitstream.length(), (2 + size), "bad multihash size");

    if (algorithm === SignAlgorithm.Ethereum) {
      assert.notEqual(signer, "0x0", "invalid signer address");
      assert.equal(size, 65, "bad Ethereum multihash size");

      const v = bitstream.extractUint8(2);
      const r = bitstream.extractBytes32(3);
      const s = bitstream.extractBytes32(3 + 32);

      try {
        const msgHash = ethUtil.hashPersonalMessage(hash);
        const pub = ethUtil.ecrecover(msgHash, v, r, s);
        const recoveredAddress = "0x" + ethUtil.pubToAddress(pub).toString("hex");
        return signer === recoveredAddress;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  private async signEthereumAsync(web3: Web3, sig: Bitstream, hash: Buffer, address: string) {
    const signature = web3.eth.sign(address, ethUtil.bufferToHex(hash));
    const { v, r, s } = ethUtil.fromRpcSig(signature);

    sig.addNumber(1 + 32 + 32, 1);
    sig.addNumber(v, 1);
    sig.addHex(ethUtil.bufferToHex(r));
    sig.addHex(ethUtil.bufferToHex(s));
  }

  // TODO: Actually implement this correctly, the standard is not widely supported yet
  private async signEIP712Async(sig: Bitstream, hash: Buffer, address: string) {
    throw Error("EIP712 signing currently not implemented.");

    /*const orderHash = this.getOrderHash(order);

    const msgParams = [
      {type: "string", name: "Owner", value: order.owner},
    ];

    const signature = await web3.eth.signTypedData(msgParams, order.owner);
    const { v, r, s } = ethUtil.fromRpcSig(signature);

    // await web3.currentProvider.sendAsync({
    //   method: "eth_signTypedData",
    //   params: [msgParams, order.owner],
    //   from: order.owner,
    // }, (err?: Error, result?: Web3.JSONRPCResponsePayload) => { console.log("Hashing: " + result.result); });

    sig.addNumber(1 + 32 + 32, 1);
    sig.addNumber(v, 1);
    sig.addHex(ethUtil.bufferToHex(r));
    sig.addHex(ethUtil.bufferToHex(s));*/
  }

}
