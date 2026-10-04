import {mark, icons} from './content.js';
import {ADDRESSES,HOUR,fmt as demoFmt,parseAmount as demoParseAmount,seed,total as demoTotal,locked as demoLocked,currentMilestone,isSettled,assertAccounting,createAgreement,transition} from './workspace-state.js';

import {PactChainClient,formatAmount,parseChainAmount,chainError} from './chain-client.js';
import {createWorkspaceMotion} from './workspace-motion.js';
import {createWalletPanel,walletBalanceLabel} from './wallet-panel.js';
import {renderWorkspaceIntro} from './workspace-intro.js';
const config=await fetch('/src/chain-config.json').then(r=>{if(!r.ok)throw new Error('Configuration unavailable');return r.json();});
const isLocalHost = (() => { const h = globalThis.location?.hostname || ''; return ['localhost','127.0.0.1','[::1]','::1'].includes(h); })();
const client=new PactChainClient(config);
const savedNetwork=localStorage.getItem('pactchain.network');
if(config.networks[savedNetwork])client.setNetwork(savedNetwork);
// On public deployments (e.g. Vercel), default to demo mode since localhost blockchain is unreachable.
const savedMode=localStorage.getItem('pactchain.mode');
let mode=savedMode==='demo'?'demo':savedMode==='chain'?'chain':isLocalHost?'chain':'demo',chainReady=false,chainMessage=isLocalHost?'Connecting to the blockchain…':'Select a network with a deployed contract, or use Demo mode to explore.',refreshPromise=null,lastTx=null;
const emptyChain=()=>({agreements:[],events:[],credit:0n,walletBalance:0n,ledger:{held:0n,credits:0n,deposited:0n,paid:0n},offset:0});
const zero=()=>mode==='chain'?0n:0;
const fmt=value=>typeof value==='bigint'?formatAmount(value):demoFmt(value);
const parseAmount=value=>mode==='chain'?parseChainAmount(value):demoParseAmount(value);
const total=a=>mode==='chain'?a.milestones.reduce((n,m)=>n+m.amount,0n):demoTotal(a);
const locked=a=>mode==='chain'?(a.funded?a.milestones.filter(m=>!isSettled(m)).reduce((n,m)=>n+m.amount,0n):0n):demoLocked(a);
const funds=()=>mode==='chain'?'test ETH':'demo ETH';
const buyerAddress=()=>wallet || (mode==='chain'?client.account:ADDRESSES.buyer);
const participant=a=>mode==='chain'?(chainReady?client.roleFor(a):'viewer'):role;

const extra={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',file:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6"/>',wallet:'<path d="M4 6h15v14H4V6Zm0 0V4h12M15 11h6v5h-6z"/>',activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m14 5-7 7 7 7M7 12h14"/>'};
const icon=name=>icons[name]||`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[name]||extra.file}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='pactchain.workspace.demo.v1';
function load(){try{const value=JSON.parse(localStorage.getItem(key)||localStorage.getItem('pactpay.workspace.v1'));if(value?.version===1&&Array.isArray(value.agreements)&&Array.isArray(value.events)&&Number.isFinite(value.offset)){assertAccounting(value);return value;}}catch{}return seed();}

const DEMO_TEST_ACCOUNTS = [
  { address: ADDRESSES.buyer, role: 'buyer', name: 'Buyer account', balance: 1000n * 10n**18n },
  { address: ADDRESSES.seller, role: 'seller', name: 'Seller account', balance: 1000n * 10n**18n },
  { address: ADDRESSES.arbiter, role: 'arbiter', name: 'Arbitrator account', balance: 1000n * 10n**18n },
];

let state=mode==='demo'?load():emptyChain(), role=mode==='demo'?'buyer':'viewer', view=['agreements','withdrawals','activity'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
let selected=state.agreements[0]?.id, filter='all', query='',wallet=mode==='demo'?ADDRESSES.buyer:'',toastTimer;
if(mode==='demo'){
  client.account=wallet;
  client.walletKind='local';
  client.localAccounts=DEMO_TEST_ACCOUNTS;
}
const root=document.querySelector('#workspace'),createDialog=document.querySelector('#create-dialog'),actionDialog=document.querySelector('#action-dialog');
const workspaceMotion=createWorkspaceMotion(root);
const walletPanel=createWalletPanel({client,
  async onConnected(){
    mode='chain';localStorage.setItem('pactchain.mode',mode);lastTx=null;wallet=client.account;
    await refreshChain();
    if(!chainReady)throw new Error(chainMessage);
    toast(`${client.walletLabel} connected. Permissions follow each agreement.`);
  },
  async onSelectTestAccount(address){
    mode='demo';localStorage.setItem('pactchain.mode',mode);lastTx=null;
    wallet=address;client.account=address;client.walletKind='local';
    client.localAccounts=DEMO_TEST_ACCOUNTS;
    const acc=DEMO_TEST_ACCOUNTS.find(a=>a.address.toLowerCase()===address.toLowerCase());
    role=acc?.role||'buyer';
    if(!state.agreements?.length) state=load();
    render();
    toast(`${client.walletLabel} connected. You are now acting as ${roleName(role)}.`);
  },
  onDisconnect(){
    client.invalidateWallet();wallet='';lastTx=null;
    if(mode==='chain'){state=emptyChain();chainReady=false;render();refreshChain();}
    else{role='viewer';render();}
    toast('Wallet disconnected. You are in public view.');
  },
  onCreate(){if(openCreate()!==false)renumber();},
  onAgreement(id){if(state.agreements.some(a=>a.id===id))openDeal(id);},
});
const now=()=>Date.now()+state.offset;
const date=value=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const roleName=value=>({arbiter:'Arbitrator',viewer:'Viewer',wallet:'Wallet'}[value]||value[0].toUpperCase()+value.slice(1));
const short=address=>`${address.slice(0,6)}…${address.slice(-4)}`;
const localConnected=()=>(mode==='chain'&&client.walletKind==='local')||(mode==='demo'&&Boolean(wallet));
function walletChip(){
  if(wallet){
    const bal=mode==='chain'?walletBalanceLabel(state.walletBalance):'1,000';
    return `<span class="wallet-chip-copy"><b>${esc(client.walletLabel)} · ${esc(short(wallet))}</b><small>${bal} ${funds()}</small></span>`;
  }
  return 'Connect wallet';
}
function walletConfirmation(action,agreement){
  if(mode!=='chain')return '';
  const m=agreement&&currentMilestone(agreement);
  const amount=action==='fund'?total(agreement):action==='withdraw'?pending():action==='refund'?locked(agreement):['approve','claim','resolve'].includes(action)?m?.amount||0n:0n;
  const meaning={create:'Terms only · funding comes next',fund:'Deposit into escrow',withdraw:'Transfer to your wallet',approve:'Credit to seller · withdraw separately',claim:'Credit to seller · withdraw separately',refund:'Credit to buyer · withdraw separately',resolve:'Split milestone into withdrawal credits',deliver:'Record delivery · no payment transfer',dispute:'Open dispute · funds stay locked'}[action];
  return `<div class="wallet-confirmation"><span class="eyebrow">${localConnected()?'LOCAL TEST WALLET · TEST ETH':'METAMASK · TEST ETH'}</span><dl><dt>Signing account</dt><dd>${esc(client.walletLabel)} <code>${esc(short(wallet))}</code></dd><dt>Action amount</dt><dd>${fmt(amount)} test ETH</dd></dl><p>${meaning}. Network fee applies.</p></div>`;
}
function getLocalAccountDisplay(account, index, currentBuyer) {
  const isBuyer = account.address.toLowerCase() === currentBuyer.toLowerCase();
  const num = index + 1;
  const roleHint = account.role === 'seller' ? 'Seller test account' : account.role === 'arbiter' ? 'Arbitrator test account' : 'Test account';
  return {
    label: `Local Account #${num} (${roleHint}) · ${short(account.address)}`,
    address: account.address,
    isBuyer,
    name: account.name,
    role: account.role
  };
}

function participantFields(){
  const buyer = buyerAddress() || '';
  if(mode==='demo'){
    return `<div class="participant-group">
      <div class="field">
        <label for="wizard-seller"><span>Seller account</span> <span class="field-required">*</span></label>
        <div class="select-wrap">
          <select id="wizard-seller" name="seller" required>
            <option value="${ADDRESSES.seller}" selected>Seller demo account · ${short(ADDRESSES.seller)}</option>
            <option value="${ADDRESSES.arbiter}">Arbitrator demo account · ${short(ADDRESSES.arbiter)}</option>
          </select>
        </div>
        <small class="field-hint">The counterparty delivering the work and collecting releases.</small>
        <p class="field-error" id="seller-error" hidden></p>
      </div>
      <div class="field">
        <label for="wizard-arbiter"><span>Arbitrator account</span> <span class="field-required">*</span></label>
        <div class="select-wrap">
          <select id="wizard-arbiter" name="arbiter" required>
            <option value="${ADDRESSES.arbiter}" selected>Arbitrator demo account · ${short(ADDRESSES.arbiter)}</option>
            <option value="${ADDRESSES.seller}">Seller demo account · ${short(ADDRESSES.seller)}</option>
          </select>
        </div>
        <small class="field-hint">A chosen human arbitrator who decides dispute allocations.</small>
        <p class="field-error" id="arbiter-error" hidden></p>
      </div>
    </div>`;
  }

  if(localConnected() && client.localAccounts?.length){
    const available = client.localAccounts
      .map((acc, idx) => getLocalAccountDisplay(acc, idx, buyer))
      .filter(item => !item.isBuyer);

    const defaultSeller = available.find(a => a.role === 'seller') || available[0];
    const defaultArbiter = available.find(a => a.role === 'arbiter' && a.address.toLowerCase() !== defaultSeller?.address.toLowerCase()) ||
      available.find(a => a.address.toLowerCase() !== defaultSeller?.address.toLowerCase()) || available[0];

    return `<div class="participant-group">
      <div class="field">
        <label for="wizard-seller"><span>Seller account</span> <span class="field-required">*</span></label>
        <div class="select-wrap">
          <select id="wizard-seller" name="seller" required>
            ${available.map(a => `<option value="${a.address}" ${a.address === defaultSeller?.address ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
            <option value="custom">Enter custom 0x address…</option>
          </select>
        </div>
        <input type="text" name="seller-custom" id="wizard-seller-custom" class="custom-address-input" placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" maxlength="42" spellcheck="false" hidden aria-label="Custom seller Ethereum address">
        <small class="field-hint">The seller delivers work against each milestone and receives payments.</small>
        <p class="field-error" id="seller-error" hidden></p>
      </div>
      <div class="field">
        <label for="wizard-arbiter"><span>Arbitrator account</span> <span class="field-required">*</span></label>
        <div class="select-wrap">
          <select id="wizard-arbiter" name="arbiter" required>
            ${available.map(a => `<option value="${a.address}" ${a.address === defaultArbiter?.address ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
            <option value="custom">Enter custom 0x address…</option>
          </select>
        </div>
        <input type="text" name="arbiter-custom" id="wizard-arbiter-custom" class="custom-address-input" placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" maxlength="42" spellcheck="false" hidden aria-label="Custom arbitrator Ethereum address">
        <small class="field-hint">A chosen human arbitrator who resolves disputes if disagreements arise.</small>
        <p class="field-error" id="arbiter-error" hidden></p>
      </div>
    </div>`;
  }

  return `<div class="participant-group">
    <div class="field">
      <label for="wizard-seller"><span>Seller wallet address</span> <span class="field-required">*</span></label>
      <input id="wizard-seller" name="seller" required pattern="0x[0-9a-fA-F]{40}" spellcheck="false" maxlength="42" placeholder="0x..." autocomplete="off">
      <small class="field-hint">The counterparty who will deliver the work and claim releases.</small>
      <p class="field-error" id="seller-error" hidden></p>
    </div>
    <div class="field">
      <label for="wizard-arbiter"><span>Arbitrator wallet address</span> <span class="field-required">*</span></label>
      <input id="wizard-arbiter" name="arbiter" required pattern="0x[0-9a-fA-F]{40}" spellcheck="false" maxlength="42" placeholder="0x..." autocomplete="off">
      <small class="field-hint">A trusted human arbitrator to resolve disputes if disagreement occurs.</small>
      <p class="field-error" id="arbiter-error" hidden></p>
    </div>
  </div>`;
}
function save(){if(mode==='chain')return true;try{localStorage.setItem(key,JSON.stringify(state));return true;}catch{toast('Storage is unavailable. Changes last only until this tab closes.');return false;}}
function toast(message){const target=document.querySelector('#toast');target.textContent=message;target.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>target.hidden=true,5000);}
function status(a){const m=currentMilestone(a);if(!m)return a.milestones.some(m=>m.status==='refunded')?['Refunded','complete']:['Completed','complete'];if(!a.funded)return ['Awaiting funding','draft'];if(m.status==='disputed')return ['Disputed','dispute'];if(m.status==='delivered')return ['In review','review'];if(now()>=m.deadline)return ['Deadline passed','dispute'];return ['In progress',''];}
const badge=a=>{const [label,style]=status(a);return `<span class="status ${style}">${label}</span>`;};
const pending=()=>mode==='chain'?state.credit:(role==='arbiter'?0:state.balances[role]);
const txLink=(hash,network=client.network)=>network.explorer?`<a class="tx-link" href="${esc(network.explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer" title="${esc(hash)}">${esc(hash.slice(0,10))}…${esc(hash.slice(-6))} ↗</a>`:`<button class="tx-link" data-copy-hash="${esc(hash)}" title="${esc(hash)}">${esc(hash.slice(0,10))}…${esc(hash.slice(-6))} · Copy hash</button>`;
function remaining(value){const seconds=Math.max(0,Math.ceil((value-now())/1000));return seconds>=86400?`${Math.floor(seconds/86400)}d ${Math.floor(seconds%86400/3600)}h remaining`:seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m remaining`:seconds>0?`${Math.floor(seconds/60)}m ${seconds%60}s remaining`:'Window ended';}
function activity(events){return events.length?events.map(e=>`<div class="activity-row"><div class="activity-icon">${icon(e.label.includes('deliver')?'file':e.label.includes('withdraw')?'wallet':e.label.includes('Dispute')?'dispute':'check')}</div><div><b>${esc(e.label)}</b><small>${esc(e.title)} · ${roleName(e.role)}${e.amount?` · ${fmt(e.amount)} ${funds()}`:''}</small></div><span>${date(e.at)}${e.transactionHash?txLink(e.transactionHash):''}</span></div>`).join(''):'<p class="empty">Your agreement activity will appear here.</p>';}

function nextAction(a){const role=participant(a);const m=currentMilestone(a);if(!m)return {title:'Agreement settled',copy:'Released and refunded amounts are available in Withdrawals. No unpaid funds remain in this agreement.',actions:[]};if(!a.funded)return {title:'Ready to fund',copy:now()>=m.deadline?'This draft has expired. Create an agreement with future deadlines.':`The buyer locks ${fmt(total(a))} ${funds()} before delivery starts.`,actions:role==='buyer'&&now()<m.deadline?['fund']:[],other:'buyer'};if(m.status==='disputed')return {title:'Dispute under review',copy:'This milestone is held until the chosen human arbitrator decides the buyer and seller allocation.',actions:role==='arbiter'?['resolve']:[],other:'arbiter'};if(m.status==='delivered'){const expired=now()>=m.inspectionEnd;return {title:expired?'Inspection window ended':'Delivery ready for review',copy:expired?'The seller can claim this milestone after the inspection window. Funds move only when the claim is made.':`The buyer can approve or dispute this milestone. ${remaining(m.inspectionEnd)}.`,actions:expired?(role==='seller'?['claim']:[]):(role==='buyer'?['approve','dispute']:[]),other:expired?'seller':'buyer'};}const expired=now()>=m.deadline;return {title:expired?'Delivery deadline missed':'Waiting for delivery',copy:expired?'The buyer can refund all remaining unpaid milestones. Previously paid milestones stay paid.':`The seller submits a delivery reference by ${date(m.deadline)}. Later milestones unlock in sequence.`,actions:expired?(role==='buyer'?['refund']:[]):(role==='seller'?['deliver']:[]),other:expired?'buyer':'seller'};}
const labels={fund:'Lock funds',deliver:'Submit delivery',approve:'Approve milestone',claim:'Claim after timeout',refund:'Claim refund',dispute:'Open dispute',resolve:'Resolve dispute',withdraw:'Withdraw funds'};





const dealDialog = document.querySelector('#agreement-dialog');
const stageNames = ['The agreement', 'Milestones & terms', 'Review & create'];

function agreementList() {
  const agreements = state.agreements.filter(a => (filter==='all'||(filter==='active'?Boolean(currentMilestone(a)):!currentMilestone(a))) && `${a.title} ${a.id}`.toLowerCase().includes(query.toLowerCase()));
  return `<section class="agreement-board" aria-labelledby="board-heading">
    <div class="board-heading"><div><span class="eyebrow">YOUR DEALS, AT A GLANCE</span><h2 id="board-heading">My agreements<span class="board-count">${state.agreements.length.toString().padStart(2,'0')}</span></h2></div><div class="board-tools"><div class="filter-tabs" aria-label="Filter agreements">${['all','active','settled'].map(f=>`<button data-filter="${f}" aria-pressed="${f===filter}" class="${f===filter?'active':''}">${f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div><label class="search">${icon('grid')}<input type="search" id="agreement-search" aria-label="Search agreements" placeholder="Find an agreement" value="${esc(query)}"></label></div></div>
    <div class="agreement-grid">${agreements.map((a,i)=>{
      const m=currentMilestone(a),step=nextAction(a),done=a.milestones.filter(isSettled).length;
      const due=m?(m.status==='delivered'?remaining(m.inspectionEnd):`Due ${date(m.deadline)}`):'All milestones settled';
      return `<article class="pact-card ${a.id===selected?'is-selected':''}" aria-label="${esc(a.title)} agreement">
        <div class="pact-card-top"><span class="pact-id">${esc(a.id)}</span>${badge(a)}</div>
        <div class="pact-card-content"><span class="card-category">${a.milestones.length>1?'MILESTONE AGREEMENT':'SINGLE DELIVERY'}</span><h3>${esc(a.title)}</h3><p class="card-next-copy">${esc(m?m.title:'Every milestone accounted for.')}</p><div class="card-value"><strong>${fmt(total(a))}<small>ETH</small></strong><span>Total agreement<br><b>${mode==='chain'?client.network.name:'Demo funds'}</b></span></div><div class="card-path" aria-label="${done} of ${a.milestones.length} milestones settled">${a.milestones.map(milestone=>`<span class="${isSettled(milestone)?'settled':milestone===m?'current':''}"></span>`).join('')}</div><div class="card-progress-label"><span>${done} / ${a.milestones.length} settled</span><span>${esc(due)}</span></div></div>
        <div class="pact-counterparty"><span class="address-mark" aria-hidden="true">${mark}</span><span>SELLER <b>${esc(short(a.seller))}</b></span><span class="card-inspection">${a.inspectionHours}h review</span></div>
        <button class="card-open" data-select="${esc(a.id)}" aria-label="Open ${esc(a.title)} agreement"><span>${esc(step.title)}</span><span aria-hidden="true">↗</span></button>
      </article>`;
    }).join('')}${filter==='all'&&!query?`<button class="new-pact-card" data-create><span class="new-card-mark">${icon('plus')}</span><span>One promise.<br>A clear plan.</span><small>Create an agreement <b aria-hidden="true">↗</b></small></button>`:''}</div>
    ${!agreements.length?'<p class="empty">No agreements match this view. Change the filter or create a new agreement.</p>':''}
    <div class="board-footer"><span>${agreements.length} of ${state.agreements.length} agreements</span><span>${icon('lock')} ${mode==='chain'?'On-chain records':'Local demo records'}</span></div>
  </section>`;
}

function details() {
  const a=state.agreements.find(a=>a.id===selected);
  if(!a)return '<p class="empty">Select an agreement.</p>';
  const m=currentMilestone(a),step=nextAction(a),done=a.milestones.filter(isSettled).length;
  const role=participant(a);
  return `<div class="deal-topline"><span class="eyebrow">THE AGREEMENT ROOM / ${esc(a.id)}</span><button class="close-button" data-close aria-label="Close agreement">×</button></div>
    <div class="deal-intro"><div class="deal-head-status">${badge(a)}<span>${a.inspectionHours}H INSPECTION</span></div><h2 id="deal-heading">${esc(a.title)}</h2><div class="deal-value"><strong>${fmt(total(a))}<small>ETH</small></strong><span>${fmt(locked(a))} ${funds()}<br>still in escrow</span></div></div>
    <div class="deal-role">${mode==='chain'?`<span>YOUR WALLET’S ROLE</span><strong>${roleName(role)}</strong>${localConnected()?'<button class="text-button" data-wallet>Switch account ↗</button>':''}`:`<span>Demo participant</span><div class="roles" aria-label="Agreement demo role">${['buyer','seller','arbiter'].map(r=>`<button data-role="${r}" aria-pressed="${role===r}" class="${role===r?'active':''}">${roleName(r)}</button>`).join('')}</div>`}</div>
    <div class="deal-body"><div class="progress-label"><span>THE MILESTONE PLAN</span><span>${done} / ${a.milestones.length} settled</span></div><div class="progress-track" role="progressbar" aria-label="Settled milestones" aria-valuemin="0" aria-valuemax="${a.milestones.length}" aria-valuenow="${done}"><span style="width:${done/a.milestones.length*100}%"></span></div>
    <div class="milestone-list">${a.milestones.map((milestone,i)=>`<div class="milestone ${m===milestone?'is-current':''}"><span class="milestone-number ${isSettled(milestone)?'done':m===milestone?'current':''}">${isSettled(milestone)?'✓':String(i+1).padStart(2,'0')}</span><div class="milestone-text"><b>${esc(milestone.title)}</b><small>${{released:'Payment released',refunded:'Refund credited',resolved:'Dispute settled',disputed:'Dispute opened',delivered:'Awaiting review',pending:a.funded?(m===milestone?'Awaiting delivery':'Upcoming milestone'):'Awaiting funding'}[milestone.status]}${milestone.status==='pending'?` · Due ${date(milestone.deadline)}`:''}</small></div><span>${fmt(milestone.amount)} ETH</span></div>`).join('')}</div>
    ${m?.proof?`<div class="detail-proof"><span class="eyebrow">DELIVERY REFERENCE</span><p>${esc(m.proof)}</p></div>`:''}${m?.reason?`<div class="detail-proof dispute-proof"><span class="eyebrow">BUYER’S CONCERN</span><p>${esc(m.reason)}</p></div>`:''}
    <div class="next-action"><div class="next-action-heading">${icon(m?.status==='disputed'?'dispute':'clock')}<strong>${step.title}</strong></div><p>${esc(step.copy)}</p>${step.other&&step.actions.length===0?`<p>${mode==='chain'?`Connect this agreement’s ${roleName(step.other).toLowerCase()} wallet to continue.`:`Switch to the ${roleName(step.other).toLowerCase()} demo role to continue.`}</p>`:''}<div class="detail-actions">${step.actions.map((action,i)=>`<button class="${i===0?'primary':'ghost danger'}" data-action="${action}" data-id="${a.id}">${labels[action]}<span aria-hidden="true">↗</span></button>`).join('')}${!m?'<button class="primary" data-view="withdrawals">Open withdrawals ↗</button>':''}</div></div>
    <details class="terms"><summary>Agreement terms & participants <span aria-hidden="true">+</span></summary><dl><dt>Buyer</dt><dd>${esc(a.buyer)}</dd><dt>Seller</dt><dd>${esc(a.seller)}</dd><dt>Arbitrator</dt><dd>${esc(a.arbiter)}</dd><dt>Inspection window</dt><dd>${a.inspectionHours} hours</dd><dt>Total agreement</dt><dd>${fmt(total(a))} ${funds()}</dd><dt>Still locked</dt><dd>${fmt(locked(a))} ${funds()}</dd></dl></details>
    <section class="deal-history"><h3>Agreement activity</h3>${activity(state.events.filter(e=>e.agreementId===a.id).slice(0,5))}</section></div><div class="deal-footnote">${mode==='chain'?`${esc(client.network.name)} · Smart contract enforces every transition`:'Local demo · No contract connected · No real ETH moves'}</div>`;
}

function withdrawalView() {
  const {credits,paid,held,deposited}=mode==='chain'?state.ledger:{credits:state.balances.buyer+state.balances.seller,paid:state.withdrawn.buyer+state.withdrawn.seller,held:state.agreements.reduce((n,a)=>n+locked(a),0),deposited:state.agreements.filter(a=>a.funded).reduce((n,a)=>n+total(a),0)};
  return `<section class="withdrawal-layout"><article class="withdrawal-receipt"><span class="eyebrow">READY WHEN YOU ARE / ${roleName(role).toUpperCase()}</span><h2>Work settled.<br>Payment ready.</h2><div class="balance">${fmt(pending())}<small>ETH</small></div><p>Released payments are credited first. Withdraw separately to complete the flow.</p><button class="primary" data-action="withdraw" ${pending()?'':'disabled'}>Withdraw ${mode==='chain'?'test ETH':'demo funds'} ${icon('arrow')}</button><div class="receipt-foot">${mode==='chain'?'ON-CHAIN CREDIT / SIGN TO WITHDRAW':'LOCAL DEMO / NO REAL ETH TRANSFER'}</div></article><div><div class="section-topline"><h2>Withdrawal history</h2><span class="eyebrow">${roleName(role)}</span></div><div class="activity-list">${activity(state.events.filter(e=>mode==='chain'?e.label==='Payment withdrawn'&&e.actor.toLowerCase()===wallet.toLowerCase():e.label==='Demo payment withdrawn'&&e.role===role))}</div><div class="ledger"><span class="eyebrow">${mode==='chain'?'CONTRACT TOTALS / ALL PARTICIPANTS':'EVERY AMOUNT ACCOUNTED FOR'}</span><p>${fmt(deposited)} deposited = ${fmt(held)} locked + ${fmt(credits)} available + ${fmt(paid)} withdrawn.</p></div><button data-view="agreements" class="text-button">Back to agreements ↗</button></div></section>`;
}

function render() {
  const previousNav=workspaceMotion.capture();
  const nav=[['agreements','My agreements'],['withdrawals','Withdrawals'],['activity','Activity']];
  const intro=renderWorkspaceIntro({section:view==='overview'?'agreements':view,agreements:state.agreements,events:state.events,focusId:selected,fmt,locked,currentMilestone,isSettled,zero:zero(),available:pending(),connected:mode==='demo'||Boolean(wallet),mode,role,wallet:mode==='demo'?ADDRESSES[role]:wallet,walletName:mode==='demo'?`${roleName(role)} demo account`:client.walletLabel,blockNumber:state.blockNumber,ready:chainReady});
  root.innerHTML=`<header class="workspace-header"><a href="/" class="brand" aria-label="PactChain home">${mark}<span>PactChain</span><small>WORKSPACE</small></a><nav class="workspace-nav" aria-label="Workspace navigation">${nav.map(([v,name])=>`<button data-view="${v}" class="${view===v||(v==='agreements'&&view==='overview')?'active':''}" ${view===v||(v==='agreements'&&view==='overview')?'aria-current="page"':''}>${name}${v==='agreements'?`<span>${state.agreements.length}</span>`:''}</button>`).join('')}<span class="nav-slider" aria-hidden="true"></span></nav><div class="header-actions"><span class="demo-tag"><i></i>${mode==='chain'?esc(client.network.name):'Demo'}</span><button class="wallet-button" data-wallet aria-label="${wallet?`Manage ${esc(client.walletLabel)}`:'Connect wallet'}" ${client.busy?'disabled':''}>${icon('wallet')}${walletChip()}</button><button class="primary header-create" data-create ${client.busy?'disabled':''}>${icon('plus')}New agreement</button></div></header>
    <main id="workspace-main" class="workspace-main">${intro.hero}
    <div class="demo-notice ${mode==='chain'&&!chainReady?'chain-offline':''}"><span>${icon('shield')}${mode==='chain'?`<b>${chainReady?'Connected to the smart contract.':'Blockchain connection unavailable.'}</b> ${esc(chainReady?(wallet?localConnected()?'Local test wallet · Test ETH. Actual local contract transactions.':'Your wallet’s agreements and balances.':'Public view. Connect a participant wallet to transact.'):chainMessage)}`:'<b>A working demo, with demo funds.</b> Saved in this browser. No contract connected.'}</span><button data-guide class="text-button">How it works ↗</button></div>${lastTx?`<div class="transaction-notice" role="status"><b>${esc(lastTx.status)}</b>${lastTx.hash?txLink(lastTx.hash,lastTx.network):`<span>${localConnected()?'Submitting through your selected local test account.':'Review the request in MetaMask.'}</span>`}</div>`:''}
    <div class="workspace-rolebar"><div class="mode-controls"><button data-mode="chain" aria-pressed="${mode==='chain'}" ${client.busy?'disabled':''}>Blockchain</button><button data-mode="demo" aria-pressed="${mode==='demo'}" ${client.busy?'disabled':''}>Demo</button>${mode==='chain'?`<label class="network-picker">Network<select id="network-select" aria-label="Blockchain network" ${client.busy?'disabled':''}>${Object.entries(config.networks).map(([key,n])=>`<option value="${esc(key)}" ${key===client.key?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label><button data-refresh class="text-button">Refresh ↻</button>`:'<span class="eyebrow">VIEW AS A DEMO PARTICIPANT</span>'}</div>${mode==='demo'?`<div class="roles" aria-label="Demo participant role">${['buyer','seller','arbiter'].map(r=>`<button data-role="${r}" aria-pressed="${role===r}" class="${role===r?'active':''}">${roleName(r)}</button>`).join('')}</div>`:`<div class="workspace-connection"><span class="eyebrow">${chainReady?`BLOCK ${state.blockNumber} · ${wallet?'WALLET PERMISSIONS':'PUBLIC VIEW'}`:'WAITING FOR CONNECTION'}</span>${localConnected()?`<button class="text-button" data-wallet ${client.busy?'disabled':''}>Switch account ↗</button>`:''}</div>`}</div>${intro.stats}
    <div class="workspace-view-panel" data-section="${view==='overview'?'agreements':view}">${view==='withdrawals'?withdrawalView():view==='activity'?`<section class="activity-page"><div class="section-topline"><div><span class="eyebrow">THE WHOLE STORY</span><h2>Agreement activity</h2></div><span class="eyebrow">${state.events.length} ${mode==='chain'?'ON-CHAIN EVENTS':'LOCAL EVENTS'}</span></div><div class="activity-list">${activity(state.events)}</div></section>`:`${agreementList()}${view==='overview'?`<section class="recent-activity"><div class="section-topline"><h2>Recent activity</h2><button class="text-button" data-view="activity">View all activity ↗</button></div><div class="activity-list">${activity(state.events.slice(0,3))}</div></section>`:''}`}</div>
    ${mode==='demo'?`<details class="test-tools"><summary>Demo testing controls <span aria-hidden="true">+</span></summary><div><p>Advance the local demo clock to test delivery deadlines and inspection timeouts. This does not change blockchain time.</p><button data-time="24">Advance 24 hours</button><button data-time="72">Advance 3 days</button><button data-reset class="danger ghost">Reset demo</button><span>${state.offset?`Advanced ${Math.round(state.offset/HOUR)} hours`:'Clock follows local time'}</span></div></details>`:''}
    <footer class="workspace-footer"><a href="/" class="brand">${mark}<span>PactChain</span></a><span>EVERY PROMISE HAS A PLAN.</span><a href="/" class="text-button">Back to website ↗</a></footer></main>`;
  workspaceMotion.update(view,previousNav);
  if(dealDialog.open){const scroll=dealDialog.scrollTop;dealDialog.innerHTML=details();dealDialog.scrollTop=scroll;}
}

function openDeal(id) { selected=id;render();dealDialog.innerHTML=details();if(!dealDialog.open)dealDialog.showModal(); }

function milestoneFields(i, initial = {}) {
  const title = initial.title ?? '';
  const amount = initial.amount ?? (i === 0 ? '0.01' : i === 1 ? '0.02' : '0.01');
  const days = initial.days ?? String((i + 1) * 7);
  return `<div class="milestone-form" data-milestone-index="${i}">
    <div class="milestone-form-head">
      <span class="milestone-badge">MILESTONE ${String(i+1).padStart(2,'0')}</span>
      <button type="button" class="remove-milestone-btn" data-remove-milestone aria-label="Remove milestone ${i+1}">Remove ×</button>
    </div>
    <div class="field">
      <label><span>Deliverable title</span> <span class="field-required">*</span></label>
      <input name="milestone-title" maxlength="80" required placeholder="e.g. Design handover or API integration" value="${esc(title)}" autocomplete="off" spellcheck="false">
      <p class="field-error milestone-title-error" hidden></p>
    </div>
    <div class="field-row">
      <div class="field">
        <label><span>Amount (${funds()})</span> <span class="field-required">*</span></label>
        <input name="milestone-amount" inputmode="decimal" required value="${esc(amount)}" pattern="(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,6})?" placeholder="0.01">
        <small class="field-hint">Min 0.000001 ETH (max 6 decimals)</small>
        <p class="field-error milestone-amount-error" hidden></p>
      </div>
      <div class="field">
        <label><span>Due in (days)</span> <span class="field-required">*</span></label>
        <input name="milestone-days" type="number" min="1" max="365" step="1" value="${esc(days)}" required>
        <small class="field-hint">Increasing order (e.g. 7, 14, 21)</small>
        <p class="field-error milestone-days-error" hidden></p>
      </div>
    </div>
  </div>`;
}

function getEffectiveParticipantAddress(name, form) {
  const select = form.querySelector(`select[name="${name}"]`);
  if (select) {
    if (select.value === 'custom') {
      const customInput = form.querySelector(`input[name="${name}-custom"]`);
      return customInput ? customInput.value.trim() : '';
    }
    return select.value.trim();
  }
  const input = form.querySelector(`input[name="${name}"]`);
  return input ? input.value.trim() : '';
}

function setFieldError(input, errorMsg, errorEl) {
  if (errorEl) {
    if (errorMsg) {
      errorEl.textContent = errorMsg;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }
  if (input) {
    if (errorMsg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function validateStep1(form, showError = false) {
  const titleInput = form.querySelector('[name="title"]');
  const title = (titleInput?.value || '').trim();
  const buyer = (buyerAddress() || '').trim().toLowerCase();
  const seller = getEffectiveParticipantAddress('seller', form);
  const arbiter = getEffectiveParticipantAddress('arbiter', form);

  let valid = true;
  let titleErr = '', sellerErr = '', arbiterErr = '';

  if (!title) {
    titleErr = 'Agreement name is required.';
    valid = false;
  } else if (new TextEncoder().encode(title).length > 80) {
    titleErr = 'Agreement name cannot exceed 80 bytes.';
    valid = false;
  }

  if (!seller) {
    sellerErr = 'Seller account or address is required.';
    valid = false;
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(seller) || seller.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    sellerErr = 'Please provide a valid, non-zero 0x Ethereum address.';
    valid = false;
  } else if (seller.toLowerCase() === buyer) {
    sellerErr = 'Seller cannot be your connected buyer wallet.';
    valid = false;
  }

  if (!arbiter) {
    arbiterErr = 'Arbitrator account or address is required.';
    valid = false;
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(arbiter) || arbiter.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    arbiterErr = 'Please provide a valid, non-zero 0x Ethereum address.';
    valid = false;
  } else if (arbiter.toLowerCase() === buyer) {
    arbiterErr = 'Arbitrator cannot be your connected buyer wallet.';
    valid = false;
  } else if (arbiter.toLowerCase() === seller.toLowerCase()) {
    arbiterErr = 'Arbitrator and seller must be different addresses.';
    valid = false;
  }

  const titleErrEl = form.querySelector('#title-error');
  const sellerEl = form.querySelector('#wizard-seller-custom:not([hidden])') || form.querySelector('#wizard-seller');
  const sellerErrEl = form.querySelector('#seller-error');
  const arbiterEl = form.querySelector('#wizard-arbiter-custom:not([hidden])') || form.querySelector('#wizard-arbiter');
  const arbiterErrEl = form.querySelector('#arbiter-error');

  if (showError) {
    setFieldError(titleInput, titleErr, titleErrEl);
    setFieldError(sellerEl, sellerErr, sellerErrEl);
    setFieldError(arbiterEl, arbiterErr, arbiterErrEl);
  } else {
    if (!titleErr && titleErrEl && !titleErrEl.hidden) setFieldError(titleInput, '', titleErrEl);
    if (!sellerErr && sellerErrEl && !sellerErrEl.hidden) setFieldError(sellerEl, '', sellerErrEl);
    if (!arbiterErr && arbiterErrEl && !arbiterErrEl.hidden) setFieldError(arbiterEl, '', arbiterErrEl);
  }

  return { valid, title, seller, arbiter, titleErr, sellerErr, arbiterErr };
}

function validateStep2(form, showError = false) {
  const rows = [...form.querySelectorAll('.milestone-form')];
  if (rows.length < 1 || rows.length > 5) {
    return { valid: false, error: 'Agreement must contain between 1 and 5 milestones.' };
  }

  let valid = true;
  let previousDays = 0;
  let totalWei = zero();
  let firstErr = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const titleInput = row.querySelector('[name="milestone-title"]');
    const amountInput = row.querySelector('[name="milestone-amount"]');
    const daysInput = row.querySelector('[name="milestone-days"]');
    const titleErrEl = row.querySelector('.milestone-title-error');
    const amountErrEl = row.querySelector('.milestone-amount-error');
    const daysErrEl = row.querySelector('.milestone-days-error');

    const mTitle = (titleInput?.value || '').trim();
    const mAmountStr = (amountInput?.value || '').trim();
    const mDays = parseInt(daysInput?.value || '0', 10);

    let tErr = '', aErr = '', dErr = '';

    if (!mTitle) {
      tErr = 'Deliverable title is required.';
      valid = false;
      if (!firstErr) firstErr = `Milestone ${i+1}: title is required.`;
    } else if (new TextEncoder().encode(mTitle).length > 80) {
      tErr = 'Deliverable title cannot exceed 80 bytes.';
      valid = false;
      if (!firstErr) firstErr = `Milestone ${i+1}: title exceeds 80 bytes.`;
    }

    try {
      const parsed = parseAmount(mAmountStr);
      if (parsed <= (mode === 'chain' ? 0n : 0)) {
        aErr = 'Amount must be greater than zero.';
        valid = false;
        if (!firstErr) firstErr = `Milestone ${i+1}: amount must be greater than zero.`;
      } else {
        totalWei += parsed;
      }
    } catch (err) {
      aErr = err.message || 'Invalid amount.';
      valid = false;
      if (!firstErr) firstErr = `Milestone ${i+1}: ${aErr}`;
    }

    if (!Number.isInteger(mDays) || mDays < 1 || mDays > 365) {
      dErr = 'Due days must be between 1 and 365.';
      valid = false;
      if (!firstErr) firstErr = `Milestone ${i+1}: due days must be between 1 and 365.`;
    } else if (mDays <= previousDays) {
      dErr = i === 0 ? 'Due days must be at least 1.' : `Must be greater than Milestone ${i}'s deadline (${previousDays} days).`;
      valid = false;
      if (!firstErr) firstErr = `Milestone ${i+1}: deadline must be later than Milestone ${i}.`;
    } else {
      previousDays = mDays;
    }

    if (showError) {
      setFieldError(titleInput, tErr, titleErrEl);
      setFieldError(amountInput, aErr, amountErrEl);
      setFieldError(daysInput, dErr, daysErrEl);
    } else {
      if (!tErr && titleErrEl && !titleErrEl.hidden) setFieldError(titleInput, '', titleErrEl);
      if (!aErr && amountErrEl && !amountErrEl.hidden) setFieldError(amountInput, '', amountErrEl);
      if (!dErr && daysErrEl && !daysErrEl.hidden) setFieldError(daysInput, '', daysErrEl);
    }
  }

  return { valid, totalWei, error: firstErr };
}

function updateWizardNextState() {
  if (!createDialog || !createDialog.open) return;
  const step = Number(createDialog.dataset.step || '0');
  const nextBtn = createDialog.querySelector('[data-wizard-next]');
  if (!nextBtn) return;
  const form = createDialog.querySelector('#create-form');
  if (!form) return;

  if (step === 0) {
    const v = validateStep1(form, false);
    nextBtn.disabled = !v.valid;
  } else if (step === 1) {
    const v = validateStep2(form, false);
    nextBtn.disabled = !v.valid;
  } else {
    nextBtn.disabled = false;
  }
}

function openCreate() {
  if(dealDialog.open)dealDialog.close();
  if(client.busy){toast('Wait for the current transaction to finish.');return false;}
  if(mode==='chain'&&!wallet){walletPanel.open({resumeCreate:true});return false;}
  if(mode==='chain'&&!chainReady){toast(chainMessage);return false;}
  if(mode==='demo'&&role!=='buyer'){role='buyer';render();}
  createDialog.classList.add('create-wizard');
  createDialog.dataset.step='0';
  document.body.classList.add('modal-open');
  createDialog.innerHTML=`<div class="wizard-top"><a class="brand" href="/">${mark}<span>PactChain</span></a><span class="eyebrow">A CLEAR START / NEW AGREEMENT</span><button class="close-button" data-close aria-label="Close dialog">×</button></div><div class="wizard-layout"><aside class="wizard-rail"><span class="eyebrow">FROM PROMISE TO PLAN</span><ol>${stageNames.map((name,i)=>`<li data-stage="${i}"><span>${String(i+1).padStart(2,'0')}</span><div><b>${name}</b><small>${['Name it. Choose your people.','Define what, when and how much.','One last look at the whole deal.'][i]}</small></div></li>`).join('')}</ol><div class="wizard-rail-note">${icon('shield')}<p>Good agreements make<br>the next step clear.</p><small>${mode==='chain'?'Terms recorded on-chain. Test ETH only.':'Local demo. No real ETH moves.'}</small></div></aside><form id="create-form" novalidate><div class="wizard-form-heading"><span class="eyebrow" id="wizard-step-label">STEP 01 / 03</span><h2 id="create-heading">First, the agreement.</h2><p id="wizard-step-copy">A name, a counterparty, and someone to turn to if you disagree.</p></div>
    <section data-wizard-panel="0">
      <div class="creator-summary-card">
        <div class="creator-summary-header">
          <span class="creator-badge">CREATOR &amp; BUYER</span>
          <span class="creator-status">${mode==='chain'?(localConnected()?'LOCAL TEST WALLET':'METAMASK WALLET'):'DEMO PARTICIPANT'}</span>
        </div>
        <div class="creator-summary-body">
          <div class="creator-address-row">
            <code class="creator-address" title="${buyerAddress()}">${buyerAddress()}</code>
          </div>
          <p class="creator-caption">Your connected account initiates the contract escrow, locks deposit funds, and approves milestone deliveries.</p>
        </div>
      </div>
      <div class="field">
        <label for="wizard-title"><span>Agreement name</span> <span class="field-required">*</span></label>
        <input id="wizard-title" name="title" maxlength="80" required placeholder="e.g. Brand website &amp; handover" autocomplete="off" spellcheck="false">
        <div class="field-meta">
          <small class="field-hint">Concise description of the agreement (1–80 characters). Recorded on-chain.</small>
          <small class="char-count" aria-live="polite"><span id="title-chars">0</span>/80</small>
        </div>
        <p class="field-error" id="title-error" hidden></p>
      </div>
      ${participantFields()}
    </section>
    <section data-wizard-panel="1" hidden>
      <div class="field">
        <label for="wizard-inspection"><span>Inspection window</span></label>
        <div class="select-wrap">
          <select id="wizard-inspection" name="inspection">
            <option value="24">24 hours (1 day review window)</option>
            <option value="48" selected>48 hours (2 days review window)</option>
            <option value="72">72 hours (3 days review window)</option>
            <option value="168">168 hours (7 days - maximum review window)</option>
          </select>
        </div>
        <small class="field-hint">Buyer review window after seller submits delivery. If the buyer does not approve or dispute within this window, the seller can claim the payout.</small>
      </div>
      <div id="milestone-fields">${milestoneFields(0)}</div>
      <button type="button" class="ghost wide-button add-milestone-btn" data-add-milestone>${icon('plus')}Add milestone</button>
      <div class="form-total-card">
        <div class="form-total-row">
          <span>Total agreement value</span>
          <b id="form-total">0.01 ${funds()}</b>
        </div>
        <div class="form-deposit-note">
          ${icon('shield')}
          <span><b>Full deposit required on funding:</b> <span id="form-deposit-amount">0.01 ${funds()}</span> will be locked in escrow by the buyer after creation.</span>
        </div>
      </div>
      <small class="field-help">Up to 5 milestones. Each deadline must increase in sequence.</small>
    </section>
    <section data-wizard-panel="2" hidden>
      <div id="agreement-preview"></div>
      <div class="wizard-submission-notice" hidden>
        <span class="pulse-dot"></span>
        <span id="wizard-submission-status">Waiting for signature…</span>
      </div>
    </section>
    <p class="form-error" role="alert" hidden></p>
    <div class="wizard-footer">
      <button type="button" class="ghost" data-wizard-back hidden>← Back</button>
      <button type="button" class="text-button" data-close>Cancel</button>
      <button type="button" class="primary" data-wizard-next>Next: milestones ↗</button>
      <button class="primary" type="submit" id="create-final" hidden>${mode==='chain'?'Confirm &amp; create escrow ↗':'Create demo agreement ↗'}</button>
    </div>
  </form></div>`;
  setWizardStep(0);
  createDialog.showModal();
  createDialog.querySelector('[name="title"]').focus({preventScroll:true});
}

function getDraft() {
  const form = createDialog.querySelector('#create-form');
  const data = new FormData(form);
  const timestamp = now();
  const seller = getEffectiveParticipantAddress('seller', form);
  const arbiter = getEffectiveParticipantAddress('arbiter', form);
  const inspectionHours = Number(data.get('inspection') || 48);

  return {
    title: (data.get('title') || '').trim(),
    seller,
    arbiter,
    inspectionHours,
    milestones: [...form.querySelectorAll('.milestone-form')].map(row => ({
      title: (row.querySelector('[name="milestone-title"]')?.value || '').trim(),
      amount: parseAmount(row.querySelector('[name="milestone-amount"]')?.value || '0'),
      deadline: timestamp + Number(row.querySelector('[name="milestone-days"]')?.value || '7') * 24 * HOUR
    }))
  };
}

function renderStep3Preview() {
  const draft = getDraft();
  const totalEth = draft.milestones.reduce((n, m) => n + m.amount, zero());
  const totalFormatted = fmt(totalEth);
  const sellerShort = short(draft.seller);
  const arbiterShort = short(draft.arbiter);
  const buyerShort = short(buyerAddress());

  const container = createDialog.querySelector('#agreement-preview');
  if (!container) return;

  container.innerHTML = `
    <article class="agreement-review">
      <div class="review-header">
        <span class="eyebrow">YOUR AGREEMENT / READY TO CREATE</span>
        <span class="review-network-tag">${mode === 'chain' ? esc(client.network.name) : 'Local demo'}</span>
      </div>
      <h3 class="review-title">${esc(draft.title)}</h3>

      <div class="review-summary-grid">
        <div class="review-stat-box">
          <span class="stat-label">Total Escrow Value</span>
          <div class="stat-value"><strong>${totalFormatted}</strong> <small>ETH</small></div>
          <span class="stat-sub">Deposited by buyer after creation</span>
        </div>
        <div class="review-stat-box">
          <span class="stat-label">Milestones &amp; Window</span>
          <div class="stat-value"><strong>${draft.milestones.length}</strong> <small>milestone${draft.milestones.length > 1 ? 's' : ''}</small></div>
          <span class="stat-sub">${draft.inspectionHours}h inspection window</span>
        </div>
      </div>

      <div class="review-participants-card">
        <span class="eyebrow">PARTICIPANTS &amp; ROLES</span>
        <dl class="review-participants-list">
          <div class="review-participant-item">
            <dt>Buyer &amp; Escrow Funder (You)</dt>
            <dd><code>${esc(buyerShort)}</code></dd>
          </div>
          <div class="review-participant-item">
            <dt>Seller (Work Deliverer)</dt>
            <dd><code>${esc(sellerShort)}</code></dd>
          </div>
          <div class="review-participant-item">
            <dt>Arbitrator (Dispute Decider)</dt>
            <dd><code>${esc(arbiterShort)}</code></dd>
          </div>
        </dl>
      </div>

      <div class="review-milestones-card">
        <span class="eyebrow">MILESTONE PLAN</span>
        <div class="review-milestones">
          ${draft.milestones.map((m, i) => {
            const pct = totalEth > (mode === 'chain' ? 0n : 0) ? 
              (mode === 'chain' ? Number((m.amount * 10000n) / totalEth) / 100 : Math.round((m.amount / totalEth) * 100)) : 0;
            return `<div class="review-milestone-row">
              <span class="review-milestone-num">${String(i + 1).padStart(2, '0')}</span>
              <div class="review-milestone-info">
                <b>${esc(m.title)}</b>
                <small>Due by ${date(m.deadline)} · ${pct}% of total</small>
              </div>
              <strong class="review-milestone-amount">${fmt(m.amount)} ETH</strong>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="review-blockchain-meta">
        <dl>
          <dt>Network</dt>
          <dd>${mode === 'chain' ? `${esc(client.network.name)} (Chain ID ${client.network.chainId})` : 'Browser Demo (Local simulation)'}</dd>
          <dt>Smart Contract Method</dt>
          <dd><code>createAgreement(seller, arbitrator, title, ...)</code></dd>
          <dt>Signing Wallet</dt>
          <dd>${mode === 'chain' ? (localConnected() ? `Local Test Wallet (${esc(short(wallet))})` : `MetaMask (${esc(short(wallet))})`) : 'Buyer Demo Account'}</dd>
        </dl>
      </div>

      <div class="review-notice">
        ${icon('lock')}
        <div>
          <b>Immutable terms recorded on-chain.</b>
          <p>Creating the agreement registers its milestones and participant addresses. Gas fees will apply. The full deposit of ${totalFormatted} ETH will be locked when you fund the agreement in the next step.</p>
        </div>
      </div>
    </article>
  `;
}

function setWizardStep(step) {
  createDialog.dataset.step = String(step);
  createDialog.querySelectorAll('[data-wizard-panel]').forEach(panel => {
    panel.hidden = Number(panel.dataset.wizardPanel) !== step;
  });
  createDialog.querySelectorAll('[data-stage]').forEach(item => {
    const itemStep = Number(item.dataset.stage);
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('done', itemStep < step);
    if (itemStep === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });

  createDialog.querySelector('#wizard-step-label').textContent = `STEP ${String(step + 1).padStart(2, '0')} / 03`;
  createDialog.querySelector('#create-heading').textContent = [
    'First, the agreement.',
    'Break the promise into steps.',
    'A plan you both can follow.'
  ][step];
  createDialog.querySelector('#wizard-step-copy').textContent = [
    'A name, a counterparty, and someone to turn to if you disagree.',
    'Set deliverables, amounts, and increasing deadlines. All funds remain protected.',
    mode === 'chain' ? (localConnected() ? 'Review the immutable terms, then confirm with your local test wallet.' : 'Review the immutable terms, then sign in MetaMask.') : 'Review the terms before creating your local demo agreement.'
  ][step];

  createDialog.querySelector('[data-wizard-back]').hidden = step === 0;
  createDialog.querySelector('[data-wizard-next]').hidden = step === 2;
  createDialog.querySelector('[data-wizard-next]').textContent = step === 0 ? 'Next: milestones ↗' : 'Review agreement ↗';
  createDialog.querySelector('#create-final').hidden = step !== 2;
  createDialog.querySelector('#create-final').textContent = mode === 'chain' ? 'Confirm & create escrow ↗' : 'Create demo agreement ↗';
  
  const formErr = createDialog.querySelector('.form-error');
  if (formErr) formErr.hidden = true;

  updateWizardNextState();

  if (step === 2) {
    renderStep3Preview();
  }

  const activePanel = createDialog.querySelector(`[data-wizard-panel="${step}"]`);
  if (activePanel) activePanel.scrollTop = 0;

  if (createDialog.open) {
    const heading = createDialog.querySelector('#create-heading');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

function advanceWizard() {
  const step = Number(createDialog.dataset.step);
  const form = createDialog.querySelector('#create-form');
  const formErrorEl = createDialog.querySelector('.form-error');
  if (formErrorEl) formErrorEl.hidden = true;

  try {
    if (step === 0) {
      const v = validateStep1(form, true);
      if (!v.valid) {
        throw new Error(v.titleErr || v.sellerErr || v.arbiterErr || 'Please check the participant details.');
      }
      setWizardStep(1);
    } else if (step === 1) {
      const v = validateStep2(form, true);
      if (!v.valid) {
        throw new Error(v.error || 'Please correct the milestone deliverables, amounts, and deadlines.');
      }
      const draft = getDraft();
      if (mode === 'chain') {
        client.validateDraft(draft);
      } else {
        createAgreement(state, draft, now());
      }
      setWizardStep(2);
    }
  } catch (error) {
    formError(form, error);
  }
}

function showGuide() {
  openDialog(actionDialog,'From promise to payment.',`<div class="guide-steps"><div><span>01</span><p><b>Agree on the details.</b>Name your counterparty, choose an arbitrator and set milestone terms.</p></div><div><span>02</span><p><b>Lock ${mode==='chain'?'test ETH':'the demo funds'}.</b>The buyer funds the agreement before delivery begins.</p></div><div><span>03</span><p><b>Deliver. Review. Repeat.</b>The seller submits work. The buyer approves or disputes within the inspection window.</p></div><div><span>04</span><p><b>Withdraw what’s yours.</b>Released payments and refunds are credited before a separate withdrawal.</p></div></div><p class="guide-note">${mode==='chain'?`${localConnected()?'Use Switch account to connect the buyer, seller or arbitrator’s local test wallet.':'Connect a Local test wallet on Local Hardhat, or switch MetaMask accounts to use each participant’s wallet.'} Delivery references and dispute reasons are public; use links or content hashes and avoid private information.`:'Use the demo roles to try each participant’s view.'} Deadline refunds, seller timeout claims and arbitrator splits follow the existing agreement rules.</p><button class="primary wide-button" data-close>Got it ↗</button>`);
}

function openDialog(dialog,heading,content){dialog.innerHTML=`<div class="dialog-head"><h2 id="${dialog===createDialog?'create-heading':'action-heading'}">${heading}</h2><button data-close aria-label="Close dialog">×</button></div><div class="dialog-content">${content}</div>`;dialog.showModal();}

function updateTotal(){
  let amount = zero();
  let hasError = false;
  try {
    createDialog.querySelectorAll('[name="milestone-amount"]').forEach(input => {
      try {
        amount += parseAmount(input.value);
      } catch {
        hasError = true;
      }
    });
    const totalEl = createDialog.querySelector('#form-total');
    if (totalEl) {
      totalEl.textContent = hasError ? 'Check amounts' : `${fmt(amount)} ${funds()}`;
    }
    const depositEl = createDialog.querySelector('#form-deposit-amount');
    if (depositEl && !hasError) {
      depositEl.textContent = `${fmt(amount)} ${funds()}`;
    }
  } catch {
    const totalEl = createDialog.querySelector('#form-total');
    if (totalEl) totalEl.textContent = 'Check amounts';
  }
}

function renumber(){
  const rows = createDialog.querySelectorAll('.milestone-form');
  rows.forEach((row, i) => {
    row.dataset.milestoneIndex = String(i);
    const badge = row.querySelector('.milestone-badge') || row.querySelector('.milestone-form-head span');
    if (badge) badge.textContent = `MILESTONE ${String(i+1).padStart(2,'0')}`;
    const rm = row.querySelector('[data-remove-milestone]');
    if (rm) rm.setAttribute('aria-label', `Remove milestone ${i+1}`);
  });
  const count = rows.length;
  const addBtn = createDialog.querySelector('[data-add-milestone]');
  if (addBtn) addBtn.disabled = count >= 5;
  createDialog.querySelectorAll('[data-remove-milestone]').forEach(b => b.disabled = count <= 1);
  updateTotal();
  updateWizardNextState();
}
function openAction(action,id){
  if(client.busy){toast('Wait for the current transaction to finish.');return;}
  if(mode==='chain'&&(!chainReady||!wallet)){toast(chainReady?'Connect a participant wallet first.':chainMessage);return;}
  const a=state.agreements.find(a=>a.id===id),m=a&&currentMilestone(a);
  let fields='',description='';
  if(action==='deliver'){
    description=`Add the file name, preview URL, or delivery reference the buyer should review. ${mode==='chain'?'The reference is public on the blockchain. Do not include private information.':'The reference stays in this browser.'}`;
    fields='<label class="field">Delivery reference<textarea name="proof" maxlength="500" required placeholder="e.g. Preview URL and handover file name"></textarea></label>';
  }else if(action==='dispute'){
    description='Pause this milestone for review by the agreed human arbitrator. Other unpaid milestones cannot proceed until this dispute is settled.';
    fields='<label class="field">Reason for dispute<textarea name="reason" maxlength="500" required placeholder="Describe what differs from the agreed deliverable"></textarea></label>';
  }else if(action==='resolve'){
    description=`Decide how this milestone’s ${fmt(m.amount)} ${funds()} is allocated. Future milestones remain locked. Buyer’s concern: ${m.reason}`;
    fields='<label class="field">Seller allocation (%)<input name="sellerPercent" type="number" min="0" max="100" step="1" value="50" required><small>The remainder is credited to the buyer. Each party withdraws separately.</small></label>';
  }else{
    description={
      fund:`Lock ${fmt(a?total(a):0)} ${funds()} for the complete agreement. ${mode==='chain'?localConnected()?'Your selected local account pays the exact deposit and local network fee.':'MetaMask will request the exact deposit plus the network fee.':'This is a local balance change. No wallet transaction will be requested.'}`,
      approve:`Release ${fmt(m?.amount||0)} ${funds()} to the seller’s withdrawable balance. The remaining milestones stay locked.`,
      claim:`Credit ${fmt(m?.amount||0)} ${funds()} to the seller after the inspection window.`,
      refund:`Return ${fmt(a?locked(a):0)} ${funds()} for all unpaid milestones to the buyer’s withdrawable balance.`,
      withdraw:`Withdraw ${fmt(pending())} ${funds()} as the ${mode==='chain'?'connected wallet':roleName(role).toLowerCase()}. ${mode==='chain'?'The contract sends your credited test ETH to this wallet. A network fee applies.':'This records a local demo withdrawal; it does not send real ETH.'}`,
    }[action];
  }
  openDialog(actionDialog,labels[action],`<p>${esc(description)}</p><form id="action-form" data-action="${action}" data-id="${esc(id||'')}">${fields}${walletConfirmation(action,a)}<p class="form-error" role="alert" hidden></p><div class="form-footer"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit">Confirm ${mode==='chain'?localConnected()?'transaction':'in MetaMask':action==='withdraw'?'demo withdrawal':action==='fund'?'demo funding':'action'}</button></div></form>`);
}
function formError(form,error){const target=form.querySelector('.form-error');target.textContent=error.message;target.hidden=false;}
document.addEventListener('click',async event=>{const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-close')){target.closest('dialog')?.close();return;}
  if(target.hasAttribute('data-wizard-next')){advanceWizard();return;}
  if(target.hasAttribute('data-wizard-back')){setWizardStep(Math.max(0,Number(createDialog.dataset.step)-1));return;}
  if(target.hasAttribute('data-guide')){showGuide();return;}
  if(target.dataset.view){if(dealDialog.open)dealDialog.close();view=target.dataset.view;history.replaceState(null,'',`#${view}`);render();root.querySelector(`.workspace-nav [data-view="${view==='overview'?'agreements':view}"]`)?.focus({preventScroll:true});return;}
  if(target.dataset.role){
    if(mode==='chain')return;
    role=target.dataset.role;
    if(ADDRESSES[role]){
      wallet=ADDRESSES[role];
      client.account=wallet;
      client.walletKind='local';
      client.localAccounts=DEMO_TEST_ACCOUNTS;
    }
    render();(dealDialog.open?dealDialog:root).querySelector(`[data-role="${role}"]`)?.focus({preventScroll:true});return;
  }
  if(target.dataset.filter){filter=target.dataset.filter;render();root.querySelector(`[data-filter="${filter}"]`)?.focus({preventScroll:true});return;}
  if(target.dataset.select){openDeal(target.dataset.select);return;}
  if(target.hasAttribute('data-create')){if(openCreate()!==false)renumber();return;}
  if(target.hasAttribute('data-add-milestone')){const container=createDialog.querySelector('#milestone-fields');if(container.children.length<5)container.insertAdjacentHTML('beforeend',milestoneFields(container.children.length));renumber();return;}
  if(target.hasAttribute('data-remove-milestone')){if(createDialog.querySelectorAll('.milestone-form').length>1)target.closest('.milestone-form').remove();renumber();return;}
  if(target.dataset.action&&!target.closest('form')){openAction(target.dataset.action,target.dataset.id);return;}
  if(target.dataset.time){if(mode==='chain')return;state.offset+=Number(target.dataset.time)*HOUR;const saved=save();render();if(saved)toast(`Demo clock advanced ${target.dataset.time} hours.`);return;}
  if(target.hasAttribute('data-reset')){if(mode==='chain')return;openDialog(actionDialog,'Reset the local demo?',`<p>This removes agreements you created and restores the sample data. It only affects this browser’s PactChain demo.</p><div class="form-footer"><button class="ghost" data-close>Cancel</button><button class="primary" data-confirm-reset>Reset demo data</button></div>`);return;}
  if(target.hasAttribute('data-confirm-reset')){if(mode==='chain')return;state=seed();role='buyer';selected=state.agreements[0].id;filter='all';query='';save();actionDialog.close();render();toast('Sample agreements restored.');return;}
  if(target.dataset.copyHash){try{await navigator.clipboard.writeText(target.dataset.copyHash);toast('Transaction hash copied.');}catch{toast(target.dataset.copyHash);}return;}
  if(target.dataset.mode){
    if(client.busy){toast('Wait for the current wallet transaction to finish.');return;}
    for(const dialog of [dealDialog,createDialog,actionDialog])dialog.close();
    mode=target.dataset.mode;
    localStorage.setItem('pactchain.mode',mode);
    if(mode==='chain'){
      chainReady=false;
      chainMessage=isLocalHost?'Connecting to the blockchain…':'Select a network with a deployed contract, or use Demo mode to explore.';
      lastTx=null;wallet=client.account;role=wallet?'wallet':'viewer';state=emptyChain();
    } else {
      wallet=ADDRESSES.buyer;
      client.account=wallet;
      client.walletKind='local';
      client.localAccounts=DEMO_TEST_ACCOUNTS;
      role='buyer';
      state=load();
    }
    lastTx=null;selected=state.agreements[0]?.id;render();
    if(mode==='chain')await refreshChain();
    return;
  }
  if(target.hasAttribute('data-refresh')){await refreshChain();return;}
  if(target.hasAttribute('data-wallet')){if(client.busy){toast('Wait for the current transaction to finish.');return;}const agreementId=dealDialog.open?selected:null;for(const dialog of [dealDialog,createDialog,actionDialog])dialog.close();walletPanel.open({agreementId});}

});
document.addEventListener('input',event=>{
  if(event.target.id==='agreement-search'){
    const cursor=event.target.selectionStart;query=event.target.value;render();const input=document.querySelector('#agreement-search');input.focus();try{input.setSelectionRange(cursor,cursor);}catch{}
  }
  if(event.target.closest('#create-form')){
    if(event.target.id==='wizard-title'){
      const countEl = createDialog.querySelector('#title-chars');
      if(countEl) countEl.textContent = String(event.target.value.length);
      validateStep1(createDialog.querySelector('#create-form'), false);
    }
    if(['wizard-seller-custom','wizard-arbiter-custom'].includes(event.target.id)){
      validateStep1(createDialog.querySelector('#create-form'), false);
    }
    if(event.target.name==='milestone-amount'){
      updateTotal();
    }
    if(['milestone-title','milestone-days','milestone-amount'].includes(event.target.name)){
      validateStep2(createDialog.querySelector('#create-form'), false);
    }
    updateWizardNextState();
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['create-form','action-form'].includes(form.id))return;event.preventDefault();
  if(form.id==='create-form'&&Number(createDialog.dataset.step)!==2){advanceWizard();return;}
  if(form.dataset.busy)return;
  form.dataset.busy='true';const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);

  const creating = form.id==='create-form';
  const action = creating ? 'create' : form.dataset.action;
  const submitBtn = creating ? form.querySelector('#create-final') : form.querySelector('button[type="submit"]');
  const origBtnText = submitBtn ? submitBtn.innerHTML : '';
  const formErrorEl = form.querySelector('.form-error');
  if(formErrorEl) formErrorEl.hidden = true;

  if (creating && submitBtn) {
    submitBtn.innerHTML = `<span class="btn-spinner"></span> Creating escrow…`;
  }

  try {
    const data=new FormData(form);
    if(mode==='chain'){
      const agreement=state.agreements.find(a=>a.id===form.dataset.id);
      const draft = creating ? getDraft() : null;
      const progressNotice = creating ? form.querySelector('.wizard-submission-notice') : null;

      const result=await client.transact(action,agreement,creating?draft:{proof:data.get('proof'),reason:data.get('reason'),sellerPercent:Number(data.get('sellerPercent'))},progress=>{
        const statusMap = {
          signing: localConnected() ? 'Submitting local test-wallet transaction…' : 'Waiting for wallet signature in MetaMask…',
          submitted: 'Transaction submitted · waiting for blockchain confirmation…',
          confirmed: 'Transaction confirmed on-chain!'
        };
        const statusText = statusMap[progress.status] || progress.status;
        lastTx={...progress,network:{...client.network},status:statusText};
        render();

        if (creating) {
          const subStatus = form.querySelector('#wizard-submission-status');
          if (subStatus) {
            subStatus.textContent = statusText;
            if(progressNotice) progressNotice.hidden = false;
          }
        }
      });

      (creating?createDialog:actionDialog).close();
      document.body.classList.remove('modal-open');
      await refreshChain();
      if(creating){
        selected=result.id;view='agreements';filter='all';query='';history.replaceState(null,'','#agreements');render();
        if(state.agreements.some(a=>a.id===selected))openDeal(selected);
      }
      toast(creating?`Agreement ${result.id||''} created on-chain. Lock funds to start delivery.`:'Transaction confirmed on-chain.');
    }else {
      if(creating){
        const result=createAgreement(state,getDraft(),now());state=result.state;selected=result.id;view='agreements';filter='all';query='';history.replaceState(null,'','#agreements');save();createDialog.close();document.body.classList.remove('modal-open');render();openDeal(selected);toast('Agreement created. Lock demo funds to start delivery.');
      }
      else{state=transition(state,form.dataset.id,action,role,{proof:data.get('proof'),reason:data.get('reason'),sellerPercent:Number(data.get('sellerPercent'))},now());save();actionDialog.close();render();toast(labels[action]+' completed in demo mode.');}
    }
  }catch(error){
    if(mode==='chain'){lastTx=lastTx?.hash?{...lastTx,status:'Transaction needs attention · check its hash before retrying'}:null;render();}
    formError(form,{message:mode==='chain'?chainError(error):error.message});
    if (creating) {
      const subNotice = form.querySelector('.wizard-submission-notice');
      if (subNotice) subNotice.hidden = true;
    }
  }
  finally{
    delete form.dataset.busy;
    buttons.forEach(b=>b.disabled=false);
    if(submitBtn) submitBtn.innerHTML = origBtnText;
  }
});

window.addEventListener('hashchange',()=>{if(location.hash==='#workspace-main')return;view=['agreements','withdrawals','activity'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';render();});
async function walletChanged(){if(client.walletKind==='local')return;client.invalidateWallet();wallet='';chainReady=false;if(mode==='chain'){for(const dialog of [createDialog,actionDialog])dialog.close();state=emptyChain();render();try{wallet=await client.attachAccounts();await refreshChain();}catch(error){toast(chainError(error));}}}
window.ethereum?.on?.('accountsChanged',walletChanged);
window.ethereum?.on?.('chainChanged',walletChanged);
document.addEventListener('change',async event=>{
  if(event.target.id==='network-select'){
    if(client.busy){event.target.value=client.key;toast('Wait for the current transaction to finish.');return;}
    client.setNetwork(event.target.value);localStorage.setItem('pactchain.network',client.key);wallet='';state=emptyChain();chainReady=false;chainMessage='Connecting to the blockchain…';lastTx=null;dealDialog.close();render();try{wallet=await client.attachAccounts();}catch{}await refreshChain();
    return;
  }
  if(event.target.name==='seller'){
    const custom = createDialog.querySelector('#wizard-seller-custom');
    if(custom){
      if(event.target.value==='custom'){custom.hidden=false;custom.required=true;custom.focus();}
      else{custom.hidden=true;custom.required=false;custom.value='';}
      validateStep1(createDialog.querySelector('#create-form'),false);
    }
  }
  if(event.target.name==='arbiter'){
    const custom = createDialog.querySelector('#wizard-arbiter-custom');
    if(custom){
      if(event.target.value==='custom'){custom.hidden=false;custom.required=true;custom.focus();}
      else{custom.hidden=true;custom.required=false;custom.value='';}
      validateStep1(createDialog.querySelector('#create-form'),false);
    }
  }
  if(event.target.closest('#create-form')){
    updateWizardNextState();
  }
});
createDialog.addEventListener('close', ()=>{ document.body.classList.remove('modal-open'); });
for(const dialog of [createDialog,actionDialog,dealDialog])dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
// Update only when a deadline boundary changes available actions. This preserves focus and form input.
let boundary='';setInterval(()=>{const next=state.agreements.map(a=>{const m=currentMilestone(a);return m?`${a.id}:${now()>=m.deadline}:${Boolean(m.inspectionEnd&&now()>=m.inspectionEnd)}`:a.id;}).join('|');if(boundary&&next!==boundary)render();boundary=next;},1000);
async function refreshChain(){
  if(mode!=='chain')return;
  if(refreshPromise){await refreshPromise;if(mode!=='chain')return;}
  const epoch=client.epoch;
  refreshPromise=(async()=>{try{
    const next=await client.snapshot();if(mode!=='chain'||epoch!==client.epoch)return;
    const changed=!chainReady||state.blockNumber!==next.blockNumber||state.account!==next.account||state.walletBalance!==next.walletBalance;
    state=next;wallet=client.account;role=wallet?'wallet':'viewer';chainReady=true;chainMessage='';
    if(!state.agreements.some(a=>a.id===selected))selected=state.agreements[0]?.id;
    if(changed)render();
  }catch(error){if(mode!=='chain'||epoch!==client.epoch)return;chainReady=false;chainMessage=chainError(error);state=emptyChain();render();}finally{refreshPromise=null;}})();
  await refreshPromise;
}
render();
if(mode==='chain'){try{wallet=await client.attachAccounts();}catch{}await refreshChain();}else save();
setInterval(()=>{if(mode==='chain'&&!client.busy&&!refreshPromise)refreshChain();},12000);

