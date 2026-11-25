import React, { useEffect, useRef } from 'react';

type Frame = { id: string; storyId: string; x: number; y: number; el: HTMLDivElement; teardown?: () => Promise<void> };

declare global {
  interface Window {
    __STORYBOOK_PREVIEW__: any;
    spike: any;
  }
}

function Board() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d') as any;
    const dpr = window.devicePixelRatio;
    const W = 1100, H = 700;
    c.width = W * dpr; c.height = H * dpr;
    const view = { panX: 20, panY: 20, zoom: 1 };
    const frames: Frame[] = [];
    const log: any[] = [];
    let hovered: Element | null = null;
    const geomMode = new URLSearchParams(location.search).get('geom') || 'sized';

    const toWorld = (clientX: number, clientY: number) => {
      const r = c.getBoundingClientRect();
      return { x: (clientX - r.left - view.panX) / view.zoom, y: (clientY - r.top - view.panY) / view.zoom };
    };

    c.onpaint = () => {
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.translate(view.panX, view.panY);
      ctx.scale(view.zoom, view.zoom);
      for (const f of frames) {
        try {
          if (geomMode === 'auto') ctx.drawElementImage(f.el, f.x, f.y);
          // Default draw size is the element's size in canvas *grid* (device) pixels, so with ctx.scale(dpr)
          // we must pass the CSS layout size explicitly. Automatic geometry then matches what was drawn.
          else if (geomMode === 'sized') ctx.drawElementImage(f.el, f.x, f.y, f.el.offsetWidth, f.el.offsetHeight);
          else {
            ctx.drawElementImage(f.el, f.x, f.y, { preserveElementGeometry: true });
            c.updateElementGeometry(f.el, {
              canvasTransform: new DOMMatrix().translate(view.panX, view.panY).scale(view.zoom).translate(f.x, f.y),
            });
          }
        } catch (err) {
          log.push(['paint-error', f.storyId, String(err)]);
        }
        ctx.strokeStyle = '#1ea7fd';
        ctx.lineWidth = 1 / view.zoom;
        ctx.strokeRect(f.x, f.y, f.el.offsetWidth, f.el.offsetHeight);
      }
      if (hovered) {
        // Outline the hovered DOM node: map its rect (in drawn space) back into world coordinates.
        const r = hovered.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = '#ff4785';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.left - cr.left, r.top - cr.top, r.width, r.height);
        ctx.restore();
      }
    };

    async function addStory(storyId: string, x: number, y: number) {
      const preview = window.__STORYBOOK_PREVIEW__;
      // Storybook 11: `loadStory` and `renderStoryToElement` are public methods of the preview
      // (PreviewWeb); `storyStoreValue` is protected, so do not reach into it.
      const story = await preview.loadStory({ storyId });
      const el = document.createElement('div');
      el.setAttribute('drawable', '');
      el.dataset.storyId = storyId;
      el.style.cssText = 'width:max-content;min-width:200px;max-width:900px;background:#fff;padding:0';
      const inner = document.createElement('div');
      el.appendChild(inner);
      c.appendChild(el);
      const frame: Frame = { id: `${storyId}-${frames.length}`, storyId, x, y, el };
      frames.push(frame);
      frame.teardown = preview.renderStoryToElement(
        story,
        inner,
        { showMain() {}, showError(e: any) { log.push(['showError', storyId, e?.title]); }, showException(e: any) { log.push(['showException', storyId, String(e)]); } },
        { autoplay: true, forceInitialArgs: false },
      );
      c.requestPaint();
      return frame.id;
    }

    // Hover / click hit-testing reaches real story DOM nodes.
    const onMove = (e: PointerEvent) => {
      const t = e.target as Element;
      const next = t && t !== c && c.contains(t) ? t : null;
      if (next !== hovered) { hovered = next; c.requestPaint(); }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      const frameEl = t.closest('[data-story-id]') as HTMLElement | null;
      log.push(['click', frameEl?.dataset.storyId ?? null, t.tagName, (t.textContent || '').trim().slice(0, 40), Math.round(e.clientX), Math.round(e.clientY)]);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);

    // Pan with the wheel, zoom with ctrl+wheel (pinch).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const r = c.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const z = Math.min(4, Math.max(0.2, view.zoom * Math.exp(-e.deltaY / 200)));
        view.panX = px - ((px - view.panX) * z) / view.zoom;
        view.panY = py - ((py - view.panY) * z) / view.zoom;
        view.zoom = z;
      } else { view.panX -= e.deltaX; view.panY -= e.deltaY; }
      c.requestPaint();
    };
    c.addEventListener('wheel', onWheel, { passive: false });

    // (c) Drop target for sidebar drags.
    const onDragOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; log.push(['dragover-types', [...(e.dataTransfer?.types ?? [])]].flat().slice(0, 4)); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData('application/x-storybook-story') || e.dataTransfer?.getData('text/plain');
      const p = toWorld(e.clientX, e.clientY);
      log.push(['drop', id, Math.round(p.x), Math.round(p.y)]);
      if (id) addStory(id, p.x, p.y);
    };
    c.addEventListener('dragover', onDragOver);
    c.addEventListener('drop', onDrop);

    window.spike = {
      addStory, frames, log, view,
      setView(v: Partial<typeof view>) { Object.assign(view, v); c.requestPaint(); },
      // screen point (client coords) for an element inside a frame, using the drawn transform
      // Expected screen point from the board model + layout offsets only (independent of canvas geometry),
      // plus the canvas pixel drawn there, to check drawing and hit-testing agree with the model.
      modelPointOf(selector: string, frameIndex = 0, inset = 0.5) {
        const f = frames[frameIndex];
        const t = f.el.querySelector(selector) as HTMLElement;
        let ox = 0, oy = 0;
        for (let n: HTMLElement | null = t; n && n !== f.el; n = n.offsetParent as HTMLElement | null) { ox += n.offsetLeft; oy += n.offsetTop; }
        const cr = c.getBoundingClientRect();
        const wx = f.x + ox + t.offsetWidth * inset, wy = f.y + oy + t.offsetHeight * inset;
        const cx = view.panX + view.zoom * wx, cy = view.panY + view.zoom * wy;
        const px = Array.from(ctx.getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data).slice(0, 3);
        return { x: cr.left + cx, y: cr.top + cy, pixel: px, offsetParentOk: true };
      },
      defaultSize(i = 0) { return c.getElementImageDefaultSize(frames[i].el); },
      screenPointOf(selector: string, frameIndex = 0) {
        const f = frames[frameIndex];
        const t = f.el.querySelector(selector) as HTMLElement;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: [r.left, r.top, r.width, r.height] };
      },
    };
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      frames.forEach((f) => f.teardown?.());
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      {...({ content: 'drawable' } as any)}
      style={{ display: 'block', width: 1100, height: 700, background: '#f6f9fc', outline: '1px solid #ddd' }}
    />
  );
}

export default { title: 'Spike/Board', parameters: { layout: 'fullscreen' } };
export const Default = { render: () => <Board /> };
