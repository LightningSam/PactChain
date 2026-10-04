const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=address=>address?`${address.slice(0,6)}…${address.slice(-4)}`:'No wallet connected';
const count=value=>String(value).padStart(2,'0');
const time=value=>new Date(value).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
const date=value=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const iso=value=>Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():'';

// Read-only presentation: figures use the same amounts and permissions as the workspace.
export function renderWorkspaceIntro(model){
  const {section,agreements,events,focusId,fmt,locked,currentMilestone,isSettled,zero,available,connected,mode,role,wallet,walletName,blockNumber,ready}=model;
  const held=agreements.reduce((n,a)=>n+locked(a),zero);
  const active=agreements.filter(a=>currentMilestone(a));
  const withdrawals=events.filter(e=>mode==='chain'?e.label==='Payment withdrawn'&&connected&&e.actor?.toLowerCase()===wallet.toLowerCase():e.label==='Demo payment withdrawn'&&e.role===role);
  const paid=withdrawals.reduce((n,e)=>n+(e.amount||zero),zero);
  const money=value=>({value:fmt(value),unit:mode==='chain'?'test ETH':'demo ETH'});
  const entry=events[0];
  let heading,copy,visual,metrics,marker;

  if(section==='withdrawals'){
    heading=['From settled work.','To your wallet.'];
    copy='Released payments and refunds, ready for the final step.<br>Your withdrawal credit stays separate from funds in escrow.';
    marker='02 / THE PAYOUT DESK';
    visual=`<aside class="intro-visual payout-slip" aria-label="Withdrawal summary"><div class="slip-top"><span class="eyebrow">YOUR WITHDRAWAL RECEIPT</span><span class="slip-symbol" aria-hidden="true">↗</span></div><span class="slip-label">Available to withdraw</span><div class="slip-amount">${connected?esc(fmt(available)):'—'}<small>${mode==='chain'?'test ETH':'demo ETH'}</small></div><div class="slip-rule"></div><dl><dt>Recipient</dt><dd>${connected?esc(walletName):'Connect your wallet'}</dd><dt>Account</dt><dd><code>${esc(short(wallet))}</code></dd></dl><div class="slip-status"><span class="status-dot"></span>${!connected?'Connect to see your credit':available>zero?'Payment ready to claim':'No withdrawal credit yet'}</div></aside>`;
    metrics=[
      {label:'AVAILABLE TO WITHDRAW',...(connected?money(available):{value:'—'}),note:connected?'Credit for this account':'Connect a wallet to view'},
      {label:'WITHDRAWN BY THIS ACCOUNT',...(connected?money(paid):{value:'—'}),note:'Completed withdrawals'},
      {label:'WITHDRAWAL RECEIPTS',value:connected?count(withdrawals.length):'—',note:'In this account’s history'},
      {label:'STILL IN AGREEMENTS',...money(held),note:'Locked until settlement'},
    ];
  }else if(section==='activity'){
    heading=['Every action.','A visible record.'];
    copy='Creation, delivery, settlement—follow the whole sequence.<br>Each entry tells you what happened and who acted.';
    marker='03 / THE AGREEMENT JOURNAL';
    visual=`<aside class="intro-visual event-journal" aria-label="Recent activity preview"><div class="journal-top"><span class="eyebrow">LATEST ENTRIES</span><span class="journal-source"><span class="status-dot"></span>${mode==='demo'?'Browser demo':ready?'On-chain log':'Awaiting connection'}</span></div><div class="journal-entries">${events.slice(0,3).map((event,index)=>`<div class="journal-entry"><span class="journal-node" aria-hidden="true">${index===0?'↗':'·'}</span><div><b>${esc(event.label)}</b><p>${esc(event.title)}</p><code>${esc(event.transactionHash?`${event.transactionHash.slice(0,10)}…${event.transactionHash.slice(-6)}`:'Local demo record')}</code></div><time datetime="${iso(event.at)}">${esc(time(event.at))}</time></div>`).join('')||'<div class="intro-empty">Your first action starts the record.<small>Create an agreement to begin its history.</small></div>'}</div></aside>`;
    metrics=[
      {label:'RECORDED EVENTS',value:count(events.length),note:mode==='chain'?'From contract event logs':'Saved in this browser'},
      {label:'AGREEMENT HISTORIES',value:count(new Set(events.map(e=>e.agreementId).filter(Boolean)).size),note:'Represented in this view'},
      {label:mode==='chain'?'LATEST BLOCK':'LATEST ACTIVITY',value:mode==='chain'?(ready?String(blockNumber):'—'):(entry?time(entry.at):'—'),note:mode==='chain'?'Last refreshed chain state':entry?date(entry.at):'No activity recorded'},
      {label:'WITHDRAWALS RECORDED',value:count(events.filter(e=>['Payment withdrawn','Demo payment withdrawn'].includes(e.label)).length),note:'Completed payment events'},
    ];
  }else{
    heading=['Every promise.','A clear next step.'];
    copy='Your agreement desk: terms, milestones and shared progress.<br>See what’s protected and what needs attention next.';
    marker='01 / THE AGREEMENT DESK';
    const focus=agreements.find(a=>a.id===focusId)||active[0]||agreements[0];
    const done=focus?.milestones.filter(isSettled).length||0;
    const labels={pending:focus?.funded?'Awaiting delivery':'Awaiting funding',delivered:'Ready for review',released:'Payment released',disputed:'Dispute under review',resolved:'Dispute settled',refunded:'Refund credited'};
    visual=`<aside class="intro-visual agreement-blueprint" aria-label="Agreement progress preview"><div class="blueprint-top"><span class="eyebrow">${esc(focus?.id||'YOUR NEXT AGREEMENT')}</span><span class="blueprint-status">${focus?(!currentMilestone(focus)?'Settled':focus.funded?'Funds locked':'Draft terms'):'A clear beginning'}</span></div><h2>${esc(focus?.title||'One promise. A shared plan.')}</h2><div class="blueprint-steps">${focus?focus.milestones.slice(0,3).map((m,i)=>`<div class="blueprint-step ${isSettled(m)?'is-done':m===currentMilestone(focus)?'is-next':''}"><span>${isSettled(m)?'✓':count(i+1)}</span><div><b>${esc(m.title)}</b><small>${m.status==='pending'&&m!==currentMilestone(focus)?'Upcoming milestone':labels[m.status]||'Upcoming milestone'}</small></div><strong>${esc(fmt(m.amount))}<small>ETH</small></strong></div>`).join(''):'<div class="intro-empty">Agree. Protect. Deliver.<small>Create an agreement to set your milestones.</small></div>'}</div><div class="blueprint-foot"><span>${focus?`${done} / ${focus.milestones.length} milestones settled`:'Terms → progress → payment'}</span><span>${focus?`${esc(fmt(locked(focus)))} ETH locked`:'Built for both sides'}</span></div></aside>`;
    metrics=[
      {label:'ACTIVE AGREEMENTS',value:count(active.length),note:'With milestones remaining'},
      {label:'HELD IN ESCROW',...money(held),note:'Across agreements in this view'},
      {label:'READY FOR REVIEW',value:count(agreements.filter(a=>currentMilestone(a)?.status==='delivered').length),note:'Deliveries awaiting settlement'},
      {label:'OPEN DISPUTES',value:count(agreements.filter(a=>currentMilestone(a)?.status==='disputed').length),note:'With the agreed arbitrator'},
    ];
  }
  return {
    hero:`<section class="workspace-hero section-intro section-intro--${section}" aria-labelledby="section-intro-heading" data-intro="${section}"><div class="hero-copy"><span class="eyebrow">PACTCHAIN / ${esc(marker)}</span><h1 id="section-intro-heading"><span class="hero-line">${heading[0]}</span><span class="hero-line"><em>${heading[1]}</em></span></h1><p>${copy}</p><div class="intro-signature"><span aria-hidden="true">${section==='withdrawals'?'↗':section==='activity'?'≡':'↔'}</span>${{agreements:'Clear terms. Shared progress.',withdrawals:'Settlement first. Withdrawal next.',activity:'A history you can follow.'}[section]}</div></div>${visual}</section>`,
    stats:`<section class="intro-metrics intro-metrics--${section}" aria-label="${{agreements:'Agreement overview',withdrawals:'Withdrawal overview',activity:'Activity overview'}[section]}">${metrics.map(metric=>`<div class="intro-metric"><span>${metric.label}</span><strong>${esc(metric.value)}${metric.unit?`<small>${esc(metric.unit)}</small>`:''}</strong><p>${metric.note}</p></div>`).join('')}</section>`,
  };
}
