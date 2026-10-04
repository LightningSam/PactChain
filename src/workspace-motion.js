// Presentation only: no wallet, agreement or transaction state is changed here.
export function createWorkspaceMotion(root) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const order = ['agreements', 'withdrawals', 'activity'];
  const animations = new Set();
  const normalize = view => view === 'overview' ? 'agreements' : view;
  let renderedView = null;
  let resizeObserver = null;

  function play(element, frames, options) {
    if (!element || preference.matches || !element.animate) return;
    const animation = element.animate(frames, {
      duration: 430, easing: 'cubic-bezier(.22, 1, .36, 1)', ...options,
    });
    animations.add(animation);
    animation.finished.then(
      () => animations.delete(animation),
      () => animations.delete(animation),
    );
  }

  function stop() {
    for (const animation of animations) animation.cancel();
    animations.clear();
  }

  function capture() {
    const nav = root.querySelector('.workspace-nav');
    const slider = nav?.querySelector('.nav-slider');
    const navRect = nav?.getBoundingClientRect();
    const sliderRect = slider?.getBoundingClientRect();
    const previous = sliderRect ? {
      left: sliderRect.left - navRect.left,
      width: sliderRect.width,
      navWidth: navRect.width,
    } : null;
    // Capture the visible position before cancellation, including a rapid mid-slide click.
    stop();
    resizeObserver?.disconnect();
    return previous;
  }

  function positionSlider(nav, slider) {
    const active = nav.querySelector('[aria-current="page"]');
    if (!active) return;
    const padding = getComputedStyle(active);
    const insetLeft = parseFloat(padding.paddingLeft) || 0;
    const insetRight = parseFloat(padding.paddingRight) || 0;
    const left = active.offsetLeft + insetLeft;
    const width = Math.max(0, active.getBoundingClientRect().width - insetLeft - insetRight);
    slider.style.left = `${left}px`;
    slider.style.width = `${width}px`;
    return { left, width };
  }

  function update(view, previous) {
    const current = normalize(view);
    const changed = renderedView !== null && renderedView !== current;
    const direction = order.indexOf(current) >= order.indexOf(renderedView) ? 1 : -1;
    const nav = root.querySelector('.workspace-nav');
    const slider = nav?.querySelector('.nav-slider');
    if (nav && slider) {
      const target = positionSlider(nav, slider);
      if (changed && target && previous && Math.abs(previous.navWidth - nav.getBoundingClientRect().width) < 2) {
        play(slider, [
          { left: `${previous.left}px`, width: `${previous.width}px` },
          { left: `${target.left}px`, width: `${target.width}px` },
        ], { duration: 380 });
      }
      // Recompute the underline when fonts finish loading or the responsive layout changes.
      resizeObserver = new ResizeObserver(() => positionSlider(nav, slider));
      resizeObserver.observe(nav);
      for (const button of nav.querySelectorAll('button')) resizeObserver.observe(button);
    }

    if (changed) {
      play(root.querySelector('.hero-copy > .eyebrow'), [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 280 });
      root.querySelectorAll('.hero-line').forEach((line, index) => play(line, [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: index * 55, fill: 'backwards', duration: 460 }));
      play(root.querySelector('.hero-copy > p'), [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: 90, fill: 'backwards', duration: 360 });
      play(root.querySelector('.intro-visual'), [
        {opacity:0,transform:`translateX(${direction*20}px) translateY(8px)`},
        {opacity:1,transform:'translateX(0) translateY(0)'},
      ], {duration:480,delay:45,fill:'backwards'});
      root.querySelectorAll('.intro-metric').forEach((metric,index)=>play(metric,[
        {opacity:0,transform:'translateY(8px)'},
        {opacity:1,transform:'translateY(0)'},
      ],{duration:340,delay:35+index*35,fill:'backwards'}));

      const panel = root.querySelector('.workspace-view-panel');
      play(panel, [
        { opacity: 0.15, transform: `translateX(${direction * 18}px) translateY(6px)` },
        { opacity: 1, transform: 'translateX(0) translateY(0)' },
      ], { duration: 430 });
      panel?.querySelectorAll('.pact-card, .new-pact-card, .withdrawal-receipt, .activity-row')
        .forEach((item, index) => {
          if (index >= 12) return;
          play(item, [
            { opacity: 0, transform: 'translateY(12px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], { delay: 60 + Math.min(index, 5) * 28, fill: 'backwards', duration: 350 });
        });
    }
    renderedView = current;
  }

  preference.addEventListener('change', () => {
    if (preference.matches) stop();
  });
  return { capture, update };
}
