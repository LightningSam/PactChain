// Local demonstration only. No RPC calls, contract writes, or real funds.
// Amounts use integer millionths of ETH to avoid floating-point balance drift.
export const UNIT = 1_000_000;
export const HOUR = 3_600_000;
export const ADDRESSES = { buyer:'0x1111111111111111111111111111111111111111', seller:'0x2222222222222222222222222222222222222222', arbiter:'0x3333333333333333333333333333333333333333' };
export const isSettled = m => ['released','refunded','resolved'].includes(m.status);
export const currentMilestone = a => a.milestones.find(m => !isSettled(m));
export const total = a => a.milestones.reduce((n,m) => n + m.amount, 0);
export const locked = a => a.funded ? a.milestones.filter(m=>!isSettled(m)).reduce((n,m)=>n+m.amount,0) : 0;
export const fmt = amount => (amount / UNIT).toLocaleString('en-US', { maximumFractionDigits:6 });
export function parseAmount(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(value))) throw new Error('Enter an ETH amount with up to six decimal places.');
  const [whole, fraction=''] = String(value).split('.');
  const amount = Number(whole) * UNIT + Number(fraction.padEnd(6,'0'));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000 * UNIT) throw new Error('Each milestone must be between 0.000001 and 1,000 demo ETH.');
  return amount;
}
function log(state, agreement, label, role, amount=0, at=Date.now()) {
  state.events.unshift({id:state.nextEvent++,agreementId:agreement?.id || null,title:agreement?.title || 'Wallet',label,role,amount,at});
}
export function seed(now=Date.now()) {
  const state = {version:1,nextId:4,nextEvent:1,offset:0,balances:{buyer:0,seller:0},withdrawn:{buyer:0,seller:10_000},agreements:[],events:[]};
  const base = {buyer:ADDRESSES.buyer,seller:ADDRESSES.seller,arbiter:ADDRESSES.arbiter,inspectionHours:48,createdAt:now-HOUR*24};
  const web = {...base,id:'PACT-001',title:'Brand website & handover',funded:true,milestones:[
    {title:'Design direction',amount:10_000,deadline:now+HOUR*24,status:'released'},
    {title:'Frontend development',amount:10_000,deadline:now+HOUR*72,status:'delivered',proof:'frontend-preview.zip · Local example delivery',inspectionEnd:now+HOUR*38},
    {title:'Launch & handover',amount:10_000,deadline:now+HOUR*168,status:'pending'}]};
  const mobile = {...base,id:'PACT-002',title:'Mobile app interface',funded:false,milestones:[
    {title:'Interface design',amount:15_000,deadline:now+HOUR*96,status:'pending'},
    {title:'Prototype handover',amount:10_000,deadline:now+HOUR*192,status:'pending'}]};
  const audit = {...base,id:'PACT-003',title:'Contract review',funded:true,milestones:[
    {title:'Review & findings',amount:20_000,deadline:now+HOUR*120,status:'pending'}]};
  state.agreements=[web,mobile,audit];
  log(state,web,'Agreement created','buyer',0,now-HOUR*24);
  log(state,web,'Demo funds locked','buyer',30_000,now-HOUR*23);
  log(state,web,'Design direction approved','buyer',10_000,now-HOUR*15);
  log(state,web,'Demo payment withdrawn','seller',10_000,now-HOUR*14);
  log(state,mobile,'Agreement created','buyer',0,now-HOUR*12);
  log(state,audit,'Demo funds locked','buyer',20_000,now-HOUR*10);
  log(state,web,'Frontend development delivered','seller',0,now-HOUR*10);
  assertAccounting(state);
  return state;
}
export function assertAccounting(state) {
  const deposited = state.agreements.filter(a=>a.funded).reduce((n,a)=>n+total(a),0);
  const accounted = state.agreements.reduce((n,a)=>n+locked(a),0) + state.balances.buyer + state.balances.seller + state.withdrawn.buyer + state.withdrawn.seller;
  if (deposited !== accounted || [state.balances.buyer,state.balances.seller,state.withdrawn.buyer,state.withdrawn.seller].some(n=>!Number.isSafeInteger(n)||n<0)) throw new Error('Demo balance consistency check failed.');
}
export function createAgreement(previous, data, now) {
  const state = structuredClone(previous);
  if (!data.title?.trim() || data.title.length>80) throw new Error('Enter an agreement name of 1–80 characters.');
  if (!/^0x[0-9a-fA-F]{40}$/.test(data.seller) || !/^0x[0-9a-fA-F]{40}$/.test(data.arbiter)) throw new Error('Enter valid seller and arbitrator addresses.');
  if (new Set([ADDRESSES.buyer.toLowerCase(),data.seller.toLowerCase(),data.arbiter.toLowerCase()]).size !== 3) throw new Error('Buyer, seller and arbitrator must have distinct addresses.');
  if (!Number.isInteger(data.inspectionHours) || data.inspectionHours<1 || data.inspectionHours>168) throw new Error('Inspection must last between 1 and 168 hours.');
  if (!data.milestones?.length || data.milestones.length>5) throw new Error('Add between one and five milestones.');
  let lastDeadline=now;
  const milestones = data.milestones.map(m=>{
    if (!m.title?.trim() || m.title.length>80 || !Number.isInteger(m.amount) || m.amount<=0 || m.amount>1000*UNIT) throw new Error('Every milestone needs a title and a positive demo ETH amount.');
    if (!Number.isFinite(m.deadline) || m.deadline<=lastDeadline) throw new Error('Delivery deadlines must increase from milestone to milestone.');
    lastDeadline=m.deadline;
    return {title:m.title.trim(),amount:m.amount,deadline:m.deadline,status:'pending'};
  });
  const agreement={id:`PACT-${String(state.nextId++).padStart(3,'0')}`,title:data.title.trim(),buyer:ADDRESSES.buyer,seller:data.seller,arbiter:data.arbiter,inspectionHours:data.inspectionHours,createdAt:now,funded:false,milestones};
  state.agreements.unshift(agreement);
  log(state,agreement,'Agreement created','buyer',0,now);
  assertAccounting(state);
  return {state,id:agreement.id};
}
export function transition(previous, id, action, role, payload={}, now=Date.now()) {
  const state=structuredClone(previous);
  const a=state.agreements.find(a=>a.id===id);
  const requireRole = expected => {if(role!==expected) throw new Error(`Switch to the ${expected==='arbiter'?'arbitrator':expected} demo role to take this action.`);};
  if (action==='withdraw') {
    if (!['buyer','seller'].includes(role)) throw new Error('The arbitrator has no withdrawable balance.');
    const amount=state.balances[role];
    if(amount<=0) throw new Error('No demo funds are available to withdraw.');
    state.balances[role]=0;state.withdrawn[role]+=amount;
    log(state,null,'Demo payment withdrawn',role,amount,now);
  } else {
    if(!a) throw new Error('Agreement not found.');
    const m=currentMilestone(a);
    if(!m) throw new Error('This agreement is already settled.');
    if(action==='fund') {
      requireRole('buyer');
      if(a.funded) throw new Error('This agreement is already funded.');
      if(now>=m.deadline) throw new Error('The delivery deadline has passed. Create an agreement with new terms.');
      a.funded=true;log(state,a,'Demo funds locked','buyer',total(a),now);
    } else {
      if(!a.funded) throw new Error('Fund the agreement before starting delivery.');
      switch(action) {
        case 'deliver':
          requireRole('seller');
          if(m.status!=='pending'||now>=m.deadline) throw new Error('This milestone cannot be delivered now.');
          if(!payload.proof?.trim()||payload.proof.length>500) throw new Error('Add a delivery reference of 1–500 characters.');
          m.status='delivered';m.proof=payload.proof.trim();m.inspectionEnd=now+a.inspectionHours*HOUR;
          log(state,a,`${m.title} delivered`,'seller',0,now);break;
        case 'approve':
          requireRole('buyer');
          if(m.status!=='delivered'||now>=m.inspectionEnd) throw new Error('Buyer approval is available during the inspection window.');
          m.status='released';state.balances.seller+=m.amount;
          log(state,a,`${m.title} approved`,'buyer',m.amount,now);break;
        case 'claim':
          requireRole('seller');
          if(m.status!=='delivered'||now<m.inspectionEnd) throw new Error('The inspection window must end before a seller claim.');
          m.status='released';state.balances.seller+=m.amount;
          log(state,a,'Inspection timeout claimed','seller',m.amount,now);break;
        case 'refund': {
          requireRole('buyer');
          if(m.status!=='pending'||now<m.deadline) throw new Error('A refund requires a missed delivery deadline.');
          const amount=locked(a);
          a.milestones.filter(m=>!isSettled(m)).forEach(m=>m.status='refunded');
          state.balances.buyer+=amount;
          log(state,a,'Unpaid demo funds refunded','buyer',amount,now);break;
        }
        case 'dispute':
          requireRole('buyer');
          if(m.status!=='delivered'||now>=m.inspectionEnd) throw new Error('Open a dispute during the inspection window.');
          if(!payload.reason?.trim()||payload.reason.length>500) throw new Error('Add a dispute reason of 1–500 characters.');
          m.status='disputed';m.reason=payload.reason.trim();
          log(state,a,'Dispute opened','buyer',0,now);break;
        case 'resolve': {
          requireRole('arbiter');
          if(m.status!=='disputed') throw new Error('Only a disputed milestone can be resolved.');
          if(!Number.isInteger(payload.sellerPercent)||payload.sellerPercent<0||payload.sellerPercent>100) throw new Error('Seller allocation must be between 0% and 100%.');
          const sellerAmount=Math.floor(m.amount*payload.sellerPercent/100), buyerAmount=m.amount-sellerAmount;
          state.balances.seller+=sellerAmount;state.balances.buyer+=buyerAmount;
          m.status='resolved';m.sellerAmount=sellerAmount;m.buyerAmount=buyerAmount;
          log(state,a,`Dispute resolved · seller ${payload.sellerPercent}% / buyer ${100-payload.sellerPercent}%`,'arbiter',m.amount,now);break;
        }
        default: throw new Error('Unknown agreement action.');
      }
    }
  }
  assertAccounting(state);
  return state;
}
