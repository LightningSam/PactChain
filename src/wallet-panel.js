import {formatAmount,chainError} from './chain-client.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = address => `${address.slice(0,6)}…${address.slice(-4)}`;
export const walletBalanceLabel = value => {
  const [whole, fraction = ''] = formatAmount(value ?? 0n).split('.');
  return `${whole}${fraction ? '.' + fraction.slice(0,4) : ''}`;
};

export function createWalletPanel({client,onConnected,onDisconnect,onCreate,onAgreement,onSelectTestAccount}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'wallet-dialog';
  dialog.setAttribute('aria-labelledby','wallet-heading');
  document.body.append(dialog);
  let provider = 'local', generation = 0, connecting = false, resumeCreate = false, resumeAgreement = null;
  let accounts = [], loading = false, error = '';

  const fallbackAccounts = [
    { address: '0x1111111111111111111111111111111111111111', role: 'buyer', name: 'Buyer account', balance: 1000n * 10n**18n },
    { address: '0x2222222222222222222222222222222222222222', role: 'seller', name: 'Seller account', balance: 1000n * 10n**18n },
    { address: '0x3333333333333333333333333333333333333333', role: 'arbiter', name: 'Arbitrator account', balance: 1000n * 10n**18n },
  ];

  function render() {
    const connected = Boolean(client.account);
    dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">PACTCHAIN / YOUR CONNECTION</span><h2 id="wallet-heading">${connected?'One wallet. Your next move.':'Your wallet. Your next step.'}</h2></div><button data-wallet-close aria-label="Close wallet panel" ${connecting?'disabled':''}>×</button></div>
      <div class="wallet-panel-body"><p class="wallet-intro">${resumeCreate?'Connect an account to continue creating your agreement.':'Connect to create agreements, deliver work and collect payments.'}</p>
      ${connected?`<div class="connected-wallet"><span class="account-avatar">${client.walletKind==='local'?(client.walletLabel?.[0]||'T'):'M'}</span><div><b>${esc(client.walletLabel)}</b><code>${esc(short(client.account))}</code></div><span class="connection-tag">Connected</span></div>`:''}
      <div class="wallet-provider-tabs" role="group" aria-label="Wallet provider"><button data-wallet-provider="local" aria-pressed="${provider==='local'}" ${connecting?'disabled':''}>Local test wallet<span>No extension needed</span></button><button data-wallet-provider="metamask" aria-pressed="${provider==='metamask'}" ${connecting?'disabled':''}>MetaMask<span>Your browser wallet</span></button></div>
      ${provider==='local'?`<div class="wallet-environment"><i></i>Local test wallet · Test ETH</div><p class="wallet-help">Funded test accounts ${client.localEnabled?'on your local blockchain':'ready to test in your browser'}. Account names help the demo; each agreement determines your permissions.</p><div class="wallet-accounts" role="group" aria-label="Local test accounts" aria-busy="${loading}">${loading?'<p class="wallet-loading" role="status">Reading accounts…</p>':accounts.map(account=>`<button class="wallet-account ${account.address.toLowerCase()===client.account?.toLowerCase()?'is-connected':''}" aria-pressed="${account.address.toLowerCase()===client.account?.toLowerCase()}" data-local-account="${esc(account.address)}" ${connecting?'disabled':''}><span class="account-avatar">${account.name[0]}</span><span class="account-info"><b>${esc(account.name)}</b><code>${esc(short(account.address))}</code></span><span class="account-funds"><b>${walletBalanceLabel(account.balance)}</b><small>test ETH</small></span><span class="account-arrow" aria-hidden="true">${account.address.toLowerCase()===client.account?.toLowerCase()?'✓':'↗'}</span></button>`).join('')}</div>${!loading&&!accounts.length?'<button class="ghost wide-button" data-wallet-retry>Retry local connection ↻</button>':''}<p class="wallet-footnote">${client.localEnabled?'Actual contract transactions. No real-money value. The local blockchain must stay running.':'Interactive test accounts. No browser extension required.'}</p>`:
      `<div class="metamask-intro"><span class="account-avatar">M</span><h3>Connect with MetaMask.</h3><p>Approve the connection in your browser wallet. You will approve each transaction separately.</p><button class="primary wide-button" data-connect-metamask ${!client.injectedEthereum?.request||connecting?'disabled':''}>${connecting?'Connecting…':'Connect MetaMask ↗'}</button>${!client.injectedEthereum?.request?`<p class="wallet-help">MetaMask is unavailable in this browser. Choose Local test wallet to test without an extension.</p>`:''}</div>`}
      <p class="wallet-error" role="alert" ${error?'':'hidden'}>${esc(error)}</p><p class="wallet-connection-status" role="status">${connecting?'Connecting account and loading your agreements…':''}</p>
      ${connected?`<div class="wallet-panel-footer"><span>Connected account controls your actions.</span><button class="text-button danger" data-wallet-disconnect ${connecting?'disabled':''}>Disconnect</button></div>`:''}
      </div>`;
  }
  async function loadAccounts() {
    const token = ++generation;
    loading = true;error = '';accounts = [];render();
    try {
      if (client.localEnabled) {
        const next = await client.listLocalAccounts();
        if(token===generation)accounts=next;
      } else {
        accounts = fallbackAccounts;
        client.localAccounts = fallbackAccounts;
      }
    } catch(cause){
      if(token===generation) {
        // Fallback to built-in test accounts so the user can always proceed
        accounts = fallbackAccounts;
        client.localAccounts = fallbackAccounts;
      }
    } finally{if(token===generation){loading=false;render();}}
  }
  async function connect(address) {
    if(connecting||client.busy)return;
    connecting=true;error='';render();
    try {
      if(address){
        if (client.localEnabled) {
          await client.connectLocal(address);
          await onConnected();
        } else {
          client.account = address;
          client.walletKind = 'local';
          if (!client.localAccounts || !client.localAccounts.length) {
            client.localAccounts = fallbackAccounts;
          }
          if (onSelectTestAccount) {
            await onSelectTestAccount(address);
          } else {
            await onConnected();
          }
        }
      } else {
        await client.connect();
        await onConnected();
      }
      if(!client.account)throw new Error('No wallet account was connected. Try again.');
      // Refresh the workspace before closing, so the account switch is visible immediately.
      const continueCreate=resumeCreate;
      const agreementId=resumeAgreement;
      connecting=false;dialog.close();
      if(continueCreate)onCreate();else if(agreementId)onAgreement(agreementId);
      else document.querySelector('.workspace-header [data-wallet]')?.focus({preventScroll:true});
    }catch(cause){error=chainError(cause);connecting=false;render();}
  }
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-wallet-close')){if(!connecting)dialog.close();return;}
    if(button.dataset.walletProvider){if(connecting)return;provider=button.dataset.walletProvider;error='';generation++;loading=false;render();if(provider==='local')loadAccounts();return;}
    if(button.dataset.localAccount){connect(button.dataset.localAccount);return;}
    if(button.hasAttribute('data-connect-metamask')){connect();return;}
    if(button.hasAttribute('data-wallet-retry')){loadAccounts();return;}
    if(button.hasAttribute('data-wallet-disconnect')){if(connecting||client.busy)return;onDisconnect();dialog.close();}
  });
  dialog.addEventListener('cancel',event=>{if(connecting)event.preventDefault();});
  dialog.addEventListener('close',()=>{generation++;resumeCreate=false;resumeAgreement=null;});
  return {
    open(options={}){
      if(client.busy)return;
      resumeCreate=Boolean(options.resumeCreate);resumeAgreement=options.agreementId||null;provider=client.walletKind==='metamask'?'metamask':'local';error='';accounts=[];loading=false;
      render();if(!dialog.open)dialog.showModal();if(provider==='local')loadAccounts();
    },
    close(){if(!connecting)dialog.close();},
  };
}
