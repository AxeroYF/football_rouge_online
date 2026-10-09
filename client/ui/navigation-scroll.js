// Mouse dragging complements native touch/trackpad scrolling. Grid menus keep native scrolling.
export function enableNavigationScroll(nav) {
  if (!nav) return;
  let gesture = null, suppressClick = false;
  const scrollable = () => getComputedStyle(nav).display === 'flex' && nav.scrollWidth > nav.clientWidth + 1;
  nav.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || event.pointerType !== 'mouse' || !scrollable()) return;
    gesture = {id:event.pointerId, x:event.clientX, left:nav.scrollLeft, dragging:false};
  });
  nav.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const delta = event.clientX - gesture.x;
    if (!gesture.dragging && Math.abs(delta) < 6) return;
    gesture.dragging = true;
    nav.setPointerCapture(event.pointerId);
    nav.classList.add('is-nav-dragging');
    nav.scrollLeft = gesture.left - delta;
    event.preventDefault();
  });
  const finish = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    suppressClick = gesture.dragging;
    gesture = null;
    nav.classList.remove('is-nav-dragging');
    if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
  };
  nav.ownerDocument.addEventListener('pointerup', finish);
  nav.ownerDocument.addEventListener('pointercancel', finish);
  nav.addEventListener('lostpointercapture', finish);
  nav.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  nav.addEventListener('dragstart', event => event.preventDefault());
  nav.addEventListener('wheel', event => {
    if (!scrollable() || event.ctrlKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nav.clientWidth : 1;
    nav.scrollLeft += delta * scale;
    event.preventDefault();
  }, {passive:false});
}
