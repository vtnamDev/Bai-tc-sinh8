import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.BIOSPHERE_URL || 'http://127.0.0.1:4173/';
const outputDir = 'test-results';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#heroSample').waitFor({ state: 'visible', timeout: 10000 });

  // Mobile navigation + adaptive performance presets.
  await page.locator('#mobileMenu').click();
  await page.locator('#mainNav [data-view="settings"]').click();
  await page.locator('#performanceStatus').waitFor({ state: 'visible' });
  assert.equal(await page.locator('button[data-performance-mode]').count(), 3);
  await page.locator('[data-performance-mode="cinema"]').click();
  assert.equal(await page.locator('html').getAttribute('data-performance-mode'), 'cinema');
  await page.locator('[data-performance-mode="smooth"]').click();
  assert.equal(await page.locator('html').getAttribute('data-performance-mode'), 'smooth');
  assert.equal(await page.locator('html').getAttribute('data-performance-lite'), 'true');
  assert.equal(await page.locator('#toastRegion .toast').count(), 1, 'Rapid setting changes must reuse one toast instead of stacking notifications.');
  assert.equal(await page.locator('#toastRegion .toast').textContent(), 'Đã ưu tiên độ mượt và tiết kiệm dữ liệu.');
  await page.screenshot({ path: `${outputDir}/mobile-performance-settings.png`, fullPage: true });

  // The setting must survive reload and remain responsive on a phone-sized viewport.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Reopen settings explicitly so the assertion tests persisted mode, not URL restoration semantics.
  await page.locator('#mobileMenu').click();
  await page.locator('#mainNav [data-view="settings"]').click();
  await page.locator('#performanceStatus').waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('data-performance-mode'), 'smooth');
  const settingsWidth = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(settingsWidth.document <= settingsWidth.viewport + 2, `Horizontal overflow in initial mobile viewport: ${JSON.stringify(settingsWidth)}`);

  // Open the actual seed deck and exercise next/previous navigation.
  await page.locator('#mobileMenu').click();
  await page.locator('#mainNav [data-view="library"]').click();
  await page.locator('#heroSample').click();
  await page.locator('#presentationViewer').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'slideStage',
    'Opening the presenter should move keyboard focus to the slide stage.');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '02 / 25');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '01 / 25');
  // Side-hit navigation controls are intentionally hidden on narrow phone layouts.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#slideNext').click();
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '02 / 25');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'slideStage',
    'Using the next-slide control should keep keyboard navigation ready.');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '03 / 25');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '02 / 25');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '01 / 25');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const initialPresentationState = await page.evaluate(() => ({
    caption: document.querySelector('#viewerSlideCaption')?.textContent?.trim() || null,
    title: document.querySelector('#slideStage .slide-title')?.textContent?.trim() || null,
    titleColor: document.querySelector('#slideStage .slide-title') ? getComputedStyle(document.querySelector('#slideStage .slide-title')).color : null,
    brandName: document.querySelector('.brand-wordmark strong')?.textContent?.trim() || null,
    bundledSlideCount: window.BIOSPHERE_BAI32_SEED?.slides?.length ?? null,
    viewerHidden: document.querySelector('#presentationViewer')?.hidden ?? null,
    scripts: [...document.scripts].map(script => ({ src: script.src, loaded: Boolean(script.src) })),
  }));
  assert.equal(initialPresentationState.bundledSlideCount, 25,
    `Browser loaded the wrong lesson data: ${JSON.stringify(initialPresentationState)}`);
  assert.equal(initialPresentationState.brandName, '4xT', 'The workspace must display the new 4xT identity.');
  assert.equal(initialPresentationState.titleColor, 'rgb(24, 63, 42)', 'The opening title must be dark enough to read on cream.');
  assert.equal(initialPresentationState.caption, '01 / 25',
    `Presentation did not render the first slide. State: ${JSON.stringify(initialPresentationState)}. Page errors: ${pageErrors.join(' | ') || 'none'}`);
  // The counter is intentionally visually hidden on narrow phones to preserve slide space.
  assert.equal((await page.locator('#viewerSlideCaption').textContent()).trim(), '01 / 25');
  await page.locator('#slideStage .photo-frame').waitFor({ state: 'visible' });
  const mobileEditorialLayout = await page.evaluate(() => {
    const stage = document.querySelector('#slideStage');
    const image = stage?.querySelector('.photo-frame');
    const content = stage?.querySelector('.slide-content');
    const diagram = stage?.querySelector('.editorial-diagram');
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height };
    };
    return {
      viewportWidth:window.innerWidth,
      image:rect(image),
      content:rect(content),
      diagram:diagram?.dataset.diagram || null,
      mediaPosition:image ? getComputedStyle(image).position : null,
      contentWidth:content?.getBoundingClientRect().width || 0,
    };
  });
  assert.ok(mobileEditorialLayout.image && mobileEditorialLayout.content,
    `Mobile slide must have separate media and text regions: ${JSON.stringify(mobileEditorialLayout)}`);
  assert.ok(mobileEditorialLayout.content.top >= mobileEditorialLayout.image.bottom - 1,
    `Photo and text overlap on mobile instead of stacking: ${JSON.stringify(mobileEditorialLayout)}`);
  assert.ok(mobileEditorialLayout.contentWidth >= mobileEditorialLayout.viewportWidth - 34,
    `The editorial content column is too narrow on a phone: ${JSON.stringify(mobileEditorialLayout)}`);
  assert.ok(mobileEditorialLayout.diagram,
    `The first slide must show a knowledge-map visual, got ${JSON.stringify(mobileEditorialLayout)}`);
  assert.equal(mobileEditorialLayout.mediaPosition, 'relative',
    'The photo frame must be a panel, not an absolutely positioned full-slide background.');
  const imageQuality = await page.locator('#slideStage .live-photo').evaluate(img => {
    const url = new URL(img.currentSrc || img.src);
    const style = getComputedStyle(img);
    return {
      width: Number(url.searchParams.get('w') || 0),
      quality: Number(url.searchParams.get('q') || 0),
      filter: style.filter,
      transform: style.transform,
    };
  });
  assert.ok(imageQuality.width >= 768 && imageQuality.quality >= 82,
    `Image URL must request adequate screen pixels and quality: ${JSON.stringify(imageQuality)}`);
  assert.equal(imageQuality.filter, 'none', 'The image itself should not be blurred or color-shifted by a filter.');
  assert.equal(imageQuality.transform, 'none', 'The photo should not be continuously zoomed, which softens edges on mobile.');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[data-biosphere-three]'))), false,
    'The 3D library must not load before a user selects a 3D scene.');
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .slide-key-idea').count(), 1,
    'Each content slide must visibly separate its main idea from secondary details.');
  assert.equal((await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .slide-key-idea-top span').textContent()).trim(), 'Ý CHÍNH');
  assert.ok(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .slide-point--support').count() >= 3,
    'Supporting ideas should be shown as distinct cards.');
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost)').getAttribute('data-story-group'), 'foundation');
  const stage = page.locator('#slideStage');
  const stageBounds = await stage.boundingBox();
  assert.ok(stageBounds && stageBounds.width > 0 && stageBounds.height > 0, 'The mobile slide stage must have a measurable tap surface.');
  // Side arrows are hidden on phones by design; use the tap-on-either-half interaction instead.
  await stage.click({ position: { x: Math.round(stageBounds.width * 0.84), y: Math.round(stageBounds.height * 0.5) } });
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '02 / 25');
  const continuityState = await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost)').evaluate(el => ({
    storyGroup:el.dataset.storyGroup,
    bridge:el.dataset.motionBridge,
    accent:getComputedStyle(el).getPropertyValue('--stage-accent').trim(),
  }));
  assert.deepEqual(continuityState, { storyGroup:'foundation', bridge:'continuity', accent:'#286748' },
    `Adjacent slides in one chapter should keep the same palette and continuous motion: ${JSON.stringify(continuityState)}`);
  const oneSurfaceState = await stage.evaluate(el => {
    const page = el.querySelector(':scope > .slide-page:not(.slide-transition-ghost)');
    return {
      pages:el.querySelectorAll(':scope > .slide-page').length,
      ghosts:el.querySelectorAll(':scope > .slide-transition-ghost').length,
      activePages:el.querySelectorAll(':scope > .slide-page:not(.slide-transition-ghost)').length,
      duration:page ? getComputedStyle(page).animationDuration : '',
      transition:el.querySelector('.slide-transition-layer')?.dataset.transition || null,
      sweepAnimation:el.querySelector('.slide-transition-layer') ? getComputedStyle(el.querySelector('.slide-transition-layer'),'::before').animationName : '',
      sweepDuration:el.querySelector('.slide-transition-layer') ? getComputedStyle(el.querySelector('.slide-transition-layer'),'::before').animationDuration : '',
    };
  });
  assert.deepEqual(
    {pages:oneSurfaceState.pages,ghosts:oneSurfaceState.ghosts,activePages:oneSurfaceState.activePages},
    {pages:1,ghosts:0,activePages:1},
    `Navigation must replace the old slide immediately; no saved screenshot or full-size image may remain layered: ${JSON.stringify(oneSurfaceState)}`
  );
  assert.equal(oneSurfaceState.transition, 'continuity', 'Same-chapter navigation must show a visible transition layer.');
  assert.equal(oneSurfaceState.sweepAnimation, 'fourxt-transition-sweep', 'The continuity transition must sweep a light streak across the slide.');
  assert.ok(Number.parseFloat(oneSurfaceState.duration) <= .5,
    `Incoming continuity motion should finish quickly, not keep the presenter feeling stuck: ${JSON.stringify(oneSurfaceState)}`);
  assert.ok(Number.parseFloat(oneSurfaceState.sweepDuration) >= .3 && Number.parseFloat(oneSurfaceState.sweepDuration) <= .5,
    `The transition sweep should be perceptible but short: ${JSON.stringify(oneSurfaceState)}`);
  await stage.click({ position: { x: Math.round(stageBounds.width * 0.16), y: Math.round(stageBounds.height * 0.5) } });
  await page.waitForFunction(() => document.querySelector('#viewerSlideCaption')?.textContent?.trim() === '01 / 25');
  const presentationWidth = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(presentationWidth.document <= presentationWidth.viewport + 2,
    `Horizontal overflow in mobile presentation: ${JSON.stringify(presentationWidth)}`);
  await page.screenshot({ path: `${outputDir}/mobile-presenter.png` });

  // Every disease has a clickable multiple-choice case quiz; verify instant feedback and lockout.
  let caseAnswer = page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .case-quiz-answer:visible');
  for (let index = 0; index < 25 && await caseAnswer.count() === 0; index += 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(90);
    const currentCaption = (await page.locator('#viewerSlideCaption').textContent()).trim();
    if (currentCaption === '06 / 25') {
      const chapterState = await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost)').evaluate(el => ({
        storyGroup:el.dataset.storyGroup,
        bridge:el.dataset.motionBridge,
        palette:el.dataset.palette,
      }));
      assert.deepEqual(chapterState, { storyGroup:'tooth', bridge:'chapter', palette:'coral' },
        `Entering a new disease should use its own accent and chapter transition: ${JSON.stringify(chapterState)}`);
      const chapterEffect=await page.locator('#slideStage > .slide-transition-layer').evaluate(el=>({type:el.dataset.transition,sweep:getComputedStyle(el,'::before').animationName,duration:getComputedStyle(el,'::before').animationDuration}));
      assert.equal(chapterEffect.type,'chapter','Crossing into a disease chapter must use the richer chapter transition.');
      assert.equal(chapterEffect.sweep,'fourxt-transition-sweep','Chapter transition must include the camera-like light sweep.');
      assert.ok(Number.parseFloat(chapterEffect.duration)>=.5 && Number.parseFloat(chapterEffect.duration)<=.8,`Chapter sweep should be cinematic without delaying narration: ${JSON.stringify(chapterEffect)}`);
      assert.equal(await page.locator('#slideStage > .slide-page').count(), 1,
        'Entering a new chapter must not keep the outgoing page in the DOM.');
      assert.equal(await page.locator('#slideStage > .slide-transition-ghost').count(), 0,
        'The previous slide must not be rendered as an outgoing ghost.');
    }
    caseAnswer = page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .case-quiz-answer:visible');
  }
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .classroom-prompt[data-case-correct-index]').count(), 1,
    'Reached a disease slide with an interactive case question.');
  assert.equal(await caseAnswer.count(), 4, 'Each disease case should expose four answer choices.');
  await caseAnswer.nth(1).click();
  await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .classroom-answer:not([hidden])').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .classroom-prompt').getAttribute('data-case-answered'), 'true');
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .case-quiz-answer.is-correct').count(), 1);
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .case-quiz-answer:disabled').count(), 4,
    'Case answers must be locked after the first choice.');
  await page.screenshot({ path: `${outputDir}/mobile-disease-case-quiz.png` });
  await page.keyboard.press('ArrowRight');

  // Reach a curated 3D scene, then verify the image/model switch exposes the 3D panel.
  let modelToggle = page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) button[data-media-mode="model"]:visible');
  for (let index = 0; index < 25 && await modelToggle.count() === 0; index += 1) {
    const unansweredQuizChoices = page.locator('#slideStage [data-quiz-answer]:not([disabled])');
    if (await unansweredQuizChoices.count() > 0) {
      // Answer each question so keyboard navigation can progress through interactive lesson slides.
      await unansweredQuizChoices.first().click();
    } else if ((await page.locator('#viewerSlideCaption').textContent()).trim() === '25 / 25') {
      break;
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(90);
    modelToggle = page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) button[data-media-mode="model"]:visible');
  }
  assert.ok(await modelToggle.count() > 0, 'At least one curated 3D scene must expose the model switch.');
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost) .editorial-diagram--process').count(), 1,
    'The disease scene should show a readable process diagram in the content column, not over the photo.');
  // Simulate the Sketchfab API being unavailable and verify that the panel falls back to its cited image.
  await page.route('https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js', route => route.abort());
  await modelToggle.click();
  await page.locator('#slideStage .media-3d-view:not([hidden])').waitFor({ state: 'visible', timeout: 5000 });
  const embeddedModel = page.locator('#slideStage .anatomy3d-panel--embed');
  await embeddedModel.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#slideStage .anatomy3d-panel--embed')?.classList.contains('is-embed-failed'), null, { timeout: 5000 });
  const embedFallbackState = await embeddedModel.evaluate(panel => ({
    status: panel.querySelector('.anatomy3d-status')?.textContent?.trim() || '',
    iframeCount: panel.querySelectorAll('iframe').length,
    fallbackOpacity: getComputedStyle(panel.querySelector('.anatomy3d-fallback')).opacity,
  }));
  assert.equal(embedFallbackState.status, 'Không tải được 3D · đang hiển thị ảnh tham chiếu');
  assert.equal(embedFallbackState.iframeCount, 0, 'The failed remote viewer must be released from the DOM.');
  await page.waitForFunction(() => {
    const image = document.querySelector('#slideStage .anatomy3d-panel--embed.is-embed-failed .anatomy3d-fallback');
    return image && Number.parseFloat(getComputedStyle(image).opacity) >= 0.95;
  }, null, { timeout: 1500 });
  embedFallbackState.fallbackOpacity = await embeddedModel.locator('.anatomy3d-fallback').evaluate(image => getComputedStyle(image).opacity);
  assert.ok(Number.parseFloat(embedFallbackState.fallbackOpacity) >= 0.95, 'A cited image must become fully visible after the fallback transition.');
  const fallbackCredit = embeddedModel.locator('.anatomy3d-fallback-credit');
  await fallbackCredit.waitFor({ state: 'visible', timeout: 1500 });
  const activeModelType = await embeddedModel.getAttribute('data-anatomy3d');
  const activeSlideData = await page.evaluate(type => {
    const deck = window.BIOSPHERE_BAI32_SEED;
    return deck?.slides?.find(slide => slide.model3D === type) || null;
  }, activeModelType);
  const fallbackCreditText = await fallbackCredit.textContent();
  assert.ok(activeSlideData?.modelFallbackCredit && fallbackCreditText.includes(activeSlideData.modelFallbackCredit),
    `Fallback credit must match the active ${activeModelType} model metadata: ${fallbackCreditText}`);
  const fallbackLicense = activeSlideData?.modelFallbackLicense;
  assert.ok(fallbackLicense && await fallbackCredit.locator('a').evaluateAll((links, expected) => links.some(link => link.href === new URL(expected, location.href).href), fallbackLicense),
    'Fallback image license must match the active image license, independently from the 3D model license.');
  await page.screenshot({ path: `${outputDir}/mobile-model-view.png` });
  const annotationToggle = embeddedModel.locator('[data-model-action="annotations"]');
  await annotationToggle.click();
  assert.equal(await annotationToggle.getAttribute('aria-expanded'), 'true', 'The anatomy annotations toggle must expose its expanded state.');
  const annotationPanel = embeddedModel.locator('.anatomy3d-annotation-panel');
  await annotationPanel.waitFor({ state: 'visible' });
  const annotationText = await annotationPanel.textContent();
  const modelType = await embeddedModel.getAttribute('data-anatomy3d');
  const expectedAnnotationTerm = ({ tooth:'Men răng', stomach:'Niêm mạc', intestine:'Ruột non', worm:'Giun đường ruột', liver:'Gan' })[modelType];
  assert.ok(expectedAnnotationTerm && annotationText.includes(expectedAnnotationTerm),
    `The ${modelType || 'active'} model annotation should match its anatomy and lesson: ${annotationText}`);
  await annotationToggle.click();
  assert.equal(await annotationToggle.getAttribute('aria-expanded'), 'false', 'The annotation panel must be dismissible.');
  assert.equal(await annotationPanel.isVisible(), false);
  assert.equal(await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost)').evaluate(el => el.classList.contains('is-model-active')), true,
    'The active mobile model view must enable the interaction layer.');
  assert.equal(await page.locator('#slideStage .media-mode-bar--mobile button[data-media-mode="model"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#slideStage .media-mode-bar--mobile button[data-media-mode="image"]').getAttribute('aria-pressed'), 'false');
  const interactionLayers = await page.locator('#slideStage > .slide-page:not(.slide-transition-ghost)').evaluate(el => ({
    copy: getComputedStyle(el.querySelector('.slide-content')).pointerEvents,
    media: getComputedStyle(el.querySelector('.slide-side-content')).pointerEvents,
    controls: getComputedStyle(el.querySelector('.media-mode-bar--mobile')).pointerEvents,
  }));
  assert.deepEqual(interactionLayers, { copy: 'none', media: 'auto', controls: 'auto' },
    'Mobile 3D gestures must reach the model, while the foreground mode switch remains tappable.');

  // Validate the landscape editorial layout too: text and image must occupy separate columns.
  await page.locator('#slideStage .media-mode-bar--mobile button[data-media-mode="image"]').click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(220);
  await page.evaluate(() => { const stage = document.querySelector('#slideStage'); if (stage) stage.scrollTop = 0; });
  const landscapeEditorialLayout = await page.evaluate(() => {
    const stage = document.querySelector('#slideStage');
    const content = stage?.querySelector('.slide-content');
    const media = stage?.querySelector('.slide-side-content');
    const image = stage?.querySelector('.photo-frame');
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height };
    };
    return {
      stage:rect(stage),content:rect(content),media:rect(media),image:rect(image),
      grid:content ? getComputedStyle(stage.querySelector('.slide-layout')).display : null,
      viewportWidth:window.innerWidth,
    };
  });
  assert.equal(landscapeEditorialLayout.grid, 'grid',
    `Landscape presenter must use a grid layout: ${JSON.stringify(landscapeEditorialLayout)}`);
  assert.ok(landscapeEditorialLayout.content && landscapeEditorialLayout.media &&
    landscapeEditorialLayout.media.left >= landscapeEditorialLayout.content.right - 2,
    `Landscape image and text columns overlap or collapse: ${JSON.stringify(landscapeEditorialLayout)}`);
  assert.ok(landscapeEditorialLayout.image?.width >= 350,
    `Landscape image column should be visually substantial: ${JSON.stringify(landscapeEditorialLayout)}`);
  await page.screenshot({ path: `${outputDir}/landscape-editorial-layout.png` });

  // Desktop/HDMI projector mode: full-screen request, cinema profile, 16:9-wide layout, and restoration.
  const projectorButton = page.locator('#viewerProjector');
  assert.equal(await projectorButton.isVisible(), true, 'Desktop landscape should expose the HDMI/TV projector control.');
  await projectorButton.click();
  await page.waitForFunction(() => document.querySelector('#presentationViewer')?.classList.contains('projector-mode'));
  await page.waitForFunction(() => {
    const viewer = document.querySelector('#presentationViewer');
    const projector = viewer?.querySelector('#viewerProjector');
    const fullscreen = viewer?.querySelector('#viewerFullscreen');
    return projector?.getAttribute('aria-pressed') === 'true' &&
      fullscreen?.getAttribute('aria-pressed') === String(document.fullscreenElement === viewer);
  }, null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const page = document.querySelector('#presentationViewer #slideStage > .slide-page:not(.slide-transition-ghost)');
    return page && page.getAnimations().every(animation => animation.playState !== 'running');
  }, null, { timeout: 4000 });
  const projectorState = await page.evaluate(() => {
    const viewer = document.querySelector('#presentationViewer');
    const stage = document.querySelector('#slideStage');
    const page = stage?.querySelector(':scope > .slide-page:not(.slide-transition-ghost)');
    const layout = page?.querySelector('.slide-layout');
    const topbar = viewer?.querySelector('.viewer-topbar');
    return {
      enabled:viewer?.classList.contains('projector-mode'),
      dataset:document.documentElement.dataset.projectorMode,
      mode:document.documentElement.dataset.performanceMode,
      fullscreen:document.fullscreenElement === viewer,
      fullscreenPressed:viewer?.querySelector('#viewerFullscreen')?.getAttribute('aria-pressed'),
      projectorPressed:viewer?.querySelector('#viewerProjector')?.getAttribute('aria-pressed'),
      stagePosition:stage ? getComputedStyle(stage).position : null,
      toolbarPosition:topbar ? getComputedStyle(topbar).position : null,
      layoutDisplay:layout ? getComputedStyle(layout).display : null,
      pageCount:stage?.querySelectorAll(':scope > .slide-page').length ?? 0,
      ghostCount:stage?.querySelectorAll(':scope > .slide-transition-ghost').length ?? 0,
      pageHeight:page?.getBoundingClientRect().height ?? 0,
      stageHeight:stage?.getBoundingClientRect().height ?? 0,
      pagePaddingHeight:page ? parseFloat(getComputedStyle(page).paddingTop) + parseFloat(getComputedStyle(page).paddingBottom) : 0,
      pageOverflowY:page ? getComputedStyle(page).overflowY : null,
      layoutHeight:layout?.getBoundingClientRect().height ?? 0,
      contentScrollHeight:layout?.querySelector('.slide-content')?.scrollHeight ?? 0,
      contentClientHeight:layout?.querySelector('.slide-content')?.clientHeight ?? 0,
    };
  });
  assert.equal(projectorState.enabled, true);
  assert.equal(projectorState.dataset, 'true');
  assert.equal(projectorState.mode, 'cinema', 'Projector mode should request the cinematic performance profile.');
  assert.equal(projectorState.projectorPressed, 'true');
  assert.equal(projectorState.fullscreenPressed, String(projectorState.fullscreen),
    'The fullscreen control must mirror the browser fullscreen state.');
  assert.equal(projectorState.stagePosition, 'absolute');
  assert.equal(projectorState.toolbarPosition, 'absolute');
  assert.equal(projectorState.layoutDisplay, 'grid');
  assert.equal(projectorState.pageOverflowY, 'hidden', 'The full-screen slide frame must stay fixed; only the inner content panel may scroll when content is taller than the viewport.');
  assert.ok(Math.abs(projectorState.pageHeight - projectorState.stageHeight) <= 2, `Projector slide must occupy the full stage: ${JSON.stringify(projectorState)}`);
  assert.ok(Math.abs(projectorState.layoutHeight - (projectorState.pageHeight - projectorState.pagePaddingHeight)) <= 3, `Projector grid must fit the usable slide area after vertical padding: ${JSON.stringify(projectorState)}`);
  assert.ok(projectorState.contentClientHeight > 0 && projectorState.contentScrollHeight >= projectorState.contentClientHeight, 'Projector content region must have a measurable scroll container for long slide copy.');
  assert.deepEqual({ pages:projectorState.pageCount, ghosts:projectorState.ghostCount }, { pages:1, ghosts:0 },
    `Projector transitions still must never retain a second full-frame slide: ${JSON.stringify(projectorState)}`);
  await page.screenshot({ path: `${outputDir}/desktop-hdmi-projector-mode.png` });

  await projectorButton.click();
  await page.waitForFunction(() => !document.querySelector('#presentationViewer')?.classList.contains('projector-mode'));
  assert.equal(await page.locator('html').getAttribute('data-projector-mode'), null);
  assert.equal(await page.locator('html').getAttribute('data-performance-mode'), 'smooth',
    'Leaving projector mode should restore the previously selected performance preset.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);

  // The shell should reload without network by caching only same-origin app files, not remote media.
  const workerReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  assert.equal(workerReady, true, 'The app shell service worker should install in a secure context.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), { timeout: 10000 });
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('#heroSample').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.locator('#performanceStatus').count(), 1,
      'Core HTML/JS must remain available after an offline reload.');
  } finally {
    await page.context().setOffline(false);
  }

  assert.deepEqual(pageErrors, [], `Unexpected JavaScript errors: ${pageErrors.join(' | ')}`);
  console.log('BioSphere browser smoke test passed: mobile/landscape editorial geometry, rich diagrams, settings persistence, slide navigation, lazy 3D loading, model view, and offline shell.');
} finally {
  await browser.close();
}
