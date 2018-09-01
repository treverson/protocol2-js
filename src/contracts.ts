import fs = require("fs");
import Web3 = require("web3");

export class Contracts {

  public ERC20Contract: any;
  public TokenRegistryContract: any;
  public SymbolRegistryContract: any;
  public TradeDelegateContract: any;
  public BrokerRegistryContract: any;
  public OrderRegistryContract: any;
  public MinerRegistryContract: any;
  public BrokerInterceptorContract: any;
  public FeeHolderContract: any;
  public ExchangeContract: any;
  public ExchangeImplContract: any;
  public DummyTokenContract: any;

  private web3: Web3;

  constructor(web3: Web3) {
    this.web3 = web3;
    
    const ABIPath = "./abi/";
    this.ERC20Contract = this.loadContract(ABIPath + "ERC20.abi");
    this.TokenRegistryContract = this.loadContract(ABIPath + "ITokenRegistry.abi");
    this.SymbolRegistryContract = this.loadContract(ABIPath + "ISymbolRegistry.abi");
    this.TradeDelegateContract = this.loadContract(ABIPath + "ITradeDelegate.abi");
    this.BrokerRegistryContract = this.loadContract(ABIPath + "IBrokerRegistry.abi");
    this.OrderRegistryContract = this.loadContract(ABIPath + "IOrderRegistry.abi");
    this.MinerRegistryContract = this.loadContract(ABIPath + "IMinerRegistry.abi");
    this.BrokerInterceptorContract = this.loadContract(ABIPath + "IBrokerInterceptor.abi");
    this.FeeHolderContract = this.loadContract(ABIPath + "IFeeHolder.abi");
    this.ExchangeContract = this.loadContract(ABIPath + "IExchange.abi");
    this.ExchangeImplContract = this.loadContract(ABIPath + "Exchange.abi");
    this.DummyTokenContract = this.loadContract(ABIPath + "DummyToken.abi");
  }

  private loadContract(path: string) {
    const abi = fs.readFileSync(path, "ascii");
    return this.web3.eth.contract(JSON.parse(abi));
  } 

}
