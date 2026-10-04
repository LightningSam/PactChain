import { template } from './content.js';
import { initMotion } from './motion.js';
import { initOrb } from './orb.js';


document.querySelector('#root').innerHTML = template;
const preferences = window.matchMedia('(prefers-reduced-motion: reduce)');
let paused = preferences.matches;
let userOverride = false;
const toggle = document.querySelector('.motion-toggle');
const setMotion = value => {
  paused = value;
  document.documentElement.classList.toggle('motion-paused', value);
  toggle.setAttribute('aria-pressed', String(value));
  toggle.textContent = value ? 'Resume motion' : 'Pause motion';
};
setMotion(paused);
toggle.addEventListener('click', () => { userOverride = true; setMotion(!paused); });
preferences.addEventListener('change',e=>{ if(!userOverride) setMotion(e.matches); });
initOrb(document.querySelector('#orb'),()=>paused);
initMotion(()=>paused);

const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');
const closeMenu = () => { mobileNav.hidden = true; menuToggle.setAttribute('aria-expanded','false'); menuToggle.setAttribute('aria-label','Open menu'); };
menuToggle.addEventListener('click',()=>{
  const open = mobileNav.hidden;
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
mobileNav.querySelectorAll('a,button').forEach(e=>e.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{ if(e.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menuToggle.focus(); } });
window.matchMedia('(min-width: 761px)').addEventListener('change', e=>{ if(e.matches) closeMenu(); });

// Landing actions lead directly to the product workspace.
document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>{window.location.href='/app.html';}));
