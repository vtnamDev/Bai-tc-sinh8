import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, app, deckSource, css, serviceWorker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../bai32-deck.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
]);

// Guard against accidental bundle growth. These are source-size budgets, not gzip estimates.
const sourceBudgets = [
  ['app.js', app, 168 * 1024],
  ['styles.css', css, 220 * 1024],
  ['bai32-deck.js', deckSource, 75 * 1024],
  ['service-worker.js', serviceWorker, 8 * 1024],
];
for (const [name, source, limit] of sourceBudgets) {
  const bytes = Buffer.byteLength(source, 'utf8');
  assert.ok(bytes <= limit, `${name} exceeds its source budget: ${bytes} bytes > ${limit} bytes`);
}
const totalSourceBytes = sourceBudgets.reduce((sum, [, source]) => sum + Buffer.byteLength(source, 'utf8'), 0);
assert.ok(totalSourceBytes <= 470 * 1024, `Combined JS/CSS source exceeds 470 KiB: ${totalSourceBytes} bytes`);
assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/, 'Mobile safe-area layout must remain enabled.');
assert.match(html, /<script[^>]+defer/, 'Application scripts should be deferred to avoid blocking HTML parsing.');
assert.ok(!/<link[^>]+rel=["']preload["'][^>]+href=["'][^"']+\\.(?:mp4|webm|glb)(?:[?"']|$)/i.test(html), 'Large video/model assets must not be eagerly preloaded.');


// Parse the bundled deck without executing application code in a browser.
const context = { window: {} };
vm.runInNewContext(deckSource, context, { filename: 'bai32-deck.js', timeout: 1000 });
const deck = context.window.BIOSPHERE_BAI32_SEED;

assert.ok(deck && typeof deck === 'object', 'The bundled seed deck must exist.');
assert.equal(deck.slides.length, 25, 'The lesson deck should contain 25 slides.');
assert.ok(deck.slides.every(slide => slide && typeof slide.title === 'string'), 'Every slide needs a title.');
assert.equal(deck.slides.filter(slide => typeof slide.keyIdea === 'string' && slide.keyIdea.length > 20).length, 25, 'Every slide must declare one concise core idea.');
const chapterPalettes = new Map();
for (const slide of deck.slides) {
  assert.ok(typeof slide.storyGroup === 'string' && slide.storyGroup.length > 0, `Slide is missing its story group: ${slide.title}`);
  assert.ok(typeof slide.palette === 'string' && slide.palette.length > 0, `Slide is missing its chapter palette: ${slide.title}`);
  if (chapterPalettes.has(slide.storyGroup)) {
    assert.equal(slide.palette, chapterPalettes.get(slide.storyGroup), `Slides inside "${slide.storyGroup}" must use a consistent palette.`);
  } else chapterPalettes.set(slide.storyGroup, slide.palette);
}
assert.equal(chapterPalettes.size, 8, 'Expected coherent story groups for the introduction, five diseases, recap and close.');
assert.equal(deck.slides.filter(slide => slide.classroomPrompt).length, 5, 'Keep one case question for each of the five diseases.');
for (const slide of deck.slides.filter(item => item.classroomPrompt)) {
  const prompt = slide.classroomPrompt;
  assert.ok(Array.isArray(prompt.options) && prompt.options.length === 4, `Each disease case needs four answer choices: ${slide.title}`);
  assert.ok(Number.isInteger(prompt.correctIndex) && prompt.correctIndex >= 0 && prompt.correctIndex < prompt.options.length, `Invalid case quiz answer: ${slide.title}`);
  assert.ok(typeof prompt.explanation === 'string' && prompt.explanation.length > 20, `Case quiz needs explanatory feedback: ${slide.title}`);
}
assert.equal(deck.slides.filter(slide => slide.model3D).length, 5, 'Keep the five curated 3D scenes.');
const flowSlides = deck.slides.filter(slide => slide.flowVisual);
assert.equal(flowSlides.length, 5, 'Each disease scene should include a lightweight process diagram.');
assert.ok(flowSlides.every(slide => typeof slide.flowVisual.label === 'string' && Array.isArray(slide.flowVisual.steps) && slide.flowVisual.steps.length === 3 && slide.flowVisual.steps.every(step => typeof step === 'string')), 'Process diagram data must contain three labeled steps.');
const quizSlides = deck.slides.filter(slide => slide.interactiveQuiz);
assert.equal(quizSlides.length, 2, 'Keep the interactive review and final quiz.');
assert.equal(quizSlides.reduce((total, slide) => total + (slide.quizQuestions?.length || 0), 0), 8, 'Quiz question count changed; review the teaching flow.');

const urlKeys = [
  'image', 'imageFallback', 'imageSourceUrl', 'video', 'video4k',
  'videoSourceUrl', 'modelSrc', 'modelSourceUrl', 'modelLicense',
];
const resources = [];
for (const [index, slide] of deck.slides.entries()) {
  for (const key of urlKeys) {
    if (slide[key]) resources.push({ location: `slide ${index + 1} ${key}`, value: slide[key] });
  }
  for (const [imageIndex, image] of (slide.supportImages || []).entries()) {
    for (const key of ['url', 'sourceUrl']) {
      if (image?.[key]) resources.push({ location: `slide ${index + 1} supportImages[${imageIndex}].${key}`, value: image[key] });
    }
  }
  for (const [linkIndex, link] of (slide.links || []).entries()) {
    if (link?.url) resources.push({ location: `slide ${index + 1} links[${linkIndex}].url`, value: link.url });
  }
}
for (const resource of resources) {
  assert.match(resource.value, /^https?:\/\//i, `Expected a web URL for ${resource.location}`);
  const parsed = new URL(resource.value);
  assert.ok(['http:', 'https:'].includes(parsed.protocol), `Unsafe protocol at ${resource.location}`);
  assert.equal(parsed.username + parsed.password, '', `Credentials are not allowed in ${resource.location}`);
}

const versionFor = asset => {
  const match = html.match(new RegExp(`(?:src|href)="[^"]*${asset}\\?v=([^"]+)"`));
  assert.ok(match, `Missing cache-busted asset reference for ${asset}`);
  return match[1];
};
const assetVersions = ['styles.css', 'bai32-deck.js', 'app.js'].map(versionFor);
assert.equal(new Set(assetVersions).size, 1, 'CSS, deck data and app code must use the same cache-busting version.');
const workerVersion = serviceWorker.match(/const SHELL_VERSION = '([^']+)'/)?.[1];
assert.equal(workerVersion, assetVersions[0], 'The service-worker shell cache must match the current HTML asset version.');
assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'CSS block braces must remain balanced.');

assert.match(app, /function safeHttpUrl\(/, 'Imported resource URLs must be protocol-checked.');
assert.match(app, /function optimizeImageUrl\(/, 'Remote image sizes must be adapted to viewport and performance profile.');
assert.match(app, /function renderSlideVisualBoard\(/, 'Every lesson page should have an editorial visual board renderer.');
assert.ok(app.includes('const keyIdeaHtml =') && app.includes('class="slide-key-idea"') && app.includes('class="slide-support-ideas"'), 'The slide must distinguish the core idea from supporting details.');
assert.ok(app.includes('const motionBridge =') && app.includes('data-story-group=') && app.includes('data-motion-bridge='), 'Slides must carry chapter identity so motion transitions can connect related pages.');
assert.ok(css.includes('.editorial-diagram') && css.includes('.editorial-diagram-node'), 'The lesson diagrams must have dedicated responsive styling.');
assert.ok(css.includes('BioSphere v12 — story palette'), 'The chapter palette and idea-hierarchy design system must be present.');
assert.ok(css.includes('.slide-key-idea') && css.includes('.slide-point--support'), 'Core and supporting idea cards must have distinct styles.');
assert.ok(css.includes('story-continuity-in') && css.includes('story-chapter-in'), 'Transitions must distinguish continuity within a chapter from motion between chapters.');
assert.ok(css.includes('BioSphere v13 — one live slide'), 'The low-latency single-surface motion pass must be present.');
assert.ok(css.includes('story-continuity-single') && css.includes('story-chapter-single'), 'Incoming-only motion must use fast continuity and chapter transitions.');
assert.ok(css.includes('HDMI / TV projector canvas') && css.includes('.viewer.projector-mode #slideStage'), 'The desktop HDMI projector canvas must have a dedicated responsive layout.');
assert.ok(css.includes('.viewer-projector-control') && css.includes('projector-mode .viewer-bottom'), 'Projector controls and the progress overlay must remain styled in fullscreen.');
assert.ok(css.includes('.live-photo{') && css.includes('data-motion-bridge="instant"]'), 'Photos must remain crisp and reveal-only navigation must avoid entrance animation.');
assert.ok(css.includes('BioSphere v10 — editorial slide system'), 'The consolidated responsive slide system must be active.');
assert.ok(!css.includes('The actual webview in the supplied screenshot is ~720 CSS px wide.'), 'The obsolete mobile rule that turns the photo into a full-slide background must stay removed.');
assert.ok(!/\.viewer \.slide-side-content\s*\{\s*position:absolute!important;z-index:0/.test(css), 'Mobile media must remain a separate layout column instead of a background layer.');
assert.ok(app.includes('photo-support-label'), 'Related images need visible labels, not only hidden alt text.');
assert.ok(app.includes('editorial-map-core'), 'The overview slide needs a real central-node mind map.');
assert.ok(app.includes('source[data-src]') && app.includes('video.load()'), 'MP4 source URLs must be attached only when motion is eligible.');
assert.ok(app.includes('lineBuckets') && app.includes('dotBuckets'), 'Canvas particles must batch draw calls instead of stroking each edge and dot independently.');
assert.ok(!app.includes('previousPage.cloneNode(true)') && !app.includes('stage.appendChild(ghost)'), 'Slide transitions must replace the old page immediately and never render two full-size slides.');
assert.ok(app.includes('let warmedPhotoAssets = new Map();') && app.includes('preload.decode().catch(() => {})'), 'Adjacent photos should be prewarmed and decoded before a fast tap.');
assert.ok(app.includes('function toggleProjectorMode()') && app.includes("if (target.id === 'viewerProjector')"), 'The viewer must offer a dedicated HDMI/TV projector mode.');
assert.ok(app.includes('function syncFullscreenControls()') && app.includes("document.addEventListener('fullscreenchange'"), 'Fullscreen button state must track the browser fullscreen state.');
assert.ok(app.includes('upgradeProjectorImages()') && app.includes('profile.projectorMode && performanceMode === \'cinema\' ? 2880 : 1920'), 'Projector mode should upgrade the visible photo to a higher-resolution source.');
assert.ok(app.includes('const frameInterval = performanceMode === \'cinema\' && window.innerWidth >= 1000 ? 1000 / 60 : 1000 / 30'), 'Desktop cinema mode should render ambient canvas effects at up to 60 FPS.');
assert.ok(app.includes('const canvasPixelRatioLimit = profile.projectorMode && atmosphereWidth >= 3000 ? 1 : profile.maxPixelRatio'), 'A 4K/8K projector viewport must not allocate an oversized high-DPI ambient canvas.');
assert.ok(app.includes('const dprLimit = profile.slowConnection ? 1.5 : 2.25'), 'Image target size must account for physical pixel density.');
assert.ok(app.includes('}, 80);'), 'Image prewarming should start early enough for the next slide.');
assert.ok(app.includes("target.matches('[data-case-answer]')"), 'Each disease case must support immediate interactive answer feedback.');
assert.match(app, /function isValidDeckShape\(/, 'Imported deck structure must be validated.');
assert.match(app, /threeLoadPromise = null;/, 'The Three.js loader should be retryable after a CDN failure.');
assert.match(app, /modelViewerLoadPromise = null;/, 'The model-viewer loader should be retryable after a CDN failure.');
assert.ok(!app.includes(`data-fallback="' + fallback + '"`), 'Fallback URLs must be escaped before entering HTML attributes.');
assert.match(css, /prefers-reduced-motion\s*:\s*reduce/, 'Reduced-motion preferences must be supported.');
assert.match(css, /@media\s*\(max-width:\s*600px\)/, 'The compact mobile layout must remain present.');

assert.ok(html.includes('data-performance-mode="auto"'), 'The automatic performance preset must be available in settings.');
assert.ok(html.includes('data-performance-mode="smooth"') && html.includes('data-performance-mode="cinema"'), 'All three performance presets must be present.');
assert.ok(html.includes('id="performanceStatus"'), 'Settings must explain the active performance profile.');
assert.ok(app.includes('function getPerformanceProfile()'), 'Runtime decisions should use the adaptive performance profile.');
const allQuery = '$' + '$(';
assert.ok(app.includes(allQuery + "'button[data-performance-mode]').forEach"), 'Performance status sync must iterate over preset buttons with querySelectorAll.');
assert.ok(app.includes(allQuery + "'.live-video', $('#slideStage')).forEach"), 'Adaptive mode must iterate over all stage videos before pausing.');
assert.ok(app.includes(allQuery + "'.photo-frame.video-playing', $('#slideStage')).forEach"), 'Adaptive mode must iterate over all playing photo frames before clearing state.');
assert.ok(app.includes(allQuery + "'.live-video', imageView).forEach"), 'Switching into 3D must safely pause all video layers.');
assert.ok(app.includes("renderMediaModeBar('media-mode-bar--mobile')"), 'Mobile must render a foreground image/3D switch.');
assert.ok(app.includes("target.closest('.media-experience') || slidePage?.querySelector('.media-experience')"), 'Both desktop and foreground mobile controls must target the same media experience.');
assert.ok(css.includes('.slide-content>.media-mode-bar--mobile'), 'The foreground switch needs dedicated mobile presentation styling.');
assert.ok(app.includes("slidePage?.classList.toggle('is-model-active', showModel)"), 'Mobile mode changes must enable pointer interaction with the 3D model.');
assert.ok(app.includes("navigator.serviceWorker.register('./service-worker.js'"), 'The app shell should register its service worker on secure origins.');
assert.ok(serviceWorker.includes("const SHELL_VERSION = '" + assetVersions[0] + "'"), 'Service-worker cache version must match the cache-busted app assets.');
assert.ok(serviceWorker.includes('await self.skipWaiting()') && serviceWorker.includes('await self.clients.claim()'), 'The service worker must activate and claim clients after installing the shell.');
assert.ok(!/https?:\/\//i.test(serviceWorker), 'The shell cache must not prefetch remote images, videos or model assets.');
assert.ok(app.includes('navigator.deviceMemory') && app.includes('navigator.hardwareConcurrency'), 'Adaptive mode should consider hardware signals when supported.');
const warmupStart = app.indexOf('function warmAdjacentPhotos()');
const warmupEnd = app.indexOf('\n  function renderQuiz', warmupStart);
const warmupSource = app.slice(warmupStart, warmupEnd);
assert.ok(warmupSource.includes('profile.saveData') && warmupSource.includes('profile.slowConnection'), 'Image preloading must respect bandwidth limits.');
assert.ok(app.includes(`if (document.hidden || !motionEnabled || reducedMotion.matches || $('#presentationViewer').hidden || profile.lite) {\n      atmosphereFrame = 0;\n      return;`), 'The background render loop must stop rather than spin while hidden.');
assert.ok(css.includes('html[data-performance-lite="true"]'), 'Low-power mode must reduce expensive visual effects.');
const toastStart = app.indexOf('function toast(message)');
const toastEnd = app.indexOf('function renderDecks()', toastStart);
const toastSource = app.slice(toastStart, toastEnd);
assert.ok(app.includes('let toastTimer = 0;') && toastSource.includes("region.querySelector('.toast')") && toastSource.includes('clearTimeout(toastTimer)'), 'Rapid notifications must reuse one toast and clear its previous timer.');

console.log(`BioSphere static validation passed: ${deck.slides.length} slides, ${resources.length} checked URLs, ${flowSlides.length} process diagrams, 5 disease case quizzes, ${quizSlides.length} class quiz slides, ${Math.round(totalSourceBytes / 1024)} KiB combined JS/CSS/SW/deck source.`);
