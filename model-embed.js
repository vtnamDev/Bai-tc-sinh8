(() => {
'use strict';
window.BioSphereModelEmbed=(panel,source,title)=>{
const url=new URL(source,location.href);
if(url.origin!=='https://sketchfab.com'||!/^\/models\/[a-f0-9]{32}\/embed\/?$/i.test(url.pathname))throw new Error('Unsupported model URL');
const slot=panel.querySelector('.anatomy3d-native-slot');if(!slot)throw new Error('Missing model slot');
const frame=document.createElement('iframe');frame.className='anatomy3d-embed-viewer';frame.src=url.href;frame.title=String(title||'Mô hình giải phẫu 3D');frame.loading='eager';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='autoplay; fullscreen; xr-spatial-tracking';frame.allowFullscreen=true;frame.setAttribute('allowtransparency','true');slot.replaceChildren(frame);return frame;
};
})();
