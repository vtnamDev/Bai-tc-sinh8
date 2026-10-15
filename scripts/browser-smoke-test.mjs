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

  // Capture the actual workspace, not only settings and presentation views.
  const mobileLibraryBounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(mobileLibraryBounds.document <= mobileLibraryBounds.viewport + 2,
    `Horizontal overflow on mobile library home: ${JSON.stringify(mobileLibraryBounds)}`);
  await page.screenshot({ path: `${outputDir}/mobile-library-home.png`, fullPage: true });

  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  desktopPage.on('pageerror', error => pageErrors.push(error.message));
  await desktopPage.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await desktopPage.locator('#heroSample').waitFor({ state: 'visible', timeout: 10000 });
  await desktopPage.screenshot({ path: `${outputDir}/desktop-library-home.png`, fullPage: true });
  const desktopLibraryBounds = await desktopPage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(desktopLibraryBounds.document <= desktopLibraryBounds.viewport + 2,
    `Horizontal overflow on desktop library home: ${JSON.stringify(desktopLibraryBounds)}`);
  await desktopPage.close();

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
  await page.waitForTimeout(250);
  const initialPresentationState = await page.evaluate(() => ({
    caption: document.querySelector('#viewerSlideCaption')?.textContent?.trim() || null,
    title: document.querySelector('#slideStage .slide-title')?.textContent?.trim() || null,
    bundledSlideCount: window.BIOSPHERE_BAI32_SEED?.slides?.length ?? null,
    viewerHidden: document.querySelector('#presentationViewer')?.hidden ?? null,
    scripts: [...document.scripts].map(script => ({ src: script.src, loaded: Boolean(script.src) })),
  }));
  assert.equal(initialPresentationState.bundledSlideCount, 25,
    `Browser loaded the wrong lesson data: ${JSON.stringify(initialPresentationState)}`);
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
  assert.deepEqual(continuityState, { storyGroup:'foundation', bridge:'continuity', accent:'#70dfd0' },
    `Adjacent slides in one chapter should keep the same palette and continuous motion: ${JSON.stringify(continuityState)}`);
  const oneSurfaceState = await stage.evaluate(el => {
    const page = el.querySelector(':scope > .slide-page:not(.slide-transition-ghost)');
    return {
      pages:el.querySelectorAll(':scope > .slide-page').length,
      ghosts:el.querySelectorAll(':scope > .slide-transition-ghost').length,
      activePages:el.querySelectorAll(':scope > .slide-page:not(.slide-transition-ghost)').length,
      duration:page ? getComputedStyle(page).animationDuration : '',
    };
  });
  assert.deepEqual(
    {pages:oneSurfaceState.pages,ghosts:oneSurfaceState.ghosts,activePages:oneSurfaceState.activePages},
    {pages:1,ghosts:0,activePages:1},
    `Navigation must replace the old slide immediately; no saved screenshot or full-size image may remain layered: ${JSON.stringify(oneSurfaceState)}`
  );
  assert.ok(Number.parseFloat(oneSurfaceState.duration) <= .35,
    `Incoming slide animation should finish quickly, not keep the presenter feeling stuck: ${JSON.stringify(oneSurfaceState)}`);
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
  await modelToggle.click();
  await page.locator('#slideStage .media-3d-view:not([hidden])').waitFor({ state: 'visible', timeout: 5000 });
  await page.screenshot({ path: `${outputDir}/mobile-model-view.png` });
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
