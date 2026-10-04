import { cardNames } from './content.js';

export function initMotion(isPaused) {
  const header = document.querySelector('.header');
  const showcase = document.querySelector('.showcase');
  const sticky = document.querySelector('.showcase-sticky');
  const orbit = document.querySelector('.orbit-stage');
  const cards = [...document.querySelectorAll('.orbit-card')];
  const caption = document.querySelector('#card-caption');
  const number = document.querySelector('#card-number');
  const prev = document.querySelector('.carousel-prev');
  const next = document.querySelector('.carousel-next');
  const manifesto = document.querySelector('.word-reveal');
  const words = manifesto.textContent.trim().split(/\s+/);
  manifesto.innerHTML = words.map(w=>`<span>${w}</span>`).join(' ');
  const wordEls = [...manifesto.querySelectorAll('span')];
  let displayed = -1;
  let queued = false;
  let phase = 0;
  let targetPhase = 0;
  let lastFrame = 0;
  let manualPhase = null;
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const maxPhase = cards.length - 1;
  const update = (now=performance.now()) => {
    queued=false;
    const delta=lastFrame?clamp((now-lastFrame)/1000,0,.05):1/60;
    lastFrame=now;
    header.classList.toggle('scrolled',window.scrollY>40);
    const rect=showcase.getBoundingClientRect();
    const travel=showcase.offsetHeight-sticky.offsetHeight;
    targetPhase=manualPhase ?? clamp(-rect.top/Math.max(1,travel),0,1)*maxPhase;
    if(isPaused()||rect.bottom<0||rect.top>window.innerHeight){phase=targetPhase;}
    else {
      const difference=targetPhase-phase;
      const eased=difference*(1-Math.exp(-delta/.34));
      const limit=delta*(manualPhase===null?1.35:1.6);
      phase+=clamp(eased,-limit,limit);
      if(Math.abs(targetPhase-phase)<.001)phase=targetPhase;
    }
    const active=clamp(Math.round(phase),0,maxPhase);
    if(displayed!==active){
      displayed=active;
      number.textContent=String(active+1).padStart(2,'0');
      caption.textContent=cardNames[active];
    }
    const requested=clamp(Math.round(targetPhase),0,maxPhase);
    prev.disabled=requested===0;
    next.disabled=requested===maxPhase;
    const mobile=window.innerWidth<=760;
    const radius=mobile?380:Math.min(window.innerWidth*.5,760);
    cards.forEach((card,i)=>{
      const distance=i-phase;
      // Fit the card to the grid row left after the heading and controls, including at zoom.
      const fit=Math.max(.1,Math.min(1,(orbit.clientHeight-48)/card.offsetHeight));
      if(isPaused()){
        card.style.transform=`translate(-50%,-50%) scale(${fit})`;
        card.style.opacity=i===active?'1':'0';
        card.style.filter='none';
        card.style.visibility=i===active?'visible':'hidden';
        card.style.zIndex=i===active?'10':'0';
      }else{
        const angle=distance*.93;
        const x=Math.sin(clamp(angle,-Math.PI,Math.PI))*radius;
        const z=(Math.cos(clamp(angle,-Math.PI,Math.PI))-1)*radius*.95;
        const turn=-clamp(angle,-1.7,1.7)*36;
        const visible=Math.abs(distance)<3.15;
        card.style.transform=`translate(-50%,-50%) translate3d(${x}px,${Math.abs(distance)*9}px,${z}px) rotateY(${turn}deg) scale(${fit})`;
        card.style.opacity=visible?'1':'0';
        card.style.filter=`brightness(${clamp(1-Math.abs(distance)*.16,.5,1)})`;
        card.style.visibility=visible?'visible':'hidden';
        card.style.zIndex=String(10-Math.round(Math.abs(distance)*2));
      }
      card.setAttribute('aria-hidden',String(i!==active));
    });
    const mr=manifesto.getBoundingClientRect();
    const reveal=clamp((window.innerHeight*.83-mr.top)/(mr.height+window.innerHeight*.28),0,1);
    wordEls.forEach((el,i)=>el.classList.toggle('lit',isPaused()||i/wordEls.length<reveal));
    if(Math.abs(targetPhase-phase)>.001)schedule();
  };
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(update);}};
  const goTo = i => {
    manualPhase=clamp(i,0,maxPhase);
    targetPhase=manualPhase;
    schedule();
  };
  const returnToScroll=()=>{manualPhase=null;schedule();};
  prev.addEventListener('click',()=>goTo(Math.round(targetPhase)-1));
  next.addEventListener('click',()=>goTo(Math.round(targetPhase)+1));
  orbit.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'){e.preventDefault();goTo(Math.round(targetPhase)+1);}
    if(e.key==='ArrowLeft'){e.preventDefault();goTo(Math.round(targetPhase)-1);}
    if(e.key==='Home'){e.preventDefault();goTo(0);}
    if(e.key==='End'){e.preventDefault();goTo(maxPhase);}
  });
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('wheel',returnToScroll,{passive:true});
  window.addEventListener('touchmove',returnToScroll,{passive:true});
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',returnToScroll));
  window.addEventListener('resize',schedule);
  new ResizeObserver(schedule).observe(orbit);
  document.querySelector('.motion-toggle').addEventListener('click',schedule);
  window.matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',schedule);
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);}}),{threshold:.12});
  document.querySelectorAll('.reveal').forEach(e=>observer.observe(e));
  update();
}
