(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'biosphere-slides-workspace-v1';
  const PERFORMANCE_STORAGE_KEY = 'biosphere-performance-mode-v1';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const seedDeck = window.BIOSPHERE_BAI32_SEED;

  let decks = loadDecks();
  let activeFilter = 'all';
  let activeView = 'library';
  let currentDeck = null;
  let slideIndex = 0;
  let motionEnabled = !reducedMotion.matches;
  let performanceMode = readPerformanceMode();
  let photoWarmTimer = 0;
  let warmedPhotoAssets = new Map();
  let projectorPreviousPerformanceMode = null;
  let projectorWasFullscreen = false;
  let toastTimer = 0;
  let soundEnabled = true;
  let previousFocus = null;
  let transitionCleanupTimer = 0;
  let activeTransitionGhost = null;
  let quizSession = { deckId: null, slideIndex: -1, questionIndex: 0, answers: {}, score: 0 };
  let quizAudioContext = null;
  let atmosphereRunning = false;
  let atmosphereFrame = 0;
  let atmosphereLastPaint = 0;
  let atmosphereWidth = 0;
  let atmosphereHeight = 0;
  let atmosphereDpr = 1;
  let atmosphereParticles = [];
  let atmospherePointer = { x: 0.5, y: 0.5 };
  let atmosphereCanvasContext = null;
  let activeAnatomy3D = null;
  let threeLoadPromise = null;
  let modelViewerLoadPromise = null;

  function loadDecks() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved)) {
        // Replace the older bundled draft with the current, researched 20-slide deck.
        const personalDecks = saved.filter(deck => isValidDeckShape(deck) && deck.id !== seedDeck.id && !deck.isSeed);
        return [seedDeck, ...personalDecks];
      }
      return [seedDeck];
    } catch {
      return [seedDeck];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
      return true;
    } catch {
      toast('Không thể lưu: bộ nhớ trình duyệt có thể đã đầy.');
      return false;
    }
  }

  function readPerformanceMode() {
    try {
      const saved = localStorage.getItem(PERFORMANCE_STORAGE_KEY);
      return ['auto', 'smooth', 'cinema'].includes(saved) ? saved : 'auto';
    } catch {
      return 'auto';
    }
  }

  function getPerformanceProfile() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    const effectiveType = String(connection.effectiveType || '').toLowerCase();
    const online = navigator.onLine !== false;
    const saveData = Boolean(connection.saveData);
    const slowConnection = !online || saveData || ['slow-2g', '2g', '3g'].includes(effectiveType);
    const memory = Number(navigator.deviceMemory) || 0;
    const cores = Number(navigator.hardwareConcurrency) || 0;
    const lowPower = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
    const lite = performanceMode === 'smooth' ||
      (performanceMode === 'auto' && (slowConnection || lowPower));
    const highCapability = memory >= 8 && cores >= 6;
    const projectorMode = document.documentElement.dataset.projectorMode === 'true';
    const allowVideo = performanceMode !== 'smooth' && online && !saveData &&
      !['slow-2g', '2g', '3g'].includes(effectiveType) &&
      motionEnabled && !reducedMotion.matches &&
      (performanceMode === 'cinema' || (highCapability && !lowPower));
    const maxPixelRatio = lite ? 1 : (performanceMode === 'cinema' ? (highCapability || projectorMode ? 2 : 1.5) : 1.25);
    return { connection, effectiveType, online, saveData, slowConnection, memory, cores, highCapability, lowPower, lite, allowVideo, maxPixelRatio, projectorMode };
  }

  function updatePerformanceUI() {
    const profile = getPerformanceProfile();
    document.documentElement.dataset.performanceMode = performanceMode;
    document.documentElement.dataset.performanceLite = String(profile.lite);
    $$('button[data-performance-mode]').forEach(button => {
      const active = button.dataset.performanceMode === performanceMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const status = $('#performanceStatus');
    if (!status) return;
    const labels = { auto: 'Tự động thông minh', smooth: 'Mượt nhẹ', cinema: 'Điện ảnh' };
    const signals = [];
    if (!profile.online) signals.push('đang ngoại tuyến');
    else if (profile.saveData) signals.push('tiết kiệm dữ liệu đang bật');
    else if (profile.effectiveType) signals.push('mạng ' + profile.effectiveType.toUpperCase());
    if (profile.memory) signals.push('RAM thiết bị khoảng ' + profile.memory + ' GB');
    if (profile.cores) signals.push(profile.cores + ' luồng CPU');
    const environment = signals.length ? signals.join(' · ') : 'chưa có đủ tín hiệu thiết bị/mạng';
    const behavior = profile.lite
      ? 'Ưu tiên độ mượt: giảm hiệu ứng nền, giới hạn tải trước và tắt video nền.'
      : profile.allowVideo
        ? 'Cho phép video nền khi phù hợp; mô hình 3D chỉ tải khi bạn mở.'
        : 'Giữ ảnh tĩnh; tôn trọng cài đặt chuyển động hoặc giới hạn kết nối.';
    status.textContent = labels[performanceMode] + ' · ' + environment + '. ' + behavior;
  }

  function setPerformanceMode(mode, announce = true) {
    if (!['auto', 'smooth', 'cinema'].includes(mode)) return;
    performanceMode = mode;
    try { localStorage.setItem(PERFORMANCE_STORAGE_KEY, mode); } catch { /* use this session only */ }
    updatePerformanceUI();
    if (atmosphereCanvasContext) resizeStageAtmosphere();
    const profile = getPerformanceProfile();
    if (profile.lite || !motionEnabled || reducedMotion.matches) stopStageAtmosphere();
    else if (!$('#presentationViewer').hidden) startStageAtmosphere();
    if (!profile.allowVideo) {
      $$('.live-video', $('#slideStage')).forEach(video => video.pause());
      $$('.photo-frame.video-playing', $('#slideStage')).forEach(frame => frame.classList.remove('video-playing'));
    } else if (!$('#presentationViewer').hidden) {
      attachVideoBackgrounds($('#slideStage'));
    }
    if (announce) toast(mode === 'auto' ? 'Đã bật tối ưu tự động.' : mode === 'smooth' ? 'Đã ưu tiên độ mượt và tiết kiệm dữ liệu.' : 'Đã bật chế độ điện ảnh.');
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  // User-imported decks are data, not trusted markup. Only allow web URLs for resources.
  function safeHttpUrl(value, fallback = '') {
    const raw = String(value ?? '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return fallback;
    try {
      const parsed = new URL(raw, window.location.href);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return fallback;
      return raw.startsWith('//') ? parsed.href : raw;
    } catch {
      return fallback;
    }
  }

  function optimizeImageUrl(value) {
    const safe = safeHttpUrl(value, '');
    if (!safe) return '';
    try {
      const url = new URL(safe, window.location.href);
      if (!['images.unsplash.com', 'images.pexels.com'].includes(url.hostname.toLowerCase())) return safe;
      const profile = getPerformanceProfile();
      // Image detail follows the physical screen, not the lower pixel-ratio budget for canvas effects.
      const dprLimit = profile.slowConnection ? 1.5 : 2.25;
      const dpr = Math.min(Math.max(Number(window.devicePixelRatio) || 1, 1), dprLimit);
      const viewportWidth = Math.max(320, Number(window.innerWidth) || 960);
      const widthLimit = profile.slowConnection ? 1100 : (profile.projectorMode && performanceMode === 'cinema' ? 2880 : 1920);
      const width = Math.round(Math.min(widthLimit, Math.max(768, viewportWidth * dpr * 1.12)));
      const quality = profile.saveData ? 78 : profile.slowConnection ? 80 : profile.lite ? 82 : performanceMode === 'cinema' ? 92 : 86;
      url.searchParams.set('w', String(width));
      url.searchParams.set('q', String(quality));
      if (!url.searchParams.has('auto')) url.searchParams.set('auto', 'format');
      return url.href;
    } catch {
      return safe;
    }
  }

  function safeDecodeURIComponent(value) {
    try { return decodeURIComponent(value); } catch { return ''; }
  }

  function isValidDeckShape(deck) {
    if (!deck || typeof deck !== 'object' || Array.isArray(deck) ||
        typeof deck.title !== 'string' || !deck.title.trim() ||
        !Array.isArray(deck.slides) || deck.slides.length < 1 || deck.slides.length > 200) return false;
    return deck.slides.every(slide => {
      if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return false;
      for (const key of ['points', 'links', 'supportImages', 'quizQuestions']) {
        if (slide[key] != null && !Array.isArray(slide[key])) return false;
      }
      if (Array.isArray(slide.links) && !slide.links.every(link => link && typeof link === 'object' && !Array.isArray(link))) return false;
      if (Array.isArray(slide.supportImages) && !slide.supportImages.every(item => item && typeof item === 'object' && !Array.isArray(item))) return false;
      if (slide.interactiveQuiz) {
        const questions = slide.quizQuestions;
        if (!Array.isArray(questions) || !questions.length || !questions.every(question =>
          question && typeof question === 'object' && !Array.isArray(question) &&
          typeof question.question === 'string' &&
          Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 8 &&
          question.options.every(option => typeof option === 'string') &&
          Number.isInteger(question.correctIndex) && question.correctIndex >= 0 && question.correctIndex < question.options.length &&
          typeof question.explanation === 'string'
        )) return false;
      }
      if (slide.classroomPrompt != null) {
        const prompt = slide.classroomPrompt;
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt) ||
            !['scenario', 'question', 'answer', 'explanation'].every(key => typeof prompt[key] === 'string')) return false;
        if (prompt.options != null && (
          !Array.isArray(prompt.options) || prompt.options.length < 2 || prompt.options.length > 4 ||
          !prompt.options.every(option => typeof option === 'string') ||
          !Number.isInteger(prompt.correctIndex) || prompt.correctIndex < 0 || prompt.correctIndex >= prompt.options.length
        )) return false;
      }
      return true;
    });
  }

  function formatSubject(subject) {
    return subject === 'biology' ? 'SINH HỌC' : subject === 'science' ? 'KHOA HỌC TỰ NHIÊN' : 'HỌC TẬP';
  }

  function renderVisual(type) {
    const captions = {
      digestive: "HỆ TIÊU HÓA", greeting: "CÙNG BẮT ĐẦU", team: "NHÓM THỰC HIỆN",
      pathway: "ĐƯỜNG ĐI CỦA THỨC ĂN", absorption: "LÔNG RUỘT NON · HẤP THỤ", balance: "DINH DƯỠNG HỢP LÝ", overview: "5 VẤN ĐỀ CẦN BIẾT",
      tooth: "SÂU RĂNG", toothcare: "CHĂM SÓC RĂNG", stomach: "DẠ DÀY · TÁ TRÀNG",
      stomachcare: "KHÁM VÀ ĐIỀU TRỊ ĐÚNG", water: "TIÊU CHẢY", watercare: "NƯỚC SẠCH · BÙ NƯỚC",
      food: "THỰC PHẨM AN TOÀN", foodsafety: "CHỌN · LÀM SẠCH · NẤU · BẢO QUẢN",
      fiber: "CHẤT XƠ · NƯỚC · VẬN ĐỘNG", comparison: "NHẬN BIẾT DẤU HIỆU",
      habits: "THÓI QUEN HẰNG NGÀY", sources: "NGUỒN ĐÁNG TIN CẬY", closing: "XIN CẢM ƠN"
    };
    const drawings = {
      digestive: '<svg viewBox="0 0 400 400" role="img" aria-label="Minh họa hệ tiêu hóa dạng 3D"><defs><linearGradient id="torso3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d3ffe8" stop-opacity=".55"/><stop offset=".48" stop-color="#65dca4" stop-opacity=".22"/><stop offset="1" stop-color="#1e7f5b" stop-opacity=".06"/></linearGradient><linearGradient id="gut3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd8bc"/><stop offset=".48" stop-color="#f19d99"/><stop offset="1" stop-color="#9e526f"/></linearGradient><filter id="soft3d"><feGaussianBlur stdDeviation="10"/></filter></defs><ellipse cx="210" cy="333" rx="105" ry="18" fill="#0c090f" opacity=".5" filter="url(#soft3d)"/><path d="M133 41 Q150 20 200 25 Q250 20 267 41 L314 113 L281 163 L272 331 Q200 364 128 331 L119 163 L86 113Z" fill="#56c997" opacity=".12" stroke="#a6f4ce" stroke-opacity=".7" stroke-width="2"/><path d="M136 48 Q154 28 200 33 Q246 28 264 48 L297 114 L271 153 L263 322 Q200 348 137 322 L129 153 L103 114Z" fill="url(#torso3d)" stroke="#d3ffe9" stroke-opacity=".4" stroke-width="2"/><path d="M191 65 C193 82 196 100 196 123" fill="none" stroke="#ffe2c5" stroke-width="14" stroke-linecap="round"/><path d="M195 116 C230 101 257 123 244 152 C234 176 211 177 211 201 C211 224 250 224 252 197" fill="none" stroke="url(#gut3d)" stroke-width="21" stroke-linecap="round"/><path d="M146 144 Q176 125 194 145 Q206 158 188 178" fill="none" stroke="#efaa99" stroke-width="15" stroke-linecap="round"/><path d="M151 198 C129 213 143 239 161 234 C183 229 169 211 190 208 C214 205 211 232 190 239 C169 246 157 266 177 278 C198 291 214 262 231 275 C251 291 225 311 204 300 C186 291 171 314 191 327 C211 339 235 326 239 304" fill="none" stroke="#ffcab6" stroke-width="13" stroke-linecap="round"/><path d="M140 194 Q118 219 130 274 Q143 300 163 293 M257 198 Q279 223 267 272 Q258 299 240 291" fill="none" stroke="#83e4b4" stroke-width="13" stroke-linecap="round"/><path d="M201 326 L201 342" stroke="#79ddb0" stroke-width="8" stroke-linecap="round"/><ellipse cx="159" cy="92" rx="33" ry="10" fill="#e7fff3" opacity=".16" transform="rotate(-25 159 92)"/><circle class="svg-pulse" cx="196" cy="122" r="7" fill="#ecfff5"/><circle class="svg-pulse delay-2" cx="251" cy="197" r="7" fill="#ffcab6"/><circle class="svg-pulse delay-3" cx="158" cy="264" r="6" fill="#b0f5cd"/></svg>',
      greeting: '<svg viewBox="0 0 400 400" role="img" aria-label="Khung cảnh chào mừng với các lớp kính nổi"><defs><linearGradient id="glassA" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ceffdf" stop-opacity=".8"/><stop offset="1" stop-color="#55cda0" stop-opacity=".1"/></linearGradient><linearGradient id="glassB" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8cdef4" stop-opacity=".6"/><stop offset="1" stop-color="#8cdef4" stop-opacity=".04"/></linearGradient></defs><ellipse cx="205" cy="333" rx="115" ry="22" fill="#000" opacity=".28"/><g class="svg-float-slow" transform="rotate(-12 154 171)"><rect x="66" y="91" width="157" height="191" rx="24" fill="#39b782" opacity=".23" stroke="#cbffe4" stroke-opacity=".7" stroke-width="2"/><rect x="77" y="102" width="135" height="169" rx="18" fill="url(#glassA)" stroke="#ddfff0" stroke-opacity=".55"/><circle cx="144" cy="151" r="24" fill="#e4fff1" fill-opacity=".78"/><path d="M105 223 Q144 171 184 223" fill="#a4f4c9" fill-opacity=".7"/><path d="M99 246h87" stroke="#eafff2" stroke-opacity=".72" stroke-width="5" stroke-linecap="round"/></g><g class="svg-float" transform="rotate(11 256 207)"><rect x="189" y="117" width="139" height="175" rx="21" fill="#57cde1" fill-opacity=".2" stroke="#d3f9ff" stroke-opacity=".6" stroke-width="2"/><rect x="200" y="128" width="117" height="153" rx="15" fill="url(#glassB)"/><path d="M225 211 l21 23 43-50" fill="none" stroke="#edfffb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M223 253h71" stroke="#dbfff3" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/></g><g fill="#bdffdc"><path class="svg-sparkle" d="M278 65l6 16 16 6-16 6-6 16-6-16-16-6 16-6z"/><path class="svg-sparkle delay-2" d="M86 55l4 11 11 4-11 4-4 11-4-11-11-4 11-4z"/></g><circle cx="333" cy="168" r="7" fill="#94e8f7" class="svg-pulse"/></svg>',
      team: '<svg viewBox="0 0 400 400" role="img" aria-label="Ba thành viên trong các khối kính nổi"><defs><linearGradient id="avatar1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d6ffe8"/><stop offset="1" stop-color="#58ce98"/></linearGradient><linearGradient id="avatar2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ccf6ff"/><stop offset="1" stop-color="#65bde2"/></linearGradient><linearGradient id="avatar3" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe3d6"/><stop offset="1" stop-color="#e88c9c"/></linearGradient></defs><ellipse cx="200" cy="329" rx="132" ry="25" fill="#000" opacity=".28"/><ellipse cx="200" cy="302" rx="114" ry="20" fill="#83e9b6" fill-opacity=".1" stroke="#acffd1" stroke-opacity=".35"/><g class="svg-float-slow" transform="translate(20 4)"><rect x="60" y="104" width="108" height="180" rx="25" fill="#76e1b1" fill-opacity=".12" stroke="#b6ffda" stroke-opacity=".55"/><circle cx="114" cy="152" r="28" fill="url(#avatar1)" stroke="#e8fff2" stroke-opacity=".8" stroke-width="2"/><path d="M78 256 Q77 205 114 205 Q151 205 150 256Z" fill="url(#avatar1)"/><path d="M96 149 Q113 118 133 148" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/></g><g class="svg-float" transform="translate(2 -15)"><rect x="146" y="70" width="108" height="218" rx="25" fill="#79dff2" fill-opacity=".15" stroke="#d1f9ff" stroke-opacity=".6"/><circle cx="200" cy="130" r="31" fill="url(#avatar2)" stroke="#f0ffff" stroke-opacity=".8" stroke-width="2"/><path d="M160 250 Q160 187 200 187 Q240 187 240 250Z" fill="url(#avatar2)"/><path d="M181 127 Q199 97 219 126" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/></g><g class="svg-float-slow" transform="translate(20 7)"><rect x="234" y="119" width="108" height="165" rx="25" fill="#f1a1aa" fill-opacity=".12" stroke="#ffd5df" stroke-opacity=".55"/><circle cx="288" cy="162" r="27" fill="url(#avatar3)" stroke="#fff0f3" stroke-opacity=".8" stroke-width="2"/><path d="M252 258 Q252 212 288 212 Q324 212 324 258Z" fill="url(#avatar3)"/><path d="M270 160 Q287 132 307 158" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/></g><circle cx="75" cy="74" r="6" fill="#c2ffdd"/><circle cx="325" cy="90" r="8" fill="#a5eafa"/><path d="M79 89 L110 104 M312 104 L290 122" stroke="#b5f6d3" stroke-opacity=".55" stroke-dasharray="4 6"/></svg>',
      pathway: '<svg viewBox="0 0 400 400" role="img" aria-label="Các cơ quan theo hành trình tiêu hóa"><defs><linearGradient id="nodeA" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e5fff0"/><stop offset="1" stop-color="#6ad9a6"/></linearGradient><linearGradient id="nodeB" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd9bf"/><stop offset="1" stop-color="#d97883"/></linearGradient></defs><path d="M65 100 C167 37 264 77 324 153 S286 278 191 309 S91 247 112 213" fill="none" stroke="#9aefc2" stroke-opacity=".42" stroke-width="3" stroke-dasharray="6 9"/><g class="svg-float-slow"><circle cx="94" cy="93" r="43" fill="#41bd8a" fill-opacity=".18" stroke="#c5ffe0" stroke-opacity=".65" stroke-width="2"/><circle cx="94" cy="93" r="32" fill="url(#nodeA)"/><path d="M80 82 Q94 73 108 82 Q119 95 101 107 Q90 115 82 103" fill="none" stroke="#197853" stroke-width="5" stroke-linecap="round"/><circle cx="305" cy="140" r="47" fill="#dd8893" fill-opacity=".14" stroke="#ffd7cf" stroke-opacity=".65" stroke-width="2"/><path d="M291 105 C290 123 304 128 316 130 C334 134 336 159 320 174 C304 189 277 174 277 153 C277 140 288 137 288 126Z" fill="url(#nodeB)"/><circle cx="217" cy="302" r="49" fill="#62d6a1" fill-opacity=".14" stroke="#bdffda" stroke-opacity=".65" stroke-width="2"/><path d="M190 282 Q176 300 192 318 Q208 333 221 311 Q236 294 250 310 Q266 324 247 337" fill="none" stroke="#bbfbd4" stroke-width="9" stroke-linecap="round"/></g><g class="svg-float"><circle cx="130" cy="220" r="29" fill="#a4e5f3" fill-opacity=".2" stroke="#d5fbff" stroke-width="2"/><path d="M117 204v32 M130 204v32 M143 204v32" stroke="#b8f3ff" stroke-width="4" stroke-linecap="round"/><circle cx="277" cy="264" r="23" fill="#8ae7b4" fill-opacity=".2" stroke="#d0ffe4" stroke-width="2"/><path d="M266 264l8 8 15-17" fill="none" stroke="#d4ffe7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><g fill="#d6ffea"><path class="svg-sparkle" d="M215 76l5 13 13 5-13 5-5 13-5-13-13-5 13-5z"/><circle cx="65" cy="283" r="5"/><circle cx="344" cy="218" r="6"/></g></svg>',
      absorption: '<svg viewBox="0 0 400 400" role="img" aria-label="Lông ruột non và các hạt chất dinh dưỡng được hấp thụ"><defs><linearGradient id="villiBase" x1="0" y1="0" x2="0.9" y2="1"><stop stop-color="#ffd8c9"/><stop offset=".52" stop-color="#e98c9d"/><stop offset="1" stop-color="#964b79"/></linearGradient><radialGradient id="nutrientGlow"><stop stop-color="#fbfff0"/><stop offset=".46" stop-color="#b8f7d2"/><stop offset="1" stop-color="#52c99a"/></radialGradient></defs><ellipse cx="204" cy="328" rx="137" ry="20" fill="#000" opacity=".26"/><path d="M61 278 C92 251 124 292 154 269 S216 289 247 266 S308 282 339 259 L339 307 L61 307Z" fill="#9f557e" opacity=".75"/><path d="M62 268 C94 241 126 282 156 259 S218 279 249 256 S310 272 338 249" fill="none" stroke="#ffd9cf" stroke-width="20" stroke-linecap="round"/><g class="svg-float-slow" fill="url(#villiBase)" stroke="#ffdccc" stroke-width="3"><path d="M87 260 C73 233 70 205 84 184 C96 165 115 182 115 202 C115 223 105 244 105 264Z"/><path d="M128 263 C111 231 115 199 133 172 C150 147 170 172 165 196 C161 222 151 244 151 268Z"/><path d="M177 260 C164 230 165 199 184 178 C204 158 220 182 213 208 C207 231 202 246 201 264Z"/><path d="M222 257 C211 228 218 199 237 177 C256 155 274 181 265 207 C259 230 248 245 248 262Z"/><path d="M273 254 C262 229 273 205 288 189 C306 169 322 195 311 220 C304 238 297 247 297 259Z"/></g><g fill="none" stroke="#7edcb3" stroke-width="5" stroke-linecap="round"><path d="M97 250 C99 224 92 214 92 196"/><path d="M143 250 C144 219 151 203 148 186"/><path d="M191 246 C187 225 195 206 198 192"/><path d="M239 244 C241 219 248 206 250 191"/><path d="M287 241 C283 226 296 214 299 205"/></g><g class="svg-float"><circle cx="103" cy="130" r="13" fill="url(#nutrientGlow)"/><circle cx="160" cy="111" r="10" fill="#ffcf81"/><circle cx="214" cy="135" r="15" fill="url(#nutrientGlow)"/><circle cx="268" cy="109" r="11" fill="#8dddf2"/><circle cx="310" cy="150" r="8" fill="#ffd0a2"/></g><g fill="none" stroke="#c6ffdf" stroke-width="2.5" stroke-dasharray="4 8"><path d="M105 149 Q115 157 127 166"/><path d="M163 127 Q168 143 174 161"/><path d="M214 154 Q217 163 221 174"/><path d="M266 126 Q263 147 263 166"/><path d="M308 166 Q306 178 303 188"/></g><g fill="#e3fff0"><path class="svg-sparkle" d="M64 83l5 14 14 5-14 5-5 14-5-14-14-5 14-5z"/><path class="svg-sparkle delay-2" d="M324 67l5 12 12 5-12 5-5 12-5-12-12-5 12-5z"/></g></svg>',
      balance: '<svg viewBox="0 0 400 400" role="img" aria-label="Đĩa dinh dưỡng cân bằng với thực phẩm nhiều màu"><defs><linearGradient id="plateOuter" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0fff5" stop-opacity=".8"/><stop offset=".4" stop-color="#9aeac2" stop-opacity=".3"/><stop offset="1" stop-color="#2c996e" stop-opacity=".12"/></linearGradient><linearGradient id="veg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b5f2a3"/><stop offset="1" stop-color="#29996b"/></linearGradient><linearGradient id="protein" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffc8a5"/><stop offset="1" stop-color="#c86175"/></linearGradient></defs><ellipse cx="202" cy="324" rx="126" ry="24" fill="#000" opacity=".3"/><ellipse class="svg-float-slow" cx="200" cy="196" rx="134" ry="127" fill="#071a12" opacity=".55" transform="translate(0 13)"/><circle class="svg-float" cx="200" cy="184" r="132" fill="url(#plateOuter)" stroke="#dcfff0" stroke-width="4"/><circle cx="200" cy="184" r="108" fill="#102d21" stroke="#d2ffe6" stroke-opacity=".55" stroke-width="3"/><path d="M200 76 A108 108 0 0 1 308 184 L200 184Z" fill="#eec66d"/><path d="M200 184 L308 184 A108 108 0 0 1 200 292Z" fill="url(#veg)"/><path d="M200 184 L200 292 A108 108 0 0 1 92 184Z" fill="url(#protein)"/><path d="M200 184 L92 184 A108 108 0 0 1 200 76Z" fill="#79cfe8"/><g fill="#fff9e7" stroke="#e0ad71" stroke-width="2"><circle cx="160" cy="125" r="13"/><circle cx="181" cy="141" r="11"/><circle cx="236" cy="133" r="13"/><circle cx="257" cy="151" r="9"/></g><g fill="#e4ffe7"><ellipse cx="239" cy="211" rx="22" ry="13" transform="rotate(-35 239 211)"/><ellipse cx="263" cy="236" rx="21" ry="12" transform="rotate(33 263 236)"/><ellipse cx="226" cy="244" rx="19" ry="12" transform="rotate(-12 226 244)"/></g><g fill="#ffdfc8"><ellipse cx="147" cy="223" rx="22" ry="13" transform="rotate(-30 147 223)"/><ellipse cx="170" cy="250" rx="22" ry="13" transform="rotate(20 170 250)"/><ellipse cx="133" cy="254" rx="16" ry="10" transform="rotate(55 133 254)"/></g><path d="M200 48v17m-16-11 6 12m26-12-6 12" stroke="#d3ffe7" stroke-width="3" stroke-linecap="round"/></svg>',
      overview: '<svg viewBox="0 0 400 400" role="img" aria-label="Năm quả cầu đại diện cho năm bệnh"><defs><radialGradient id="sphereMint" cx=".3" cy=".22" r=".8"><stop stop-color="#eafff1"/><stop offset=".35" stop-color="#81e5b3"/><stop offset="1" stop-color="#16744f"/></radialGradient><radialGradient id="sphereCoral" cx=".3" cy=".22" r=".8"><stop stop-color="#fff0e6"/><stop offset=".42" stop-color="#ffa9a5"/><stop offset="1" stop-color="#a84766"/></radialGradient><radialGradient id="sphereBlue" cx=".3" cy=".22" r=".8"><stop stop-color="#e9fdff"/><stop offset=".4" stop-color="#8edff0"/><stop offset="1" stop-color="#3a75ad"/></radialGradient></defs><ellipse cx="205" cy="330" rx="133" ry="20" fill="#000" opacity=".25"/><g class="svg-float-slow"><circle cx="200" cy="129" r="58" fill="url(#sphereMint)" stroke="#dbffeb" stroke-opacity=".72" stroke-width="2"/><ellipse cx="183" cy="111" rx="21" ry="12" fill="#fff" opacity=".26" transform="rotate(-30 183 111)"/><path d="M181 127h37m-30-12v25m22-25v25" stroke="#0c6b48" stroke-width="6" stroke-linecap="round"/><circle cx="111" cy="223" r="46" fill="url(#sphereCoral)" stroke="#ffe1dc" stroke-opacity=".8" stroke-width="2"/><path d="M91 227 Q108 191 126 225 M104 214l-6 24" fill="none" stroke="#953c5f" stroke-width="6" stroke-linecap="round"/><circle cx="285" cy="223" r="46" fill="url(#sphereBlue)" stroke="#e4fcff" stroke-opacity=".8" stroke-width="2"/><path d="M285 186 C276 205 264 218 264 235 C264 264 306 264 306 235 C306 218 294 205 285 186Z" fill="#e4fcff" fill-opacity=".86"/><circle cx="154" cy="309" r="35" fill="url(#sphereBlue)" stroke="#e4fcff" stroke-opacity=".7" stroke-width="2"/><path d="M138 298l16 20 18-24" fill="none" stroke="#215b87" stroke-width="5" stroke-linecap="round"/><circle cx="244" cy="309" r="35" fill="url(#sphereCoral)" stroke="#ffe1dc" stroke-opacity=".7" stroke-width="2"/><path d="M228 309h32m-16-16v32" stroke="#913c5c" stroke-width="5" stroke-linecap="round"/></g><circle cx="88" cy="89" r="5" fill="#d8ffea"/><circle cx="317" cy="92" r="8" fill="#94def2"/><circle cx="333" cy="282" r="5" fill="#ffcabf"/></svg>',
      tooth: '<svg viewBox="0 0 400 400" role="img" aria-label="Răng sâu minh họa có chiều sâu"><defs><linearGradient id="enamel3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffef3"/><stop offset=".4" stop-color="#d9ffe8"/><stop offset=".8" stop-color="#88ddb6"/><stop offset="1" stop-color="#3c9d77"/></linearGradient><linearGradient id="cavity3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a64e60"/><stop offset="1" stop-color="#54283f"/></linearGradient></defs><ellipse cx="208" cy="324" rx="101" ry="22" fill="#000" opacity=".34"/><path d="M122 62 C82 40 53 74 60 117 C67 161 91 190 106 237 C115 269 123 300 145 297 C169 294 165 236 190 208 C207 189 219 212 230 251 C242 291 258 311 277 291 C295 273 297 217 323 167 C348 117 324 66 286 59 C251 53 230 80 201 80 C169 80 145 47 122 62Z" transform="translate(13 14)" fill="#155b44" opacity=".75"/><path class="svg-float" d="M122 62 C82 40 53 74 60 117 C67 161 91 190 106 237 C115 269 123 300 145 297 C169 294 165 236 190 208 C207 189 219 212 230 251 C242 291 258 311 277 291 C295 273 297 217 323 167 C348 117 324 66 286 59 C251 53 230 80 201 80 C169 80 145 47 122 62Z" fill="url(#enamel3d)" stroke="#f5fff8" stroke-width="4"/><path d="M202 80 Q181 113 198 145 Q209 165 194 192" fill="none" stroke="url(#cavity3d)" stroke-width="20" stroke-linecap="round"/><path d="M193 83 Q215 110 211 131" fill="none" stroke="#fff" stroke-opacity=".58" stroke-width="7" stroke-linecap="round"/><ellipse cx="132" cy="107" rx="31" ry="13" fill="#fff" opacity=".47" transform="rotate(-30 132 107)"/><g fill="#f3a1a6" stroke="#ffe3e0" stroke-width="2"><circle cx="79" cy="61" r="9"/><circle cx="322" cy="92" r="8"/><circle cx="334" cy="148" r="11"/></g><g class="svg-sparkle" stroke="#9df3c1" stroke-width="3" stroke-linecap="round"><path d="M57 198v18m-9-9h18"/><path d="M321 233v16m-8-8h16"/></g></svg>',
      toothcare: '<svg viewBox="0 0 400 400" role="img" aria-label="Bàn chải làm sạch răng với các bọt sáng"><defs><linearGradient id="cleanTooth" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffef5"/><stop offset=".6" stop-color="#c7fbe0"/><stop offset="1" stop-color="#6ccca1"/></linearGradient><linearGradient id="brushHandle" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e8fff2"/><stop offset="1" stop-color="#67d8a1"/></linearGradient></defs><ellipse cx="199" cy="326" rx="111" ry="19" fill="#000" opacity=".3"/><path d="M123 82 C90 61 69 94 77 128 C84 158 101 187 111 226 C119 254 128 279 147 278 C168 277 165 228 187 202 C202 184 217 209 226 242 C236 277 251 296 267 277 C284 257 289 211 309 170 C333 125 312 83 281 77 C251 70 230 95 205 94 C172 93 143 68 123 82Z" fill="url(#cleanTooth)" stroke="#effff6" stroke-width="3"/><path d="M72 284 L233 122 Q246 110 258 122 Q268 132 256 146 L93 308 Q77 310 72 296Z" fill="url(#brushHandle)" stroke="#e8fff3" stroke-width="2"/><path d="M231 124l24-24 35 35-24 24Z" fill="#dffaf0" stroke="#9decc4" stroke-width="3"/><g stroke="#4cbb8c" stroke-width="4" stroke-linecap="round"><path d="M244 116l14-13m-4 21 14-13m-4 21 14-13"/></g><g fill="#b1f4d0" stroke="#effff5" stroke-width="2"><circle cx="96" cy="63" r="12"/><circle cx="316" cy="80" r="8"/><circle cx="325" cy="214" r="14"/><circle cx="86" cy="193" r="7"/></g><path class="svg-sparkle" d="M304 264l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" fill="#dcfff0"/></svg>',
      stomach: '<svg viewBox="0 0 400 400" role="img" aria-label="Dạ dày có vùng niêm mạc tổn thương"><defs><linearGradient id="stomach3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd8c4"/><stop offset=".38" stop-color="#f19b9a"/><stop offset=".75" stop-color="#ce718b"/><stop offset="1" stop-color="#803b63"/></linearGradient><radialGradient id="ulcer"><stop stop-color="#6a294b"/><stop offset=".65" stop-color="#b94f72"/><stop offset="1" stop-color="#e68c97"/></radialGradient></defs><ellipse cx="207" cy="327" rx="118" ry="23" fill="#000" opacity=".32"/><path d="M155 48 C151 78 153 100 177 119 C202 138 229 139 264 131 C302 122 324 147 314 184 C303 230 263 254 236 281 C205 310 158 295 128 265 C97 234 80 197 99 158 C110 137 133 129 135 102 L134 49Z" transform="translate(11 10)" fill="#713c66" opacity=".55"/><path class="svg-float" d="M155 48 C151 78 153 100 177 119 C202 138 229 139 264 131 C302 122 324 147 314 184 C303 230 263 254 236 281 C205 310 158 295 128 265 C97 234 80 197 99 158 C110 137 133 129 135 102 L134 49Z" fill="url(#stomach3d)" stroke="#ffdfd0" stroke-width="4"/><path d="M158 71 C157 101 174 128 201 145 C232 166 267 160 292 171" fill="none" stroke="#7a345a" stroke-width="15" stroke-linecap="round"/><path d="M111 181 Q131 151 151 180 Q163 202 184 188 Q205 174 222 201 Q238 225 270 206" fill="none" stroke="#ffd8c7" stroke-width="10" stroke-linecap="round"/><ellipse cx="242" cy="188" rx="22" ry="27" fill="url(#ulcer)" stroke="#ffd0c0" stroke-width="4" transform="rotate(21 242 188)"/><ellipse cx="153" cy="218" rx="17" ry="20" fill="url(#ulcer)" stroke="#ffd0c0" stroke-width="4" transform="rotate(-12 153 218)"/><ellipse cx="122" cy="118" rx="29" ry="12" fill="#fff" opacity=".18" transform="rotate(-36 122 118)"/><g class="svg-pulse" fill="#ffd9c8"><circle cx="280" cy="97" r="6"/><circle cx="93" cy="244" r="7"/></g></svg>',
      stomachcare: '<svg viewBox="0 0 400 400" role="img" aria-label="Dạ dày được bảo vệ bởi tấm khiên y tế"><defs><linearGradient id="careShield" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d8ffea"/><stop offset=".55" stop-color="#73dfac"/><stop offset="1" stop-color="#23855e"/></linearGradient><linearGradient id="careStomach" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd6c4"/><stop offset="1" stop-color="#c96d8b"/></linearGradient></defs><ellipse cx="205" cy="331" rx="117" ry="20" fill="#000" opacity=".3"/><path d="M204 41 L322 84 V181 C322 250 270 298 204 333 C138 298 86 250 86 181 V84Z" fill="#59d59c" fill-opacity=".12" stroke="#c1ffdc" stroke-opacity=".6" stroke-width="3"/><path class="svg-float-slow" d="M204 58 L304 94 V178 C304 236 259 279 204 308 C149 279 104 236 104 178 V94Z" fill="url(#careShield)" fill-opacity=".87" stroke="#eafff1" stroke-width="3"/><path d="M174 111 C172 137 179 150 196 164 C217 182 239 176 259 173 C282 171 291 193 280 216 C265 247 236 264 215 278 C191 294 162 273 145 252 C128 231 122 204 136 183 C145 168 160 163 160 143 L160 111Z" fill="url(#careStomach)" stroke="#fff0e8" stroke-width="3"/><circle cx="232" cy="217" r="13" fill="#994461" stroke="#ffd0c0" stroke-width="4"/><path d="M202 110v44m-22-22h44" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M202 110v44m-22-22h44" stroke="#2c9d6c" stroke-width="5" stroke-linecap="round"/><circle cx="75" cy="116" r="7" fill="#b4f4d0"/><circle cx="333" cy="262" r="9" fill="#b3edff"/></svg>',
      water: '<svg viewBox="0 0 400 400" role="img" aria-label="Giọt nước trong suốt ba chiều"><defs><linearGradient id="waterOuter" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edfff8"/><stop offset=".24" stop-color="#b8f5ff"/><stop offset=".6" stop-color="#5fc5ec"/><stop offset="1" stop-color="#3679bd"/></linearGradient><linearGradient id="waterInner" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".84"/><stop offset="1" stop-color="#9fe8ff" stop-opacity=".05"/></linearGradient></defs><ellipse cx="205" cy="331" rx="95" ry="20" fill="#000" opacity=".28"/><path class="svg-float" d="M200 48 C171 97 108 163 108 226 C108 282 148 321 200 321 C252 321 292 282 292 226 C292 163 229 97 200 48Z" transform="translate(12 13)" fill="#266ca4" opacity=".58"/><path class="svg-float" d="M200 42 C171 91 108 157 108 220 C108 276 148 315 200 315 C252 315 292 276 292 220 C292 157 229 91 200 42Z" fill="url(#waterOuter)" stroke="#e6ffff" stroke-width="4"/><path d="M159 212 C159 247 177 271 205 274" fill="none" stroke="url(#waterInner)" stroke-width="15" stroke-linecap="round"/><ellipse cx="164" cy="152" rx="26" ry="49" fill="#fff" opacity=".27" transform="rotate(31 164 152)"/><g fill="#dffbff" stroke="#fff" stroke-opacity=".65" stroke-width="2"><circle cx="95" cy="105" r="10"/><circle cx="311" cy="132" r="14"/><circle cx="314" cy="254" r="7"/><circle cx="82" cy="260" r="6"/></g><path class="svg-sparkle" d="M294 67l7 18 18 7-18 7-7 18-7-18-18-7 18-7z" fill="#baf4ff"/></svg>',
      watercare: '<svg viewBox="0 0 400 400" role="img" aria-label="Ly nước và gói bù nước minh họa"><defs><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edffff" stop-opacity=".8"/><stop offset=".48" stop-color="#9bdef4" stop-opacity=".27"/><stop offset="1" stop-color="#5a9fd5" stop-opacity=".18"/></linearGradient><linearGradient id="ors" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffefb8"/><stop offset="1" stop-color="#e9ad5f"/></linearGradient></defs><ellipse cx="205" cy="330" rx="125" ry="20" fill="#000" opacity=".3"/><g class="svg-float-slow"><path d="M126 90h110l-10 203q-4 24-23 24h-47q-19 0-23-24Z" fill="url(#glass)" stroke="#ddfbff" stroke-width="4"/><path d="M131 183h100l-5 97q-3 20-18 20h-50q-15 0-18-20Z" fill="#6fd1ee" fill-opacity=".75"/><ellipse cx="181" cy="183" rx="50" ry="8" fill="#d6f8ff" fill-opacity=".55"/><path d="M146 120l7 150" stroke="#fff" stroke-opacity=".5" stroke-width="7" stroke-linecap="round"/></g><g class="svg-float" transform="rotate(9 279 230)"><path d="M244 143h81l-8 153q-1 12-14 12h-36q-13 0-14-12Z" fill="url(#ors)" stroke="#fff0c5" stroke-width="3"/><path d="M243 163h82" stroke="#d39a4b" stroke-width="3"/><rect x="256" y="208" width="57" height="49" rx="7" fill="#fff9e7" fill-opacity=".82"/><path d="M268 224h32m-32 10h25m-25 10h29" stroke="#c88d4f" stroke-width="3" stroke-linecap="round"/></g><circle cx="100" cy="104" r="9" fill="#a8eafa"/><path d="M301 91l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" fill="#d9ffeb" class="svg-sparkle"/></svg>',
      food: '<svg viewBox="0 0 400 400" role="img" aria-label="Mâm thực phẩm tươi nhiều màu"><defs><linearGradient id="foodPlate" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eafff1" stop-opacity=".9"/><stop offset=".5" stop-color="#8be5b5" stop-opacity=".32"/><stop offset="1" stop-color="#297d5a" stop-opacity=".2"/></linearGradient><linearGradient id="tomato" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffbab1"/><stop offset="1" stop-color="#c94c70"/></linearGradient><linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b7f3a5"/><stop offset="1" stop-color="#238f61"/></linearGradient></defs><ellipse cx="203" cy="324" rx="131" ry="24" fill="#000" opacity=".28"/><ellipse cx="200" cy="194" rx="137" ry="130" fill="#11412d" opacity=".65" transform="translate(0 13)"/><ellipse class="svg-float" cx="200" cy="184" rx="137" ry="130" fill="url(#foodPlate)" stroke="#e4fff0" stroke-width="4"/><ellipse cx="200" cy="184" rx="113" ry="106" fill="#0e2118" stroke="#baf5d1" stroke-opacity=".55" stroke-width="3"/><g class="svg-float-slow"><circle cx="151" cy="134" r="36" fill="url(#tomato)"/><path d="M151 100l-6 13 13-4 8 10-2-16" fill="#7ee0a5"/><ellipse cx="238" cy="128" rx="28" ry="38" fill="#f4d082" transform="rotate(22 238 128)"/><path d="M222 112l31 31m-22-44 31 31" stroke="#fff0b6" stroke-opacity=".7" stroke-width="5"/><g fill="url(#leaf)" stroke="#c7ffc0" stroke-width="2"><ellipse cx="247" cy="206" rx="24" ry="39" transform="rotate(35 247 206)"/><ellipse cx="216" cy="219" rx="21" ry="36" transform="rotate(-20 216 219)"/><ellipse cx="267" cy="234" rx="21" ry="31" transform="rotate(52 267 234)"/></g><path d="M124 205q-7-48 28-57q35 17 19 56q-16 31-47 1Z" fill="#b9e9fb"/><path d="M129 193l32-30m-28 51 35-31" stroke="#f2fcff" stroke-width="4"/><circle cx="146" cy="251" r="22" fill="#ffc28f"/><circle cx="146" cy="251" r="12" fill="#f9e5a8"/><circle cx="177" cy="267" r="18" fill="#b0e9f3"/></g><g fill="#e5fff0"><circle cx="93" cy="115" r="5"/><circle cx="303" cy="91" r="7"/><circle cx="315" cy="258" r="5"/></g></svg>',
      foodsafety: '<svg viewBox="0 0 400 400" role="img" aria-label="Thực phẩm an toàn được bảo vệ bằng khiên 3D"><defs><linearGradient id="safeShield" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eafff1"/><stop offset=".45" stop-color="#83e8b3"/><stop offset="1" stop-color="#2d9668"/></linearGradient><linearGradient id="safePlate" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4fff6"/><stop offset="1" stop-color="#64c99b"/></linearGradient></defs><ellipse cx="203" cy="326" rx="125" ry="22" fill="#000" opacity=".3"/><ellipse cx="160" cy="253" rx="82" ry="31" fill="#0d3423" stroke="#b9f8d3" stroke-opacity=".6" stroke-width="3"/><ellipse cx="160" cy="245" rx="79" ry="29" fill="url(#safePlate)" stroke="#e5fff0" stroke-width="3"/><circle cx="136" cy="237" r="17" fill="#ffb4ac"/><ellipse cx="176" cy="233" rx="13" ry="23" fill="#edcf82" transform="rotate(25 176 233)"/><path d="M199 38 L309 80 V167 C309 231 261 276 199 309 C137 276 89 231 89 167 V80Z" transform="translate(13 12)" fill="#12472f" opacity=".58"/><path class="svg-float" d="M199 38 L309 80 V167 C309 231 261 276 199 309 C137 276 89 231 89 167 V80Z" fill="url(#safeShield)" fill-opacity=".9" stroke="#eafff1" stroke-width="4"/><path d="M145 169l35 36 76-86" fill="none" stroke="#126b49" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><path d="M147 164l33 35 73-82" fill="none" stroke="#edfff4" stroke-opacity=".65" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><g fill="#b9f7d2"><circle cx="76" cy="116" r="7"/><circle cx="327" cy="225" r="9"/></g></svg>',
      fiber: '<svg viewBox="0 0 400 400" role="img" aria-label="Táo, rau xanh và nước cho hệ tiêu hóa"><defs><linearGradient id="apple3d" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffedb1"/><stop offset=".45" stop-color="#ffad87"/><stop offset="1" stop-color="#be536d"/></linearGradient><linearGradient id="glassBlue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edffff" stop-opacity=".7"/><stop offset="1" stop-color="#63bce8" stop-opacity=".4"/></linearGradient></defs><ellipse cx="204" cy="325" rx="118" ry="22" fill="#000" opacity=".29"/><g class="svg-float"><path d="M175 100 C143 74 97 95 91 141 C83 197 126 258 161 257 C181 257 187 244 203 257 C233 280 283 210 278 151 C274 104 230 77 196 100 C188 106 181 106 175 100Z" transform="translate(9 9)" fill="#863d58" opacity=".55"/><path d="M175 100 C143 74 97 95 91 141 C83 197 126 258 161 257 C181 257 187 244 203 257 C233 280 283 210 278 151 C274 104 230 77 196 100 C188 106 181 106 175 100Z" fill="url(#apple3d)" stroke="#ffe6c8" stroke-width="4"/><path d="M185 96 C181 71 192 52 216 44" fill="none" stroke="#a6eeb7" stroke-width="10" stroke-linecap="round"/><path d="M202 58 Q238 35 253 62 Q228 86 202 76Z" fill="#75d9a0" stroke="#caffdc" stroke-width="2"/></g><g class="svg-float-slow" transform="rotate(8 286 243)"><path d="M273 169h65l-8 136q-1 15-13 15h-25q-12 0-13-15Z" fill="url(#glassBlue)" stroke="#e7ffff" stroke-width="3"/><path d="M277 235h58l-5 65q-1 10-10 10h-26q-9 0-10-10Z" fill="#70d1ed" fill-opacity=".6"/><ellipse cx="305" cy="235" rx="29" ry="6" fill="#edffff" fill-opacity=".65"/></g><g fill="#8ce5a8" stroke="#d6ffe3" stroke-width="2"><ellipse cx="85" cy="264" rx="19" ry="35" transform="rotate(-24 85 264)"/><ellipse cx="112" cy="277" rx="17" ry="29" transform="rotate(42 112 277)"/></g><circle cx="303" cy="117" r="8" fill="#9eeef5"/><path class="svg-sparkle" d="M91 77l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" fill="#c9ffdc"/></svg>',
      comparison: '<svg viewBox="0 0 400 400" role="img" aria-label="Năm thẻ nổi so sánh các bệnh tiêu hóa"><defs><linearGradient id="tileMint" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e5fff0"/><stop offset="1" stop-color="#69d9a4"/></linearGradient><linearGradient id="tileRose" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe4d9"/><stop offset="1" stop-color="#da8197"/></linearGradient><linearGradient id="tileBlue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e1fbff"/><stop offset="1" stop-color="#75c9e5"/></linearGradient></defs><ellipse cx="203" cy="330" rx="137" ry="20" fill="#000" opacity=".26"/><g class="svg-float-slow" transform="rotate(-12 118 152)"><rect x="65" y="75" width="105" height="145" rx="19" fill="#1c694a" opacity=".7" transform="translate(6 8)"/><rect x="65" y="75" width="105" height="145" rx="19" fill="url(#tileMint)" stroke="#eafff1" stroke-width="2"/><circle cx="118" cy="131" r="26" fill="#f9fff9" fill-opacity=".62"/><path d="M104 122h28m-22-9v22m16-22v22" stroke="#218257" stroke-width="5" stroke-linecap="round"/><path d="M90 175h56" stroke="#2a9667" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/></g><g class="svg-float" transform="rotate(8 208 176)"><rect x="157" y="96" width="103" height="148" rx="18" fill="#5e315a" opacity=".6" transform="translate(6 8)"/><rect x="157" y="96" width="103" height="148" rx="18" fill="url(#tileRose)" stroke="#fff0ec" stroke-width="2"/><circle cx="208" cy="151" r="25" fill="#fff8f3" fill-opacity=".62"/><path d="M194 150q-3-19 15-22q22 2 21 20q-4 17-24 20q-13-2-12-18" fill="none" stroke="#bb5d78" stroke-width="5"/><path d="M181 201h54" stroke="#ba5674" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/></g><g class="svg-float-slow" transform="rotate(-5 291 212)"><rect x="252" y="144" width="91" height="133" rx="18" fill="#275f7d" opacity=".65" transform="translate(5 8)"/><rect x="252" y="144" width="91" height="133" rx="18" fill="url(#tileBlue)" stroke="#edffff" stroke-width="2"/><circle cx="297" cy="195" r="21" fill="#fff" fill-opacity=".72"/><path d="M297 178c-8 14-15 22-15 29q0 15 15 15t15-15c0-7-7-15-15-29Z" fill="#57a9d5"/><path d="M269 245h56" stroke="#4294bc" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/></g><circle cx="77" cy="270" r="9" fill="#a3edc2"/><circle cx="330" cy="94" r="7" fill="#a8ebfa"/><path class="svg-sparkle" d="M218 56l5 14 14 5-14 5-5 14-5-14-14-5 14-5z" fill="#d8ffea"/></svg>',
      habits: '<svg viewBox="0 0 400 400" role="img" aria-label="Sáu thói quen sức khỏe xoay quanh lõi trung tâm"><defs><radialGradient id="habitCore" cx=".28" cy=".22" r=".85"><stop stop-color="#eafff1"/><stop offset=".4" stop-color="#89e8b5"/><stop offset="1" stop-color="#23865e"/></radialGradient><linearGradient id="habitBlue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e8fcff"/><stop offset="1" stop-color="#6cc6e5"/></linearGradient></defs><ellipse cx="205" cy="321" rx="125" ry="24" fill="#000" opacity=".26"/><ellipse cx="200" cy="192" rx="133" ry="115" fill="none" stroke="#a9f4cb" stroke-opacity=".35" stroke-width="2" stroke-dasharray="5 8" transform="rotate(-18 200 192)"/><circle class="svg-float" cx="200" cy="192" r="65" fill="url(#habitCore)" stroke="#e9fff2" stroke-width="4"/><path d="M171 192l20 20 40-45" fill="none" stroke="#176947" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><g class="svg-float-slow"><circle cx="94" cy="102" r="31" fill="url(#habitBlue)" stroke="#f0ffff" stroke-width="2"/><path d="M80 101q14-19 28 0l-3 14H83Z" fill="#4ea7cd"/><circle cx="301" cy="102" r="31" fill="#f5cd80" stroke="#fff4d0" stroke-width="2"/><path d="M289 108q12-30 24 0q-12 17-24 0" fill="#f3fff0"/><circle cx="324" cy="225" r="31" fill="#e9a0aa" stroke="#ffe9ec" stroke-width="2"/><path d="M311 225h26m-13-13v26" stroke="#974961" stroke-width="5" stroke-linecap="round"/><circle cx="249" cy="305" r="31" fill="#93e8ae" stroke="#e7fff0" stroke-width="2"/><path d="M236 303q13-15 26 0m-22 7q9 6 18 0" fill="none" stroke="#2b8e5d" stroke-width="4" stroke-linecap="round"/><circle cx="77" cy="238" r="31" fill="url(#habitBlue)" stroke="#f0ffff" stroke-width="2"/><path d="M67 227l10 11-10 12m20-23-10 11 10 12" fill="none" stroke="#4a9fca" stroke-width="4" stroke-linecap="round"/><circle cx="151" cy="312" r="31" fill="#e6b1e9" stroke="#f9e7ff" stroke-width="2"/><path d="M139 312h24m-12-12v24" stroke="#9657a1" stroke-width="4" stroke-linecap="round"/></g><g stroke="#b8f8d3" stroke-opacity=".65" stroke-width="2"><path d="M119 124l37 36M275 124l-29 36M299 211l-33-8M237 280l-14-29M102 253l45-31M166 287l18-33"/></g><circle cx="201" cy="105" r="5" fill="#dffff0"/></svg>',
      sources: '<svg viewBox="0 0 400 400" role="img" aria-label="Sổ tay khoa học và tài liệu tham khảo ba chiều"><defs><linearGradient id="bookCover" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d4ffe6"/><stop offset=".52" stop-color="#6edda7"/><stop offset="1" stop-color="#267b59"/></linearGradient><linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffef1"/><stop offset="1" stop-color="#d1efdd"/></linearGradient><linearGradient id="bookBlue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dffaff"/><stop offset="1" stop-color="#67bfe0"/></linearGradient></defs><ellipse cx="201" cy="324" rx="129" ry="21" fill="#000" opacity=".28"/><g class="svg-float-slow" transform="rotate(-9 166 205)"><rect x="80" y="94" width="146" height="218" rx="14" fill="#246b4e" transform="translate(8 9)"/><rect x="80" y="94" width="146" height="218" rx="14" fill="url(#bookCover)" stroke="#eafff1" stroke-width="3"/><rect x="93" y="109" width="120" height="188" rx="7" fill="url(#paper)"/><path d="M109 141h86m-86 20h78m-78 20h87m-87 20h65" stroke="#79b799" stroke-width="5" stroke-linecap="round"/><circle cx="153" cy="248" r="26" fill="#b1efc9"/><path d="M137 251l12 12 23-28" fill="none" stroke="#27875d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g><g class="svg-float" transform="rotate(11 261 208)"><rect x="220" y="128" width="100" height="173" rx="13" fill="#316e8a" opacity=".8" transform="translate(6 8)"/><rect x="220" y="128" width="100" height="173" rx="13" fill="url(#bookBlue)" stroke="#e8fdff" stroke-width="3"/><path d="M237 159h65m-65 15h54m-54 15h60" stroke="#efffff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/><circle cx="270" cy="238" r="24" fill="#fff" fill-opacity=".65"/><path d="M259 239l8 8 16-19" fill="none" stroke="#468eb4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g><g fill="#b9f5d1"><circle cx="70" cy="78" r="7"/><circle cx="327" cy="97" r="9"/></g><path class="svg-sparkle" d="M300 61l6 16 16 6-16 6-6 16-6-16-16-6 16-6z" fill="#d9fff0"/></svg>',
      closing: '<svg viewBox="0 0 400 400" role="img" aria-label="Cảnh kết thúc với ánh sáng và những dải chuyển động"><defs><radialGradient id="closingCore"><stop stop-color="#e9fff1" stop-opacity=".95"/><stop offset=".45" stop-color="#82eab3" stop-opacity=".5"/><stop offset="1" stop-color="#4ac58e" stop-opacity="0"/></radialGradient><linearGradient id="ribbonA" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d7ffe9"/><stop offset=".48" stop-color="#81e4b1"/><stop offset="1" stop-color="#3d9fce"/></linearGradient></defs><ellipse cx="203" cy="333" rx="124" ry="19" fill="#000" opacity=".24"/><circle cx="200" cy="190" r="132" fill="url(#closingCore)"/><ellipse class="svg-float-slow" cx="200" cy="192" rx="99" ry="125" fill="none" stroke="#aaf5ca" stroke-opacity=".65" stroke-width="2" transform="rotate(35 200 192)"/><ellipse class="svg-float" cx="200" cy="192" rx="125" ry="78" fill="none" stroke="#92e5f0" stroke-opacity=".75" stroke-width="3" transform="rotate(-34 200 192)"/><ellipse cx="200" cy="192" rx="78" ry="120" fill="none" stroke="#effff5" stroke-opacity=".3" stroke-width="2" transform="rotate(67 200 192)"/><circle cx="200" cy="190" r="50" fill="url(#ribbonA)" stroke="#eafff2" stroke-width="3"/><path d="M172 190l19 19 39-42" fill="none" stroke="#196b49" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><g fill="#e5fff0"><path class="svg-sparkle" d="M108 71l7 18 18 7-18 7-7 18-7-18-18-7 18-7z"/><path class="svg-sparkle delay-2" d="M304 251l5 13 13 5-13 5-5 13-5-13-13-5 13-5z"/><circle cx="306" cy="95" r="6"/><circle cx="83" cy="258" r="5"/></g></svg>'
    };
    const fallback = drawings.digestive;
    const image = drawings[type] || fallback;
    const safeType = /^[a-z]+$/.test(type) ? type : "digestive";
    const sceneNumber = String(Object.keys(captions).indexOf(type) + 1).padStart(2, "0");
    return '<aside class="slide-art scene scene--' + safeType + '" aria-label="' + escapeHTML(captions[type] || "Minh họa khoa học") + '">' +
      '<div class="art-backplane"></div><div class="art-orbit art-orbit--one"></div><div class="art-orbit art-orbit--two"></div>' +
      '<div class="art-bloom art-bloom--a"></div><div class="art-bloom art-bloom--b"></div>' +
      '<div class="art-illustration">' + image + '</div>' +
      '<div class="art-glass-chip"><span></span> BIOLOGY / 3D VISUAL</div>' +
      '<div class="art-caption"><i></i><span>' + escapeHTML(captions[type] || "BIOSPHERE / SCIENCE") + '</span><b>' + sceneNumber + '</b></div>' +
    '</aside>';
  }

  function toast(message) {
    const region = $('#toastRegion');
    if (!region) return;
    // Reuse one live announcement so rapid setting changes never stack or overlap toasts.
    let item = region.querySelector('.toast');
    if (!item) {
      item = document.createElement('div');
      item.className = 'toast';
      region.append(item);
    }
    item.textContent = message;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      item.remove();
      toastTimer = 0;
    }, 2800);
  }

  function renderDecks() {
    const query = $('#searchDecks').value.trim().toLocaleLowerCase('vi');
    const filtered = decks.filter(deck => {
      const searchable = (deck.title + ' ' + deck.description + ' ' + formatSubject(deck.subject)).toLocaleLowerCase('vi');
      const matchesQuery = searchable.includes(query);
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'draft' ? deck.status === 'draft' : deck.subject === activeFilter);
      return matchesQuery && matchesFilter;
    });

    $('#allCount').textContent = String(decks.length).padStart(2, '0');
    $('#deckGrid').innerHTML = filtered.map((deck, position) => {
      const state = deck.status === 'ready' ? 'HOÀN THIỆN' : 'BẢN NHÁP';
      const slideCount = Array.isArray(deck.slides) ? deck.slides.length : 0;
      return `
        <article class="deck-card">
          <div class="deck-cover">
    ${deck.slides?.[0]?.image ? '<img class="deck-cover-photo" src="' + escapeHTML(safeHttpUrl(deck.slides[0].image)) + '" alt="" loading="lazy" decoding="async" data-fallback="https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1000&q=70">' : ''}
            <div class="deck-cover-shade"></div>
            <div class="cover-top"><span>${formatSubject(deck.subject)}</span><span>${String(position + 1).padStart(2, '0')} / ${escapeHTML(deck.date || 'LOCAL')}</span></div>
            <div class="cover-title">${escapeHTML(deck.title)}</div>
            <div class="cover-foot"><span>BIOSPHERE / SLIDES</span><span>${deck.isSeed ? 'BÀI 32 · TƯƠNG TÁC' : 'BẢN NHÁP'}</span></div>
          </div>
          <div class="deck-body">
            <h3>${escapeHTML(deck.title)}</h3>
            <p>${escapeHTML(deck.description || 'Bản nháp bài thuyết trình.')}</p>
            <div class="tags"><span class="tag">${formatSubject(deck.subject)}</span><span class="tag">${slideCount} trang</span><span class="tag">${state}</span></div>
            <div class="card-foot"><small>${escapeHTML(deck.date || 'LOCAL')}</small><div><button class="small-btn" data-share="${escapeHTML(deck.id)}">Chia sẻ</button> <button class="small-btn" data-present="${escapeHTML(deck.id)}">Trình chiếu ↗</button></div></div>
          </div>
        </article>`;
    }).join('');

    $('#emptyState').classList.toggle('hidden', filtered.length > 0);
    $('#deckGrid').classList.toggle('hidden', filtered.length === 0);
    attachLiveImageFallbacks($('#deckGrid'));
  }

  function showView(view, updateURL = true) {
    if (!['library', 'templates', 'settings'].includes(view)) view = 'library';
    activeView = view;
    $$('[data-view-panel]').forEach(panel => {
      const visible = panel.dataset.viewPanel === view;
      panel.hidden = !visible;
      panel.classList.toggle('active', visible);
    });
    $$('[data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('#mainNav').classList.remove('open');
    if (updateURL && location.hash.slice(1) !== view) history.pushState({ view }, '', '#' + view);
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  function openModal(id) {
    const modal = $('#' + id);
    if (!modal) return;
    previousFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('input,select,textarea,button')?.focus();
  }

  function closeModal(modal) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (!$('.modal-backdrop:not([hidden])') && $('#presentationViewer').hidden) document.body.style.overflow = '';
    previousFocus?.focus?.();
  }

  function makeDeck(formData, template = 'science') {
    const title = String(formData.get('title') || '').trim();
    if (!title) return;
    const subject = String(formData.get('subject') || 'biology');
    const description = String(formData.get('description') || '').trim() || 'Bản nháp mới — bổ sung nội dung sau khi đối chiếu tài liệu.';
    const deck = {
      id: 'deck-' + Date.now().toString(36),
      title,
      subject,
      status: String(formData.get('status') || 'draft'),
      date: new Date().toISOString().slice(0, 10),
      description,
      template,
      isSeed: false,
      slides: [
        { kicker: formatSubject(subject), title, subtitle: description, points: [], note: 'BIOLOGY / DRAFT' },
        { kicker: 'Ý CHÍNH / 01', title: 'Thông tin đã kiểm chứng', subtitle: 'Bổ sung nội dung sau khi đối chiếu tài liệu và yêu cầu của giáo viên.', points: ['Ý chính thứ nhất — chờ tài liệu.', 'Ý chính thứ hai — chờ tài liệu.', 'Nguồn tham khảo — ghi rõ xuất xứ.'], note: 'DRAFT / VERIFY SOURCES' },
        { kicker: 'TỔNG KẾT', title: 'Điều cần ghi nhớ', subtitle: 'Tóm lược nội dung rút ra từ tài liệu nguồn.', points: ['Nhắc lại nội dung trọng tâm.', 'Nêu điều người nghe cần nhớ.'], note: 'DRAFT' }
      ]
    };
    decks.unshift(deck);
    persist();
    renderDecks();
  attachLiveImageFallbacks(document);
    closeModal($('#createModal'));
    $('#createForm').reset();
    showView('library');
    toast('Đã tạo bản nháp trên thiết bị này.');
    return deck;
  }

  function present(id) {
    const requested = decks.find(deck => deck.id === id);
    if (!requested) {
      toast('Không tìm thấy bản nháp này trên thiết bị.');
      return;
    }
    currentDeck = requested;
    slideIndex = 0;
    $('#slideStage').innerHTML = '';
    $('#presentationViewer').hidden = false;
    setViewerUIHidden(false);
    closeContents(false);
    document.body.style.overflow = 'hidden';
    startStageAtmosphere();
    $('#viewerDeckTitle').textContent = currentDeck.title;
    renderSlide();
    if (location.hash !== '#present/' + encodeURIComponent(currentDeck.id)) {
      history.pushState({ presentation: currentDeck.id }, '', '#present/' + encodeURIComponent(currentDeck.id));
    }
  }


  function renderInteractive3D(slide) {
    const type = String(slide.model3D || 'intestine');
    const image = safeHttpUrl(slide.modelFallback || slide.imageFallback || slide.image || '');
    const alt = String(slide.modelFallbackAlt || slide.imageFallbackAlt || slide.imageAlt || 'Hình minh họa mô hình giải phẫu');
    const fallbackSourceUrl = safeHttpUrl(slide.modelFallbackSourceUrl || slide.imageFallbackSourceUrl || '');
    const fallbackCredit = String(slide.modelFallbackCredit || slide.imageFallbackCredit || '');
    const fallbackLicenseUrl = safeHttpUrl(slide.modelFallbackLicense || slide.imageFallbackLicense || '');
    const fallbackLicenseLabel = String(slide.modelFallbackLicenseLabel || slide.imageFallbackLicenseLabel || 'Giấy phép ảnh dự phòng');
    const title = String(slide.modelTitle || 'Mô hình tương tác');
    const description = String(slide.modelDescription || 'Mô hình sơ đồ tương tác.');
    const modelSrc = safeHttpUrl(slide.modelSrc || '');
    const modelEmbed = safeHttpUrl(slide.modelEmbed || '');
    const sourceUrl = safeHttpUrl(slide.modelSourceUrl || '');
    const credit = String(slide.modelCredit || 'Mô hình sơ đồ minh họa BioSphere');
    const license = safeHttpUrl(slide.modelLicense || '');
    const licenseLabel = String(slide.modelLicenseLabel || 'Giấy phép mô hình');
    const annotationGuides = {
      tooth: {
        title: 'CẤU TRÚC RĂNG',
        items: [
          ['Men răng', 'Lớp ngoài cứng giúp bảo vệ thân răng.'],
          ['Ngà răng', 'Mô nằm dưới men răng, góp phần tạo cấu trúc chính của răng.'],
          ['Tủy răng', 'Vùng mô mềm bên trong có mạch máu và thần kinh.'],
          ['Liên hệ sâu răng', 'Axit do vi khuẩn tạo ra từ đường có thể làm men răng mất khoáng. Mẫu này không đánh dấu riêng ổ sâu.']
        ]
      },
      stomach: {
        title: 'DẠ DÀY VÀ NIÊM MẠC',
        items: [
          ['Thân dạ dày', 'Nơi chứa và nhào trộn thức ăn trong quá trình tiêu hóa.'],
          ['Niêm mạc', 'Lớp lót phía trong, góp phần bảo vệ thành dạ dày.'],
          ['Liên hệ loét', 'Tổn thương loét được giải thích bằng ảnh và sơ đồ riêng, không phải điểm đánh dấu trên mô hình này.']
        ]
      },
      intestine: {
        title: 'RUỘT NON VÀ HẤP THU',
        items: [
          ['Ruột non', 'Tham gia tiêu hóa và hấp thu phần lớn chất dinh dưỡng.'],
          ['Niêm mạc ruột', 'Bề mặt bên trong giúp tăng diện tích tiếp xúc cho hấp thu.'],
          ['Liên hệ tiêu chảy', 'Tiêu chảy có thể gây mất nước và chất điện giải; mô hình không mô tả tác nhân gây bệnh.'],
        ['Giới hạn mô hình', 'Mẫu tham chiếu tập trung vào ruột non; các mốc màu không phải dấu hiệu tổn thương hay nhiễm bệnh.']
        ]
      },
      worm: {
        title: 'GIUN VÀ ĐƯỜNG LÂY',
        items: [
          ['Giun đường ruột', 'Một số loài giun có thể ký sinh trong ruột người.'],
          ['Đường lây', 'Con đường lây phụ thuộc loài giun; không phải mọi loài đều có cùng vòng đời.'],
          ['Phòng tránh', 'Giữ vệ sinh tay, nước và thực phẩm; trao đổi với người lớn hoặc nhân viên y tế khi cần.'],
        ['Giới hạn mô hình', 'Hình dựng giúp quan sát thân giun thuôn hai đầu; không phải ảnh quét sinh học và không đại diện cho mọi loài giun.']
        ]
      },
      liver: {
        title: 'GAN VÀ VIÊM GAN A',
        items: [
          ['Gan', 'Cơ quan tham gia chuyển hóa và xử lý nhiều chất trong cơ thể.'],
          ['Virus HAV', 'Virus viêm gan A lây chủ yếu qua đường phân–miệng và gây viêm gan.'],
          ['Giới hạn mô hình', 'Mô hình dùng để định vị cơ quan; không hiển thị virus hay mức độ tổn thương.']
        ]
      }
    };
    const annotationGuide = annotationGuides[type] || {
      title: 'GỢI Ý QUAN SÁT',
      items: [['Quan sát mô hình', 'Đối chiếu hình dạng, vị trí và vai trò của cơ quan với nội dung trên slide.']]
    };
    const annotationsHtml = '<button type="button" class="anatomy3d-annotation-toggle" data-model-action="annotations" aria-expanded="false" aria-controls="anatomy3d-annotations">✦ Chú thích</button>' +
      '<section class="anatomy3d-annotation-panel" id="anatomy3d-annotations" aria-label="Chú thích liên hệ bài học" hidden>' +
        '<div class="anatomy3d-annotation-heading"><span>GỢI Ý QUAN SÁT</span><strong>' + escapeHTML(annotationGuide.title) + '</strong></div>' +
        '<ul>' + annotationGuide.items.map(item => '<li><strong>' + escapeHTML(item[0]) + '</strong><span>' + escapeHTML(item[1]) + '</span></li>').join('') + '</ul>' +
        '<p>Chú thích liên hệ kiến thức; không phải điểm ghim tọa độ trên mô hình.</p>' +
      '</section>';
    return '<aside class="anatomy3d-panel' + (modelEmbed ? ' anatomy3d-panel--embed' : '') + '" data-anatomy3d="' + escapeHTML(type) + '"' +
      (modelSrc ? ' data-model-src="' + escapeHTML(modelSrc) + '"' : '') +
      (modelEmbed ? ' data-model-embed="' + escapeHTML(modelEmbed) + '"' : '') +
      ' data-model-title="' + escapeHTML(title) + '" aria-label="' + escapeHTML(title) + '">' +
      '<div class="anatomy3d-topline"><span>BIOSPHERE / 3D</span><span class="anatomy3d-status" role="status" aria-live="polite">Sẵn sàng mở mô hình</span></div>' +
      annotationsHtml +
      (image ? '<img class="anatomy3d-fallback" data-fallback-src="' + escapeHTML(image) + '" alt="' + escapeHTML(alt) + '" decoding="async" loading="lazy">' : '') +
      '<div class="anatomy3d-native-slot"></div>' +
      '<div class="anatomy3d-canvas" aria-hidden="true"></div>' +
      '<div class="anatomy3d-title"><strong>' + escapeHTML(title) + '</strong><span>' + escapeHTML(description) + '</span></div>' +
      (modelEmbed ? '<div class="anatomy3d-embed-hint">Xoay và phóng to bằng điều khiển ngay trong mô hình.</div>' :
        '<div class="anatomy3d-controls" role="group" aria-label="Điều khiển mô hình 3D">' +
          '<button type="button" data-model-action="rotate" aria-pressed="false">Tự xoay</button>' +
          '<button type="button" data-model-action="zoom-out" aria-label="Thu nhỏ mô hình">−</button>' +
          '<button type="button" data-model-action="zoom-in" aria-label="Phóng to mô hình">＋</button>' +
          '<button type="button" data-model-action="reset">Đặt lại</button>' +
        '</div>') +
      '<div class="anatomy3d-attribution">' +
        (sourceUrl ? '<a href="' + escapeHTML(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(credit) + ' ↗</a>' : '<span>' + escapeHTML(credit) + '</span>') +
        (license ? '<a href="' + escapeHTML(license) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(licenseLabel) + '</a>' : '') +
      '</div>' +
      (fallbackCredit || fallbackSourceUrl || fallbackLicenseUrl
        ? '<div class="anatomy3d-fallback-credit"><span>Ảnh dự phòng:</span> ' +
          (fallbackSourceUrl ? '<a href="' + escapeHTML(fallbackSourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(fallbackCredit || 'Nguồn ảnh') + '</a>' : '<span>' + escapeHTML(fallbackCredit || 'Nguồn ảnh chưa ghi rõ') + '</span>') +
          (fallbackLicenseUrl ? ' · <a href="' + escapeHTML(fallbackLicenseUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(fallbackLicenseLabel) + '</a>' : '') +
          '</div>'
        : '') +
      '<div class="anatomy3d-footnote">' + (modelEmbed ? 'Mô hình tương tác · xem nguồn và giấy phép bên dưới.' : (modelSrc ? 'Xoay bằng chuột · cuộn để phóng to · mô hình tham chiếu giải phẫu' : 'Kéo chuột để xoay · lăn chuột để phóng to · mô hình sơ đồ minh họa')) + '</div>' +
    '</aside>';
  }

  function renderMediaModeBar(className = '') {
    return '<div class="media-mode-bar ' + className + '">' +
      '<span class="media-mode-label">KHÁM PHÁ HÌNH ẢNH</span>' +
      '<div class="media-mode-switch" role="group" aria-label="Chọn cách xem hình ảnh">' +
        '<button type="button" class="media-mode-button is-active" data-media-mode="image" aria-pressed="true"><span aria-hidden="true">▧</span> Ảnh gốc</button>' +
        '<button type="button" class="media-mode-button" data-media-mode="model" aria-pressed="false"><span aria-hidden="true">◈</span> Mô hình 3D</button>' +
      '</div>' +
    '</div>';
  }

  function renderMediaWithModel(slide) {
    const image = slide.image ? renderPhoto(slide) : renderVisual(slide.visual);
    return '<div class="media-experience" data-media-type="' + escapeHTML(String(slide.model3D || 'anatomy')) + '">' +
      renderMediaModeBar('media-mode-bar--desktop') +
      '<div class="media-image-view is-active">' + image + '</div>' +
      '<div class="media-3d-view" hidden>' + renderInteractive3D(slide) + '</div>' +
    '</div>';
  }

  function ensureThreeLibrary() {
    if (window.THREE && window.THREE.WebGLRenderer) return Promise.resolve(window.THREE);
    if (threeLoadPromise) return threeLoadPromise;
    const pending = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-biosphere-three]');
      if (existing) {
        existing.addEventListener('load', () => window.THREE ? resolve(window.THREE) : reject(new Error('3D library did not initialize')), { once: true });
        existing.addEventListener('error', () => reject(new Error('3D library failed to load')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js';
      script.async = true;
      script.dataset.biosphereThree = 'true';
      script.onload = () => window.THREE ? resolve(window.THREE) : reject(new Error('3D library did not initialize'));
      script.onerror = () => reject(new Error('3D library failed to load'));
      document.head.appendChild(script);
    });
    threeLoadPromise = pending.catch(error => {
      threeLoadPromise = null;
      document.querySelector('script[data-biosphere-three]')?.remove();
      throw error;
    });
    return threeLoadPromise;
  }

  function disposeInteractiveModel() {
    const model = activeAnatomy3D;
    if (!model) return;
    activeAnatomy3D = null;
    delete model.panel.dataset.modelInitializing;
    const annotationPanel = model.panel.querySelector('.anatomy3d-annotation-panel');
    const annotationToggle = model.panel.querySelector('[data-model-action="annotations"]');
    if (annotationPanel) annotationPanel.hidden = true;
    if (annotationToggle) {
      annotationToggle.setAttribute('aria-expanded', 'false');
      annotationToggle.textContent = '✦ Chú thích';
    }
    if (model.kind === 'embed') {
      window.clearTimeout(model.timeoutId);
      model.iframe?.removeEventListener('biosphere-viewer-ready', model.onReady);
      model.iframe?.removeEventListener('biosphere-viewer-error', model.onError);
      if (model.iframe) model.iframe.src = 'about:blank';
      model.iframe?.remove();
      model.panel.classList.remove('is-embed-loading', 'is-embed-ready', 'is-embed-failed');
      const status = model.panel.querySelector('.anatomy3d-status');
      if (status) status.textContent = 'Sẵn sàng mở mô hình';
      return;
    }
    if (model.kind === 'native') {
      if (model.visibilityHandler) document.removeEventListener('visibilitychange', model.visibilityHandler);
      model.viewer.removeEventListener('load', model.onLoad);
      model.viewer.removeEventListener('error', model.onError);
      model.viewer.removeEventListener('progress', model.onProgress);
      model.viewer.removeAttribute('src');
      model.viewer.remove();
      model.panel.classList.remove('is-native-loading', 'is-native-ready');
      return;
    }
    if (model.frame) cancelAnimationFrame(model.frame);
    if (model.visibilityHandler) document.removeEventListener('visibilitychange', model.visibilityHandler);
    model.resizeObserver?.disconnect();
    window.removeEventListener('resize', model.onResize);
    model.panel.removeEventListener('pointerdown', model.onPointerDown);
    model.panel.removeEventListener('pointermove', model.onPointerMove);
    model.panel.removeEventListener('pointerup', model.onPointerUp);
    model.panel.removeEventListener('pointercancel', model.onPointerUp);
    model.panel.removeEventListener('wheel', model.onWheel);
    model.group.traverse(object => {
      if (object.geometry?.dispose) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose?.());
      }
    });
    model.renderer.dispose();
    model.renderer.domElement.remove();
    model.panel.classList.remove('is-3d-ready');
  }

  function makeTube(THREE, group, points, color, radius = 0.07, tubularSegments = 56, tapered = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(point[0], point[1], point[2] || 0)));
    const radialSegments = tapered ? 12 : 10;
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
    if (tapered) {
      const positions = geometry.attributes.position, ringSize = radialSegments + 1;
      for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments, edge = Math.max(0, Math.min(1, t / 0.18, (1 - t) / 0.18)), smooth = edge * edge * (3 - 2 * edge), scale = 0.045 + 0.955 * smooth, center = curve.getPointAt(t);
        for (let j = 0; j <= radialSegments; j++) {
          const index = i * ringSize + j;
          positions.setXYZ(index, center.x + (positions.getX(index) - center.x) * scale, center.y + (positions.getY(index) - center.y) * scale, center.z + (positions.getZ(index) - center.z) * scale);
        }
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    const material = tapered ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.29, metalness: 0, clearcoat: 0.62, clearcoatRoughness: 0.24 }) : new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.02 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function makeEllipsoid(THREE, group, position, scale, color) {
    const geometry = new THREE.SphereGeometry(1, 24, 18);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.02 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2] || 0);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    group.add(mesh);
    return mesh;
  }

  function makeExtrudedShape(THREE, group, shape, color, depth = 0.34, z = 0, bevel = 0.045, materialOptions = {}) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelSegments: 4, steps: 1,
      bevelSize: bevel, bevelThickness: bevel, curveSegments: 32
    });
    geometry.translate(0, 0, -depth / 2);
    const base = { color, roughness: 0.42, metalness: 0.01 };
    const material = new THREE.MeshPhysicalMaterial({ ...base, ...materialOptions });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = z;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function makeToothShape(THREE, scale = 1) {
    const shape = new THREE.Shape();
    const p = (x, y) => [x * scale, y * scale];
    let a = p(-0.58, 0.84); shape.moveTo(a[0], a[1]);
    a = p(-0.28, 1.02); const b = p(0.12, 0.98); const c = p(0.51, 0.82);
    shape.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]);
    a = p(0.90, 0.63); const d = p(0.76, 0.28); const e = p(0.49, 0.06);
    shape.bezierCurveTo(a[0], a[1], d[0], d[1], e[0], e[1]);
    a = p(0.33, -0.10); const f = p(0.38, -0.53); const g = p(0.20, -0.92);
    shape.bezierCurveTo(a[0], a[1], f[0], f[1], g[0], g[1]);
    a = p(0.13, -1.06); const h = p(-0.02, -1.06); const i = p(-0.12, -0.91);
    shape.bezierCurveTo(a[0], a[1], h[0], h[1], i[0], i[1]);
    a = p(-0.30, -0.55); const j = p(-0.27, -0.18); const k = p(-0.43, 0.04);
    shape.bezierCurveTo(a[0], a[1], j[0], j[1], k[0], k[1]);
    a = p(-0.72, 0.25); const l = p(-0.88, 0.60); const m = p(-0.58, 0.84);
    shape.bezierCurveTo(a[0], a[1], l[0], l[1], m[0], m[1]);
    shape.closePath();
    return shape;
  }

  function makeStomachShape(THREE) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.16, 0.82);
    shape.bezierCurveTo(-0.36, 0.66, -0.34, 0.43, -0.23, 0.25);
    shape.bezierCurveTo(-0.43, 0.08, -0.63, -0.24, -0.43, -0.48);
    shape.bezierCurveTo(-0.21, -0.76, 0.18, -0.78, 0.43, -0.54);
    shape.bezierCurveTo(0.63, -0.35, 0.54, -0.12, 0.37, 0.02);
    shape.bezierCurveTo(0.19, 0.18, 0.19, 0.34, 0.37, 0.43);
    shape.bezierCurveTo(0.54, 0.52, 0.61, 0.68, 0.47, 0.82);
    shape.bezierCurveTo(0.29, 0.99, 0.03, 0.95, -0.16, 0.82);
    shape.closePath();
    return shape;
  }

  function buildModelGeometry(THREE, type, group) {
    if (type === 'tooth') {
      // Explanatory cutaway schematic: enamel, dentin, pulp and a visible caries spot.
      makeExtrudedShape(THREE, group, makeToothShape(THREE, 1), '#f0e4cb', 0.46, 0, 0.075, { roughness: 0.23, clearcoat: 0.92, clearcoatRoughness: 0.18 });
      makeExtrudedShape(THREE, group, makeToothShape(THREE, 0.72), '#d9a36c', 0.22, 0.25, 0.03, { roughness: 0.42 });
      makeExtrudedShape(THREE, group, makeToothShape(THREE, 0.32), '#cd6d88', 0.12, 0.39, 0.018, { roughness: 0.35 });
      makeTube(THREE, group, [[-0.08, 0.02, 0.47], [-0.15, -0.31, 0.45], [-0.18, -0.62, 0.43], [-0.10, -0.86, 0.42]], '#be5d77', 0.025, 42);
      makeTube(THREE, group, [[0.04, 0.01, 0.47], [0.10, -0.31, 0.45], [0.14, -0.62, 0.43], [0.12, -0.84, 0.42]], '#be5d77', 0.022, 42);
      makeEllipsoid(THREE, group, [0.46, 0.58, 0.40], [0.16, 0.135, 0.045], '#986344');
      makeEllipsoid(THREE, group, [0.47, 0.59, 0.445], [0.082, 0.068, 0.026], '#4d3331');
      makeTube(THREE, group, [[-0.61, 0.20, 0.28], [-0.39, 0.07, 0.31], [-0.12, 0.02, 0.32], [0.18, 0.02, 0.31]], '#d9a4aa', 0.036, 40);
      return;
    }
    if (type === 'stomach') {
      // Stomach cutaway schematic with mucosal folds; the ulcer marker is illustrative, not clinical imagery.
      makeExtrudedShape(THREE, group, makeStomachShape(THREE), '#c96e86', 0.42, 0.03, 0.075, { roughness: 0.34, clearcoat: 0.38, clearcoatRoughness: 0.35 });
      makeTube(THREE, group, [[-0.16, 1.22, 0.04], [-0.18, 0.94, 0.12], [-0.16, 0.71, 0.15], [-0.17, 0.49, 0.20]], '#efb3ba', 0.095);
      makeTube(THREE, group, [[0.37, -0.42, 0.20], [0.57, -0.42, 0.16], [0.69, -0.24, 0.08], [0.55, -0.04, 0.08]], '#e8a2ac', 0.075);
      [
        [[-0.30, 0.30, 0.26], [-0.14, 0.36, 0.29], [0.02, 0.28, 0.29], [0.16, 0.20, 0.26]],
        [[-0.32, 0.12, 0.28], [-0.12, 0.18, 0.31], [0.08, 0.10, 0.30], [0.18, 0.02, 0.26]],
        [[-0.29, -0.06, 0.28], [-0.11, -0.01, 0.31], [0.08, -0.08, 0.29], [0.17, -0.17, 0.25]],
        [[-0.20, -0.25, 0.24], [-0.03, -0.20, 0.28], [0.13, -0.27, 0.25]]
      ].forEach((fold, i) => makeTube(THREE, group, fold, i % 2 ? '#f2b2be' : '#e58fa3', 0.018, 38));
      makeEllipsoid(THREE, group, [0.20, 0.19, 0.30], [0.13, 0.10, 0.035], '#f0c28f');
      makeEllipsoid(THREE, group, [0.20, 0.19, 0.34], [0.065, 0.048, 0.022], '#8b405b');
      makeEllipsoid(THREE, group, [0.20, 0.19, 0.36], [0.028, 0.020, 0.012], '#4d2336');
      return;
    }
    if (type === 'intestine') {
      makeTube(THREE, group, [[-0.62, 0.62, 0], [-0.69, 0.20, 0.02], [-0.68, -0.37, 0], [-0.48, -0.62, 0], [0.02, -0.67, 0], [0.49, -0.60, 0], [0.67, -0.32, 0.02], [0.65, 0.28, 0], [0.47, 0.65, 0], [0.21, 0.67, 0]], '#9e4e67', 0.145, 110);
      // Small intestine is shown as soft, nested loops rather than a random coil.
      makeTube(THREE, group, [[-0.44, 0.34, 0.14], [-0.22, 0.43, 0.22], [0.05, 0.34, 0.20], [0.32, 0.28, 0.17], [0.39, 0.10, 0.20], [0.12, 0.04, 0.24], [-0.23, 0.11, 0.21], [-0.40, -0.04, 0.18], [-0.29, -0.22, 0.21], [0.03, -0.18, 0.25], [0.34, -0.24, 0.18], [0.30, -0.42, 0.14], [-0.05, -0.44, 0.20], [-0.32, -0.39, 0.13]], '#eab0b8', 0.062, 150);
      for (let i = 0; i < 9; i++) {
        const x = -0.28 + i * 0.07;
        const y = 0.26 + Math.sin(i * 0.72) * 0.07;
        makeTube(THREE, group, [[x, y, 0.255], [x + 0.03, y - 0.04, 0.275], [x + 0.06, y - 0.08, 0.255]], '#f5c5c9', 0.009, 14);
      }
      return;
    }
    if (type === 'worm') {
      // Ascaris-inspired silhouette: two smooth bodies with tapered ends, intentionally not segmented.
      const female = [[-0.72,0.68,-0.08],[-0.68,0.39,-0.02],[-0.42,0.17,0.04],[-0.04,0.23,0.08],[0.38,0.38,0.04],[0.65,0.17,0],[0.49,-0.13,0.06],[0.12,-0.29,0.10],[-0.25,-0.28,0.06],[-0.54,-0.47,0],[-0.30,-0.71,0.02]];
      const male = [[0.70,0.66,-0.20],[0.44,0.46,-0.18],[0.16,0.53,-0.14],[-0.16,0.53,-0.12],[-0.36,0.30,-0.10],[-0.20,0.05,-0.08],[0.12,0.02,-0.08],[0.36,-0.13,-0.06],[0.29,-0.39,-0.04],[0.07,-0.56,-0.02],[0.16,-0.71,0.04],[0.29,-0.64,0.08]];
      makeTube(THREE, group, female, '#d8b58b', 0.050, 190, true);
      makeTube(THREE, group, male, '#f0d8b4', 0.034, 190, true);
      return;
    }
    if (type === 'liver') {
      const shape = new THREE.Shape();
      shape.moveTo(-0.84, 0.30);
      shape.bezierCurveTo(-0.72, 0.72, -0.22, 0.74, 0.10, 0.55);
      shape.bezierCurveTo(0.44, 0.37, 0.61, 0.52, 0.78, 0.30);
      shape.bezierCurveTo(0.83, 0.12, 0.61, -0.28, 0.32, -0.42);
      shape.bezierCurveTo(0.08, -0.54, -0.05, -0.39, -0.22, -0.35);
      shape.bezierCurveTo(-0.49, -0.32, -0.68, -0.20, -0.84, 0.30);
      shape.closePath();
      makeExtrudedShape(THREE, group, shape, '#965064', 0.43, 0, 0.085, { roughness: 0.32, clearcoat: 0.42 });
      makeEllipsoid(THREE, group, [0.24, -0.46, 0.24], [0.12, 0.22, 0.10], '#75a77c');
      makeTube(THREE, group, [[0.18, -0.24, 0.30], [0.13, -0.04, 0.28], [-0.01, 0.10, 0.21]], '#e4bd81', 0.035, 32);
    }
  }

  function ensureModelViewerLibrary() {
    if (window.customElements?.get('model-viewer')) return Promise.resolve();
    if (modelViewerLoadPromise) return modelViewerLoadPromise;
    const pending = new Promise((resolve, reject) => {
      const done = () => window.customElements?.whenDefined('model-viewer').then(resolve, reject);
      const existing = document.querySelector('script[data-biosphere-model-viewer]');
      if (existing) {
        existing.addEventListener('load', done, { once: true });
        existing.addEventListener('error', () => reject(new Error('Model viewer failed to load')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.4.0/model-viewer.min.js';
      script.dataset.biosphereModelViewer = 'true';
      script.onload = done;
      script.onerror = () => reject(new Error('Model viewer CDN unavailable'));
      document.head.appendChild(script);
    });
    modelViewerLoadPromise = pending.catch(error => {
      modelViewerLoadPromise = null;
      document.querySelector('script[data-biosphere-model-viewer]')?.remove();
      throw error;
    });
    return modelViewerLoadPromise;
  }

  function initInteractiveModels(root) {
    const panel = root.matches?.('.anatomy3d-panel') ? root : root.querySelector('.anatomy3d-panel');
    if (!panel) return;
    const view = panel.closest('.media-3d-view');
    if (view?.hidden || panel.dataset.modelInitializing === '1' || activeAnatomy3D?.panel === panel) return;
    disposeInteractiveModel();
    panel.dataset.modelInitializing = '1';
    const requestId = String((Number(panel.dataset.modelRequest) || 0) + 1);
    panel.dataset.modelRequest = requestId;
    const fallback = panel.querySelector('.anatomy3d-fallback');
    if (fallback && !fallback.getAttribute('src') && fallback.dataset.fallbackSrc) {
      fallback.src = fallback.dataset.fallbackSrc;
      fallback.addEventListener('error', () => fallback.classList.add('photo-load-failed'), { once: true });
    }
    if (panel.dataset.modelEmbed) {
      try {
        const iframe = window.BioSphereModelEmbed(panel, panel.dataset.modelEmbed, panel.dataset.modelTitle || 'Mô hình giải phẫu 3D');
        const model = { kind: 'embed', panel, iframe, onReady: null, onError: null, timeoutId: 0, errorHandled: false };
        activeAnatomy3D = model;
        panel.classList.remove('is-embed-failed', 'is-embed-ready');
        panel.classList.add('is-embed-loading');
        const status = panel.querySelector('.anatomy3d-status');
        if (status) status.textContent = 'Đang tải mô hình 3D…';

        model.onReady = () => {
          if (activeAnatomy3D !== model || !panel.isConnected || model.errorHandled) return;
          window.clearTimeout(model.timeoutId);
          model.timeoutId = 0;
          panel.classList.remove('is-embed-loading', 'is-embed-failed');
          panel.classList.add('is-embed-ready');
          if (status) status.textContent = 'Mô hình 3D đã sẵn sàng';
        };
        model.onError = () => {
          if (activeAnatomy3D !== model || !panel.isConnected || model.errorHandled) return;
          model.errorHandled = true;
          window.clearTimeout(model.timeoutId);
          model.timeoutId = 0;
          panel.classList.remove('is-embed-loading', 'is-embed-ready');
          panel.classList.add('is-embed-failed');
          if (status) status.textContent = 'Không tải được 3D · đang hiển thị ảnh tham chiếu';
          iframe.removeEventListener('biosphere-viewer-ready', model.onReady);
          iframe.removeEventListener('biosphere-viewer-error', model.onError);
          iframe.src = 'about:blank';
          iframe.remove();
        };

        iframe.addEventListener('biosphere-viewer-ready', model.onReady);
        iframe.addEventListener('biosphere-viewer-error', model.onError);
        model.timeoutId = window.setTimeout(model.onError, 15000);
      } catch {
        delete panel.dataset.modelInitializing;
        initCustomThreeModel(panel, requestId);
      }
      return;
    }
    if (panel.dataset.modelSrc) {
      initReferenceModelViewer(panel, requestId).catch(() => {
        if (!panel.isConnected || $('#slideStage').querySelector('.anatomy3d-panel') !== panel || panel.dataset.modelRequest !== requestId) return;
        delete panel.dataset.modelInitializing;
        const status = panel.querySelector('.anatomy3d-status');
        if (status) status.textContent = 'Mô hình tham chiếu không tải được · dùng mô hình dự phòng';
        initCustomThreeModel(panel, requestId);
      });
    } else {
      initCustomThreeModel(panel, requestId);
    }
  }

  async function initReferenceModelViewer(panel, requestId) {
    const source = String(panel.dataset.modelSrc || '').trim();
    if (!source) throw new Error('No reference model source');
    await ensureModelViewerLibrary();
    if (!panel.isConnected || $('#slideStage').querySelector('.anatomy3d-panel') !== panel || panel.closest('.media-3d-view')?.hidden || panel.dataset.modelRequest !== requestId) {
      if (panel.dataset.modelRequest === requestId) delete panel.dataset.modelInitializing;
      return;
    }
    const slot = panel.querySelector('.anatomy3d-native-slot');
    if (!slot) throw new Error('3D viewer slot missing');
    slot.innerHTML = '';
    const viewer = document.createElement('model-viewer');
    viewer.className = 'anatomy3d-native-viewer';
    viewer.setAttribute('src', source);
    viewer.setAttribute('alt', panel.dataset.modelTitle || 'Mô hình tham chiếu giải phẫu 3D');
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('touch-action', 'pan-y');
    viewer.setAttribute('interaction-prompt', 'none');
    viewer.setAttribute('shadow-intensity', '0.65');
    viewer.setAttribute('exposure', '1.08');
    viewer.setAttribute('loading', 'eager');
    viewer.setAttribute('reveal', 'auto');
    viewer.setAttribute('camera-orbit', 'auto auto auto');
    viewer.setAttribute('camera-target', 'auto auto auto');
    viewer.setAttribute('field-of-view', '30deg');
    viewer.setAttribute('disable-tap', '');
    viewer.setAttribute('tone-mapping', 'neutral');
    const fallback = panel.querySelector('.anatomy3d-fallback');
    if (fallback?.dataset.fallbackSrc) viewer.setAttribute('poster', fallback.dataset.fallbackSrc);
    if (motionEnabled && !reducedMotion.matches) {
      viewer.setAttribute('auto-rotate', '');
      viewer.setAttribute('rotation-per-second', '8deg');
    }
    slot.appendChild(viewer);
    const model = { kind: 'native', panel, viewer, autoRotate: viewer.hasAttribute('auto-rotate'), onLoad: null, onError: null, onProgress: null, visibilityHandler: null };
    activeAnatomy3D = model;
    panel.classList.add('is-native-loading');
    const status = panel.querySelector('.anatomy3d-status');
    if (status) status.textContent = 'Đang tải mô hình giải phẫu…';
    const rotate = panel.querySelector('[data-model-action="rotate"]');
    if (rotate) {
      rotate.setAttribute('aria-pressed', String(model.autoRotate));
      rotate.textContent = model.autoRotate ? 'Dừng xoay' : 'Tự xoay';
    }
    model.onLoad = () => {
      if (activeAnatomy3D !== model) return;
      panel.classList.remove('is-native-loading');
      panel.classList.add('is-native-ready');
      if (status) status.textContent = 'Mô hình tham chiếu đã sẵn sàng';
    };
    model.onProgress = event => {
      if (activeAnatomy3D !== model || !status) return;
      const progress = Math.round((event.detail?.totalProgress || 0) * 100);
      status.textContent = progress > 0 && progress < 100 ? 'Đang tải mô hình · ' + progress + '%' : 'Đang dựng mô hình 3D…';
    };
    model.onError = () => {
      if (activeAnatomy3D !== model) return;
      disposeInteractiveModel();
      panel.classList.remove('is-native-loading', 'is-native-ready');
      if (status) status.textContent = 'Không tải được mô hình tham chiếu · chuyển sang mô hình dự phòng';
      delete panel.dataset.modelInitializing;
      initCustomThreeModel(panel, requestId);
    };
    model.visibilityHandler = () => {
      if (activeAnatomy3D !== model) return;
      const tabHidden = document.hidden || $('#presentationViewer').hidden || panel.closest('.media-3d-view')?.hidden;
      if (tabHidden || !motionEnabled || reducedMotion.matches || !model.autoRotate) viewer.removeAttribute('auto-rotate');
      else viewer.setAttribute('auto-rotate', '');
    };
    document.addEventListener('visibilitychange', model.visibilityHandler);
    viewer.addEventListener('load', model.onLoad);
    viewer.addEventListener('progress', model.onProgress);
    viewer.addEventListener('error', model.onError);
  }

  function initCustomThreeModel(panel, requestId = panel.dataset.modelRequest) {
    if (panel.dataset.modelRequest === requestId) panel.dataset.modelInitializing = '1';
    ensureThreeLibrary().then(THREE => {
      if (!panel.isConnected || $('#slideStage').querySelector('.anatomy3d-panel') !== panel || panel.closest('.media-3d-view')?.hidden || panel.dataset.modelRequest !== requestId) {
        if (panel.dataset.modelRequest === requestId) delete panel.dataset.modelInitializing;
        return;
      }
      try {
        const surface = panel.querySelector('.anatomy3d-canvas');
        const width = Math.max(220, surface.clientWidth || panel.clientWidth || 420);
        const height = Math.max(240, surface.clientHeight || panel.clientHeight || 420);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, getPerformanceProfile().maxPixelRatio));
        renderer.setSize(width, height, false);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        surface.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
        camera.position.set(0, 0, 5.4);
        scene.add(new THREE.AmbientLight(0xffffff, 1.65));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
        keyLight.position.set(-3, 4, 6);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x80e8de, 1.25);
        rimLight.position.set(3, 1.2, -4);
        scene.add(rimLight);
        const group = new THREE.Group();
        scene.add(group);
        buildModelGeometry(THREE, panel.dataset.anatomy3d, group);
        group.scale.setScalar(1.0);

        const model = {
          kind: 'custom', panel, renderer, scene, camera, group, frame: 0, render: null, visibilityHandler: null,
          autoRotate: motionEnabled && !reducedMotion.matches,
          dragging: false, lastX: 0, lastY: 0, resizeObserver: null, onResize: null,
          onPointerDown: null, onPointerMove: null, onPointerUp: null, onWheel: null
        };
        model.onResize = () => {
          if (!panel.isConnected) return;
          const w = Math.max(1, surface.clientWidth);
          const h = Math.max(1, surface.clientHeight);
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          model.render?.();
        };
        model.onPointerDown = event => {
          if (event.target.closest('button')) return;
          model.dragging = true;
          model.lastX = event.clientX;
          model.lastY = event.clientY;
          panel.classList.add('is-dragging');
          panel.setPointerCapture?.(event.pointerId);
        };
        model.onPointerMove = event => {
          if (!model.dragging) return;
          const dx = event.clientX - model.lastX;
          const dy = event.clientY - model.lastY;
          model.lastX = event.clientX;
          model.lastY = event.clientY;
          group.rotation.y += dx * 0.010;
          group.rotation.x = Math.max(-1.0, Math.min(1.0, group.rotation.x + dy * 0.008));
          model.render?.();
        };
        model.onPointerUp = event => {
          model.dragging = false;
          panel.classList.remove('is-dragging');
          try { panel.releasePointerCapture?.(event.pointerId); } catch { /* pointer capture may already be released */ }
          model.render?.();
        };
        model.onWheel = event => {
          event.preventDefault();
          const scale = group.scale.x * (event.deltaY < 0 ? 1.08 : 0.92);
          group.scale.setScalar(Math.max(0.68, Math.min(1.7, scale)));
          model.render?.();
        };
        panel.addEventListener('pointerdown', model.onPointerDown);
        panel.addEventListener('pointermove', model.onPointerMove);
        panel.addEventListener('pointerup', model.onPointerUp);
        panel.addEventListener('pointercancel', model.onPointerUp);
        panel.addEventListener('wheel', model.onWheel, { passive: false });
        if (window.ResizeObserver) {
          model.resizeObserver = new ResizeObserver(model.onResize);
          model.resizeObserver.observe(surface);
        } else {
          window.addEventListener('resize', model.onResize);
        }
        activeAnatomy3D = model;
        panel.classList.add('is-3d-ready');
        const status = panel.querySelector('.anatomy3d-status');
        if (status) status.textContent = 'Mô hình 3D sẵn sàng';
        const rotate = panel.querySelector('[data-model-action="rotate"]');
        if (rotate) rotate.setAttribute('aria-pressed', String(model.autoRotate));
        model.onResize();

        const tick = () => {
          model.frame = 0;
          if (activeAnatomy3D !== model || !panel.isConnected) return;
          if (document.hidden || $('#presentationViewer').hidden || panel.closest('.media-3d-view')?.hidden) return;
          if (model.autoRotate && motionEnabled && !reducedMotion.matches && !model.dragging) {
            group.rotation.y += 0.0032;
          }
          renderer.render(scene, camera);
          if (model.dragging || (model.autoRotate && motionEnabled && !reducedMotion.matches)) {
            model.frame = requestAnimationFrame(tick);
          }
        };
        model.render = () => {
          if (activeAnatomy3D !== model || model.frame) return;
          if (document.hidden || $('#presentationViewer').hidden || panel.closest('.media-3d-view')?.hidden) return;
          model.frame = requestAnimationFrame(tick);
        };
        model.visibilityHandler = () => {
          if (document.hidden || $('#presentationViewer').hidden || panel.closest('.media-3d-view')?.hidden) {
            if (model.frame) cancelAnimationFrame(model.frame);
            model.frame = 0;
          } else {
            model.render?.();
          }
        };
        document.addEventListener('visibilitychange', model.visibilityHandler);
        model.render();
      } catch (error) {
        if (panel.dataset.modelRequest !== requestId || !panel.isConnected) return;
        panel.classList.remove('is-3d-ready');
        delete panel.dataset.modelInitializing;
        const status = panel.querySelector('.anatomy3d-status');
        if (status) status.textContent = 'Đang dùng hình minh họa dự phòng';
        const footnote = panel.querySelector('.anatomy3d-footnote');
        if (footnote) footnote.textContent = 'Ảnh tĩnh dự phòng · mô hình 3D không khả dụng';
      }
    }).catch(() => {
      if (!panel.isConnected || $('#slideStage').querySelector('.anatomy3d-panel') !== panel || panel.dataset.modelRequest !== requestId) return;
      delete panel.dataset.modelInitializing;
      const status = panel.querySelector('.anatomy3d-status');
      if (status) status.textContent = 'Không tải được 3D · đang dùng hình minh họa';
      const footnote = panel.querySelector('.anatomy3d-footnote');
      if (footnote) footnote.textContent = 'Ảnh tĩnh dự phòng · mô hình 3D không khả dụng';
    });
  }

  function controlInteractiveModel(button) {
    const panel = button.closest('.anatomy3d-panel');
    const model = activeAnatomy3D;
    if (!panel || !model || model.panel !== panel) return;
    const action = button.dataset.modelAction;
    if (action === 'annotations') {
      const annotationPanel = panel.querySelector('.anatomy3d-annotation-panel');
      if (!annotationPanel) return;
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      annotationPanel.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? 'Ẩn chú thích' : '✦ Chú thích';
      return;
    }
    if (model.kind === 'native') {
      const viewer = model.viewer;
      if (action === 'rotate') {
        model.autoRotate = !model.autoRotate;
        if (model.autoRotate && motionEnabled && !reducedMotion.matches) {
          viewer.setAttribute('auto-rotate', '');
          viewer.setAttribute('rotation-per-second', '8deg');
        } else viewer.removeAttribute('auto-rotate');
        button.setAttribute('aria-pressed', String(model.autoRotate));
        button.textContent = model.autoRotate ? 'Dừng xoay' : 'Tự xoay';
      } else if (action === 'zoom-in' || action === 'zoom-out') {
        const orbit = viewer.getCameraOrbit();
        const factor = action === 'zoom-in' ? 0.88 : 1.14;
        const radius = Math.min(1000, Math.max(0.02, orbit.radius * factor));
        viewer.cameraOrbit = orbit.theta + 'rad ' + orbit.phi + 'rad ' + radius + 'm';
      } else if (action === 'reset') {
        viewer.cameraOrbit = 'auto auto auto';
        viewer.cameraTarget = 'auto auto auto';
        model.autoRotate = motionEnabled && !reducedMotion.matches;
        if (model.autoRotate) viewer.setAttribute('auto-rotate', '');
        else viewer.removeAttribute('auto-rotate');
        const rotateButton = panel.querySelector('[data-model-action="rotate"]');
        if (rotateButton) {
          rotateButton.setAttribute('aria-pressed', String(model.autoRotate));
          rotateButton.textContent = model.autoRotate ? 'Dừng xoay' : 'Tự xoay';
        }
      }
      return;
    }
    if (action === 'rotate') {
      model.autoRotate = !model.autoRotate;
      button.setAttribute('aria-pressed', String(model.autoRotate));
      button.textContent = model.autoRotate ? 'Dừng xoay' : 'Tự xoay';
      model.render?.();
    } else if (action === 'zoom-in') {
      model.group.scale.setScalar(Math.min(1.7, model.group.scale.x * 1.12));
      model.render?.();
    } else if (action === 'zoom-out') {
      model.group.scale.setScalar(Math.max(0.68, model.group.scale.x * 0.89));
      model.render?.();
    } else if (action === 'reset') {
      model.group.rotation.set(0, 0, 0);
      model.group.scale.setScalar(1);
      model.autoRotate = motionEnabled && !reducedMotion.matches;
      const rotate = panel.querySelector('[data-model-action="rotate"]');
      if (rotate) {
        rotate.setAttribute('aria-pressed', String(model.autoRotate));
        rotate.textContent = model.autoRotate ? 'Dừng xoay' : 'Tự xoay';
      }
      model.render?.();
    }
  }


  function renderTeamGallery(slide) {
    const members = Array.isArray(slide.teamMembers) ? slide.teamMembers.slice(0, 8) : [];
    if (!members.length) return '';
    const validAnimals = new Set(['wolf', 'cat', 'rabbit', 'penguin', 'pink-cat', 'otter', 'fox', 'panda']);
    const fallbackAnimals = ['wolf','cat','rabbit','penguin','pink-cat','otter','fox','panda'];
    return '<section class="team-gallery" aria-label="Tám thành viên nhóm BioSphere Slides">' +
      '<div class="team-gallery-caption"><span>GẶP GỠ NHÓM THỰC HIỆN</span><span>08 THÀNH VIÊN · 01 HÀNH TRÌNH</span></div>' +
      '<div class="team-member-grid">' + members.map((member, index) => {
        const animal = validAnimals.has(member?.animal) ? member.animal : fallbackAnimals[index % fallbackAnimals.length];
        return '<article class="team-member-card" style="--member-index:' + index + '">' +
          '<div class="team-member-avatar"><img src="/assets/team/animal-' + animal + '.svg" alt="" width="88" height="88" loading="eager" decoding="async"></div>' +
          '<div class="team-member-copy"><span class="team-member-role">' + escapeHTML(member?.role || 'Thành viên') + '</span>' +
          '<strong class="team-member-name">' + escapeHTML(member?.name || ('Thành viên ' + (index + 1))) + '</strong></div>' +
        '</article>';
      }).join('') + '</div>' +
      '<div class="team-gallery-footer"><span>HỌC HỎI</span><i></i><span>HỢP TÁC</span><i></i><span>KHÁM PHÁ KHOA HỌC</span></div>' +
    '</section>';
  }

  function renderSlideVisualBoard(slide) {
    const visual = String(slide.visual || 'editorial');
    const title = String(slide.title || '');
    let label = 'BẢN ĐỒ KIẾN THỨC';
    let heading = 'Nhìn nhanh — hiểu sâu';
    let subline = 'Các ý chính được nối thành một hình để dễ ghi nhớ.';
    let nodes = [];
    let mode = 'cards';

    if (slide.flowVisual && Array.isArray(slide.flowVisual.steps)) {
      label = slide.flowVisual.label || 'QUY TRÌNH KHOA HỌC';
      heading = title;
      subline = 'Theo dõi từng bước theo thứ tự, rồi liên hệ với phần giải thích.';
      nodes = slide.flowVisual.steps.map((text, i) => ({ label: text, detail: ['Điểm khởi đầu', 'Quá trình trung gian', 'Kết quả hoặc việc cần làm'][i] || '' }));
      mode = 'process';
    } else if (visual === 'digestive' || /5 bệnh liên quan đến hệ tiêu hóa/i.test(title)) {
      label = 'LỘ TRÌNH BÀI HỌC'; heading = 'Năm bệnh · năm cơ chế khác nhau'; subline = 'Chọn góc nhìn đúng: nguyên nhân, dấu hiệu, phòng ngừa và thời điểm cần trợ giúp.';
      nodes = [
        {label:'Sâu răng',detail:'Mảng bám · axit'},
        {label:'Loét dạ dày',detail:'H. pylori · một số thuốc'},
        {label:'Tiêu chảy',detail:'Mất nước'},
        {label:'Nhiễm giun',detail:'Đường lây qua môi trường'},
        {label:'Viêm gan A',detail:'Virus HAV'}
      ];
      mode = 'disease-map';
    } else if (visual === 'pathway' || /hành trình của thức ăn/i.test(title)) {
      label = 'SƠ ĐỒ HỆ TIÊU HÓA'; heading = 'Đường đi của thức ăn'; subline = 'Mỗi cơ quan làm một việc; gan, túi mật và tuyến tụy hỗ trợ bằng dịch tiêu hóa.';
      nodes = [
        {label:'Miệng',detail:'Nhai · nước bọt'},
        {label:'Thực quản',detail:'Đưa thức ăn xuống'},
        {label:'Dạ dày',detail:'Nhào trộn'},
        {label:'Ruột non',detail:'Tiêu hóa · hấp thụ'},
        {label:'Ruột già',detail:'Hấp thụ thêm nước'}
      ];
      mode = 'route';
    } else if (visual === 'balance') {
      label = 'DINH DƯỠNG CÂN BẰNG'; heading = 'Bốn vai trò cần nhớ'; subline = 'Ăn đa dạng để cơ thể có năng lượng, nguyên liệu xây dựng và chất cần thiết để điều hòa hoạt động.';
      nodes = [
        {label:'Năng lượng',detail:'Carbohydrate · chất béo'},
        {label:'Xây dựng',detail:'Protein · tăng trưởng'},
        {label:'Điều hòa',detail:'Vitamin · chất khoáng'},
        {label:'Hỗ trợ',detail:'Nước · chất xơ'}
      ];
      mode = 'cards';
    } else if (visual === 'overview' || /năm bệnh — năm góc nhìn/i.test(title)) {
      label = 'BẢN ĐỒ TỔNG QUAN'; heading = 'Một mục tiêu chung: phòng bệnh'; subline = 'Nguyên nhân khác nhau, nhưng vệ sinh và quyết định đúng lúc đều quan trọng.';
      nodes = [
        {label:'Răng miệng',detail:'Giảm mảng bám'},
        {label:'Dạ dày',detail:'Không tự điều trị'},
        {label:'Tiêu chảy',detail:'Chú ý mất nước'},
        {label:'Giun đường ruột',detail:'Cắt đường lây'},
        {label:'Viêm gan A',detail:'Nước sạch · vệ sinh'}
      ];
      mode = 'mind-map';
    } else if (visual === 'comparison') {
      label = 'SO SÁNH DẤU HIỆU'; heading = 'Dấu hiệu là manh mối, không phải chẩn đoán'; subline = 'Nếu biểu hiện nặng hoặc kéo dài, báo người lớn và tìm đánh giá y tế.';
      nodes = [
        {label:'Sâu răng',detail:'Ê buốt · đau răng'},
        {label:'Loét dạ dày',detail:'Đau bụng trên · dấu hiệu chảy máu rất nguy hiểm'},
        {label:'Tiêu chảy',detail:'Phân lỏng · theo dõi mất nước'},
        {label:'Nhiễm giun',detail:'Có thể ít dấu hiệu rõ'},
        {label:'Viêm gan A',detail:'Vàng da · nước tiểu sẫm cần đánh giá'}
      ];
      mode = 'comparison';
    } else if (visual === 'habits') {
      label = 'BẢN ĐỒ THÓI QUEN'; heading = 'Sáu hành động nhỏ, lợi ích lâu dài'; subline = 'Chọn các hành động có thể duy trì hằng ngày; khi có dấu hiệu cảnh báo thì tìm trợ giúp.';
      nodes = [
        {label:'Rửa tay',detail:'Trước khi ăn · sau đi vệ sinh'},
        {label:'Nước an toàn',detail:'Dùng nước sạch'},
        {label:'Thực phẩm sạch',detail:'Rửa · nấu chín · bảo quản'},
        {label:'Chăm sóc răng',detail:'Chải răng với fluoride'},
        {label:'Ăn đa dạng',detail:'Rau quả · chất xơ · nước'},
        {label:'Tìm trợ giúp',detail:'Báo người lớn khi đáng lo'}
      ];
      mode = 'cards';
    } else if (visual === 'greeting' || visual === 'team') {
      label = visual === 'team' ? 'HOẠT ĐỘNG NHÓM' : 'MỤC TIÊU HỌC TẬP';
      heading = visual === 'team' ? 'Cùng suy luận, không chỉ đoán đáp án' : 'Ba việc sẽ làm trong bài học';
      subline = 'Quan sát bằng chứng, chọn cách xử trí an toàn và giải thích lý do bằng kiến thức khoa học.';
      nodes = visual === 'team'
        ? [{label:'Đọc tình huống',detail:'Tìm chi tiết quan trọng'},{label:'Chọn đáp án',detail:'Cân nhắc mức độ an toàn'},{label:'Giải thích',detail:'Nêu bằng chứng'}]
        : [{label:'Hiểu cơ chế',detail:'Nguyên nhân và đường lây'},{label:'Nhận biết',detail:'Dấu hiệu cần chú ý'},{label:'Phòng ngừa',detail:'Hành động hằng ngày'}];
      mode = 'cards';
    } else if (visual === 'sources' || /ba điều cần ghi nhớ/i.test(title)) {
      label = 'SƠ ĐỒ GHI NHỚ'; heading = 'Hiểu đúng · phòng ngừa · tìm trợ giúp'; subline = 'Không tự chẩn đoán và không tự dùng kháng sinh; hãy dựa vào hướng dẫn y tế đáng tin cậy.';
      nodes = [{label:'Hiểu đúng',detail:'Nguyên nhân khác nhau'},{label:'Phòng ngừa',detail:'Vệ sinh và thực phẩm an toàn'},{label:'Tìm trợ giúp',detail:'Báo người lớn khi đáng lo'}];
      mode = 'cards';
    } else if (visual === 'closing') {
      label = 'MANG KIẾN THỨC VÀO ĐỜI SỐNG'; heading = 'Bắt đầu từ một việc hôm nay'; subline = 'Thói quen đều đặn, kiến thức đúng và việc tìm trợ giúp đúng lúc đi cùng nhau.';
      nodes = [{label:'Làm sạch răng',detail:'Giảm nguy cơ sâu răng'},{label:'Rửa tay',detail:'Cắt một phần đường lây'},{label:'Dùng nước an toàn',detail:'Bảo vệ cả gia đình'}];
      mode = 'cards';
    } else if (visual === 'tooth' || visual === 'toothcare') {
      label = 'CƠ CHẾ VÀ PHÒNG NGỪA'; heading = 'Bảo vệ men răng'; subline = 'Đồ có đường, mảng bám và axit liên quan đến quá trình mất khoáng.';
      nodes = [{label:'Làm sạch mảng bám',detail:'Chải răng đúng cách'},{label:'Giảm tần suất đường',detail:'Ưu tiên nước lọc'},{label:'Dùng fluoride',detail:'Theo hướng dẫn phù hợp'},{label:'Khám nha khoa',detail:'Khi đau hoặc ê buốt lặp lại'}];
      mode = 'cards';
    } else if (visual === 'stomach' || visual === 'stomachcare') {
      label = 'NGUYÊN NHÂN VÀ XỬ TRÍ'; heading = 'Không tự kết luận từ cơn đau'; subline = 'Cần đánh giá nguyên nhân, nhất là khi có dấu hiệu cảnh báo.';
      nodes = [{label:'H. pylori',detail:'Một nguyên nhân thường gặp'},{label:'Một số NSAID',detail:'Có thể làm tăng nguy cơ loét'},{label:'Đánh giá y tế',detail:'Báo triệu chứng và thuốc đang dùng'}];
      mode = 'cards';
    } else if (/viêm gan A/i.test(title + ' ' + String(slide.kicker || ''))) {
      label = 'ĐƯỜNG LÂY VÀ DẤU HIỆU'; heading = 'Từ nguồn nhiễm đến gan'; subline = 'Đây là sơ đồ giải thích đường lây, không phải công cụ tự chẩn đoán.';
      nodes = [{label:'Nước / thực phẩm bẩn',detail:'Có thể mang virus HAV'},{label:'Virus vào cơ thể',detail:'Đường phân–miệng'},{label:'Gan bị viêm',detail:'Vàng da cần được đánh giá'}];
      mode = 'process';
    } else if (/nước sạch|bàn tay sạch|thực phẩm an toàn/i.test(title)) {
      label = 'BA LỚP PHÒNG NGỪA'; heading = 'Chặn mầm bệnh trước khi ăn uống'; subline = 'Tạo nhiều lớp bảo vệ: vệ sinh tay, nước an toàn và thực phẩm được làm sạch/chế biến đúng cách.';
      nodes = [{label:'Tay sạch',detail:'Rửa với xà phòng đúng lúc'},{label:'Nước an toàn',detail:'Dùng nguồn nước phù hợp'},{label:'Thực phẩm sạch',detail:'Rửa · nấu chín · bảo quản'}];
      mode = 'cards';
    } else if (/nhiễm giun/i.test(title + ' ' + String(slide.kicker || '')) || visual === 'food' || visual === 'foodsafety' || visual === 'fiber') {
      label = 'CẮT ĐƯỜNG LÂY'; heading = 'Tay sạch · nước sạch · thực phẩm an toàn'; subline = 'Không thể nhận biết mọi trường hợp bằng mắt; phòng ngừa cần được duy trì đều đặn.';
      nodes = [{label:'Môi trường bẩn',detail:'Đất · nước · thực phẩm'},{label:'Mầm bệnh vào miệng',detail:'Qua tay hoặc thức ăn'},{label:'Giảm nguy cơ',detail:'Rửa tay · làm sạch thực phẩm'}];
      mode = 'process';
    } else if (visual === 'water' || visual === 'watercare') {
      label = 'ƯU TIÊN AN TOÀN'; heading = 'Ngăn nhiễm trùng, chú ý mất nước'; subline = 'Pha dung dịch ORS đúng lượng nước hướng dẫn trên gói và tìm giúp đỡ khi có dấu hiệu nặng.';
      nodes = [{label:'Nước an toàn',detail:'Rửa tay · thực phẩm sạch'},{label:'Theo dõi',detail:'Khát nhiều · tiểu ít · mệt'},{label:'Bù nước',detail:'ORS đúng hướng dẫn'}];
      mode = 'process';
    } else {
      const points = Array.isArray(slide.points) ? slide.points.slice(0, 4) : [];
      if (!points.length) return '';
      label = 'Ý CHÍNH CẦN NHỚ'; heading = title; subline = 'Các ý chính được chia thành từng mảnh thông tin dễ quan sát.';
      nodes = points.map((point, index) => ({label:'Ý '+String(index+1).padStart(2,'0'),detail:String(point)}));
      mode = 'cards';
    }

    if (!nodes.length) return '';
    const nodeHtml = nodes.map((node, index) =>
      '<div class="editorial-diagram-node" style="--node-index:' + index + '">' +
        '<span class="editorial-diagram-index">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<div><strong>' + escapeHTML(node.label) + '</strong>' +
        (node.detail ? '<p>' + escapeHTML(node.detail) + '</p>' : '') + '</div>' +
      '</div>'
    ).join('');
    const mindMapCore = mode === 'mind-map'
      ? '<div class="editorial-map-core"><span>TRUNG TÂM CHỦ ĐỀ</span><strong>HỆ TIÊU HÓA</strong></div>'
      : '';
    return '<section class="editorial-diagram editorial-diagram--' + mode + '" aria-label="' + escapeHTML(label) + '" data-diagram="' + mode + '">' +
      '<div class="editorial-diagram-heading"><span>' + escapeHTML(label) + '</span><h2>' + escapeHTML(heading) + '</h2>' +
      (subline ? '<p>' + escapeHTML(subline) + '</p>' : '') + '</div>' +
      mindMapCore +
      '<div class="editorial-diagram-nodes">' + nodeHtml + '</div>' +
    '</section>';
  }

  function renderPhoto(slide) {
    const fallback = optimizeImageUrl(safeHttpUrl(slide.imageFallback, 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1600&q=85'));
    const url = optimizeImageUrl(safeHttpUrl(slide.image || ''));
    if (!url) return renderVisual(slide.visual);
    const videoUrl = safeHttpUrl(slide.video || '');
    const video4kUrl = safeHttpUrl(slide.video4k || '');
    const profile = getPerformanceProfile();
    const saveData = profile.saveData;
    const connectionType = profile.effectiveType;
    const coarsePortrait = window.matchMedia('(pointer: coarse) and (orientation: portrait)').matches;
    const use4k = Boolean(performanceMode === 'cinema' && profile.allowVideo && !profile.lite && video4kUrl &&
      window.matchMedia('(min-width: 1800px) and (orientation: landscape)').matches &&
      !coarsePortrait && !saveData && !['slow-2g', '2g', '3g'].includes(connectionType) &&
      motionEnabled && !reducedMotion.matches);
    const selectedVideo = profile.allowVideo ? (use4k ? video4kUrl : videoUrl) : '';
    const provider = String(slide.videoProvider || '').trim();
    const credit = selectedVideo
      ? (use4k ? (slide.videoCredit || provider + ' · 4K master') : (slide.videoCredit || provider + ' · video'))
      : (slide.imageCredit || 'Nguồn ảnh được ghi kèm');
    const imageSource = safeHttpUrl(slide.imageSourceUrl || url, url);
    const source = safeHttpUrl(selectedVideo ? (slide.videoSourceUrl || imageSource) : imageSource, imageSource);
    const palette = slide.palette || 'ocean';
    const photoTotal = currentDeck?.slides?.length || 32;
    const photoNo = String(slideIndex + 1).padStart(2, '0') + ' / ' + String(photoTotal).padStart(2, '0');
    const supports = Array.isArray(slide.supportImages)
      ? slide.supportImages.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 2)
      : [];
    const videoMarkup = selectedVideo
      ? '<video class="live-video" muted playsinline autoplay loop preload="none" poster="' + escapeHTML(url) + '" aria-hidden="true" data-video-provider="' + escapeHTML(provider) + '">' +
          '<source data-src="' + escapeHTML(selectedVideo) + '" type="video/mp4">' +
        '</video>'
      : '';
    const supportMarkup = supports.length ? '<div class="photo-support-stack">' + supports.map((item, i) =>
      '<a class="photo-support-card photo-support-card--' + (i + 1) + '" href="' + escapeHTML(safeHttpUrl(item.sourceUrl || item.url || imageSource, imageSource)) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHTML(item.alt || 'Mở nguồn ảnh bổ sung') + '">' +
        '<img class="photo-support-image" src="' + escapeHTML(optimizeImageUrl(safeHttpUrl(item.url || ''))) + '" alt="' + escapeHTML(item.alt || '') + '" loading="lazy" decoding="async" fetchpriority="low" data-fallback="' + escapeHTML(fallback) + '">' +
        '<span class="photo-support-label">' + escapeHTML(item.alt || 'Ảnh bổ sung') + '</span>' +
      '</a>'
    ).join('') + '</div>' : '';
    const mediaAlt = selectedVideo ? (slide.videoAlt || slide.imageAlt || 'Video minh họa liên quan') : (slide.imageAlt || 'Ảnh minh họa thực tế');
    return '<aside class="photo-scene" data-palette="' + escapeHTML(palette) + '" data-media-mode="' + (selectedVideo ? 'video' : 'photo') + '" aria-label="' + escapeHTML(mediaAlt) + '">' +
      '<div class="photo-halo photo-halo--one"></div><div class="photo-halo photo-halo--two"></div>' +
      '<div class="photo-frame">' +
        videoMarkup +
        '<img class="live-photo' + (slide.imageFit === 'contain' ? ' is-contained-diagram' : '') + '" src="' + escapeHTML(url) + '" alt="' + escapeHTML(slide.imageAlt || 'Ảnh thực tế liên quan đến nội dung') + '" loading="eager" decoding="async" fetchpriority="high" referrerpolicy="no-referrer" data-fallback="' + escapeHTML(fallback) + '">' +
        '<div class="photo-color-wash"></div><div class="photo-vignette"></div>' +
        '<div class="photo-topline"><span><i></i> ' + (selectedVideo ? 'VIDEO THỰC / ' + escapeHTML(provider.toUpperCase()) + (use4k ? ' · 4K' : '') : 'ẢNH THỰC / LIVE SOURCE') + '</span><b>' + photoNo + '</b></div>' +
        '<div class="photo-bottomline"><div class="photo-caption-copy"><span>' + (selectedVideo ? 'LIVE FOOTAGE · ' + escapeHTML(provider.toUpperCase()) : 'FIELD VISUAL') + '</span><strong>' + escapeHTML(mediaAlt) + '</strong></div>' +
        '<a class="photo-source-link" href="' + escapeHTML(source) + '" target="_blank" rel="noopener noreferrer" aria-label="Mở nguồn ' + (selectedVideo ? 'video' : 'ảnh') + ': ' + escapeHTML(credit) + '">' + (selectedVideo ? 'Nguồn video' : 'Nguồn ảnh') + ' <span>↗</span></a></div>' +
        '<div class="photo-focus-ring"></div>' +
      '</div>' + supportMarkup +
      '<div class="photo-credit-line"><span><i></i> ' + (selectedVideo ? 'VIDEO SOURCE / LICENSE' : 'SOURCE / ATTRIBUTION') + '</span><strong>' + escapeHTML(credit) + '</strong></div>' +
      '<div class="photo-scanline"></div>' +
    '</aside>';
  }

  function attachVideoBackgrounds(root = document) {
    $$('.live-video', root).forEach(video => {
      const frame = video.closest('.photo-frame');
      const canShowVideo = () => getPerformanceProfile().allowVideo && motionEnabled && !reducedMotion.matches &&
        !document.hidden && !$('#presentationViewer').hidden;

      const markIfPlaying = () => {
        if (canShowVideo() && !video.paused && video.readyState >= 2) {
          frame?.classList.add('video-playing');
        }
      };

      if (video.dataset.motionBound === '1') {
        if (canShowVideo()) {
          const resume = video.play();
          if (resume && typeof resume.then === 'function') {
            resume.then(markIfPlaying).catch(() => frame?.classList.remove('video-playing'));
          } else {
            markIfPlaying();
          }
        } else {
          video.pause();
          frame?.classList.remove('video-playing');
        }
        return;
      }

      video.dataset.motionBound = '1';
      video.addEventListener('playing', markIfPlaying);
      video.addEventListener('pause', () => {
        if (video.paused) frame?.classList.remove('video-playing');
      });
      video.addEventListener('error', () => {
        frame?.classList.remove('video-playing');
        frame?.classList.add('video-failed');
        video.remove();
      });

      const startVideo = () => {
        if (!canShowVideo()) {
          video.pause();
          frame?.classList.remove('video-playing');
          return;
        }
        const attempt = video.play();
        if (attempt && typeof attempt.then === 'function') {
          attempt.then(markIfPlaying).catch(() => frame?.classList.remove('video-playing'));
        } else {
          markIfPlaying();
        }
      };
      video.addEventListener('loadeddata', startVideo, { once: true });
      // The poster image paints first. Attach the MP4 only after the active slide is eligible for motion.
      if (canShowVideo()) {
        const deferredSource = video.querySelector('source[data-src]');
        if (deferredSource && !deferredSource.getAttribute('src')) {
          deferredSource.setAttribute('src', deferredSource.dataset.src || '');
          video.load();
        }
      }
      startVideo();
    });
  }

  function attachLiveImageFallbacks(root = document) {
    $$('.live-photo, .photo-support-image, .deck-cover-photo, .hero-photo-img', root).forEach(img => {
      if (img.dataset.fallbackBound === '1') return;
      img.dataset.fallbackBound = '1';
      img.addEventListener('error', () => {
        const fallback = img.dataset.fallback;
        if (fallback && img.dataset.fallbackUsed !== '1' && img.src !== fallback) {
          img.dataset.fallbackUsed = '1';
          img.src = fallback;
          const scene = img.closest('.photo-scene');
          if (img.classList.contains('live-photo') && scene) {
            img.alt = 'Ảnh thực dự phòng từ Unsplash';
            scene.dataset.imageFallback = 'true';
            const caption = $('.photo-caption-copy strong', scene);
            if (caption) caption.textContent = 'Ảnh dự phòng · Unsplash';
            const credit = $('.photo-credit-line strong', scene);
            if (credit) credit.textContent = 'Ảnh dự phòng · Unsplash';
            const sourceLink = $('.photo-source-link', scene);
            if (sourceLink) {
              sourceLink.href = 'https://unsplash.com/license';
              sourceLink.setAttribute('aria-label', 'Xem giấy phép ảnh dự phòng Unsplash');
              sourceLink.innerHTML = 'Unsplash <span>↗</span>';
            }
          }
          if (img.classList.contains('photo-support-image')) {
            img.alt = 'Ảnh phụ dự phòng từ Unsplash';
            const card = img.closest('.photo-support-card');
            if (card) {
              card.href = 'https://unsplash.com/license';
              card.setAttribute('aria-label', 'Xem giấy phép ảnh phụ dự phòng Unsplash');
            }
          }
          return;
        }
        img.classList.add('photo-load-failed');
        img.closest('.photo-frame, .photo-support-card, .deck-cover, .hero-photo-card')?.classList.add('photo-failed');
      });
    });
  }

  function warmAdjacentPhotos() {
    if (photoWarmTimer) window.clearTimeout(photoWarmTimer);
    if (!currentDeck || typeof Image === 'undefined') return;
    const profile = getPerformanceProfile();
    if (!profile.online || profile.saveData || profile.slowConnection) return;
    const slides = Array.isArray(currentDeck.slides) ? currentDeck.slides : [];
    // Warm the next image early; retain at most one decoded image on phones and two on desktop cinema.
    const capacity = profile.lite ? 1 : (performanceMode === 'cinema' && window.innerWidth >= 900 ? 2 : 1);
    photoWarmTimer = window.setTimeout(() => {
      photoWarmTimer = 0;
      if (!currentDeck || currentDeck.slides !== slides) return;
      const indexes = [slideIndex + 1];
      if (capacity > 1) indexes.push(slideIndex + 2);
      indexes.forEach(index => {
        if (index < 0 || index >= slides.length) return;
        const url = optimizeImageUrl(safeHttpUrl(slides[index]?.image || ''));
        if (!url) return;
        if (warmedPhotoAssets.has(url)) {
          const cached = warmedPhotoAssets.get(url);
          warmedPhotoAssets.delete(url);
          warmedPhotoAssets.set(url, cached);
          return;
        }
        const preload = new Image();
        preload.decoding = 'async';
        preload.loading = 'eager';
        try { preload.fetchPriority = 'low'; } catch { /* older browsers */ }
        warmedPhotoAssets.set(url, preload);
        while (warmedPhotoAssets.size > capacity) {
          const oldestUrl = warmedPhotoAssets.keys().next().value;
          if (!oldestUrl) break;
          warmedPhotoAssets.delete(oldestUrl);
        }
        preload.src = url;
        if (typeof preload.decode === 'function') preload.decode().catch(() => {});
      });
    }, 80);
  }

  function renderQuiz(slide) {
    const questions = Array.isArray(slide.quizQuestions) ? slide.quizQuestions : [];
    if (!questions.length) return '';
    if (quizSession.deckId !== currentDeck.id || quizSession.slideIndex !== slideIndex) {
      quizSession = { deckId: currentDeck.id, slideIndex, questionIndex: 0, answers: {}, score: 0 };
    }
    const total = questions.length;
    const index = quizSession.questionIndex;
    if (index >= total) {
      const percent = Math.round((quizSession.score / total) * 100);
      const resultLabel = percent === 100 ? 'Xuất sắc — cả lớp nắm bài rất chắc!' : percent >= 60 ? 'Tốt lắm — cùng xem lại những câu còn sai nhé.' : 'Chưa sao — mình xem lời giải, rồi thử lại nhé!';
      const recap = questions.map((question, i) => {
        const chosen = quizSession.answers[i];
        const right = chosen === question.correctIndex;
        return '<div class="quiz-recap-row ' + (right ? 'is-correct' : 'is-wrong') + '"><span class="quiz-recap-icon">' + (right ? '✓' : '↺') + '</span><div><strong>Câu ' + (i + 1) + '</strong><p>' + escapeHTML(question.options[question.correctIndex]) + '</p></div></div>';
      }).join('');
      return '<section class="quiz-panel quiz-results"><div class="quiz-panel-top"><span><i></i> KẾT QUẢ THỬ THÁCH</span><b>' + total + ' CÂU</b></div>' +
        '<div class="quiz-score-orb"><span>ĐIỂM CỦA EM</span><strong>' + quizSession.score + '<small>/' + total + '</small></strong><div class="quiz-score-meter"><i style="width:' + percent + '%"></i></div></div>' +
        '<h3>' + resultLabel + '</h3><p class="quiz-result-subtitle">Mỗi câu trả lời là một cơ hội để nhớ kiến thức lâu hơn.</p>' +
        '<div class="quiz-recap-list">' + recap + '</div><button class="quiz-action quiz-action-primary" data-quiz-restart><span>↻</span> Chơi lại từ đầu</button></section>';
    }
    const question = questions[index];
    const hasAnswer = Object.prototype.hasOwnProperty.call(quizSession.answers, index);
    const selected = hasAnswer ? quizSession.answers[index] : null;
    const correct = hasAnswer && selected === question.correctIndex;
    const options = question.options.map((option, optionIndex) => {
      const isCorrect = hasAnswer && optionIndex === question.correctIndex;
      const isSelected = hasAnswer && optionIndex === selected;
      const stateClass = isCorrect ? ' is-correct' : isSelected ? ' is-wrong' : '';
      const symbol = isCorrect ? '<span class="quiz-option-result">✓</span>' : isSelected ? '<span class="quiz-option-result">×</span>' : '<span class="quiz-option-letter">' + String.fromCharCode(65 + optionIndex) + '</span>';
      return '<button class="quiz-answer' + stateClass + '" data-quiz-answer="' + optionIndex + '" ' + (hasAnswer ? 'disabled ' : '') + 'aria-pressed="' + String(isSelected) + '">' + symbol + '<span class="quiz-answer-text">' + escapeHTML(option) + '</span><span class="quiz-answer-shimmer"></span></button>';
    }).join('');
    const feedback = hasAnswer
      ? '<div class="quiz-feedback ' + (correct ? 'is-correct' : 'is-wrong') + '" role="status"><span class="quiz-feedback-icon">' + (correct ? '✓' : '×') + '</span><div><strong>' + (correct ? 'CHÍNH XÁC · +1 ĐIỂM' : 'CHƯA ĐÚNG · CÙNG GHI NHỚ') + '</strong><p>' + escapeHTML(question.explanation) + '</p></div></div>' +
        '<div class="quiz-continue-hint"><span>Chạm vùng trình chiếu để tiếp tục</span><i aria-hidden="true"></i><kbd>→</kbd></div>'
      : '<div class="quiz-encouragement"><span>◉</span> Chọn một đáp án — phản hồi sẽ xuất hiện ngay.</div>';
    return '<section class="quiz-panel" aria-label="Câu hỏi tương tác">' +
      '<div class="quiz-panel-top"><span><i></i> LỚP HỌC TƯƠNG TÁC</span><b>CÂU ' + String(index + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0') + '</b></div>' +
      '<div class="quiz-progress"><i style="width:' + (((index + (hasAnswer ? 1 : 0)) / total) * 100) + '%"></i></div>' +
      '<div class="quiz-question-label"><span>THỬ THÁCH KIẾN THỨC</span><strong>' + escapeHTML(question.question) + '</strong></div>' +
      '<div class="quiz-answers">' + options + '</div>' + feedback +
      '<div class="quiz-score-strip"><span><i>✦</i> ĐIỂM HIỆN TẠI</span><strong>' + quizSession.score + ' <small>/ ' + total + '</small></strong><span class="quiz-sound-hint">' + (soundEnabled ? '♫ Âm thanh bật' : '♪ Âm thanh tắt') + '</span></div>' +
    '</section>';
  }

  function refreshQuizPanel() {
    const slide = currentDeck?.slides?.[slideIndex];
    const panel = $('#slideStage .quiz-panel');
    if (!slide?.interactiveQuiz || !panel) return;
    panel.outerHTML = renderQuiz(slide);
  }

  function answerQuiz(optionIndex) {
    const slide = currentDeck?.slides?.[slideIndex];
    if (!slide?.interactiveQuiz || !Array.isArray(slide.quizQuestions)) return;
    const index = quizSession.questionIndex;
    const question = slide.quizQuestions[index];
    if (!question || Object.prototype.hasOwnProperty.call(quizSession.answers, index)) return;
    const isCorrect = Number(optionIndex) === question.correctIndex;
    quizSession.answers[index] = Number(optionIndex);
    if (isCorrect) quizSession.score += 1;
    playQuizSound(isCorrect);
    refreshQuizPanel();
  }

  function nextQuizQuestion() {
    const slide = currentDeck?.slides?.[slideIndex];
    if (!slide?.interactiveQuiz) return;
    quizSession.questionIndex = Math.min(quizSession.questionIndex + 1, slide.quizQuestions.length);
    playSlideSound(true);
    refreshQuizPanel();
  }

  function restartQuiz() {
    const slide = currentDeck?.slides?.[slideIndex];
    if (!slide?.interactiveQuiz) return;
    quizSession = { deckId: currentDeck.id, slideIndex, questionIndex: 0, answers: {}, score: 0 };
    playQuizSound(true, true);
    refreshQuizPanel();
  }

  function playQuizSound(correct, soft = false) {
    if (!soundEnabled) return;
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      quizAudioContext ||= new AudioCtor();
      const context = quizAudioContext;
      if (context.state === 'suspended') context.resume();
      const now = context.currentTime;
      const tones = correct ? (soft ? [523, 659] : [523, 659, 784]) : [246, 185];
      tones.forEach((frequency, i) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = now + i * (correct ? 0.105 : 0.09);
        oscillator.type = correct ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(soft ? 0.026 : 0.045, startAt + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.18);
      });
    } catch {
      // Browsers may block audio until the first user gesture; the quiz still works silently.
    }
  }

  function playSlideSound(forward = true) {
    if (!soundEnabled) return;
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      quizAudioContext ||= new AudioCtor();
      const context = quizAudioContext;
      if (context.state === 'suspended') context.resume();
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(forward ? 360 : 440, now);
      oscillator.frequency.exponentialRampToValueAtTime(forward ? 570 : 330, now + 0.105);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.014, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch {
      // Sound is optional; navigation must continue without it.
    }
  }

  function toggleQuizSound() {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem('biosphere-quiz-sound', soundEnabled ? 'on' : 'off'); } catch { /* session-only toggle */ }
    const button = $('#viewerSound');
    button?.setAttribute('aria-pressed', String(soundEnabled));
    if (button) button.textContent = soundEnabled ? '♫' : '♪';
    button?.setAttribute('aria-label', soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh');
    button?.setAttribute('title', soundEnabled ? 'Âm thanh slide và phản hồi đúng/sai đang bật' : 'Âm thanh slide và phản hồi đúng/sai đang tắt');
    renderSlide();
    if (soundEnabled) playQuizSound(true, true);
  }

  function initStageAtmosphere() {
    const canvas = $('#stageAtmosphere');
    if (!canvas || typeof canvas.getContext !== 'function') return;
    atmosphereCanvasContext = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!atmosphereCanvasContext) return;
    resizeStageAtmosphere();
    window.addEventListener('resize', resizeStageAtmosphere, { passive: true });
    $('#presentationViewer').addEventListener('pointermove', event => {
      const bounds = $('#presentationViewer').getBoundingClientRect();
      atmospherePointer.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      atmospherePointer.y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
      $('#slideStage').style.setProperty('--parallax-x', ((atmospherePointer.x - 0.5) * 2).toFixed(3));
      $('#slideStage').style.setProperty('--parallax-y', ((atmospherePointer.y - 0.5) * 2).toFixed(3));
    }, { passive: true });
  }

  function resizeStageAtmosphere() {
    const canvas = $('#stageAtmosphere');
    if (!canvas || !atmosphereCanvasContext) return;
    const viewer = $('#presentationViewer');
    atmosphereWidth = Math.max(1, viewer.clientWidth);
    atmosphereHeight = Math.max(1, viewer.clientHeight);
    const profile = getPerformanceProfile();
    const canvasPixelRatioLimit = profile.projectorMode && atmosphereWidth >= 3000 ? 1 : profile.maxPixelRatio;
    atmosphereDpr = Math.min(window.devicePixelRatio || 1, canvasPixelRatioLimit);
    canvas.width = Math.round(atmosphereWidth * atmosphereDpr);
    canvas.height = Math.round(atmosphereHeight * atmosphereDpr);
    atmosphereCanvasContext.setTransform(atmosphereDpr, 0, 0, atmosphereDpr, 0, 0);
    const mobile = window.matchMedia('(max-width: 650px)').matches;
    const desktopCinema = performanceMode === 'cinema' && !mobile;
    const count = profile.lite ? 0 : desktopCinema
      ? (profile.projectorMode && atmosphereWidth >= 2500 ? 144 : profile.projectorMode ? 112 : profile.highCapability ? 88 : 58)
      : (mobile ? 18 : 28);
    atmosphereParticles = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * atmosphereWidth,
      y: Math.random() * atmosphereHeight,
      vx: (Math.random() - 0.5) * (mobile ? 0.14 : 0.24),
      vy: (Math.random() - 0.5) * (mobile ? 0.12 : 0.19),
      r: Math.random() * 1.4 + 0.5,
      phase: Math.random() * Math.PI * 2,
      index: i
    }));
  }

  function drawStageAtmosphere(timestamp) {
    if (!atmosphereRunning || !atmosphereCanvasContext) return;
    const profile = getPerformanceProfile();
    if (document.hidden || !motionEnabled || reducedMotion.matches || $('#presentationViewer').hidden || profile.lite) {
      atmosphereFrame = 0;
      return;
    }
    const frameInterval = performanceMode === 'cinema' && window.innerWidth >= 1000 ? 1000 / 60 : 1000 / 30;
    if (timestamp - atmosphereLastPaint < frameInterval) {
      atmosphereFrame = window.requestAnimationFrame(drawStageAtmosphere);
      return;
    }
    atmosphereLastPaint = timestamp;
    const context = atmosphereCanvasContext;
    const stage = $('#slideStage');
    const palette = stage?.dataset.palette || 'spectrum';
    const colors = {
      ocean: ['91,229,231','113,142,255'], coral: ['255,143,166','255,206,146'],
      violet: ['210,160,255','123,145,255'], amber: ['255,197,108','255,130,158'],
      cyan: ['104,231,243','164,166,255'], magenta: ['242,160,231','125,223,247'],
      lime: ['193,239,145','106,220,202'], rose: ['255,159,181','255,210,143'],
      pink: ['255,159,198','188,160,255'], ruby: ['255,150,157','197,165,255'],
      blue: ['117,182,255','140,228,245'], aqua: ['118,240,243','141,185,255'],
      orange: ['255,194,119','255,135,157'], gold: ['255,218,125','155,237,183'],
      indigo: ['155,169,255','255,159,208'], teal: ['118,232,207','123,184,255'],
      spectrum: ['139,232,244','231,161,255']
    };
    const pair = colors[palette] || colors.spectrum;
    context.clearRect(0, 0, atmosphereWidth, atmosphereHeight);
    const time = timestamp * 0.00025;
    const mobile = atmosphereWidth < 700;
    const linkDistance = mobile ? 74 : 108;
    const linkDistanceSquared = linkDistance * linkDistance;
    const lineBuckets = Array.from({ length: 6 }, () => []);
    const dotBuckets = [[], []];

    // Update all particles before measuring edges; keep motion smooth with fewer, batched canvas calls.
    for (const particle of atmosphereParticles) {
      particle.x += particle.vx + (atmospherePointer.x * atmosphereWidth - particle.x) * 0.000008;
      particle.y += particle.vy + Math.sin(time + particle.phase) * 0.12;
      if (particle.x < -8) particle.x = atmosphereWidth + 8;
      if (particle.x > atmosphereWidth + 8) particle.x = -8;
      if (particle.y < -8) particle.y = atmosphereHeight + 8;
      if (particle.y > atmosphereHeight + 8) particle.y = -8;
    }

    for (let i = 0; i < atmosphereParticles.length; i++) {
      const particle = atmosphereParticles[i];
      for (let j = i + 1; j < atmosphereParticles.length; j++) {
        const other = atmosphereParticles[j];
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= linkDistanceSquared) continue;
        const distance = Math.sqrt(distanceSquared);
        const alpha = 1 - distance / linkDistance;
        const band = alpha > 0.66 ? 2 : alpha > 0.33 ? 1 : 0;
        const bucket = lineBuckets[((i + j) % 2) * 3 + band];
        bucket.push(particle.x, particle.y, other.x, other.y);
      }
      dotBuckets[particle.index % 2].push(particle);
    }

    const alphaValues = [0.035, 0.075, 0.12];
    context.lineWidth = 0.6;
    for (let hue = 0; hue < 2; hue++) {
      for (let band = 0; band < 3; band++) {
        const coords = lineBuckets[hue * 3 + band];
        if (!coords.length) continue;
        context.beginPath();
        for (let i = 0; i < coords.length; i += 4) {
          context.moveTo(coords[i], coords[i + 1]);
          context.lineTo(coords[i + 2], coords[i + 3]);
        }
        context.strokeStyle = 'rgba(' + pair[hue] + ',' + alphaValues[band] + ')';
        context.stroke();
      }
    }

    // Batch particles by tone to avoid a fill operation per dot.
    for (let hue = 0; hue < 2; hue++) {
      const dots = dotBuckets[hue];
      if (!dots.length) continue;
      context.beginPath();
      for (const particle of dots) {
        const pulse = 0.9 + Math.sin(time * 3 + particle.phase) * 0.1;
        const radius = particle.r * pulse;
        const x = particle.x + (atmospherePointer.x - 0.5) * 5;
        const y = particle.y + (atmospherePointer.y - 0.5) * 5;
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fillStyle = 'rgba(' + pair[hue] + ',0.42)';
      context.fill();
    }

    atmosphereFrame = window.requestAnimationFrame(drawStageAtmosphere);
  }

  function startStageAtmosphere() {
    if (!atmosphereCanvasContext || atmosphereRunning || !motionEnabled || reducedMotion.matches || getPerformanceProfile().lite) return;
    atmosphereRunning = true;
    atmosphereLastPaint = 0;
    atmosphereFrame = window.requestAnimationFrame(drawStageAtmosphere);
  }

  function stopStageAtmosphere() {
    atmosphereRunning = false;
    if (atmosphereFrame) window.cancelAnimationFrame(atmosphereFrame);
    atmosphereFrame = 0;
    if (atmosphereCanvasContext) atmosphereCanvasContext.clearRect(0, 0, atmosphereWidth, atmosphereHeight);
  }

  function renderSlide({ direction = 'forward', animate = true } = {}) {
    disposeInteractiveModel();
    if (!currentDeck) return;
    const slides = Array.isArray(currentDeck.slides) && currentDeck.slides.length ? currentDeck.slides : seedDeck.slides;
    slideIndex = Math.max(0, Math.min(slideIndex, slides.length - 1));
    const slide = slides[slideIndex];
    const isTeamSlide = slide.visual === 'team' && Array.isArray(slide.teamMembers);
    if (!slide.interactiveQuiz) quizSession = { deckId: null, slideIndex: -1, questionIndex: 0, answers: {}, score: 0 };

    const stage = $('#slideStage');
    const previousPage = stage.querySelector(':scope > .slide-page:not(.slide-transition-ghost)');
    const storyGroup = String(slide.storyGroup || slide.palette || 'foundation');
    const previousStoryGroup = previousPage?.dataset.storyGroup || previousPage?.dataset.palette || '';
    const motionBridge = !animate || direction === 'reveal'
      ? 'instant'
      : (!previousPage ? 'opening' : (previousStoryGroup === storyGroup ? 'continuity' : 'chapter'));
    const motionPreset = slide.motionPreset || (motionBridge === 'continuity' ? 'depth' : 'rise');

    // The previous page will be removed immediately by the stage replacement below.
    // Never clone a full slide or leave a second image/media decoder alive during transitions.
    if (transitionCleanupTimer) window.clearTimeout(transitionCleanupTimer);
    transitionCleanupTimer = 0;
    if (activeTransitionGhost?.isConnected) activeTransitionGhost.remove();
    activeTransitionGhost = null;

    const points = Array.isArray(slide.points) ? slide.points.filter(point => typeof point === 'string' && point.trim()) : [];
    const keyIdea = typeof slide.keyIdea === 'string' && slide.keyIdea.trim()
      ? slide.keyIdea.trim()
      : (points[0] || slide.title || currentDeck.title);
    const keyIdeaHtml = !isTeamSlide && !slide.interactiveQuiz && points.length
      ? '<section class="slide-key-idea" aria-label="Ý chính">' +
          '<div class="slide-key-idea-top"><span>Ý CHÍNH</span><b>TRỌNG TÂM</b></div>' +
          '<p>' + escapeHTML(keyIdea) + '</p>' +
        '</section>'
      : '';
    const pointHtml = !isTeamSlide && !slide.interactiveQuiz && points.length
      ? '<section class="slide-support-ideas" aria-label="Các ý phụ">' +
          '<div class="slide-support-heading"><strong>Ý PHỤ</strong><span>Chi tiết, dẫn chứng và cách áp dụng</span></div>' +
          '<div class="slide-points">' + points.map((point, i) =>
            '<div class="slide-point slide-point--support" data-idea-index="' + i + '">' +
              '<b>' + String(i + 1).padStart(2, '0') + '</b><span>' + escapeHTML(point) + '</span>' +
            '</div>'
          ).join('') + '</div>' +
        '</section>'
      : '';
    const quizHtml = slide.interactiveQuiz ? renderQuiz(slide) : '';
    const endingHtml = slideIndex === slides.length - 1
      ? '<div class="ending-actions" aria-label="Thao tác sau khi kết thúc">' +
        '<button type="button" class="ending-action ending-action-primary" id="viewerReplay">Xem lại từ đầu <span aria-hidden="true">↺</span></button>' +
        '<button type="button" class="ending-action" id="viewerFinalContents">Về mục lục <span aria-hidden="true">▦</span></button>' +
      '</div>'
      : '';
    const prompt = slide.classroomPrompt;
    const hasCaseQuiz = Array.isArray(prompt?.options) && prompt.options.length >= 2;
    const caseOptionsHtml = hasCaseQuiz
      ? '<div class="case-quiz-options" role="group" aria-label="Chọn đáp án cho tình huống">' + prompt.options.map((option, i) =>
          '<button type="button" class="case-quiz-answer" data-case-answer="' + i + '" aria-pressed="false"><span class="case-quiz-letter">' + String.fromCharCode(65 + i) + '</span><span>' + escapeHTML(option) + '</span></button>'
        ).join('') + '</div>'
      : '<button type="button" class="reveal-answer-btn" data-reveal-answer aria-expanded="false">Hiện đáp án gợi ý <span aria-hidden="true">＋</span></button>';
    const promptHtml = prompt
      ? '<section class="classroom-prompt" aria-label="Tình huống thảo luận"' + (hasCaseQuiz ? ' data-case-correct-index="' + prompt.correctIndex + '"' : '') + '>' +
        '<div class="classroom-prompt-kicker"><span>' + (hasCaseQuiz ? 'CÂU HỎI TƯƠNG TÁC' : 'THẢO LUẬN CÙNG LỚP') + '</span><b>SUY LUẬN · KHÔNG TỰ CHẨN ĐOÁN</b></div>' +
        '<p class="classroom-scenario">' + escapeHTML(prompt.scenario) + '</p>' +
        '<h2 class="classroom-question">' + escapeHTML(prompt.question) + '</h2>' +
        caseOptionsHtml +
        '<div class="classroom-answer"' + (hasCaseQuiz ? ' hidden' : '') + '><strong class="case-quiz-result">Gợi ý trả lời</strong><p>' + escapeHTML(prompt.answer) + '</p><small>' + escapeHTML(prompt.explanation) + '</small></div>' +
      '</section>'
      : '';
    const sourceHtml = slide.note && !slide.interactiveQuiz ? '<div class="slide-source">' + escapeHTML(slide.note) + '</div>' : '';
    const linkItems = Array.isArray(slide.links)
      ? slide.links.filter(link => link && typeof link === 'object' && safeHttpUrl(link.url))
      : [];
    const linksHtml = linkItems.length
      ? '<div class="slide-links"><div class="slide-links-title">TÀI LIỆU TRỰC TUYẾN</div>' + linkItems.map(link => '<a href="' + escapeHTML(safeHttpUrl(link.url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(link.label) + ' <span aria-hidden="true">↗</span></a>').join('') + '</div>'
      : '';
    const palette = slide.palette || 'spectrum';
    stage.dataset.palette = palette;
    stage.dataset.storyGroup = storyGroup;
    stage.dataset.motionBridge = motionBridge;
    stage.dataset.direction = direction;
    stage.dataset.preset = motionPreset;
    stage.dataset.slideIndex = String(slideIndex + 1);
    stage.dataset.slideCount = String(slides.length);
    // Stop outgoing video before replacing the slide; otherwise decoders may overlap during transitions.
    $$('.live-video', stage).forEach(video => {
      video.pause();
      video.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore media cleanup errors */ }
    });
    stage.innerHTML =
      '<article class="slide-page" data-palette="' + escapeHTML(palette) + '" data-story-group="' + escapeHTML(storyGroup) + '" data-motion-bridge="' + escapeHTML(motionBridge) + '" data-visual="' + escapeHTML(slide.visual || 'editorial') + '" data-direction="' + escapeHTML(direction) + '" data-preset="' + escapeHTML(motionPreset) + '">' +
        '<div class="' + (isTeamSlide ? 'slide-layout slide-layout--team' : 'slide-layout') + '">' +
          '<section class="' + (isTeamSlide ? 'slide-content slide-content--team' : 'slide-content') + '">' +
            '<div class="slide-kicker">' + escapeHTML(slide.kicker || '4xT / SLIDE') + '</div>' +
            '<h1 class="slide-title">' + escapeHTML(slide.title || currentDeck.title) + '</h1>' +
            '<p class="slide-subtitle">' + escapeHTML(slide.subtitle || 'Bổ sung sau khi kiểm chứng tài liệu.') + '</p>' +
            (isTeamSlide ? renderTeamGallery(slide) : (keyIdeaHtml + renderSlideVisualBoard(slide) + (slide.model3D ? renderMediaModeBar('media-mode-bar--mobile') : '') + pointHtml + promptHtml + quizHtml + endingHtml + sourceHtml + linksHtml)) +
          '</section>' +
          (isTeamSlide ? '' : '<div class="slide-side-content">' + (slide.model3D ? renderMediaWithModel(slide) : (slide.image ? renderPhoto(slide) : (slide.visual ? renderVisual(slide.visual) : ''))) + '</div>') +
        '</div>' +
      '</article>';
    stage.dataset.slideIndex = String(slideIndex + 1);

    // There is no outgoing ghost to clean up: the old page was removed immediately above.
    attachLiveImageFallbacks(stage);
    attachVideoBackgrounds(stage);
    initInteractiveModels(stage);
    warmAdjacentPhotos();
    const label = String(slideIndex + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    $('#viewerSlideCaption').textContent = label;
    const photoCounter = $('#slideStage .photo-topline b');
    if (photoCounter) photoCounter.textContent = label;
    $('#viewerProgress').style.width = ((slideIndex + 1) / slides.length * 100) + '%';
    $('#viewerProgress').setAttribute('aria-valuenow', String(slideIndex + 1));
    $('#viewerProgress').setAttribute('aria-valuemax', String(slides.length));
    $('#viewerSound')?.setAttribute('aria-pressed', String(soundEnabled));
    if ($('#viewerSound')) $('#viewerSound').textContent = soundEnabled ? '♫' : '♪';
    $('#slidePrev').disabled = slideIndex === 0;
    $('#slideNext').disabled = slideIndex === slides.length - 1;
    $('#viewerPlayMotion').setAttribute('aria-pressed', String(motionEnabled));
    $('#presentationViewer').classList.toggle('motion-off', !motionEnabled);
    if (motionEnabled) {
      startStageAtmosphere();
      attachVideoBackgrounds($('#slideStage'));
    } else {
      stopStageAtmosphere();
      $$('.live-video', $('#slideStage')).forEach(video => video.pause());
      $$('.photo-frame.video-playing', $('#slideStage')).forEach(frame => frame.classList.remove('video-playing'));
    }
  }

  function setViewerUIHidden(hidden) {
    const viewer = $('#presentationViewer');
    const toggle = $('#viewerControlsToggle');
    viewer.classList.toggle('ui-hidden', Boolean(hidden));
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(Boolean(hidden)));
      toggle.textContent = hidden ? 'Hiện điều khiển' : 'Ẩn điều khiển';
      toggle.title = 'Ẩn/hiện giao diện điều khiển (phím H)';
    }
  }

  function openContents() {
    if (!currentDeck) return;
    const overlay = $('#presentationContents');
    const list = $('#contentsList');
    const slides = currentDeck.slides || [];
    $('#contentsDeckTitle').textContent = currentDeck.title || 'Mục lục bài trình chiếu';
    $('#contentsPosition').textContent = 'Đang ở trang ' + (slideIndex + 1) + ' / ' + slides.length;
    $('#contentsProgress').style.width = ((slideIndex + 1) / Math.max(1, slides.length) * 100) + '%';
    list.innerHTML = slides.map((slide, index) =>
      '<button type="button" class="contents-item' + (index === slideIndex ? ' is-current' : '') + '" data-jump-slide="' + index + '"' + (index === slideIndex ? ' aria-current="page"' : '') + '>' +
        '<span class="contents-item-number">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<span class="contents-item-copy"><small>' + escapeHTML(slide.kicker || '4xT / SLIDE') + '</small><strong>' + escapeHTML(slide.title || 'Trang chiếu') + '</strong></span>' +
        '<span class="contents-item-arrow" aria-hidden="true">↗</span>' +
      '</button>'
    ).join('');
    overlay.hidden = false;
    setViewerUIHidden(false);
    $('#contentsClose').focus();
  }

  function closeContents(returnFocus = true) {
    const overlay = $('#presentationContents');
    if (!overlay) return;
    overlay.hidden = true;
    if (returnFocus && !$('#presentationViewer').classList.contains('ui-hidden')) $('#viewerContents')?.focus();
  }

  function advanceFromStage() {
    const slide = currentDeck?.slides?.[slideIndex];
    if (!slide?.interactiveQuiz) {
      goNext();
      return;
    }
    const questions = slide.quizQuestions || [];
    if (quizSession.questionIndex >= questions.length) {
      goNext();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(quizSession.answers, quizSession.questionIndex)) {
      nextQuizQuestion();
    }
  }

  function goNext() {
    if (!currentDeck || slideIndex >= currentDeck.slides.length - 1) return;
    slideIndex += 1;
    playSlideSound(true);
    renderSlide();
  }

  function goPrevious() {
    if (!currentDeck || slideIndex <= 0) return;
    slideIndex -= 1;
    playSlideSound(false);
    renderSlide({ direction: 'backward' });
  }

  async function exitPresentation() {
    const viewer = $('#presentationViewer');
    if (viewer.hidden) return;
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* fullscreen may already have closed */ }
    }
    viewer.hidden = true;
    document.body.style.overflow = '';
    stopStageAtmosphere();
    disposeInteractiveModel();
    if (transitionCleanupTimer) window.clearTimeout(transitionCleanupTimer);
    transitionCleanupTimer = 0;
    activeTransitionGhost?.remove();
    activeTransitionGhost = null;
    $('#slideStage').innerHTML = '';
    currentDeck = null;
    if (!['library', 'templates', 'settings'].includes(location.hash.slice(1))) {
      history.replaceState({ view: activeView }, '', '#' + activeView);
    }
  }

  function syncFullscreenControls() {
    const viewer = $('#presentationViewer');
    const fullscreenButton = $('#viewerFullscreen');
    const projectorButton = $('#viewerProjector');
    const isFullscreen = document.fullscreenElement === viewer;
    const isProjector = viewer.classList.contains('projector-mode');
    if (fullscreenButton) {
      fullscreenButton.setAttribute('aria-pressed', String(isFullscreen));
      fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình');
      fullscreenButton.title = isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)';
      const label = fullscreenButton.querySelector('.fullscreen-label');
      if (label) label.textContent = isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    }
    if (projectorButton) {
      projectorButton.setAttribute('aria-pressed', String(isProjector));
      projectorButton.setAttribute('aria-label', isProjector ? 'Thoát chế độ chiếu TV' : 'Bật chế độ chiếu TV');
      projectorButton.title = isProjector ? 'Trở lại giao diện thường (P)' : 'Tối ưu HDMI/TV, 16:9, chế độ điện ảnh (P). Chuyển cửa sổ trình duyệt sang TV trước khi bật.';
      const label = projectorButton.querySelector('.projector-label');
      if (label) label.textContent = isProjector ? 'Thoát chiếu' : 'Chiếu TV';
    }
  }

  function leaveProjectorMode({ restorePerformance = true } = {}) {
    const viewer = $('#presentationViewer');
    viewer.classList.remove('projector-mode');
    delete document.documentElement.dataset.projectorMode;
    $('#viewerProjector')?.setAttribute('aria-pressed', 'false');
    setViewerUIHidden(false);
    projectorWasFullscreen = false;
    const restoreMode = projectorPreviousPerformanceMode;
    projectorPreviousPerformanceMode = null;
    if (restorePerformance && restoreMode) setPerformanceMode(restoreMode, false);
    syncFullscreenControls();
    if (!viewer.hidden) requestAnimationFrame(resizeStageAtmosphere);
  }

  function upgradeProjectorImages() {
    if (document.documentElement.dataset.projectorMode !== 'true') return;
    $$('.live-photo', $('#slideStage')).forEach(image => {
      const url = optimizeImageUrl(safeHttpUrl(image.currentSrc || image.src, ''));
      if (!url || url === image.src || image.dataset.projectorSource === url) return;
      image.dataset.projectorSource = url;
      const candidate = new Image();
      candidate.decoding = 'async';
      try { candidate.fetchPriority = 'high'; } catch { /* older browsers */ }
      candidate.src = url;
      const apply = () => {
        if (!image.isConnected || document.documentElement.dataset.projectorMode !== 'true' || image.dataset.projectorSource !== url) return;
        image.src = url;
        image.dataset.projectorSourceApplied = url;
      };
      if (typeof candidate.decode === 'function') candidate.decode().then(apply).catch(() => {});
      else candidate.onload = apply;
    });
  }

  async function toggleProjectorMode() {
    const viewer = $('#presentationViewer');
    if (viewer.classList.contains('projector-mode')) {
      leaveProjectorMode();
      if (document.fullscreenElement === viewer) {
        try { await document.exitFullscreen(); } catch { /* the browser may have exited already */ }
      }
      toast('Đã thoát chế độ chiếu TV.');
      return;
    }

    projectorPreviousPerformanceMode = performanceMode;
    viewer.classList.add('projector-mode');
    document.documentElement.dataset.projectorMode = 'true';
    $('#viewerProjector')?.setAttribute('aria-pressed', 'true');
    setViewerUIHidden(false);
    setPerformanceMode('cinema', false);
    if (!motionEnabled && !reducedMotion.matches) setMotion(true);
    upgradeProjectorImages();
    syncFullscreenControls();

    let enteredFullscreen = document.fullscreenElement === viewer;
    if (!enteredFullscreen && typeof viewer.requestFullscreen === 'function') {
      try {
        await viewer.requestFullscreen({ navigationUI: 'hide' });
        enteredFullscreen = document.fullscreenElement === viewer;
      } catch {
        try {
          await viewer.requestFullscreen();
          enteredFullscreen = document.fullscreenElement === viewer;
        } catch { /* keep the projector layout available even if fullscreen is blocked */ }
      }
    }
    projectorWasFullscreen = enteredFullscreen;
    syncFullscreenControls();
    requestAnimationFrame(resizeStageAtmosphere);
    toast(enteredFullscreen
      ? 'Chế độ chiếu TV đã bật: toàn màn hình, hiệu ứng điện ảnh và hình ảnh độ phân giải cao.'
      : 'Đã bật bố cục chiếu TV. Bấm F hoặc nút toàn màn hình nếu trình duyệt chưa phủ kín màn hình.');
  }

  async function toggleFullscreen() {
    const viewer = $('#presentationViewer');
    try {
      if (document.fullscreenElement === viewer) {
        await document.exitFullscreen();
      } else if (viewer.requestFullscreen) {
        await viewer.requestFullscreen({ navigationUI: 'hide' });
      } else {
        toast('Trình duyệt này chưa hỗ trợ toàn màn hình.');
      }
    } catch {
      try {
        if (!document.fullscreenElement && viewer.requestFullscreen) {
          await viewer.requestFullscreen();
        } else {
          toast('Không thể bật toàn màn hình. Hãy dùng menu của trình duyệt.');
        }
      } catch {
        toast('Không thể bật toàn màn hình. Hãy thử qua menu của trình duyệt.');
      }
    }
    syncFullscreenControls();
  }

  function shareDeck(id) {
    const deck = decks.find(item => item.id === id);
    if (!deck) return;
    const url = new URL(location.href);
    url.hash = 'present/' + encodeURIComponent(id);
    $('#shareUrl').value = url.toString();
    $('#shareExplanation').textContent = deck.isSeed
      ? 'Bài Bài 32 được đóng gói cùng website nên người nhận có thể mở liên kết trên thiết bị khác. Lưu ý: liên kết hiện chưa có mật khẩu; bản nháp hoặc tệp nhập khác vẫn chỉ lưu trên thiết bị này.'
      : 'Đây là đường dẫn mẫu. Bản nháp này chỉ lưu trên thiết bị hiện tại nên người nhận ở thiết bị khác chưa thể xem nội dung.';
    openModal('shareModal');
  }

  function exportDeck(id) {
    const deck = decks.find(item => item.id === id);
    if (!deck) return;
    const blob = new Blob([JSON.stringify({ format: 'biosphere-deck', version: 1, presentation: deck }, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = deck.title.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 60) + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast('Đã xuất bài thuyết trình dạng JSON.');
  }

  function importDeck() {
    const file = $('#jsonImport').files?.[0];
    if (!file) {
      toast('Hãy chọn tệp JSON trước.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('Tệp vượt quá giới hạn 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const deck = payload && typeof payload === 'object' ? (payload.presentation || payload) : null;
        if (!isValidDeckShape(deck)) throw new Error('invalid presentation');
        deck.id = 'import-' + Date.now().toString(36);
        deck.isSeed = false;
        deck.status = 'draft';
        decks.unshift(deck);
        persist();
        renderDecks();
        closeModal($('#importModal'));
        $('#jsonImport').value = '';
        showView('library');
        toast('Đã nhập bài vào thư viện cục bộ.');
      } catch {
        toast('Tệp không đúng định dạng BioSphere JSON.');
      }
    };
    reader.onerror = () => toast('Không thể đọc tệp. Hãy thử lại.');
    reader.readAsText(file);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const light = theme === 'light';
    $('#themeToggle').textContent = light ? '☀' : '◐';
    $('#settingsTheme').classList.toggle('on', light);
    $('#settingsTheme').setAttribute('aria-checked', String(light));
    try { localStorage.setItem('biosphere-theme-v2', theme); } catch { /* theme remains active this session */ }
  }

  function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  }

  function setMotion(enabled) {
    motionEnabled = Boolean(enabled);
    $('#settingsMotion').classList.toggle('on', motionEnabled);
    $('#settingsMotion').setAttribute('aria-checked', String(motionEnabled));
    $('#viewerPlayMotion').setAttribute('aria-pressed', String(motionEnabled));
    $('#presentationViewer').classList.toggle('motion-off', !motionEnabled);
    if (motionEnabled && !reducedMotion.matches) {
      startStageAtmosphere();
      attachVideoBackgrounds($('#slideStage'));
    } else {
      stopStageAtmosphere();
      $$('.live-video', $('#slideStage')).forEach(video => video.pause());
      $$('.photo-frame.video-playing', $('#slideStage')).forEach(frame => frame.classList.remove('video-playing'));
    }
    if (activeAnatomy3D) {
      if (activeAnatomy3D.kind === 'native') {
        if (motionEnabled && !reducedMotion.matches && activeAnatomy3D.autoRotate) activeAnatomy3D.viewer.setAttribute('auto-rotate', '');
        else activeAnatomy3D.viewer.removeAttribute('auto-rotate');
      } else {
        if (!motionEnabled || reducedMotion.matches) activeAnatomy3D.autoRotate = false;
        activeAnatomy3D.render?.();
      }
    }
    updatePerformanceUI();
  }

  // Shared event delegation avoids accumulating listeners when the library rerenders.
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;

    if (target.matches('[data-performance-mode]')) {
      setPerformanceMode(target.dataset.performanceMode);
      return;
    }
    if (target.matches('[data-present]')) present(target.dataset.present);
    if (target.matches('[data-share]')) shareDeck(target.dataset.share);
    if (target.matches('[data-export]')) exportDeck(target.dataset.export);
    if (target.matches('[data-view]')) showView(target.dataset.view);
    if (target.matches('[data-filter]')) {
      activeFilter = target.dataset.filter;
      $$('[data-filter]').forEach(button => button.classList.toggle('active', button === target));
      renderDecks();
    }
    if (target.matches('[data-template]')) {
      openModal('createModal');
      const templateSelect = $('#createForm select[name="subject"]');
      templateSelect.value = 'science';
      $('#createForm').dataset.template = target.dataset.template;
    }
    if (target.matches('[data-close-modal]')) closeModal(target.closest('.modal-backdrop'));
    if (target.id === 'createOpen' || target.id === 'heroCreate' || target.id === 'emptyCreate') openModal('createModal');
    if (target.id === 'heroSample') present(seedDeck.id);
    if (target.id === 'importOpen') openModal('importModal');
    if (target.id === 'mobileMenu') $('#mainNav').classList.toggle('open');
    if (target.id === 'themeToggle') toggleTheme();
    if (target.id === 'settingsTheme') toggleTheme();
    if (target.id === 'settingsMotion') setMotion(!motionEnabled);
    if (target.id === 'viewerPlayMotion') {
      setMotion(!motionEnabled);
      toast(motionEnabled ? 'Đã bật chuyển động' : 'Đã giảm chuyển động');
    }
    if (target.id === 'viewerReplay') {
      slideIndex = 0;
      quizSession = { deckId: null, slideIndex: -1, questionIndex: 0, answers: {}, score: 0 };
      renderSlide({ animate: false });
      return;
    }
    if (target.id === 'viewerFinalContents') { openContents(); return; }
    if (target.matches('[data-case-answer]')) {
      const panel = target.closest('.classroom-prompt');
      if (!panel || panel.dataset.caseAnswered === 'true') return;
      const selected = Number(target.dataset.caseAnswer);
      const correct = Number(panel.dataset.caseCorrectIndex);
      if (!Number.isInteger(selected) || !Number.isInteger(correct)) return;
      panel.dataset.caseAnswered = 'true';
      panel.querySelectorAll('[data-case-answer]').forEach((button, index) => {
        button.disabled = true;
        button.setAttribute('aria-pressed', String(index === selected));
        if (index === correct) button.classList.add('is-correct');
        if (index === selected && selected !== correct) button.classList.add('is-wrong');
      });
      const feedback = panel.querySelector('.classroom-answer');
      const label = feedback?.querySelector('.case-quiz-result');
      if (label) label.textContent = selected === correct ? 'Chính xác — em đã chọn đúng!' : 'Chưa đúng — cùng ghi nhớ đáp án';
      if (feedback) feedback.hidden = false;
      return;
    }
    if (target.matches('[data-reveal-answer]')) {
      const panel = target.closest('.classroom-prompt');
      const answer = panel?.querySelector('.classroom-answer');
      if (answer) {
        answer.hidden = !answer.hidden;
        target.setAttribute('aria-expanded', String(!answer.hidden));
        target.innerHTML = answer.hidden ? 'Hiện đáp án gợi ý <span aria-hidden="true">＋</span>' : 'Ẩn đáp án gợi ý <span aria-hidden="true">−</span>';
      }
      return;
    }
    if (target.id === 'viewerControlsToggle') {
      setViewerUIHidden(!$('#presentationViewer').classList.contains('ui-hidden'));
      return;
    }
    if (target.id === 'viewerContents') { openContents(); return; }
    if (target.id === 'contentsClose') { closeContents(); return; }
    if (target.matches('[data-jump-slide]')) {
      const nextIndex = Number(target.dataset.jumpSlide);
      if (Number.isInteger(nextIndex) && currentDeck?.slides?.[nextIndex]) {
        slideIndex = nextIndex;
        closeContents(false);
        renderSlide({ animate: false });
      }
      return;
    }
    if (target.matches('[data-media-mode]')) {
      const slidePage = target.closest('.slide-page');
      const experience = target.closest('.media-experience') || slidePage?.querySelector('.media-experience');
      if (!experience) return;
      const mode = target.dataset.mediaMode;
      const imageView = experience.querySelector('.media-image-view');
      const modelView = experience.querySelector('.media-3d-view');
      if (!imageView || !modelView) return;
      // The mobile toolbar lives with the slide copy; keep both bars in sync.
      $$('[data-media-mode]', slidePage || experience).forEach(button => {
        const active = button.dataset.mediaMode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const showModel = mode === 'model';
      slidePage?.classList.toggle('is-model-active', showModel);
      if (showModel) $$('.live-video', imageView).forEach(video => video.pause());
      else if (motionEnabled && !reducedMotion.matches) attachVideoBackgrounds(imageView);
      imageView.hidden = showModel;
      modelView.hidden = !showModel;
      imageView.classList.toggle('is-active', !showModel);
      modelView.classList.toggle('is-active', showModel);
      if (showModel) initInteractiveModels(experience);
      else {
        const modelPanel = modelView.querySelector('.anatomy3d-panel');
        if (activeAnatomy3D?.panel === modelPanel) disposeInteractiveModel();
        else if (modelPanel) delete modelPanel.dataset.modelInitializing;
        if (modelPanel) modelPanel.dataset.modelRequest = String((Number(modelPanel.dataset.modelRequest) || 0) + 1);
      }
      return;
    }
    if (target.matches('[data-model-action]')) { controlInteractiveModel(target); return; }
    if (target.matches('[data-quiz-answer]')) answerQuiz(Number(target.dataset.quizAnswer));
    if (target.matches('[data-quiz-restart]')) restartQuiz();
    if (target.id === 'viewerSound') toggleQuizSound();
    if (target.id === 'slidePrev') goPrevious();
    if (target.id === 'slideNext') goNext();
    if (target.id === 'viewerClose' || target.id === 'viewerExit') exitPresentation();
    if (target.id === 'viewerFullscreen') { toggleFullscreen(); return; }
    if (target.id === 'viewerProjector') { toggleProjectorMode(); return; }
    if (target.id === 'resetLocal') {
      decks = [seedDeck];
      persist();
      renderDecks();
      toast('Đã khôi phục khung bài mẫu.');
    }
    if (target.id === 'copyShare') {
      navigator.clipboard?.writeText($('#shareUrl').value).then(
        () => toast('Đã sao chép liên kết.'),
        () => { $('#shareUrl').select(); toast('Hãy sao chép liên kết đã chọn.'); }
      ) || ($('#shareUrl').select(), toast('Hãy sao chép liên kết đã chọn.'));
    }
  });

  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    showView('library');
  });

  $('#presentationContents').addEventListener('click', event => {
    if (event.target.id === 'presentationContents') closeContents();
  });

  $('#slideStage').addEventListener('click', event => {
    const quizSlide = currentDeck?.slides?.[slideIndex];
    if (quizSlide?.interactiveQuiz) {
      const answerButton = event.target.closest('[data-quiz-answer]');
      const interactiveControl = event.target.closest('a, [data-quiz-restart], input, select, textarea');
      if (interactiveControl) return;
      if (answerButton) {
        if (Object.prototype.hasOwnProperty.call(quizSession.answers, quizSession.questionIndex)) nextQuizQuestion();
        return;
      }
      advanceFromStage();
      return;
    }
    if (event.target.closest('a, button, input, select, textarea')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left + bounds.width / 2) goPrevious();
    else goNext();
  });

  $('#searchDecks').addEventListener('input', renderDecks);
  $('#createForm').addEventListener('submit', event => {
    event.preventDefault();
    makeDeck(new FormData(event.currentTarget), event.currentTarget.dataset.template || 'science');
    event.currentTarget.dataset.template = 'science';
  });
  $('#jsonImport').addEventListener('change', () => {
    const file = $('#jsonImport').files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Tệp vượt quá giới hạn 2 MB.');
      $('#jsonImport').value = '';
      return;
    }
    importDeck();
  });
  $('#importModal').addEventListener('click', event => {
    if (event.target.id === 'importModal') closeModal(event.currentTarget);
    if (event.target.id === 'jsonImport') event.stopPropagation();
  });
  $('#importOpen').addEventListener('dblclick', importDeck);
  $('#shareModal').addEventListener('click', event => {
    if (event.target.id === 'shareModal') closeModal(event.currentTarget);
  });

  document.addEventListener('keydown', event => {
    const viewerOpen = !$('#presentationViewer').hidden;
    if (viewerOpen) {
      if (!event.ctrlKey && !event.altKey && !event.metaKey &&
          !event.target.closest?.('input, textarea, select, [contenteditable="true"]')) {
        if (event.key.toLowerCase() === 'p') {
          event.preventDefault();
          toggleProjectorMode();
          return;
        }
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          toggleFullscreen();
          return;
        }
      }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setViewerUIHidden(!$('#presentationViewer').classList.contains('ui-hidden'));
        return;
      }
      if (event.key === 'Escape' && !$('#presentationContents').hidden) {
        event.preventDefault();
        closeContents();
        return;
      }
      const quizSlide = currentDeck?.slides?.[slideIndex];
      const quizActive = Boolean(quizSlide?.interactiveQuiz);
      const quizIndex = quizSession.questionIndex;
      const quizAnswered = quizActive && quizIndex < quizSlide.quizQuestions.length &&
        Object.prototype.hasOwnProperty.call(quizSession.answers, quizIndex);
      const forwardKeys = ['ArrowRight', 'PageDown', ' '];

      if (quizActive && quizAnswered && forwardKeys.includes(event.key)) {
        event.preventDefault();
        advanceFromStage();
        return;
      }

      const control = event.target.closest?.('button, a, input, select, textarea, [role="button"]');
      if (control) {
        if (control.matches('[data-quiz-answer]') && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
          const choices = $$('[data-quiz-answer]', $('#slideStage')).filter(button => !button.disabled);
          const index = choices.indexOf(control);
          const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
          const nextChoice = choices[index + direction];
          if (nextChoice) {
            event.preventDefault();
            nextChoice.focus();
          }
        }
        if (event.key === 'Escape' && !document.fullscreenElement) exitPresentation();
        return;
      }
      if (forwardKeys.includes(event.key)) {
        event.preventDefault();
        if (quizActive) advanceFromStage();
        else goNext();
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        goPrevious();
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        exitPresentation();
      }
      return;
    }
    if (event.key === 'Escape') $$('.modal-backdrop:not([hidden])').forEach(closeModal);
  });

  window.addEventListener('popstate', () => {
    const hash = location.hash.slice(1);
    if (!$('#presentationViewer').hidden) {
      $('#presentationViewer').hidden = true;
      document.body.style.overflow = '';
      stopStageAtmosphere();
      disposeInteractiveModel();
      closeContents(false);
      if (transitionCleanupTimer) window.clearTimeout(transitionCleanupTimer);
      transitionCleanupTimer = 0;
      activeTransitionGhost?.remove();
      activeTransitionGhost = null;
      $('#slideStage').innerHTML = '';
      currentDeck = null;
    }
    if (hash.startsWith('present/')) {
      const id = safeDecodeURIComponent(hash.slice('present/'.length));
      if (decks.some(deck => deck.id === id)) present(id);
      else showView('library', false);
    } else {
      showView(hash, false);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const viewer = $('#presentationViewer');
    if (document.fullscreenElement === viewer) {
      projectorWasFullscreen = viewer.classList.contains('projector-mode');
    } else if (viewer.classList.contains('projector-mode') && projectorWasFullscreen) {
      // Escape or the browser's native exit action ends projector mode as well.
      leaveProjectorMode();
    }
    syncFullscreenControls();
    if (!viewer.hidden) requestAnimationFrame(resizeStageAtmosphere);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStageAtmosphere();
      $$('.live-video', $('#slideStage')).forEach(video => video.pause());
    } else if (!$('#presentationViewer').hidden && motionEnabled && !reducedMotion.matches) {
      startStageAtmosphere();
      attachVideoBackgrounds($('#slideStage'));
    }
  });

  reducedMotion.addEventListener?.('change', event => {
    if (event.matches) setMotion(false);
  });

  const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  networkInfo?.addEventListener?.('change', () => setPerformanceMode(performanceMode, false));
  window.addEventListener('online', () => setPerformanceMode(performanceMode, false));
  window.addEventListener('offline', () => setPerformanceMode(performanceMode, false));

  try {
    const savedTheme = localStorage.getItem('biosphere-theme-v2');
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
    else setTheme('light');
  } catch {
    setTheme('light');
  }
  renderDecks();
  try { soundEnabled = localStorage.getItem('biosphere-quiz-sound') !== 'off'; } catch { soundEnabled = true; }
  if ($('#viewerSound')) {
    $('#viewerSound').textContent = soundEnabled ? '♫' : '♪';
    $('#viewerSound').setAttribute('aria-pressed', String(soundEnabled));
    $('#viewerSound').setAttribute('aria-label', soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh');
  }
  initStageAtmosphere();
  updatePerformanceUI();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {
      // The app remains fully usable if service workers are blocked by browser or hosting policy.
    });
  }

  const initialHash = location.hash.slice(1);
  if (initialHash.startsWith('present/')) {
    const id = safeDecodeURIComponent(initialHash.slice('present/'.length));
    if (decks.some(deck => deck.id === id)) present(id);
    else showView('library', false);
  } else {
    showView(initialHash, false);
  }
})();