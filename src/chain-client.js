import { BrowserProvider, JsonRpcProvider, Contract, formatEther, parseEther, isAddress, ZeroAddress, getAddress } from './vendor/ethers.js';
import { abi } from './contract-abi.js';
import {LocalTestWallet,localWalletAllowed} from './local-wallet.js';

const isPageLocal = (hostname = globalThis.location?.hostname) => ['localhost','127.0.0.1','[::1]','::1'].includes(hostname || '');
const statuses=['pending','delivered','released','disputed','resolved','refunded'];
const bytes=s=>new TextEncoder().encode(s).length;
export const formatAmount = value => formatEther(value).replace(/\.0$/, '');
export function parseChainAmount(value) {
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error('Use a positive ETH amount with at most 6 decimal places.');
  const amount=parseEther(value);
  if(amount<=0n || amount>parseEther('1000'))throw new Error('Each milestone must be between 0.000001 and 1000 ETH.');
  return amount;
}
export function chainError(error) {
  if(error.code==='ACTION_REJECTED'||error.code===4001||error.info?.error?.code===4001)return 'The wallet request was cancelled. No transaction was completed.';
  const reasons={Unauthorized:'This wallet is not authorized for this action.',InvalidState:'The agreement has changed or this action is unavailable. Refresh and review its current state.',InvalidTerms:'Check the agreement terms and participant addresses.',DeadlinePassed:'The delivery or inspection window has ended.',TooEarly:'The required deadline has not passed yet.',IncorrectDeposit:'The deposit must match the exact agreement total.',NothingToWithdraw:'This wallet has no available payment to withdraw.',TransferFailed:'The recipient rejected the transfer. Its withdrawal credit remains available.',UnknownAgreement:'This agreement does not exist on the selected contract.'};
  return reasons[error.revert?.name] || (error.code==='INSUFFICIENT_FUNDS'?'The wallet needs enough ETH for the payment and network fee.':error.shortMessage || error.message || 'The transaction could not be completed.');
}

export class PactChainClient {
  constructor(config, { ethereum=globalThis.window?.ethereum, providerFactory, pageHostname=globalThis.location?.hostname }={}) {
    this.config=config;this.ethereum=ethereum;this.injectedEthereum=ethereum;this.providerFactory=providerFactory;this.pageHostname=pageHostname;
    this.account='';this.walletProvider=null;this.epoch=0;this.busy=false;
    this.setNetwork(config.defaultNetwork);
  }
  setNetwork(key) {
    if(this.busy)throw new Error('Wait for the current transaction to finish.');
    if(!this.config.networks[key])throw new Error('Unsupported network.');
    this.invalidateWallet();this.key=key;this.network=this.config.networks[key];this.localAccounts=[];
    this.provider?.destroy?.();
    this.provider=this.providerFactory?.(this.network) || new JsonRpcProvider(this.network.rpcUrl,this.network.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:0});
    this.provider.pollingInterval=1500;
    this.contract=isAddress(this.network.address) ? new Contract(this.network.address,abi,this.provider) : null;
    this.logs=[];this.scannedTo=this.network.deploymentBlock-1;this.blockTimes=new Map();
  }
  invalidateWallet(){this.epoch++;this.account='';this.signer=null;this.walletProvider?.destroy?.();this.walletProvider=null;this.walletKind='';this.ethereum=this.injectedEthereum;}
  get localEnabled(){return localWalletAllowed(this.network,this.pageHostname);}
  get walletLabel(){return this.walletKind==='local'?(this.localAccounts.find(a=>a.address.toLowerCase()===this.account.toLowerCase())?.name||'Local account'):'MetaMask';}
  async listLocalAccounts(){
    const epoch=this.epoch;
    const accounts=await new LocalTestWallet(this.provider,this.network,this.pageHostname).accounts();
    if(epoch!==this.epoch)throw new Error('The network changed. Open the wallet panel again.');
    this.localAccounts=accounts;return accounts;
  }
  async connectLocal(address){
    if(this.busy)throw new Error('Wait for the current transaction to finish.');
    const epoch=this.epoch;
    const adapter=new LocalTestWallet(this.provider,this.network,this.pageHostname);
    const accounts=await adapter.select(address);
    if(epoch!==this.epoch)throw new Error('The network changed. Connect again.');
    await this.attachAccounts(adapter,'local');
    this.localAccounts=accounts;return this.account;
  }
  roleFor(a) {
    if(!this.account)return 'viewer';
    const address=this.account.toLowerCase();
    return ['buyer','seller','arbiter'].find(role=>a[role]?.toLowerCase()===address)||'viewer';
  }
  async connect() {
    if(this.busy)throw new Error('Wait for the current transaction to finish.');
    this.invalidateWallet();
    if(!this.ethereum?.request)throw new Error('Open PactChain in a browser with MetaMask installed. The on-chain workspace remains available for viewing.');
    const chainId='0x'+this.network.chainId.toString(16);
    if(Number(await this.ethereum.request({method:'eth_chainId'}))!==this.network.chainId) {
      try { await this.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId}]}); }
      catch(error){
        if(error.code!==4902)throw error;
        await this.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:this.network.name,rpcUrls:[this.network.rpcUrl],nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},...(this.network.explorer?{blockExplorerUrls:[this.network.explorer]}:{})}]});
        await this.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
      }
    }
    await this.ethereum.request({method:'eth_requestAccounts'});
    await this.attachAccounts();
    return this.account;
  }
  async attachAccounts(ethereum=this.injectedEthereum,kind='metamask') {
    this.invalidateWallet();
    this.ethereum=ethereum;
    const epoch=this.epoch;
    if(!this.ethereum?.request)return '';
    if(Number(await ethereum.request({method:'eth_chainId'}))!==this.network.chainId||epoch!==this.epoch)return '';
    const accounts=await ethereum.request({method:'eth_accounts'});
    if(!accounts.length||epoch!==this.epoch)return '';
    const walletProvider=new BrowserProvider(ethereum,'any',{cacheTimeout:0});
    const signer=await walletProvider.getSigner(accounts[0]);
    if(epoch!==this.epoch){walletProvider.destroy();return '';}
    this.walletProvider=walletProvider;this.signer=signer;this.account=getAddress(accounts[0]);this.walletKind=kind;
    return this.account;
  }
  validateDraft(draft, timestamp=Date.now()) {
    if(!this.account)throw new Error('Connect your buyer wallet before creating an agreement.');
    draft={...draft,title:draft.title.trim(),milestones:draft.milestones.map(m=>({...m,title:m.title.trim()}))};
    const participants=[this.account,draft.seller,draft.arbiter];
    if(participants.some(a=>!isAddress(a)||a===ZeroAddress)||new Set(participants.map(a=>a.toLowerCase())).size!==3)throw new Error('Use three distinct, valid buyer, seller and arbitrator addresses.');
    if(!draft.title||bytes(draft.title)>80)throw new Error('Agreement title must contain 1–80 UTF-8 bytes.');
    if(!Number.isInteger(draft.inspectionHours)||draft.inspectionHours<1||draft.inspectionHours>168)throw new Error('Inspection period must be 1–168 hours.');
    if(draft.milestones.length<1||draft.milestones.length>5)throw new Error('Define 1–5 milestones.');
    let previous=Math.floor(timestamp/1000);
    for(const m of draft.milestones){
      const deadline=Math.floor(m.deadline/1000);
      if(!m.title||bytes(m.title)>80||typeof m.amount!=='bigint'||m.amount<=0n||!Number.isSafeInteger(deadline)||deadline<=previous)throw new Error('Milestones need a title, positive amount and increasing future deadlines.');
      previous=deadline;
    }
    return draft;
  }
  async snapshot() {
    const epoch=this.epoch;
    // On a public deployment, the localhost RPC is unreachable — give a clear error before attempting the connection.
    if(!isPageLocal(this.pageHostname)){try{const rpc=new URL(this.network.rpcUrl);if(['localhost','127.0.0.1','[::1]','::1'].includes(rpc.hostname))throw new Error(`The ${this.network.name} network connects to a local blockchain that is not reachable from this site. Switch to a public testnet with a deployed contract, or use Demo mode to explore.`);}catch(e){if(e.message.includes('not reachable'))throw e;}}
    if(!this.contract)throw new Error(`${this.network.name} has no deployed contract configured.${isPageLocal(this.pageHostname)?' Follow the deployment instructions in README.md.':' Switch to a network with a deployed contract or use Demo mode.'}`);
    const block=await this.provider.getBlock('latest');
    if(!block)throw new Error('The blockchain is unavailable.');
    const tag=block.number;
    if(await this.provider.getCode(this.network.address,tag)==='0x')throw new Error(`No contract exists at the configured address.${isPageLocal(this.pageHostname)?' Start the local blockchain and redeploy after any restart.':' The contract may not be deployed on this network.'}`);
    if(tag<this.scannedTo){this.logs=[];this.scannedTo=this.network.deploymentBlock-1;this.blockTimes.clear();}
    // Fetch every chunk successfully before committing the cursor. A failed RPC cannot truncate history.
    // Re-read the recent tail so a short chain reorganization replaces orphaned events.
    const scanFrom=Math.max(this.network.deploymentBlock,this.scannedTo-5);
    const newLogs=[];
    for(let from=scanFrom;from<=tag;from+=1000){newLogs.push(...await this.provider.getLogs({address:this.network.address,fromBlock:from,toBlock:Math.min(from+999,tag)}));}
    if(epoch!==this.epoch)throw new Error('Wallet or network changed. Refreshing the current view.');
    const allLogs=[...this.logs.filter(log=>log.blockNumber<scanFrom),...newLogs];
    const parsed=allLogs.map(log=>({log,event:this.contract.interface.parseLog(log)})).filter(e=>e.event);
    const creations=parsed.filter(e=>e.event.name==='AgreementCreated');
    const agreements=await Promise.all(creations.map(async ({event})=>{
      const numericId=event.args.agreementId;
      const [a,ms]=await Promise.all([this.contract.getAgreement(numericId,{blockTag:tag}),this.contract.getMilestones(numericId,{blockTag:tag})]);
      return {numericId,id:`PACT-${numericId.toString().padStart(3,'0')}`,buyer:a.buyer,seller:a.seller,arbiter:a.arbitrator,title:a.title,inspectionHours:Number(a.inspectionPeriod)/3600,createdAt:Number(a.createdAt)*1000,funded:a.funded,closed:a.closed,milestones:ms.map(m=>({title:m.title,amount:m.amount,deadline:Number(m.deadline)*1000,inspectionEnd:Number(m.inspectionEnd)*1000,status:statuses[Number(m.status)],proof:m.proof,reason:m.reason,sellerAmount:m.sellerAmount,buyerAmount:m.buyerAmount}))};
    }));
    const uniqueBlocks=[...new Set(allLogs.map(log=>log.blockNumber))].filter(n=>n>=scanFrom||!this.blockTimes.has(n));
    for(const n of uniqueBlocks){const b=await this.provider.getBlock(n);if(!b)throw new Error('An event block is unavailable; refresh to retry.');this.blockTimes.set(n,b.timestamp*1000);}
    const events=parsed.map(({log,event})=>{
      const args=event.args,id=args.agreementId?`PACT-${args.agreementId.toString().padStart(3,'0')}`:'',a=agreements.find(a=>a.id===id),actor=args.actor||args.buyer;
      const labels={AgreementCreated:'Agreement created',Funded:'Funds locked',DeliverySubmitted:'Delivery submitted',MilestoneReleased:args.timeoutClaim?'Inspection timeout claimed':'Milestone released',RemainingRefunded:'Remaining funds refunded',DisputeOpened:'Dispute opened',DisputeResolved:'Dispute resolved',Withdrawn:'Payment withdrawn'};
      return {id:`${log.transactionHash}:${log.index}`,agreementId:id,title:a?.title||'Wallet withdrawal',label:labels[event.name]||event.name,role:a?(['buyer','seller','arbiter'].find(r=>a[r].toLowerCase()===actor.toLowerCase())||'viewer'):'wallet',actor,amount:args.amount??(event.name==='DisputeResolved'?args.sellerAmount+args.buyerAmount:0n),sellerAmount:args.sellerAmount,buyerAmount:args.buyerAmount,at:this.blockTimes.get(log.blockNumber),transactionHash:log.transactionHash,blockNumber:log.blockNumber,logIndex:log.index};
    }).sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
    const [credit,held,credits,deposited,paid,walletBalance]=await Promise.all([this.account?this.contract.pendingWithdrawals(this.account,{blockTag:tag}):0n,this.contract.totalLocked({blockTag:tag}),this.contract.totalCredits({blockTag:tag}),this.contract.totalDeposited({blockTag:tag}),this.contract.totalWithdrawn({blockTag:tag}),this.account?this.provider.getBalance(this.account,tag):0n]);
    if(epoch!==this.epoch)throw new Error('Wallet or network changed. Refreshing the current view.');
    this.logs=allLogs;this.scannedTo=tag;
    const visible=this.account?agreements.filter(a=>this.roleFor(a)!=='viewer'):agreements;
    const ids=new Set(visible.map(a=>a.id));
    return {agreements:visible,events:this.account?events.filter(e=>ids.has(e.agreementId)||e.actor.toLowerCase()===this.account.toLowerCase()):events,credit,walletBalance,ledger:{held,credits,deposited,paid},offset:0,account:this.account,blockNumber:tag,chainTimestamp:block.timestamp*1000};
  }
  async transact(action,agreement,data={},onProgress=()=>{}) {
    if(this.busy)throw new Error('A wallet transaction is already in progress.');
    if(!this.contract)throw new Error('Deploy the contract before submitting transactions.');
    if(!this.signer||!this.account)throw new Error('Connect the wallet for the required participant.');
    this.busy=true;
    const account=this.account,epoch=this.epoch;
    try {
      const [chainId,accounts]=await Promise.all([this.ethereum.request({method:'eth_chainId'}),this.ethereum.request({method:'eth_accounts'})]);
      if(Number(chainId)!==this.network.chainId||accounts[0]?.toLowerCase()!==account.toLowerCase()||epoch!==this.epoch)throw new Error('The wallet account or network changed. Connect it again before signing.');
      const contract=this.contract.connect(this.signer);
      let method,args;
      if(action==='create'){
        const block=await this.provider.getBlock('latest');
        const d=this.validateDraft(data,Math.max(Date.now(),block.timestamp*1000));
        method='createAgreement';args=[d.seller,d.arbiter,d.title,d.inspectionHours*3600,d.milestones.map(m=>m.title),d.milestones.map(m=>m.amount),d.milestones.map(m=>Math.floor(m.deadline/1000))];
      }else if(action==='withdraw'){method='withdraw';args=[];}
      else {
        if(!agreement)throw new Error('Select an agreement.');
        const id=agreement.numericId;
        const expected=action==='resolve'?'arbiter':['deliver','claim'].includes(action)?'seller':'buyer';
        if(this.roleFor(agreement)!==expected)throw new Error(`Connect this agreement’s ${expected==='arbiter'?'arbitrator':expected} wallet.`);
        switch(action){
          case 'fund':method='fundAgreement';args=[id,{value:agreement.milestones.reduce((n,m)=>n+m.amount,0n)}];break;
          case 'deliver':case 'dispute': {
            const value=(action==='deliver'?data.proof:data.reason)?.trim();
            if(!value||bytes(value)>500)throw new Error('Enter a public reference or reason containing 1–500 UTF-8 bytes.');
            method=action==='deliver'?'submitDelivery':'openDispute';args=[id,value];break;
          }
          case 'approve':method='approveMilestone';args=[id];break;
          case 'claim':method='claimAfterInspection';args=[id];break;
          case 'refund':method='refundRemaining';args=[id];break;
          case 'resolve':if(!Number.isInteger(data.sellerPercent)||data.sellerPercent<0||data.sellerPercent>100)throw new Error('Seller allocation must be 0–100%.');method='resolveDispute';args=[id,data.sellerPercent*100];break;
          default:throw new Error('Unsupported transaction action.');
        }
      }
      // Simulate with the selected signer before asking MetaMask to send any value.
      await contract[method].staticCall(...args);
      if(epoch!==this.epoch)throw new Error('Wallet or network changed before signing.');
      onProgress({status:'signing'});
      const tx=await contract[method](...args);
      onProgress({status:'submitted',hash:tx.hash});
      let receipt;
      try {receipt=await tx.wait(1);} catch(error){
        if(error.code!=='TRANSACTION_REPLACED'||error.cancelled)throw error;
        receipt=error.receipt;
      }
      if(!receipt||receipt.status!==1)throw new Error('The transaction reverted. Refresh the agreement and try again.');
      onProgress({status:'confirmed',hash:receipt.hash});
      const created=receipt.logs.map(log=>{try{return contract.interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==='AgreementCreated');
      return {receipt,id:created?`PACT-${created.args.agreementId.toString().padStart(3,'0')}`:null};
    } finally {this.busy=false;}
  }
}
