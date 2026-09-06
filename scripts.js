/* ==========================================================================
   DV-SUITE — scripts.js
   ========================================================================== */
'use strict';

const DV_WATERMARK_TEXT = 'DON VICTOR MINISTRIES';

/* ==========================================================================
   0. Small utilities
   ========================================================================== */

const dvQs  = (sel, root) => (root || document).querySelector(sel);
const dvQsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function dvClamp(dvVal, dvMin, dvMax) {
  return Math.min(dvMax, Math.max(dvMin, dvVal));
}

function dvUid() {
  return 'dv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dvEscapeHtml(dvStr) {
  const dvDiv = document.createElement('div');
  dvDiv.textContent = dvStr == null ? '' : String(dvStr);
  return dvDiv.innerHTML;
}

/* ==========================================================================
   1. Toast system (replaces browser alerts)
   ========================================================================== */

const DvToast = {
  dvShow(dvMessage, dvType) {
    const dvStack = dvQs('#dvToastStack');
    if (!dvStack) return;
    const dvToastEl = document.createElement('div');
    dvToastEl.className = 'dv-toast' + (dvType ? ` dv-toast--${dvType}` : '');
    dvToastEl.textContent = dvMessage;
    dvStack.appendChild(dvToastEl);
    requestAnimationFrame(() => dvToastEl.classList.add('dv-toast--visible'));
    setTimeout(() => {
      dvToastEl.classList.remove('dv-toast--visible');
      setTimeout(() => dvToastEl.remove(), 250);
    }, 2600);
  }
};

const DvColor = {
  dvProbeEl: null,

  dvGetProbe() {
    if (!this.dvProbeEl) this.dvProbeEl = new Option();
    return this.dvProbeEl;
  },

  dvIsValid(dvValue) {
    if (!dvValue) return false;
    const dvProbe = this.dvGetProbe();
    dvProbe.style.color = '';
    dvProbe.style.color = dvValue;
    return dvProbe.style.color !== '';
  },

  // Resolve any valid CSS colour (hex or name) to a normalized #rrggbb hex,
  // since the canvas engine's contrast maths expects hex.
  dvToHex(dvValue) {
    if (!this.dvIsValid(dvValue)) return null;
    const dvCanvas = document.createElement('canvas');
    dvCanvas.width = 1; dvCanvas.height = 1;
    const dvCtx = dvCanvas.getContext('2d');
    dvCtx.fillStyle = '#000000';
    dvCtx.fillStyle = dvValue;
    dvCtx.fillRect(0, 0, 1, 1);
    const dvPixel = dvCtx.getImageData(0, 0, 1, 1).data;
    return '#' + [dvPixel[0], dvPixel[1], dvPixel[2]].map((dvV) => dvV.toString(16).padStart(2, '0')).join('');
  }
};

const DvDB = {
  dvName: 'dv-suite-db',
  dvVersion: 1,
  dvStoreFiles: 'dvFiles',
  dvStoreSettings: 'dvSettings',
  dvHandle: null,

  dvOpen() {
    if (this.dvHandle) return Promise.resolve(this.dvHandle);
    return new Promise((dvResolve, dvReject) => {
      const dvReq = indexedDB.open(this.dvName, this.dvVersion);
      dvReq.onupgradeneeded = () => {
        const dvDb = dvReq.result;
        if (!dvDb.objectStoreNames.contains(DvDB.dvStoreFiles)) {
          const dvStore = dvDb.createObjectStore(DvDB.dvStoreFiles, { keyPath: 'id' });
          dvStore.createIndex('dvUpdatedAt', 'updatedAt');
        }
        if (!dvDb.objectStoreNames.contains(DvDB.dvStoreSettings)) {
          dvDb.createObjectStore(DvDB.dvStoreSettings, { keyPath: 'key' });
        }
      };
      dvReq.onsuccess = () => { this.dvHandle = dvReq.result; dvResolve(this.dvHandle); };
      dvReq.onerror = () => dvReject(dvReq.error);
    });
  },

  async dvTx(dvStoreName, dvMode) {
    const dvDb = await this.dvOpen();
    return dvDb.transaction(dvStoreName, dvMode).objectStore(dvStoreName);
  },

  async dvPutFile(dvFile) {
    const dvStore = await this.dvTx(this.dvStoreFiles, 'readwrite');
    return new Promise((dvRes, dvRej) => {
      const dvReq = dvStore.put(dvFile);
      dvReq.onsuccess = () => dvRes(dvFile);
      dvReq.onerror = () => dvRej(dvReq.error);
    });
  },

  async dvGetAllFiles() {
    const dvStore = await this.dvTx(this.dvStoreFiles, 'readonly');
    return new Promise((dvRes, dvRej) => {
      const dvReq = dvStore.getAll();
      dvReq.onsuccess = () => dvRes(dvReq.result.sort((a, b) => b.updatedAt - a.updatedAt));
      dvReq.onerror = () => dvRej(dvReq.error);
    });
  },

  async dvDeleteFile(dvId) {
    const dvStore = await this.dvTx(this.dvStoreFiles, 'readwrite');
    return new Promise((dvRes, dvRej) => {
      const dvReq = dvStore.delete(dvId);
      dvReq.onsuccess = () => dvRes();
      dvReq.onerror = () => dvRej(dvReq.error);
    });
  }
};

/* ==========================================================================
   3. Settings (persisted in localStorage — small key/value, sync UI needs)
   ========================================================================== */

const DvSettings = {
  dvKey: 'dv-suite-settings',
  dvDefaults: { theme: 'light', accent: 'blue', fontScale: 100 },

  dvLoad() {
    try {
      const dvRaw = localStorage.getItem(this.dvKey);
      return dvRaw ? Object.assign({}, this.dvDefaults, JSON.parse(dvRaw)) : Object.assign({}, this.dvDefaults);
    } catch (dvErr) {
      return Object.assign({}, this.dvDefaults);
    }
  },

  dvSave(dvSettings) {
    try { localStorage.setItem(this.dvKey, JSON.stringify(dvSettings)); } catch (dvErr) { /* storage unavailable */ }
  },

  dvApply(dvSettings) {
    document.documentElement.setAttribute('data-dv-theme', dvSettings.theme);
    document.documentElement.setAttribute('data-dv-accent', dvSettings.accent);
    document.documentElement.style.setProperty('--dv-scale', (dvSettings.fontScale / 100).toFixed(2));
  }
};

/* ==========================================================================
   4. Router — page navigation + Android-style back handling
   ========================================================================== */

const DvRouter = {
  dvCurrent: 'home',
  dvStack: ['home'],

  dvTitles: { home: 'DV-SUITE', editor: 'Editor', files: 'Files', more: 'More' },

  dvInit() {
    dvQsa('[data-dv-nav]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => this.dvGoTo(dvBtn.getAttribute('data-dv-nav'), true));
    });
    dvQs('#dvBackBtn').addEventListener('click', () => this.dvBack());
    window.addEventListener('popstate', () => this.dvBack(true));
    history.replaceState({ dvPage: 'home' }, '');
    this.dvRender();
  },

  dvGoTo(dvPage, dvIsNavTap) {
    if (dvPage === this.dvCurrent) return;
    this.dvCurrent = dvPage;
    if (dvIsNavTap) {
      this.dvStack = [dvPage];
      history.pushState({ dvPage }, '');
    }
    this.dvRender();
  },

  dvBack(dvFromPopstate) {
    if (DvModal.dvIsOpen()) { DvModal.dvClose(); return; }
    if (DvSidebars.dvAnyOpen()) { DvSidebars.dvCloseAll(); return; }
    if (this.dvCurrent !== 'home') {
      this.dvCurrent = 'home';
      this.dvRender();
      if (!dvFromPopstate) history.pushState({ dvPage: 'home' }, '');
    }
  },

  dvRender() {
    dvQsa('.dv-page').forEach((dvPageEl) => {
      dvPageEl.classList.toggle('dv-page--active', dvPageEl.getAttribute('data-dv-page') === this.dvCurrent);
    });
    dvQsa('[data-dv-nav]').forEach((dvBtn) => {
      dvBtn.classList.toggle('dv-bottomnav__item--active', dvBtn.getAttribute('data-dv-nav') === this.dvCurrent);
    });
    dvQs('#dvPageTitle').textContent = this.dvTitles[this.dvCurrent] || 'DV-SUITE';
    dvQs('#dvBackBtn').classList.toggle('dv-icon-btn--hidden', this.dvCurrent === 'home');
    if (this.dvCurrent === 'files') DvFiles.dvRenderList();
    if (this.dvCurrent === 'home') DvFiles.dvRenderRecent();
  }
};

/* ==========================================================================
   5. Sidebars — two fully independent systems
   ========================================================================== */

const DvSidebars = {
  dvInit() {
    dvQs('#dvHamburgerBtn').classList.remove('dv-hidden');
    dvQs('#dvHamburgerBtn').addEventListener('click', () => this.dvOpen('info'));
    dvQs('#dvInfoScrim').addEventListener('click', () => this.dvClose('info'));
    dvQs('#dvInfoCloseBtn').addEventListener('click', () => this.dvClose('info'));
    dvQs('#dvInfoExitBtn').addEventListener('click', () => this.dvClose('info'));

    dvQs('#dvMoreDotsBtn').addEventListener('click', () => this.dvOpen('settings'));
    dvQs('#dvSettingsScrim').addEventListener('click', () => this.dvClose('settings'));
    dvQs('#dvSettingsCloseBtn').addEventListener('click', () => this.dvClose('settings'));
    dvQs('#dvSettingsExitBtn').addEventListener('click', () => this.dvClose('settings'));

    dvQsa('[data-dv-info]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        this.dvClose('info');
        DvContent.dvOpenInfo(dvBtn.getAttribute('data-dv-info'));
      });
    });
  },

  dvOpen(dvWhich) {
    const dvSidebar = dvQs(dvWhich === 'info' ? '#dvInfoSidebar' : '#dvSettingsSidebar');
    const dvScrim = dvQs(dvWhich === 'info' ? '#dvInfoScrim' : '#dvSettingsScrim');
    dvSidebar.classList.add('dv-sidebar--open');
    dvScrim.classList.add('dv-sidebar-scrim--visible');
  },

  dvClose(dvWhich) {
    const dvSidebar = dvQs(dvWhich === 'info' ? '#dvInfoSidebar' : '#dvSettingsSidebar');
    const dvScrim = dvQs(dvWhich === 'info' ? '#dvInfoScrim' : '#dvSettingsScrim');
    dvSidebar.classList.remove('dv-sidebar--open');
    dvScrim.classList.remove('dv-sidebar-scrim--visible');
  },

  dvCloseAll() { this.dvClose('info'); this.dvClose('settings'); },

  dvAnyOpen() {
    return dvQs('#dvInfoSidebar').classList.contains('dv-sidebar--open') ||
           dvQs('#dvSettingsSidebar').classList.contains('dv-sidebar--open');
  }
};

/* ==========================================================================
   6. Settings sidebar controls wiring
   ========================================================================== */

const DvSettingsPanel = {
  dvAccents: ['blue', 'red', 'green', 'orange', 'purple', 'teal', 'pink', 'indigo', 'amber', 'slate'],
  dvState: null,

  dvInit() {
    this.dvState = DvSettings.dvLoad();
    DvSettings.dvApply(this.dvState);

    const dvGrid = dvQs('#dvThemeGrid');
    dvGrid.innerHTML = '';
    this.dvAccents.forEach((dvAccent) => {
      const dvSwatch = document.createElement('button');
      dvSwatch.className = 'dv-theme-swatch' + (dvAccent === this.dvState.accent ? ' dv-theme-swatch--active' : '');
      dvSwatch.style.background = getComputedStyle(document.documentElement).getPropertyValue(`--dv-color-primary`);
      dvSwatch.setAttribute('data-dv-accent-opt', dvAccent);
      dvSwatch.addEventListener('click', () => this.dvSetAccent(dvAccent));
      dvGrid.appendChild(dvSwatch);
    });
    this.dvPaintSwatches();

    const dvDarkToggle = dvQs('#dvDarkModeToggle');
    dvDarkToggle.classList.toggle('dv-toggle--on', this.dvState.theme === 'dark');
    dvDarkToggle.addEventListener('click', () => {
      this.dvState.theme = this.dvState.theme === 'dark' ? 'light' : 'dark';
      dvDarkToggle.classList.toggle('dv-toggle--on', this.dvState.theme === 'dark');
      DvSettings.dvApply(this.dvState);
      DvSettings.dvSave(this.dvState);
    });

    const dvScaleSlider = dvQs('#dvFontScaleSlider');
    dvScaleSlider.value = this.dvState.fontScale;
    dvScaleSlider.addEventListener('input', () => {
      this.dvState.fontScale = Number(dvScaleSlider.value);
      DvSettings.dvApply(this.dvState);
      DvSettings.dvSave(this.dvState);
    });

    dvQs('#dvInstallAppBtn').addEventListener('click', () => DvInstall.dvPrompt());
    dvQs('#dvShareAppBtn').addEventListener('click', () => DvShare.dvShareApp());
  },

  dvSetAccent(dvAccent) {
    this.dvState.accent = dvAccent;
    DvSettings.dvApply(this.dvState);
    DvSettings.dvSave(this.dvState);
    this.dvPaintSwatches();
  },

  dvPaintSwatches() {
    const dvColorsByAccent = {
      blue: '#1877F2', red: '#FA383E', green: '#42B72A', orange: '#F7931E', purple: '#8B5CF6',
      teal: '#14B8A6', pink: '#EC4899', indigo: '#6366F1', amber: '#D97706', slate: '#475569'
    };
    dvQsa('[data-dv-accent-opt]').forEach((dvSwatch) => {
      const dvAccent = dvSwatch.getAttribute('data-dv-accent-opt');
      dvSwatch.style.background = dvColorsByAccent[dvAccent];
      dvSwatch.classList.toggle('dv-theme-swatch--active', dvAccent === this.dvState.accent);
    });
  }
};

/* ==========================================================================
   7. Full-page modal (info pages + generic detail views)
   ========================================================================== */

const DvModal = {
  dvInit() {
    dvQs('#dvModalBackBtn').addEventListener('click', () => this.dvClose());
  },
  dvOpen(dvTitle, dvHtml) {
    dvQs('#dvModalTitle').textContent = dvTitle;
    dvQs('#dvModalBody').innerHTML = dvHtml;
    dvQs('#dvModal').classList.add('dv-modal--open');
  },
  dvClose() { dvQs('#dvModal').classList.remove('dv-modal--open'); },
  dvIsOpen() { return dvQs('#dvModal').classList.contains('dv-modal--open'); }
};

const DvContent = {
  dvBodies: {
    about: `<p>DV-SUITE is an offline-first design tool for creating stickers, tickers and GIFs directly on your Android device — no account, no server, no tracking.</p>`,
    developer: `<p>DV-SUITE is built and maintained as an independent, Android-first web application.</p>`,
    warning: `<p><strong>Proprietary Software Notice.</strong> DV-SUITE and its source code are proprietary. Copying, redistributing, or repackaging this application without authorization is prohibited.</p>`,
    contact: `<p>For support or feedback, use the contact channel provided with your copy of DV-SUITE.</p>`,
    howto: `<ol><li>Open the Editor tab.</li><li>Pick a template.</li><li>Add your content, colours and layout.</li><li>Check the Quality tab for warnings.</li><li>Tap Export / Share to save or send your design.</li></ol>`
  },
  dvTitles: { about: 'About Us', developer: 'About Developer', warning: 'Proprietary Software Warning', contact: 'Contact Us', howto: 'How to Use' },
  dvOpenInfo(dvKey) {
    DvModal.dvOpen(this.dvTitles[dvKey] || '', this.dvBodies[dvKey] || '');
  }
};

/* ==========================================================================
   8. Templates
   ========================================================================== */

const DvTemplates = [
  { id: 'centered-headline', name: 'Centered Headline' },
  { id: 'left-editorial',    name: 'Left-Aligned Editorial' },
  { id: 'image-focused',     name: 'Image Focused' },
  { id: 'quote-focused',     name: 'Quote Focused' },
  { id: 'text-focused',      name: 'Text Focused' }
];

/* ==========================================================================
   9. Design state + Canvas rendering engine
   ========================================================================== */

const DvDesign = {
  dvState: null,

  dvNew() {
    this.dvState = {
      id: null,
      kind: 'design', // 'design' | 'sticker' | 'ticker' | 'gif' — drives the rendering engine's shape/behavior
      template: 'centered-headline',
      headline: 'Your Headline Here',
      body: 'Supporting text goes here. It will wrap and resize to stay readable.',
      footer: '',
      author: '',
      imageDataUrl: null,
      imagePos: 'top',
      primaryColor: '#1877F2',
      secondaryColor: '#FFFFFF',
      headlineColor: '#1877F2',
      bodyColor: '#333333',
      font: "Roboto, system-ui, sans-serif",
      textSize: 32,
      contrast: 35,
      align: 'left',
      aspect: '1:1',
      width: 600,
      height: 600,
      animate: 'none',
      durationSec: 5,
      updatedAt: Date.now()
    };
  },

  dvAspectRatio() {
    const dvMap = { '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '4:5': 4 / 5 };
    return dvMap[this.dvState.aspect] || (this.dvState.width / this.dvState.height);
  },

  dvSyncDimensionsFromAspect() {
    if (this.dvState.aspect === 'custom') return;
    const dvRatio = this.dvAspectRatio();
    const dvBase = 600;
    if (dvRatio >= 1) {
      this.dvState.width = dvBase;
      this.dvState.height = Math.round(dvBase / dvRatio);
    } else {
      this.dvState.height = dvBase;
      this.dvState.width = Math.round(dvBase * dvRatio);
    }
  }
};

const DvRenderer = {
  dvWrapText(dvCtx, dvText, dvMaxWidth) {
    const dvWords = String(dvText || '').split(/\s+/).filter(Boolean);
    const dvLines = [];
    let dvLine = '';
    dvWords.forEach((dvWord) => {
      const dvTest = dvLine ? dvLine + ' ' + dvWord : dvWord;
      if (dvCtx.measureText(dvTest).width > dvMaxWidth && dvLine) {
        dvLines.push(dvLine);
        dvLine = dvWord;
      } else {
        dvLine = dvTest;
      }
    });
    if (dvLine) dvLines.push(dvLine);
    return dvLines;
  },

  dvFitFontSize(dvCtx, dvText, dvMaxWidth, dvMaxHeight, dvStartSize, dvFontFamily, dvWeight) {
    let dvSize = dvStartSize;
    while (dvSize > 12) {
      dvCtx.font = `${dvWeight || 700} ${dvSize}px ${dvFontFamily}`;
      const dvLines = this.dvWrapText(dvCtx, dvText, dvMaxWidth);
      if (dvLines.length * dvSize * 1.25 <= dvMaxHeight) return { size: dvSize, lines: dvLines };
      dvSize -= 2;
    }
    dvCtx.font = `${dvWeight || 700} ${dvSize}px ${dvFontFamily}`;
    return { size: dvSize, lines: this.dvWrapText(dvCtx, dvText, dvMaxWidth) };
  },

  dvDrawFrame(dvCanvas, dvState, dvAnimT) {
    if (dvState.kind === 'sticker') { this.dvDrawStickerFrame(dvCanvas, dvState); return; }
    if (dvState.kind === 'ticker') { this.dvDrawTickerBannerFrame(dvCanvas, dvState, dvAnimT || 0); return; }
    this.dvDrawStandardFrame(dvCanvas, dvState);
  },

  dvDrawStandardFrame(dvCanvas, dvState) {
    const dvCtx = dvCanvas.getContext('2d');
    const dvW = dvCanvas.width, dvH = dvCanvas.height;
    const dvMargin = Math.round(Math.min(dvW, dvH) * 0.08);

    dvCtx.clearRect(0, 0, dvW, dvH);

    // Background
    dvCtx.fillStyle = dvState.secondaryColor || '#FFFFFF';
    dvCtx.fillRect(0, 0, dvW, dvH);

    // Background image (if positioned as background)
    const dvImg = dvState.dvImageEl || null;
    if (dvImg && dvState.imagePos === 'background') {
      this.dvDrawCover(dvCtx, dvImg, 0, 0, dvW, dvH);
      dvCtx.fillStyle = `rgba(0,0,0,${dvState.contrast / 100})`;
      dvCtx.fillRect(0, 0, dvW, dvH);
    } else if (dvState.template !== 'text-focused') {
      // Subtle gradient overlay for non-background templates
      const dvGrad = dvCtx.createLinearGradient(0, 0, 0, dvH);
      dvGrad.addColorStop(0, dvState.primaryColor + '22');
      dvGrad.addColorStop(1, dvState.primaryColor + '05');
      dvCtx.fillStyle = dvGrad;
      dvCtx.fillRect(0, 0, dvW, dvH);
    }

    let dvCursorY = dvMargin;
    const dvContentW = dvW - dvMargin * 2;
    const dvTextAlign = dvState.align === 'center' ? 'center' : (dvState.align === 'right' ? 'right' : 'left');
    const dvAlignX = dvTextAlign === 'center' ? dvW / 2 : (dvTextAlign === 'right' ? dvW - dvMargin : dvMargin);

    // Author / credit — rendered BEHIND the headline and body, large and
    // centered within the artwork itself, so the work sits in front of it
    // rather than the credit trailing far below everything else.
    if (dvState.author) {
      dvCtx.save();
      dvCtx.globalAlpha = 0.14;
      dvCtx.font = `700 ${Math.round(Math.min(dvW, dvH) * 0.16)}px ${dvState.font}`;
      dvCtx.fillStyle = dvState.imagePos === 'background' ? '#FFFFFF' : (dvState.headlineColor || dvState.primaryColor);
      dvCtx.textAlign = 'center';
      dvCtx.textBaseline = 'middle';
      dvCtx.fillText(dvState.author, dvW / 2, dvH / 2);
      dvCtx.restore();
    }

    // Foreground image top
    if (dvImg && dvState.imagePos === 'top') {
      const dvImgH = Math.round(dvH * 0.32);
      this.dvDrawCover(dvCtx, dvImg, dvMargin, dvCursorY, dvContentW, dvImgH, 12);
      dvCursorY += dvImgH + dvMargin * 0.6;
    }

    // Headline
    dvCtx.textAlign = dvTextAlign;
    dvCtx.textBaseline = 'top';
    dvCtx.fillStyle = dvState.imagePos === 'background' ? '#FFFFFF' : (dvState.headlineColor || dvState.primaryColor);

    const dvHeadlineMaxH = dvH * 0.32;
    const dvFit = this.dvFitFontSize(dvCtx, dvState.headline, dvContentW, dvHeadlineMaxH, dvState.textSize, dvState.font, 700);
    dvFit.lines.forEach((dvLine, dvIdx) => {
      dvCtx.fillText(dvLine, dvAlignX, dvCursorY + dvIdx * dvFit.size * 1.25);
    });
    dvCursorY += dvFit.lines.length * dvFit.size * 1.25 + dvMargin * 0.5;

    // Quote marks for quote-focused template
    if (dvState.template === 'quote-focused') {
      dvCtx.font = `700 ${Math.round(dvFit.size * 1.6)}px ${dvState.font}`;
      dvCtx.fillStyle = dvState.primaryColor + '55';
    }

    // Body text
    dvCtx.fillStyle = dvState.imagePos === 'background' ? '#F1F1F1' : (dvState.bodyColor || '#333333');
    const dvBodySize = Math.max(19, Math.round(dvState.textSize * 0.5));
    dvCtx.font = `400 ${dvBodySize}px ${dvState.font}`;
    const dvBodyMaxH = dvH - dvCursorY - dvMargin * (dvState.footer ? 2.2 : 1.2) - (dvState.imagePos === 'bottom' ? dvH * 0.3 : 0);
    const dvBodyLines = this.dvWrapText(dvCtx, dvState.body, dvContentW);
    let dvDrawn = 0;
    for (const dvLine of dvBodyLines) {
      if (dvDrawn + dvBodySize * 1.3 > Math.max(dvBodySize * 1.3, dvBodyMaxH)) break;
      dvCtx.fillText(dvLine, dvAlignX, dvCursorY + dvDrawn);
      dvDrawn += dvBodySize * 1.3;
    }
    dvCursorY += dvDrawn + dvMargin * 0.4;

    // Foreground image bottom
    if (dvImg && dvState.imagePos === 'bottom') {
      const dvImgH = Math.round(dvH * 0.28);
      const dvImgY = dvH - dvMargin - dvImgH - (dvState.footer ? 28 : 0);
      this.dvDrawCover(dvCtx, dvImg, dvMargin, dvImgY, dvContentW, dvImgH, 12);
    }

    // Footer
    if (dvState.footer) {
      dvCtx.font = `600 19px ${dvState.font}`;
      dvCtx.fillStyle = dvState.imagePos === 'background' ? '#EEEEEE' : '#777777';
      dvCtx.textAlign = 'center';
      dvCtx.fillText(dvState.footer, dvW / 2, dvH - dvMargin * 0.55);
    }

    this.dvDrawWatermark(dvCtx, dvW, dvH, dvState);

    // Animation transforms are applied by caller via canvas transform before calling this,
    // so this function always renders the base static frame content.
  },

  dvDrawWatermark(dvCtx, dvW, dvH, dvState) {
    // Hardcoded, always-on, tiled diagonally across the entire canvas so it
    // can't be cropped out by a screenshot — this is intentionally not a
    // user-configurable setting (see DV_WATERMARK_TEXT at top of file).
    dvCtx.save();
    dvCtx.globalAlpha = 0.16;
    const dvFontSize = Math.max(19, Math.round(Math.min(dvW, dvH) * 0.07));
    dvCtx.font = `700 ${dvFontSize}px ${dvState.font}`;
    dvCtx.fillStyle = '#000000';
    dvCtx.textAlign = 'center';
    dvCtx.textBaseline = 'middle';

    dvCtx.translate(dvW / 2, dvH / 2);
    dvCtx.rotate(-Math.PI / 8);
    dvCtx.translate(-dvW / 2, -dvH / 2);

    const dvStepX = dvFontSize * (DV_WATERMARK_TEXT.length * 0.62 + 3);
    const dvStepY = dvFontSize * 2.4;
    const dvSpan = Math.max(dvW, dvH) * 1.6;
    for (let dvY = -dvSpan / 2; dvY < dvSpan; dvY += dvStepY) {
      for (let dvX = -dvSpan / 2; dvX < dvSpan; dvX += dvStepX) {
        dvCtx.fillText(DV_WATERMARK_TEXT, dvX, dvY);
      }
    }
    dvCtx.restore();
  },

  dvDrawStickerFrame(dvCanvas, dvState) {
    // Sticker engine: die-cut circular badge with a thick border ring — visually distinct
    // from a plain rectangular design, matching how stickers actually get cut/shared.
    const dvCtx = dvCanvas.getContext('2d');
    const dvW = dvCanvas.width, dvH = dvCanvas.height;
    const dvCx = dvW / 2, dvCy = dvH / 2;
    const dvOuterR = Math.min(dvW, dvH) / 2 - 4;
    const dvBorderW = Math.max(8, Math.round(dvOuterR * 0.06));
    const dvInnerR = dvOuterR - dvBorderW;

    dvCtx.clearRect(0, 0, dvW, dvH);

    // Transparent outside the circle (true die-cut look) — checker only shown in editors, exported PNG stays transparent
    dvCtx.save();
    dvCtx.beginPath();
    dvCtx.arc(dvCx, dvCy, dvOuterR, 0, Math.PI * 2);
    dvCtx.clip();

    // Border ring
    dvCtx.fillStyle = dvState.primaryColor;
    dvCtx.fillRect(0, 0, dvW, dvH);

    // Face
    dvCtx.beginPath();
    dvCtx.arc(dvCx, dvCy, dvInnerR, 0, Math.PI * 2);
    dvCtx.clip();
    dvCtx.fillStyle = dvState.secondaryColor || '#FFFFFF';
    dvCtx.fillRect(0, 0, dvW, dvH);

    if (dvState.author) {
      dvCtx.save();
      dvCtx.globalAlpha = 0.14;
      dvCtx.font = `700 ${Math.round(dvInnerR * 0.3)}px ${dvState.font}`;
      dvCtx.fillStyle = dvState.headlineColor || dvState.primaryColor;
      dvCtx.textAlign = 'center';
      dvCtx.textBaseline = 'middle';
      dvCtx.fillText(dvState.author, dvCx, dvCy);
      dvCtx.restore();
    }

    const dvImg = dvState.dvImageEl || null;
    const dvMargin = Math.round(dvInnerR * 0.28);
    let dvCursorY = dvCy - dvInnerR + dvMargin;
    const dvContentW = dvInnerR * 2 - dvMargin * 2;
    const dvContentX = dvCx - dvInnerR + dvMargin;

    if (dvImg) {
      const dvImgH = Math.round(dvInnerR * 0.7);
      this.dvDrawCover(dvCtx, dvImg, dvContentX, dvCursorY, dvContentW, dvImgH, 10);
      dvCursorY += dvImgH + dvMargin * 0.5;
    }

    dvCtx.textAlign = 'center';
    dvCtx.textBaseline = 'top';
    dvCtx.fillStyle = dvState.headlineColor || dvState.primaryColor;
    const dvFit = this.dvFitFontSize(dvCtx, dvState.headline, dvContentW, dvInnerR * 0.9, dvState.textSize, dvState.font, 700);
    dvFit.lines.forEach((dvLine, dvIdx) => dvCtx.fillText(dvLine, dvCx, dvCursorY + dvIdx * dvFit.size * 1.2));

    dvCtx.restore(); // release face clip, keep outer circle clip for watermark

    this.dvDrawWatermark(dvCtx, dvW, dvH, dvState);
    dvCtx.restore(); // release outer circle clip
  },

  dvDrawTickerBannerFrame(dvCanvas, dvState, dvT) {
    // Ticker engine: a persistent horizontal marquee banner is the core of the design,
    // not an optional overlay — this is what makes a "ticker" different from a static sticker.
    const dvCtx = dvCanvas.getContext('2d');
    const dvW = dvCanvas.width, dvH = dvCanvas.height;
    dvCtx.clearRect(0, 0, dvW, dvH);

    // Backdrop band (top ~60%) can carry an image or plain brand color
    const dvBandH = Math.round(dvH * 0.62);
    const dvImg = dvState.dvImageEl || null;
    if (dvImg) {
      this.dvDrawCover(dvCtx, dvImg, 0, 0, dvW, dvBandH);
      dvCtx.fillStyle = `rgba(0,0,0,${dvState.contrast / 100})`;
      dvCtx.fillRect(0, 0, dvW, dvBandH);
    } else {
      dvCtx.fillStyle = dvState.secondaryColor || '#FFFFFF';
      dvCtx.fillRect(0, 0, dvW, dvBandH);
    }

    const dvMargin = Math.round(dvW * 0.06);

    if (dvState.author) {
      dvCtx.save();
      dvCtx.globalAlpha = 0.14;
      dvCtx.font = `700 ${Math.round(dvBandH * 0.5)}px ${dvState.font}`;
      dvCtx.fillStyle = dvImg ? '#FFFFFF' : (dvState.headlineColor || dvState.primaryColor);
      dvCtx.textAlign = 'center';
      dvCtx.textBaseline = 'middle';
      dvCtx.fillText(dvState.author, dvW / 2, dvBandH / 2);
      dvCtx.restore();
    }

    dvCtx.textAlign = dvState.align === 'center' ? 'center' : (dvState.align === 'right' ? 'right' : 'left');
    const dvAlignX = dvState.align === 'center' ? dvW / 2 : (dvState.align === 'right' ? dvW - dvMargin : dvMargin);
    dvCtx.textBaseline = 'top';
    dvCtx.fillStyle = dvImg ? '#FFFFFF' : (dvState.headlineColor || dvState.primaryColor);
    const dvFit = this.dvFitFontSize(dvCtx, dvState.headline, dvW - dvMargin * 2, dvBandH * 0.6, dvState.textSize, dvState.font, 700);
    dvFit.lines.forEach((dvLine, dvIdx) => dvCtx.fillText(dvLine, dvAlignX, dvMargin * 0.6 + dvIdx * dvFit.size * 1.2));

    // The marquee strip — always present and always animated in exported GIFs
    const dvBarH = dvH - dvBandH;
    dvCtx.fillStyle = dvState.primaryColor;
    dvCtx.fillRect(0, dvBandH, dvW, dvBarH);
    dvCtx.fillStyle = '#FFFFFF';
    dvCtx.font = `600 ${Math.max(19, Math.round(dvBarH * 0.45))}px ${dvState.font}`;
    dvCtx.textBaseline = 'middle';
    dvCtx.textAlign = 'left';
    const dvMsg = (dvState.body || dvState.footer || dvState.headline || 'DV-SUITE');
    const dvTextW = dvCtx.measureText(dvMsg).width;
    const dvTravel = dvW + dvTextW;
    const dvX = dvW - dvT * dvTravel;
    dvCtx.fillText(dvMsg, dvX, dvBandH + dvBarH / 2);

    this.dvDrawWatermark(dvCtx, dvW, dvH, dvState);
  },

  dvDrawCover(dvCtx, dvImg, dvX, dvY, dvW, dvH, dvRadius) {
    dvCtx.save();
    if (dvRadius) {
      this.dvRoundRectPath(dvCtx, dvX, dvY, dvW, dvH, dvRadius);
      dvCtx.clip();
    }
    const dvImgRatio = dvImg.width / dvImg.height;
    const dvBoxRatio = dvW / dvH;
    let dvDrawW, dvDrawH, dvDx, dvDy;
    if (dvImgRatio > dvBoxRatio) {
      dvDrawH = dvH; dvDrawW = dvH * dvImgRatio;
      dvDx = dvX - (dvDrawW - dvW) / 2; dvDy = dvY;
    } else {
      dvDrawW = dvW; dvDrawH = dvW / dvImgRatio;
      dvDx = dvX; dvDy = dvY - (dvDrawH - dvH) / 2;
    }
    dvCtx.drawImage(dvImg, dvDx, dvDy, dvDrawW, dvDrawH);
    dvCtx.restore();
  },

  dvRoundRectPath(dvCtx, dvX, dvY, dvW, dvH, dvR) {
    dvCtx.beginPath();
    dvCtx.moveTo(dvX + dvR, dvY);
    dvCtx.arcTo(dvX + dvW, dvY, dvX + dvW, dvY + dvH, dvR);
    dvCtx.arcTo(dvX + dvW, dvY + dvH, dvX, dvY + dvH, dvR);
    dvCtx.arcTo(dvX, dvY + dvH, dvX, dvY, dvR);
    dvCtx.arcTo(dvX, dvY, dvX + dvW, dvY, dvR);
    dvCtx.closePath();
  },

  dvRenderTicker(dvCanvas, dvState, dvT) {
    // dvT in [0,1) — used for scroll / pulse animation preview and GIF frame generation
    const dvCtx = dvCanvas.getContext('2d');
    dvCtx.save();
    if (dvState.animate === 'scroll') {
      const dvOffset = (1 - dvT) * dvCanvas.width - dvT * 0; // simple left scroll handled at text level below
    }
    if (dvState.animate === 'pulse') {
      const dvScale = 1 + 0.03 * Math.sin(dvT * Math.PI * 2);
      dvCtx.translate(dvCanvas.width / 2, dvCanvas.height / 2);
      dvCtx.scale(dvScale, dvScale);
      dvCtx.translate(-dvCanvas.width / 2, -dvCanvas.height / 2);
    }
    this.dvDrawFrame(dvCanvas, dvState, dvT);
    // The ticker engine (dvDrawTickerBannerFrame) already renders its own animated marquee
    // using dvT, and the sticker engine has no scroll bar — only overlay a bottom strip here
    // for the generic "design" kind when the user explicitly picked the Scrolling Ticker option.
    if (dvState.animate === 'scroll' && dvState.kind !== 'ticker' && dvState.kind !== 'sticker') {
      const dvBarH = Math.round(dvCanvas.height * 0.09);
      const dvY = dvCanvas.height - dvBarH;
      dvCtx.fillStyle = dvState.primaryColor;
      dvCtx.fillRect(0, dvY, dvCanvas.width, dvBarH);
      dvCtx.fillStyle = '#FFFFFF';
      dvCtx.font = `600 ${Math.max(19, Math.round(dvBarH * 0.5))}px ${dvState.font}`;
      dvCtx.textBaseline = 'middle';
      dvCtx.textAlign = 'left';
      const dvMsg = (dvState.footer || dvState.headline || 'DV-SUITE');
      const dvTextW = dvCtx.measureText(dvMsg).width;
      const dvTravel = dvCanvas.width + dvTextW;
      const dvX = dvCanvas.width - dvT * dvTravel;
      dvCtx.fillText(dvMsg, dvX, dvY + dvBarH / 2);
    }
    dvCtx.restore();
  }
};

/* ==========================================================================
   10. Quality control
   ========================================================================== */

const DvQuality = {
  dvRelLuminance(dvHex) {
    const dvRgb = this.dvHexToRgb(dvHex);
    const dvA = [dvRgb.r, dvRgb.g, dvRgb.b].map((dvV) => {
      dvV /= 255;
      return dvV <= 0.03928 ? dvV / 12.92 : Math.pow((dvV + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * dvA[0] + 0.7152 * dvA[1] + 0.0722 * dvA[2];
  },
  dvHexToRgb(dvHex) {
    const dvClean = dvHex.replace('#', '');
    const dvNum = parseInt(dvClean.length === 3 ? dvClean.split('').map((c) => c + c).join('') : dvClean, 16);
    return { r: (dvNum >> 16) & 255, g: (dvNum >> 8) & 255, b: dvNum & 255 };
  },
  dvContrastRatio(dvHex1, dvHex2) {
    const dvL1 = this.dvRelLuminance(dvHex1) + 0.05;
    const dvL2 = this.dvRelLuminance(dvHex2) + 0.05;
    return dvL1 > dvL2 ? dvL1 / dvL2 : dvL2 / dvL1;
  },

  dvRun(dvState, dvCanvas) {
    const dvResults = [];
    const dvCtx = dvCanvas.getContext('2d');

    // Text overflow check
    dvCtx.font = `700 ${dvState.textSize}px ${dvState.font}`;
    const dvMargin = Math.round(Math.min(dvCanvas.width, dvCanvas.height) * 0.08);
    const dvLines = DvRenderer.dvWrapText(dvCtx, dvState.headline, dvCanvas.width - dvMargin * 2);
    const dvHeadlineHeight = dvLines.length * dvState.textSize * 1.25;
    dvResults.push({
      label: 'Text overflow',
      pass: dvHeadlineHeight <= dvCanvas.height * 0.34,
      detail: dvHeadlineHeight <= dvCanvas.height * 0.34 ? 'Headline fits within its area.' : 'Headline is long — consider shortening or reducing size.'
    });

    // Contrast check
    const dvRatio = this.dvContrastRatio(dvState.headlineColor || dvState.primaryColor, dvState.secondaryColor);
    dvResults.push({
      label: 'Readability / contrast',
      pass: dvRatio >= 3,
      detail: dvRatio >= 3 ? `Good contrast ratio (${dvRatio.toFixed(1)}:1).` : `Low contrast (${dvRatio.toFixed(1)}:1) — pick more distinct colours.`
    });

    // Safe margins
    dvResults.push({
      label: 'Safe margins',
      pass: dvMargin >= Math.min(dvCanvas.width, dvCanvas.height) * 0.05,
      detail: 'Content is kept clear of the canvas edges.'
    });

    // Canvas dimensions
    const dvDimsOk = dvCanvas.width >= 100 && dvCanvas.height >= 100 && dvCanvas.width <= 4000 && dvCanvas.height <= 4000;
    dvResults.push({
      label: 'Canvas dimensions',
      pass: dvDimsOk,
      detail: dvDimsOk ? `${dvCanvas.width}×${dvCanvas.height}px is within a safe export range.` : 'Dimensions are outside the recommended export range.'
    });

    // Image quality
    const dvImg = dvState.dvImageEl;
    const dvImgOk = !dvImg || (dvImg.naturalWidth >= dvCanvas.width * 0.5);
    dvResults.push({
      label: 'Image quality',
      pass: dvImgOk,
      detail: dvImg ? (dvImgOk ? 'Image resolution looks sufficient.' : 'Image resolution is low for this canvas size.') : 'No image in this design.'
    });

    return dvResults;
  },

  dvRenderList(dvState, dvCanvas) {
    const dvResults = this.dvRun(dvState, dvCanvas);
    const dvList = dvQs('#dvQualityList');
    dvList.innerHTML = dvResults.map((dvR) => `
      <li class="dv-qc-item ${dvR.pass ? 'dv-qc-item--pass' : 'dv-qc-item--warn'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${dvR.pass ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M12 9v4M12 17h.01M12 2L2 20h20L12 2z"/>'}
        </svg>
        <span><strong>${dvEscapeHtml(dvR.label)}:</strong> ${dvEscapeHtml(dvR.detail)}</span>
      </li>`).join('');
    return dvResults;
  }
};

/* ==========================================================================
   11. Editor controller
   ========================================================================== */

const DvEmoji = {
  dvSet: ['✝️','🙏','😍','🔥','🎉','👍','👏','💯','❤️','⭐',
          '✅','⚡','🎁','📢','🚀','🙌','😎','🤩','😢','😡',
          '🥳','🤔','👀','💪','🌟','☀️','🛐','🎵','📸','📝'],
  dvLastTarget: null,

  dvInit() {
    dvQsa('.dv-emoji-target').forEach((dvEl) => {
      dvEl.addEventListener('focus', () => { this.dvLastTarget = dvEl; });
    });
    this.dvLastTarget = dvQs('#dvHeadlineInput');

    const dvGrid = dvQs('#dvEmojiGrid');
    dvGrid.innerHTML = this.dvSet.map((dvE) => `<button class="dv-emoji-btn" type="button">${dvE}</button>`).join('');
    dvQsa('.dv-emoji-btn', dvGrid).forEach((dvBtn, dvIdx) => {
      dvBtn.addEventListener('click', () => this.dvInsert(this.dvSet[dvIdx]));
    });
  },

  dvInsert(dvEmojiChar) {
    const dvTarget = this.dvLastTarget || dvQs('#dvHeadlineInput');
    const dvStart = dvTarget.selectionStart != null ? dvTarget.selectionStart : dvTarget.value.length;
    const dvEnd = dvTarget.selectionEnd != null ? dvTarget.selectionEnd : dvTarget.value.length;
    const dvVal = dvTarget.value;
    dvTarget.value = dvVal.slice(0, dvStart) + dvEmojiChar + dvVal.slice(dvEnd);
    const dvNewPos = dvStart + dvEmojiChar.length;
    if (dvTarget.setSelectionRange) dvTarget.setSelectionRange(dvNewPos, dvNewPos);
    dvTarget.dispatchEvent(new Event('input', { bubbles: true }));
    dvTarget.focus();
  }
};

const DvEditor = {
  dvCanvas: null,

  dvInit() {
    this.dvCanvas = dvQs('#dvCanvas');
    DvDesign.dvNew();

    this.dvBuildTemplateGrid();
    this.dvWireTabs();
    this.dvWireFields();

    dvQs('#dvHeroCreateBtn').addEventListener('click', () => this.dvStartNew());
    dvQsa('[data-dv-quick]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        const dvKind = dvBtn.getAttribute('data-dv-quick');
        if (dvKind === 'files') { DvRouter.dvGoTo('files', true); return; }
        this.dvStartNew(dvKind);
      });
    });

    dvQs('#dvSaveBtn').addEventListener('click', () => DvFiles.dvOpenSaveConfirm());
    dvQs('#dvExportBtn').addEventListener('click', () => DvExport.dvOpenMenu());

    this.dvSyncFieldsFromState();
    this.dvRender();
  },

  dvStartNew(dvKind) {
    DvDesign.dvNew();
    const dvS = DvDesign.dvState;
    if (dvKind === 'sticker') {
      dvS.kind = 'sticker'; dvS.template = 'centered-headline'; dvS.aspect = '1:1'; dvS.animate = 'none';
      dvS.headline = 'Your Sticker'; dvS.body = '';
    } else if (dvKind === 'ticker') {
      dvS.kind = 'ticker'; dvS.template = 'text-focused'; dvS.aspect = '16:9'; dvS.animate = 'scroll';
      dvS.headline = 'Breaking News'; dvS.body = 'Scrolling ticker message goes here';
    } else if (dvKind === 'gif') {
      dvS.kind = 'gif'; dvS.animate = 'pulse'; dvS.aspect = '1:1';
    }
    DvDesign.dvSyncDimensionsFromAspect();
    this.dvSyncFieldsFromState();
    DvRouter.dvGoTo('editor', true);
    this.dvRender();
  },

  dvBuildTemplateGrid() {
    const dvGrid = dvQs('#dvTemplateGrid');
    dvGrid.innerHTML = DvTemplates.map((dvT) => `
      <button class="dv-template-card${dvT.id === DvDesign.dvState.template ? ' dv-template-card--active' : ''}" data-dv-template="${dvT.id}">${dvEscapeHtml(dvT.name)}</button>
    `).join('');
    dvQsa('[data-dv-template]', dvGrid).forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        DvDesign.dvState.template = dvBtn.getAttribute('data-dv-template');
        dvQsa('[data-dv-template]', dvGrid).forEach((b) => b.classList.toggle('dv-template-card--active', b === dvBtn));
        this.dvRender();
      });
    });
  },

  dvWireTabs() {
    dvQsa('.dv-editor__tab').forEach((dvTab) => {
      dvTab.addEventListener('click', () => {
        const dvKey = dvTab.getAttribute('data-dv-tab');
        dvQsa('.dv-editor__tab').forEach((t) => t.classList.toggle('dv-editor__tab--active', t === dvTab));
        dvQsa('.dv-editor__panel').forEach((dvP) => dvP.classList.toggle('dv-editor__panel--active', dvP.getAttribute('data-dv-panel') === dvKey));
        if (dvKey === 'quality') DvQuality.dvRenderList(DvDesign.dvState, this.dvCanvas);
      });
    });
  },

  dvWireFields() {
    const dvS = () => DvDesign.dvState;

    dvQs('#dvHeadlineInput').addEventListener('input', (e) => { dvS().headline = e.target.value; this.dvRender(); });
    dvQs('#dvBodyInput').addEventListener('input', (e) => { dvS().body = e.target.value; this.dvRender(); });
    dvQs('#dvFooterInput').addEventListener('input', (e) => { dvS().footer = e.target.value; this.dvRender(); });
    dvQs('#dvAuthorInput').addEventListener('input', (e) => { dvS().author = e.target.value; this.dvRender(); });

    dvQs('#dvImageInput').addEventListener('change', (e) => {
      const dvFile = e.target.files && e.target.files[0];
      if (!dvFile) return;
      const dvReader = new FileReader();
      dvReader.onload = () => {
        dvS().imageDataUrl = dvReader.result;
        const dvImg = new Image();
        dvImg.onload = () => { dvS().dvImageEl = dvImg; this.dvRender(); };
        dvImg.src = dvReader.result;
      };
      dvReader.readAsDataURL(dvFile);
    });

    dvQs('#dvPrimaryColorInput').addEventListener('input', (e) => this.dvHandleColorInput(e.target, 'dvPrimarySwatch', 'primaryColor'));
    dvQs('#dvSecondaryColorInput').addEventListener('input', (e) => this.dvHandleColorInput(e.target, 'dvSecondarySwatch', 'secondaryColor'));
    dvQs('#dvHeadlineColorInput').addEventListener('input', (e) => this.dvHandleColorInput(e.target, 'dvHeadlineSwatch', 'headlineColor'));
    dvQs('#dvBodyColorInput').addEventListener('input', (e) => this.dvHandleColorInput(e.target, 'dvBodySwatch', 'bodyColor'));
    dvQs('#dvFontSelect').addEventListener('change', (e) => { dvS().font = e.target.value; this.dvRender(); });
    dvQs('#dvTextSizeSlider').addEventListener('input', (e) => { dvS().textSize = Number(e.target.value); this.dvRender(); });
    dvQs('#dvContrastSlider').addEventListener('input', (e) => { dvS().contrast = Number(e.target.value); this.dvRender(); });

    dvQsa('[data-dv-align]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        dvS().align = dvBtn.getAttribute('data-dv-align');
        dvQsa('[data-dv-align]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b === dvBtn));
        this.dvRender();
      });
    });
    dvQsa('[data-dv-imgpos]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        dvS().imagePos = dvBtn.getAttribute('data-dv-imgpos');
        dvQsa('[data-dv-imgpos]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b === dvBtn));
        this.dvRender();
      });
    });
    dvQsa('[data-dv-animate]').forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        dvS().animate = dvBtn.getAttribute('data-dv-animate');
        dvQsa('[data-dv-animate]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b === dvBtn));
        this.dvRender();
      });
    });

    dvQs('#dvAspectSelect').addEventListener('change', (e) => {
      dvS().aspect = e.target.value;
      DvDesign.dvSyncDimensionsFromAspect();
      this.dvApplyCanvasSize();
      this.dvSyncFieldsFromState();
      this.dvRender();
    });
    dvQs('#dvWidthInput').addEventListener('input', (e) => {
      dvS().aspect = 'custom'; dvS().width = dvClamp(Number(e.target.value) || 600, 100, 2000);
      this.dvApplyCanvasSize(); this.dvRender();
    });
    dvQs('#dvHeightInput').addEventListener('input', (e) => {
      dvS().aspect = 'custom'; dvS().height = dvClamp(Number(e.target.value) || 600, 100, 2000);
      this.dvApplyCanvasSize(); this.dvRender();
    });

    dvQs('#dvDurationInput').addEventListener('input', (e) => {
      dvS().durationSec = dvClamp(Number(e.target.value) || 5, 1, 300);
    });
  },

  dvHandleColorInput(dvInputEl, dvSwatchId, dvStateKey) {
    const dvRaw = dvInputEl.value.trim();
    const dvHex = DvColor.dvToHex(dvRaw);
    const dvSwatch = dvQs('#' + dvSwatchId);
    if (dvHex) {
      dvInputEl.classList.remove('dv-field__input--invalid');
      dvSwatch.style.background = dvHex;
      DvDesign.dvState[dvStateKey] = dvHex;
      this.dvRender();
    } else {
      dvInputEl.classList.add('dv-field__input--invalid');
      dvSwatch.style.background = 'transparent';
    }
  },

  dvApplyCanvasSize() {
    this.dvCanvas.width = DvDesign.dvState.width;
    this.dvCanvas.height = DvDesign.dvState.height;
  },

  dvSyncFieldsFromState() {
    const dvS = DvDesign.dvState;
    dvQs('#dvHeadlineInput').value = dvS.headline;
    dvQs('#dvBodyInput').value = dvS.body;
    dvQs('#dvFooterInput').value = dvS.footer;
    dvQs('#dvAuthorInput').value = dvS.author || '';
    dvQs('#dvPrimaryColorInput').value = dvS.primaryColor;
    dvQs('#dvSecondaryColorInput').value = dvS.secondaryColor;
    dvQs('#dvHeadlineColorInput').value = dvS.headlineColor || dvS.primaryColor;
    dvQs('#dvBodyColorInput').value = dvS.bodyColor || '#333333';
    dvQs('#dvPrimarySwatch').style.background = dvS.primaryColor;
    dvQs('#dvSecondarySwatch').style.background = dvS.secondaryColor;
    dvQs('#dvHeadlineSwatch').style.background = dvS.headlineColor || dvS.primaryColor;
    dvQs('#dvBodySwatch').style.background = dvS.bodyColor || '#333333';
    dvQs('#dvFontSelect').value = dvS.font;
    dvQs('#dvTextSizeSlider').value = dvS.textSize;
    dvQs('#dvContrastSlider').value = dvS.contrast;
    dvQs('#dvAspectSelect').value = dvS.aspect;
    dvQs('#dvWidthInput').value = dvS.width;
    dvQs('#dvHeightInput').value = dvS.height;
    dvQs('#dvDurationInput').value = dvS.durationSec;
    dvQsa('[data-dv-align]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b.getAttribute('data-dv-align') === dvS.align));
    dvQsa('[data-dv-imgpos]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b.getAttribute('data-dv-imgpos') === dvS.imagePos));
    dvQsa('[data-dv-animate]').forEach((b) => b.classList.toggle('dv-segmented__opt--active', b.getAttribute('data-dv-animate') === dvS.animate));
    dvQsa('[data-dv-template]').forEach((b) => b.classList.toggle('dv-template-card--active', b.getAttribute('data-dv-template') === dvS.template));
    this.dvApplyCanvasSize();
  },

  dvRender() {
    DvRenderer.dvDrawFrame(this.dvCanvas, DvDesign.dvState, 0);
    if (dvQs('[data-dv-panel="quality"]').classList.contains('dv-editor__panel--active')) {
      DvQuality.dvRenderList(DvDesign.dvState, this.dvCanvas);
    }
  },

  dvLoadDesign(dvFile) {
    DvDesign.dvState = Object.assign({}, dvFile.state);
    if (dvFile.state.imageDataUrl) {
      const dvImg = new Image();
      dvImg.onload = () => { DvDesign.dvState.dvImageEl = dvImg; this.dvRender(); };
      dvImg.src = dvFile.state.imageDataUrl;
    }
    DvDesign.dvState.id = dvFile.id;
    this.dvSyncFieldsFromState();
    DvRouter.dvGoTo('editor', true);
    this.dvRender();
  }
};

/* ==========================================================================
   12. File manager (save / list / rename / duplicate / delete)
   ========================================================================== */

const DvFiles = {
  dvPendingDeleteId: null,

  dvInit() {
    dvQs('#dvSaveCancelBtn').addEventListener('click', () => this.dvCloseSaveConfirm());
    dvQs('#dvSaveConfirmBtn').addEventListener('click', () => this.dvConfirmSave());
    dvQs('#dvDeleteCancelBtn').addEventListener('click', () => this.dvCloseDeleteConfirm());
    dvQs('#dvDeleteConfirmBtn').addEventListener('click', () => this.dvConfirmDelete());
  },

  dvOpenSaveConfirm() {
    dvQs('#dvSaveTitleInput').value = DvDesign.dvState.title || (DvDesign.dvState.headline || 'Untitled').slice(0, 30);
    dvQs('#dvSaveConfirm').classList.add('dv-confirm--open');
  },
  dvCloseSaveConfirm() { dvQs('#dvSaveConfirm').classList.remove('dv-confirm--open'); },

  async dvConfirmSave() {
    const dvTitle = dvQs('#dvSaveTitleInput').value.trim() || 'Untitled';
    const dvState = Object.assign({}, DvDesign.dvState);
    delete dvState.dvImageEl;
    const dvId = DvDesign.dvState.id || dvUid();
    const dvFile = { id: dvId, title: dvTitle, state: dvState, thumb: DvEditor.dvCanvas.toDataURL('image/png'), updatedAt: Date.now() };
    await DvDB.dvPutFile(dvFile);
    DvDesign.dvState.id = dvId;
    DvDesign.dvState.title = dvTitle;
    this.dvCloseSaveConfirm();
    DvToast.dvShow('Design saved', 'success');
    this.dvRenderList();
    this.dvRenderRecent();
  },

  dvOpenDeleteConfirm(dvId) {
    this.dvPendingDeleteId = dvId;
    dvQs('#dvDeleteConfirm').classList.add('dv-confirm--open');
  },
  dvCloseDeleteConfirm() { dvQs('#dvDeleteConfirm').classList.remove('dv-confirm--open'); this.dvPendingDeleteId = null; },

  async dvConfirmDelete() {
    if (this.dvPendingDeleteId) {
      await DvDB.dvDeleteFile(this.dvPendingDeleteId);
      DvToast.dvShow('File deleted');
      this.dvRenderList();
      this.dvRenderRecent();
    }
    this.dvCloseDeleteConfirm();
  },

  async dvDuplicate(dvId) {
    const dvFiles = await DvDB.dvGetAllFiles();
    const dvOrig = dvFiles.find((f) => f.id === dvId);
    if (!dvOrig) return;
    const dvCopy = JSON.parse(JSON.stringify(dvOrig));
    dvCopy.id = dvUid();
    dvCopy.title = dvOrig.title + ' (copy)';
    dvCopy.updatedAt = Date.now();
    await DvDB.dvPutFile(dvCopy);
    DvToast.dvShow('Design duplicated', 'success');
    this.dvRenderList();
  },

  async dvRename(dvId) {
    const dvFiles = await DvDB.dvGetAllFiles();
    const dvFile = dvFiles.find((f) => f.id === dvId);
    if (!dvFile) return;
    DvDesign.dvState.id = dvId;
    dvQs('#dvSaveTitleInput').value = dvFile.title;
    dvQs('#dvSaveConfirm').classList.add('dv-confirm--open');
    const dvOldHandler = dvQs('#dvSaveConfirmBtn').onclick;
    dvQs('#dvSaveConfirmBtn').onclick = async () => {
      dvFile.title = dvQs('#dvSaveTitleInput').value.trim() || dvFile.title;
      dvFile.updatedAt = Date.now();
      await DvDB.dvPutFile(dvFile);
      this.dvCloseSaveConfirm();
      DvToast.dvShow('Renamed', 'success');
      this.dvRenderList();
      dvQs('#dvSaveConfirmBtn').onclick = null;
      dvQs('#dvSaveConfirmBtn').addEventListener('click', () => this.dvConfirmSave());
    };
  },

  async dvRenderList() {
    const dvFiles = await DvDB.dvGetAllFiles();
    const dvList = dvQs('#dvFileList');
    dvQs('#dvFilesEmpty').classList.toggle('dv-hidden', dvFiles.length > 0);
    dvList.innerHTML = dvFiles.map((dvF) => `
      <li class="dv-file-row" data-dv-file-id="${dvF.id}">
        <div class="dv-file-row__thumb"><img src="${dvF.thumb}" alt=""></div>
        <div class="dv-file-row__meta">
          <div class="dv-file-row__name">${dvEscapeHtml(dvF.title)}</div>
          <div class="dv-file-row__sub">${new Date(dvF.updatedAt).toLocaleDateString()}</div>
        </div>
        <button class="dv-icon-btn" data-dv-file-menu="${dvF.id}" aria-label="Options">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>
      </li>
    `).join('');

    dvQsa('[data-dv-file-menu]', dvList).forEach((dvBtn) => {
      dvBtn.addEventListener('click', (dvEvent) => {
        dvEvent.stopPropagation();
        this.dvOpenFileMenu(dvBtn.getAttribute('data-dv-file-menu'), dvBtn);
      });
    });
    dvQsa('.dv-file-row', dvList).forEach((dvRow) => {
      dvRow.addEventListener('click', async () => {
        const dvFiles2 = await DvDB.dvGetAllFiles();
        const dvFile = dvFiles2.find((f) => f.id === dvRow.getAttribute('data-dv-file-id'));
        if (dvFile) DvEditor.dvLoadDesign(dvFile);
      });
    });
  },

  async dvRenderRecent() {
    const dvFiles = (await DvDB.dvGetAllFiles()).slice(0, 8);
    const dvScroll = dvQs('#dvRecentScroll');
    dvQs('#dvRecentEmpty').classList.toggle('dv-hidden', dvFiles.length > 0);
    dvQsa('.dv-recent-card', dvScroll).forEach((el) => el.remove());
    dvFiles.forEach((dvF) => {
      const dvCard = document.createElement('div');
      dvCard.className = 'dv-recent-card';
      dvCard.innerHTML = `<div class="dv-recent-card__thumb"><img src="${dvF.thumb}" alt="" style="width:100%;height:100%;object-fit:cover;"></div><div class="dv-recent-card__name">${dvEscapeHtml(dvF.title)}</div>`;
      dvCard.addEventListener('click', () => DvEditor.dvLoadDesign(dvF));
      dvScroll.appendChild(dvCard);
    });
  },

  dvOpenFileMenu(dvId, dvAnchorEl) {
    DvMenu.dvOpen(dvAnchorEl, [
      { label: 'Open', icon: 'open', onClick: async () => { const files = await DvDB.dvGetAllFiles(); const f = files.find((x) => x.id === dvId); if (f) DvEditor.dvLoadDesign(f); } },
      { label: 'Rename', icon: 'rename', onClick: () => this.dvRename(dvId) },
      { label: 'Duplicate', icon: 'duplicate', onClick: () => this.dvDuplicate(dvId) },
      { label: 'Share to WhatsApp', icon: 'whatsapp', onClick: async () => { const files = await DvDB.dvGetAllFiles(); const f = files.find((x) => x.id === dvId); if (f) DvShare.dvShareDataUrl(f.thumb, f.title + '.png', 'whatsapp'); } },
      { label: 'Share to Facebook', icon: 'facebook', onClick: async () => { const files = await DvDB.dvGetAllFiles(); const f = files.find((x) => x.id === dvId); if (f) DvShare.dvShareDataUrl(f.thumb, f.title + '.png', 'facebook'); } },
      { label: 'Android Share Sheet', icon: 'share', onClick: async () => { const files = await DvDB.dvGetAllFiles(); const f = files.find((x) => x.id === dvId); if (f) DvShare.dvShareDataUrl(f.thumb, f.title + '.png', 'native'); } },
      { label: 'Delete', icon: 'delete', danger: true, onClick: () => this.dvOpenDeleteConfirm(dvId) },
      { label: 'Exit', icon: 'exit', onClick: () => {} }
    ]);
  }
};

/* ==========================================================================
   13. Generic three-dot context menu
   ========================================================================== */

const DvMenu = {
  dvIcons: {
    open: '<path d="M4 6h6l2 2h8v10H4z"/>',
    rename: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    delete: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.5-4.4M8.2 13.2l7.5 4.4"/>',
    whatsapp: '<path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.5A10 10 0 1012 2z"/>',
    facebook: '<path d="M14 9h3V6h-3a4 4 0 00-4 4v2H7v3h3v6h3v-6h3l1-3h-4v-2a1 1 0 011-1z"/>',
    exit: '<path d="M6 6l12 12M18 6L6 18"/>'
  },

  dvOpen(dvAnchorEl, dvItems) {
    const dvMenuEl = dvQs('#dvContextMenu');
    dvMenuEl.innerHTML = dvItems.map((dvItem, dvIdx) => `
      <button class="dv-menu__item${dvItem.danger ? ' dv-menu__item--danger' : ''}" data-dv-menu-idx="${dvIdx}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${this.dvIcons[dvItem.icon] || ''}</svg>
        ${dvEscapeHtml(dvItem.label)}
      </button>
    `).join('');

    const dvRect = dvAnchorEl.getBoundingClientRect();
    const dvMenuWidth = 240;
    let dvLeft = dvRect.right - dvMenuWidth;
    dvLeft = dvClamp(dvLeft, 8, window.innerWidth - dvMenuWidth - 8);
    let dvTop = dvRect.bottom + 4;
    dvMenuEl.style.left = dvLeft + 'px';
    dvMenuEl.style.top = dvTop + 'px';
    dvMenuEl.classList.add('dv-menu--open');

    // Clamp after layout if it overflows bottom
    requestAnimationFrame(() => {
      const dvMenuRect = dvMenuEl.getBoundingClientRect();
      if (dvMenuRect.bottom > window.innerHeight - 8) {
        dvMenuEl.style.top = Math.max(8, window.innerHeight - dvMenuRect.height - 8) + 'px';
      }
    });

    dvQsa('[data-dv-menu-idx]', dvMenuEl).forEach((dvBtn) => {
      dvBtn.addEventListener('click', () => {
        const dvItem = dvItems[Number(dvBtn.getAttribute('data-dv-menu-idx'))];
        this.dvClose();
        if (dvItem.onClick) dvItem.onClick();
      });
    });

    setTimeout(() => document.addEventListener('click', this.dvOutsideHandler = (dvEvent) => {
      if (!dvMenuEl.contains(dvEvent.target)) this.dvClose();
    }), 0);
  },

  dvClose() {
    dvQs('#dvContextMenu').classList.remove('dv-menu--open');
    if (this.dvOutsideHandler) document.removeEventListener('click', this.dvOutsideHandler);
  }
};

/* ==========================================================================
   14. Internal GIF encoder (GIF89a, LZW) — no external library
   ========================================================================== */

const DvGifEncoder = {
  dvQuantize(dvImageData, dvMaxColors) {
    // Simple uniform quantization to a fixed cube palette (fast, dependency-free).
    const dvLevels = 6; // 6x6x6 = 216 colors + grayscale ramp fills remainder
    const dvPalette = [];
    for (let r = 0; r < dvLevels; r++)
      for (let g = 0; g < dvLevels; g++)
        for (let b = 0; b < dvLevels; b++)
          dvPalette.push([Math.round(r * 255 / (dvLevels - 1)), Math.round(g * 255 / (dvLevels - 1)), Math.round(b * 255 / (dvLevels - 1))]);
    while (dvPalette.length < dvMaxColors) dvPalette.push([0, 0, 0]);

    const dvIndices = new Uint8Array(dvImageData.width * dvImageData.height);
    const dvData = dvImageData.data;
    for (let dvI = 0, dvPix = 0; dvI < dvData.length; dvI += 4, dvPix++) {
      const dvR = dvData[dvI], dvG = dvData[dvI + 1], dvB = dvData[dvI + 2];
      const dvRi = Math.round(dvR / 255 * (dvLevels - 1));
      const dvGi = Math.round(dvG / 255 * (dvLevels - 1));
      const dvBi = Math.round(dvB / 255 * (dvLevels - 1));
      dvIndices[dvPix] = dvRi * dvLevels * dvLevels + dvGi * dvLevels + dvBi;
    }
    return { palette: dvPalette.slice(0, 256), indices: dvIndices };
  },

  dvLzwEncode(dvIndices, dvMinCodeSize) {
    const dvClearCode = 1 << dvMinCodeSize;
    const dvEoiCode = dvClearCode + 1;
    let dvCodeSize = dvMinCodeSize + 1;
    let dvNextCode = dvEoiCode + 1;
    let dvDict = new Map();

    const dvResetDict = () => {
      dvDict = new Map();
      for (let dvI = 0; dvI < dvClearCode; dvI++) dvDict.set(String(dvI), dvI);
      dvNextCode = dvEoiCode + 1;
      dvCodeSize = dvMinCodeSize + 1;
    };
    dvResetDict();

    const dvBits = [];
    const dvPushCode = (dvCode) => {
      for (let dvB = 0; dvB < dvCodeSize; dvB++) dvBits.push((dvCode >> dvB) & 1);
    };

    dvPushCode(dvClearCode);
    let dvW = String(dvIndices[0]);
    for (let dvI = 1; dvI < dvIndices.length; dvI++) {
      const dvK = String(dvIndices[dvI]);
      const dvWK = dvW + ',' + dvK;
      if (dvDict.has(dvWK)) {
        dvW = dvWK;
      } else {
        dvPushCode(dvDict.get(dvW));
        dvDict.set(dvWK, dvNextCode++);
        if (dvNextCode > (1 << dvCodeSize) && dvCodeSize < 12) dvCodeSize++;
        if (dvNextCode >= 4096) { dvPushCode(dvClearCode); dvResetDict(); }
        dvW = dvK;
      }
    }
    dvPushCode(dvDict.get(dvW));
    dvPushCode(dvEoiCode);

    // Pack bits into bytes
    const dvBytes = [];
    for (let dvI = 0; dvI < dvBits.length; dvI += 8) {
      let dvByte = 0;
      for (let dvB = 0; dvB < 8; dvB++) if (dvBits[dvI + dvB]) dvByte |= (1 << dvB);
      dvBytes.push(dvByte);
    }
    return dvBytes;
  },

  dvBuildGif(dvFrames, dvWidth, dvHeight, dvDelayCs, dvLoop) {
    // dvFrames: array of ImageData
    const dvOut = [];
    const dvPushByte = (dvB) => dvOut.push(dvB & 0xFF);
    const dvPushBytes = (dvArr) => dvArr.forEach(dvPushByte);
    const dvPushStr = (dvS) => { for (let dvI = 0; dvI < dvS.length; dvI++) dvPushByte(dvS.charCodeAt(dvI)); };
    const dvPushShort = (dvV) => { dvPushByte(dvV & 0xFF); dvPushByte((dvV >> 8) & 0xFF); };

    dvPushStr('GIF89a');
    dvPushShort(dvWidth);
    dvPushShort(dvHeight);
    dvPushByte(0xF7); // global color table, 256 colors, color resolution 8 bit
    dvPushByte(0);    // background color index
    dvPushByte(0);    // pixel aspect ratio

    // Build a shared palette from the first frame's quantizer (uniform cube, same for all frames)
    const dvFirstQ = this.dvQuantize(dvFrames[0], 256);
    dvFirstQ.palette.forEach((dvC) => dvPushBytes(dvC));

    // NETSCAPE2.0 looping extension
    if (dvLoop) {
      dvPushByte(0x21); dvPushByte(0xFF); dvPushByte(0x0B);
      dvPushStr('NETSCAPE2.0');
      dvPushByte(0x03); dvPushByte(0x01); dvPushShort(0); dvPushByte(0x00);
    }

    dvFrames.forEach((dvFrame) => {
      const dvQ = this.dvQuantize(dvFrame, 256);

      // Graphic Control Extension
      dvPushByte(0x21); dvPushByte(0xF9); dvPushByte(0x04);
      dvPushByte(0x00); // no transparency, no disposal specified
      dvPushShort(dvDelayCs);
      dvPushByte(0x00); // transparent color index (unused)
      dvPushByte(0x00);

      // Image Descriptor
      dvPushByte(0x2C);
      dvPushShort(0); dvPushShort(0);
      dvPushShort(dvWidth); dvPushShort(dvHeight);
      dvPushByte(0x00); // no local color table

      const dvMinCodeSize = 8;
      dvPushByte(dvMinCodeSize);
      const dvLzwBytes = this.dvLzwEncode(dvQ.indices, dvMinCodeSize);
      for (let dvI = 0; dvI < dvLzwBytes.length; dvI += 255) {
        const dvChunk = dvLzwBytes.slice(dvI, dvI + 255);
        dvPushByte(dvChunk.length);
        dvPushBytes(dvChunk);
      }
      dvPushByte(0x00); // block terminator
    });

    dvPushByte(0x3B); // trailer
    return new Uint8Array(dvOut);
  }
};

/* ==========================================================================
   15. Export pipeline (PNG / JPEG / GIF) + share menu
   ========================================================================== */

const DvExport = {
  dvOpenMenu() {
    const dvAnchor = dvQs('#dvExportBtn');
    const dvKind = DvDesign.dvState.kind;
    const dvItems = [];

    if (dvKind === 'sticker') {
      dvItems.push({ label: 'Export as Sticker (WEBP, transparent)', icon: 'open', onClick: () => this.dvExportSticker() });
      dvItems.push({ label: 'Export as PNG', icon: 'open', onClick: () => this.dvExportStatic('png') });
    } else if (dvKind === 'ticker' || dvKind === 'gif') {
      dvItems.push({ label: 'Export as GIF', icon: 'open', onClick: () => this.dvExportGif() });
      dvItems.push({ label: 'Export as Video (MP4/WebM)', icon: 'open', onClick: () => this.dvExportVideo() });
      dvItems.push({ label: 'Export as PNG (single frame)', icon: 'open', onClick: () => this.dvExportStatic('png') });
    } else {
      dvItems.push({ label: 'Export as PNG', icon: 'open', onClick: () => this.dvExportStatic('png') });
      dvItems.push({ label: 'Export as JPEG', icon: 'open', onClick: () => this.dvExportStatic('jpeg') });
      dvItems.push({ label: 'Export as GIF', icon: 'open', onClick: () => this.dvExportGif() });
    }

    dvItems.push(
      { label: 'Share to WhatsApp', icon: 'whatsapp', onClick: () => this.dvExportAndShare('whatsapp') },
      { label: 'Share to Facebook', icon: 'facebook', onClick: () => this.dvExportAndShare('facebook') },
      { label: 'Share via Email', icon: 'share', onClick: () => this.dvExportAndShare('email') },
      { label: 'Android Share Sheet', icon: 'share', onClick: () => this.dvExportAndShare('native') },
      { label: 'Exit', icon: 'exit', onClick: () => {} }
    );

    DvMenu.dvOpen(dvAnchor, dvItems);
  },

  dvExportStatic(dvFormat) {
    const dvCanvas = DvEditor.dvCanvas;
    const dvMime = dvFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    dvCanvas.toBlob((dvBlob) => {
      const dvUrl = URL.createObjectURL(dvBlob);
      const dvA = document.createElement('a');
      dvA.href = dvUrl;
      dvA.download = `dv-suite-design.${dvFormat === 'jpeg' ? 'jpg' : 'png'}`;
      dvA.click();
      setTimeout(() => URL.revokeObjectURL(dvUrl), 4000);
      DvToast.dvShow('Exported ' + dvFormat.toUpperCase(), 'success');
    }, dvMime, 0.92);
  },

  dvExportSticker() {
    // WhatsApp-style sticker export: transparent WEBP, natively supported by canvas.toBlob — no library needed.
    const dvCanvas = DvEditor.dvCanvas;
    const dvSupportsWebp = dvCanvas.toDataURL('image/webp').indexOf('image/webp') === 5;
    const dvMime = dvSupportsWebp ? 'image/webp' : 'image/png';
    const dvExt = dvSupportsWebp ? 'webp' : 'png';
    dvCanvas.toBlob((dvBlob) => {
      const dvUrl = URL.createObjectURL(dvBlob);
      const dvA = document.createElement('a');
      dvA.href = dvUrl;
      dvA.download = `dv-suite-sticker.${dvExt}`;
      dvA.click();
      setTimeout(() => URL.revokeObjectURL(dvUrl), 4000);
      DvToast.dvShow(dvSupportsWebp ? 'Sticker exported (WEBP)' : 'WEBP unsupported — exported PNG instead', 'success');
    }, dvMime, 0.95);
  },

  dvExportGif() {
    const dvState = DvDesign.dvState;
    const dvDurationSec = dvClamp(dvState.durationSec || 5, 1, 300);
    const dvFps = 10;
    const dvFrameCount = dvClamp(Math.round(dvDurationSec * dvFps), 2, 400);
    const dvCanvas = DvEditor.dvCanvas;
    const dvOffscreen = document.createElement('canvas');
    dvOffscreen.width = dvCanvas.width;
    dvOffscreen.height = dvCanvas.height;
    const dvCtx = dvOffscreen.getContext('2d');

    dvQs('#dvExportProgressTitle').textContent = 'Building GIF…';
    dvQs('#dvExportProgressFill').style.width = '0%';
    dvQs('#dvExportConfirm').classList.add('dv-confirm--open');

    const dvFrames = [];
    let dvI = 0;

    const dvStep = () => {
      const dvT = dvI / dvFrameCount;
      DvRenderer.dvRenderTicker(dvOffscreen, dvState, dvT);
      dvFrames.push(dvCtx.getImageData(0, 0, dvOffscreen.width, dvOffscreen.height));
      dvI++;
      dvQs('#dvExportProgressFill').style.width = Math.round((dvI / dvFrameCount) * 70) + '%';

      if (dvI < dvFrameCount) {
        setTimeout(dvStep, 0);
      } else {
        dvQs('#dvExportProgressTitle').textContent = 'Encoding GIF…';
        setTimeout(() => {
          const dvDelayCs = Math.round(100 / dvFps);
          const dvBytes = DvGifEncoder.dvBuildGif(dvFrames, dvOffscreen.width, dvOffscreen.height, dvDelayCs, true);
          dvQs('#dvExportProgressFill').style.width = '100%';
          const dvBlob = new Blob([dvBytes], { type: 'image/gif' });
          const dvUrl = URL.createObjectURL(dvBlob);
          const dvA = document.createElement('a');
          dvA.href = dvUrl; dvA.download = 'dv-suite-design.gif'; dvA.click();
          setTimeout(() => URL.revokeObjectURL(dvUrl), 4000);
          dvQs('#dvExportConfirm').classList.remove('dv-confirm--open');
          DvToast.dvShow('GIF exported', 'success');
        }, 30);
      }
    };
    dvStep();

    dvQs('#dvExportCancelBtn').onclick = () => {
      dvQs('#dvExportConfirm').classList.remove('dv-confirm--open');
    };
  },

  dvExportAndShare(dvChannel) {
    const dvCanvas = DvEditor.dvCanvas;
    const dvDataUrl = dvCanvas.toDataURL('image/png');
    DvShare.dvShareDataUrl(dvDataUrl, 'dv-suite-design.png', dvChannel);
  },

  /* ------------------------------------------------------------------
     Video export: canvas.captureStream() + MediaRecorder are native
     browser APIs, not external libraries. We try real MP4 first; if
     the device can't record MP4 natively we fall back to WebM (also
     a real, playable video format) with no dependency at all. Only if
     native MP4 isn't available do we lazy-load a minimal, well-known
     CDN-hosted transcoder to produce a true MP4 as well — never on
     the default path, and never blocking the WebM the user already got.
     ------------------------------------------------------------------ */

  dvPickVideoMime() {
    const dvCandidates = [
      { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' }
    ];
    for (const dvC of dvCandidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(dvC.mime)) return dvC;
    }
    return null;
  },

  dvExportVideo() {
    if (!window.MediaRecorder || !DvEditor.dvCanvas.captureStream) {
      DvToast.dvShow('Video recording is not supported on this browser', 'error');
      return;
    }
    const dvPick = this.dvPickVideoMime();
    if (!dvPick) {
      DvToast.dvShow('No supported video format found on this device', 'error');
      return;
    }

    const dvState = DvDesign.dvState;
    const dvDurationSec = dvClamp(dvState.durationSec || 5, 1, 300);
    const dvCanvas = DvEditor.dvCanvas;
    const dvFps = 24;
    const dvStream = dvCanvas.captureStream(dvFps);
    const dvRecorder = new MediaRecorder(dvStream, { mimeType: dvPick.mime });
    const dvChunks = [];

    dvQs('#dvExportProgressTitle').textContent = `Recording video (0/${dvDurationSec}s)…`;
    dvQs('#dvExportProgressFill').style.width = '0%';
    dvQs('#dvExportConfirm').classList.add('dv-confirm--open');

    dvRecorder.ondataavailable = (dvEvt) => { if (dvEvt.data && dvEvt.data.size > 0) dvChunks.push(dvEvt.data); };

    let dvStartTime = null;
    let dvRafId = null;
    const dvAnimateFrame = (dvNow) => {
      if (!dvStartTime) dvStartTime = dvNow;
      const dvElapsed = (dvNow - dvStartTime) / 1000;
      const dvT = (dvElapsed % dvDurationSec) / dvDurationSec;
      DvRenderer.dvRenderTicker(dvCanvas, dvState, dvT);
      dvQs('#dvExportProgressTitle').textContent = `Recording video (${Math.min(dvDurationSec, dvElapsed).toFixed(1)}/${dvDurationSec}s)…`;
      dvQs('#dvExportProgressFill').style.width = Math.min(100, Math.round((dvElapsed / dvDurationSec) * 100)) + '%';
      if (dvElapsed < dvDurationSec) {
        dvRafId = requestAnimationFrame(dvAnimateFrame);
      } else {
        dvRecorder.stop();
      }
    };

    dvRecorder.onstop = () => {
      if (dvRafId) cancelAnimationFrame(dvRafId);
      const dvBlob = new Blob(dvChunks, { type: dvPick.mime.split(';')[0] });
      dvQs('#dvExportConfirm').classList.remove('dv-confirm--open');

      if (dvPick.ext === 'mp4') {
        this.dvDownloadBlob(dvBlob, 'dv-suite-design.mp4');
        DvToast.dvShow('Video exported (MP4)', 'success');
      } else {
        this.dvOfferMp4Transcode(dvBlob);
      }
    };

    dvRecorder.start();
    dvRafId = requestAnimationFrame(dvAnimateFrame);

    dvQs('#dvExportCancelBtn').onclick = () => {
      if (dvRecorder.state !== 'inactive') dvRecorder.stop();
      if (dvRafId) cancelAnimationFrame(dvRafId);
      dvQs('#dvExportConfirm').classList.remove('dv-confirm--open');
    };
  },

  dvDownloadBlob(dvBlob, dvFilename) {
    const dvUrl = URL.createObjectURL(dvBlob);
    const dvA = document.createElement('a');
    dvA.href = dvUrl; dvA.download = dvFilename; dvA.click();
    setTimeout(() => URL.revokeObjectURL(dvUrl), 4000);
  },

  dvOfferMp4Transcode(dvWebmBlob) {
    this.dvDownloadBlob(dvWebmBlob, 'dv-suite-design.webm');
    DvToast.dvShow('This device recorded WebM. Converting a copy to real MP4…');
    this.dvTranscodeWebmToMp4(dvWebmBlob)
      .then((dvMp4Blob) => {
        this.dvDownloadBlob(dvMp4Blob, 'dv-suite-design.mp4');
        DvToast.dvShow('MP4 conversion complete', 'success');
      })
      .catch(() => {
        DvToast.dvShow('MP4 conversion needs an internet connection — WebM was saved instead', 'error');
      });
  },

  // Loaded only on demand, only when native MP4 recording isn't available.
  // jsDelivr is used here specifically because it serves the official,
  // unmodified @ffmpeg/ffmpeg package straight from its npm release —
  // a widely trusted, version-pinned CDN, not an arbitrary third party.
  dvFfmpegLoadPromise: null,
  dvLoadFfmpeg() {
    if (this.dvFfmpegLoadPromise) return this.dvFfmpegLoadPromise;
    this.dvFfmpegLoadPromise = new Promise((dvResolve, dvReject) => {
      if (window.FFmpeg) { dvResolve(window.FFmpeg); return; }
      const dvScript = document.createElement('script');
      dvScript.src = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
      dvScript.onload = () => window.FFmpeg ? dvResolve(window.FFmpeg) : dvReject(new Error('dv-ffmpeg-load-failed'));
      dvScript.onerror = () => dvReject(new Error('dv-ffmpeg-network-failed'));
      document.head.appendChild(dvScript);
    });
    return this.dvFfmpegLoadPromise;
  },

  async dvTranscodeWebmToMp4(dvWebmBlob) {
    const dvFFmpegNs = await this.dvLoadFfmpeg();
    const dvFFmpeg = new dvFFmpegNs.FFmpeg();
    await dvFFmpeg.load({
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js'
    });
    const dvInputBytes = new Uint8Array(await dvWebmBlob.arrayBuffer());
    await dvFFmpeg.writeFile('input.webm', dvInputBytes);
    await dvFFmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'output.mp4']);
    const dvOutData = await dvFFmpeg.readFile('output.mp4');
    return new Blob([dvOutData.buffer], { type: 'video/mp4' });
  }
};

/* ==========================================================================
   16. Sharing — WhatsApp / Facebook quick share, Android Share Sheet, email
   ========================================================================== */

const DvShare = {
  dvDataUrlToFile(dvDataUrl, dvFilename) {
    const dvArr = dvDataUrl.split(',');
    const dvMimeMatch = dvArr[0].match(/:(.*?);/);
    const dvMime = dvMimeMatch ? dvMimeMatch[1] : 'image/png';
    const dvBin = atob(dvArr[1]);
    const dvBytes = new Uint8Array(dvBin.length);
    for (let dvI = 0; dvI < dvBin.length; dvI++) dvBytes[dvI] = dvBin.charCodeAt(dvI);
    return new File([dvBytes], dvFilename, { type: dvMime });
  },

  async dvShareDataUrl(dvDataUrl, dvFilename, dvChannel) {
    const dvFile = this.dvDataUrlToFile(dvDataUrl, dvFilename);

    if ((dvChannel === 'native' || dvChannel === 'whatsapp' || dvChannel === 'facebook') &&
        navigator.canShare && navigator.canShare({ files: [dvFile] })) {
      try {
        await navigator.share({ files: [dvFile], title: 'DV-SUITE Design' });
        DvToast.dvShow('Shared', 'success');
        return;
      } catch (dvErr) {
        if (dvErr && dvErr.name === 'AbortError') return;
        // fall through to link-based sharing below
      }
    }

    if (dvChannel === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent('Check out my DV-SUITE design!'), '_blank');
      DvToast.dvShow('Save the image, then attach it in WhatsApp');
    } else if (dvChannel === 'facebook') {
      window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(location.href), '_blank');
      DvToast.dvShow('Save the image, then attach it in Facebook');
    } else if (dvChannel === 'email') {
      window.location.href = 'mailto:?subject=' + encodeURIComponent('My DV-SUITE design') + '&body=' + encodeURIComponent('Made with DV-SUITE.');
      DvToast.dvShow('Attach the saved image to your email');
    } else if (navigator.share) {
      try { await navigator.share({ title: 'DV-SUITE Design', text: 'Made with DV-SUITE' }); } catch (dvErr) { /* user cancelled */ }
    } else {
      DvToast.dvShow('Sharing not supported on this browser — image was downloaded instead');
    }
  },

  dvShareApp() {
    const dvUrl = location.href;
    if (navigator.share) {
      navigator.share({ title: 'DV-SUITE', text: 'Try DV-SUITE — offline sticker & GIF generator', url: dvUrl }).catch(() => {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent('Try DV-SUITE: ' + dvUrl), '_blank');
    }
  }
};

/* ==========================================================================
   17. Install prompt (PWA)
   ========================================================================== */

const DvInstall = {
  dvDeferredPrompt: null,

  dvInit() {
    window.addEventListener('beforeinstallprompt', (dvEvent) => {
      dvEvent.preventDefault();
      this.dvDeferredPrompt = dvEvent;
    });
    dvQs('#dvMoreInstall').addEventListener('click', () => this.dvPrompt());
    window.addEventListener('appinstalled', () => DvToast.dvShow('DV-SUITE installed', 'success'));
  },

  async dvPrompt() {
    if (this.dvDeferredPrompt) {
      this.dvDeferredPrompt.prompt();
      await this.dvDeferredPrompt.userChoice;
      this.dvDeferredPrompt = null;
    } else {
      DvToast.dvShow('Use your browser menu → "Add to Home screen" to install');
    }
  }
};

/* ==========================================================================
   18. "More" page info wiring + confirm modal escape handling
   ========================================================================== */

function dvWireMorePage() {
  dvQs('#dvMoreAbout').addEventListener('click', () => DvContent.dvOpenInfo('about'));
  dvQs('#dvMoreHowTo').addEventListener('click', () => DvContent.dvOpenInfo('howto'));
  dvQs('#dvMoreContact').addEventListener('click', () => DvContent.dvOpenInfo('contact'));
  dvQs('#dvMoreWarning').addEventListener('click', () => DvContent.dvOpenInfo('warning'));
  dvQs('#dvMoreInstall').addEventListener('click', () => DvInstall.dvPrompt());
  dvQs('#dvMoreShareApp').addEventListener('click', () => DvShare.dvShareApp());
}

/* ==========================================================================
   19. Service worker registration
   ========================================================================== */

function dvRegisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline registration best-effort */ });
    });
  }
}

/* ==========================================================================
   20. Init
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  DvRouter.dvInit();
  DvSidebars.dvInit();
  DvSettingsPanel.dvInit();
  DvModal.dvInit();
  DvFiles.dvInit();
  DvEditor.dvInit();
  DvEmoji.dvInit();
  dvWireMorePage();
  dvRegisterServiceWorker();
  DvFiles.dvRenderRecent();
});
