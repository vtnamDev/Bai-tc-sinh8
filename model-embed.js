(() => {
  'use strict';

  let apiPromise = null;

  function loadSketchfabApi() {
    if (typeof window.Sketchfab === 'function') return Promise.resolve(window.Sketchfab);
    if (apiPromise) return apiPromise;

    apiPromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-biosphere-sketchfab-api]');
      const created = !script;
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
        script.async = true;
        script.dataset.biosphereSketchfabApi = 'true';
      }

      let settled = false;
      let timeoutId = 0;
      const finish = error => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
        if (error) reject(error);
        else if (typeof window.Sketchfab === 'function') resolve(window.Sketchfab);
        else reject(new Error('Sketchfab API did not initialize'));
      };
      const onLoad = () => finish();
      const onError = () => finish(new Error('Sketchfab API failed to load'));
      timeoutId = window.setTimeout(() => finish(new Error('Sketchfab API timed out')), 10000);
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      if (created) document.head.appendChild(script);
    }).catch(error => {
      apiPromise = null;
      document.querySelector('script[data-biosphere-sketchfab-api]')?.remove();
      throw error;
    });

    return apiPromise;
  }

  function emitViewerState(frame, eventName) {
    if (frame.isConnected) frame.dispatchEvent(new Event(eventName));
  }

  window.BioSphereModelEmbed = (panel, source, title) => {
    const url = new URL(source, location.href);
    const match = url.pathname.match(/^\/models\/([a-f0-9]{32})\/embed\/?$/i);
    if (url.origin !== 'https://sketchfab.com' || !match) {
      throw new Error('Unsupported model URL');
    }

    const slot = panel.querySelector('.anatomy3d-native-slot');
    if (!slot) throw new Error('Missing model slot');

    const frame = document.createElement('iframe');
    frame.className = 'anatomy3d-embed-viewer';
    frame.src = 'about:blank';
    frame.title = String(title || 'Mô hình giải phẫu 3D');
    frame.loading = 'eager';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; fullscreen; xr-spatial-tracking';
    frame.allowFullscreen = true;
    frame.setAttribute('allowtransparency', 'true');
    slot.replaceChildren(frame);

    loadSketchfabApi().then(Sketchfab => {
      if (!panel.isConnected || !frame.isConnected) return;
      try {
        const client = new Sketchfab('1.12.1', frame);
        client.init(match[1], {
          autostart: 1,
          ui_theme: 'light',
          ui_infos: 0,
          ui_controls: 1,
          ui_hint: 0,
          ui_watermark: 1,
          dnt: 1,
          success(api) {
            if (!frame.isConnected) return;
            api.addEventListener('viewerready', () => emitViewerState(frame, 'biosphere-viewer-ready'));
            api.start();
          },
          error() {
            emitViewerState(frame, 'biosphere-viewer-error');
          }
        });
      } catch {
        emitViewerState(frame, 'biosphere-viewer-error');
      }
    }).catch(() => emitViewerState(frame, 'biosphere-viewer-error'));

    return frame;
  };
})();
