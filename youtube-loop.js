// ==UserScript==
// @name         YouTube A/B Loop
// @version      2.0.0
// @description  A/B loop — native YouTube player integration
// @author       Black0S
// @match        https://www.youtube.com/watch*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript-/refs/heads/main/youtube-loop.js
// @downloadURL  https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript-/refs/heads/main/youtube-loop.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
  'use strict';


  // ─────────────────────────────────────────────────────────────────────────────
  //  CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────

  const RETRY_DELAY_MS       = 600;   // ms between player-ready polling attempts
  const SPA_NAVIGATION_DELAY = 1500;  // ms to wait after YouTube SPA navigation
  const EMPTY_TIME           = '–:––';


  // ─────────────────────────────────────────────────────────────────────────────
  //  CSS  (injected once into <head>, persists across SPA navigations)
  // ─────────────────────────────────────────────────────────────────────────────

  const CSS = `
    /* ── Toolbar button ── */
    .abl-yt-btn {
      border: none; background: transparent; cursor: pointer;
      padding: 0; margin: 0; width: 48px; height: 48px;
      display: inline-flex; align-items: center; justify-content: center;
      position: relative; vertical-align: top;
      opacity: .9; transition: opacity .15s;
    }
    .abl-yt-btn:hover { opacity: 1; }

    /* Active dot — visible when loop is running */
    .abl-yt-btn .abl-dot {
      position: absolute; top: 9px; right: 9px;
      width: 5px; height: 5px; border-radius: 50%;
      background: #f00; opacity: 0; transform: scale(0);
      transition: opacity .2s, transform .25s cubic-bezier(.34,1.56,.64,1);
    }
    .abl-yt-btn.active .abl-dot { opacity: 1; transform: scale(1); }

    /* ── Floating panel ── */
    .abl-panel {
      position: absolute; bottom: 54px; right: 4px; width: 340px;
      background: rgba(30,30,30,.72);
      backdrop-filter: blur(28px) saturate(1.6) brightness(.85);
      -webkit-backdrop-filter: blur(28px) saturate(1.6) brightness(.85);
      border-radius: 12px; border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 8px 32px rgba(0,0,0,.5);
      font-family: 'Roboto','YouTube Sans',Arial,sans-serif; color: #fff;
      z-index: 99999; overflow: hidden;
      opacity: 0; transform: translateY(8px) scale(.97);
      transform-origin: bottom right;
      transition: opacity .18s, transform .18s cubic-bezier(.4,0,.2,1);
      pointer-events: none; user-select: none;
    }
    .abl-panel.open { opacity: 1; transform: none; pointer-events: all; }

    /* ── Panel header ── */
    .abl-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px 8px; border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .abl-panel-title {
      font-size: 12px; font-weight: 500; letter-spacing: .06em;
      text-transform: uppercase; color: rgba(255,255,255,.45);
    }

    /* ── Loop toggle (pill switch) ── */
    .abl-loop-toggle {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 4px 8px; border-radius: 20px; transition: background .15s;
    }
    .abl-loop-toggle:hover { background: rgba(255,255,255,.08); }
    .abl-toggle-pill {
      width: 30px; height: 17px; border-radius: 9px;
      background: rgba(255,255,255,.18); position: relative;
      transition: background .2s; flex-shrink: 0;
    }
    .abl-toggle-pill::after {
      content: ''; position: absolute; top: 2.5px; left: 2.5px;
      width: 12px; height: 12px; border-radius: 50%;
      background: rgba(255,255,255,.5);
      transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .2s;
    }
    .abl-loop-toggle.on .abl-toggle-pill           { background: #f00; }
    .abl-loop-toggle.on .abl-toggle-pill::after    { transform: translateX(13px); background: #fff; }
    .abl-toggle-label {
      font-size: 13px; font-weight: 500;
      color: rgba(255,255,255,.6); transition: color .15s;
    }
    .abl-loop-toggle.on .abl-toggle-label { color: #fff; }

    /* ── Mode selector ── */
    .abl-mode-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
      padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .abl-mode-btn {
      height: 32px; border-radius: 6px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.05); font-family: inherit;
      font-size: 12px; font-weight: 500; color: rgba(255,255,255,.45);
      cursor: pointer; transition: background .15s, color .15s, border-color .15s;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .abl-mode-btn:hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.8); }
    .abl-mode-btn.sel   { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.3); color: #fff; }

    /* ── A/B section (collapsed in "full" mode) ── */
    .abl-ab-section {
      padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.08);
      overflow: hidden; max-height: 200px;
      transition: opacity .2s, max-height .2s, padding .2s;
    }
    .abl-ab-section.hidden { opacity: 0; max-height: 0; padding: 0 16px; pointer-events: none; }

    /* ── Footer ── */
    .abl-panel-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px 12px; overflow: hidden; max-height: 80px;
      transition: opacity .2s, max-height .2s, padding .2s;
    }
    .abl-panel-footer.hidden { opacity: 0; max-height: 0; padding: 0; pointer-events: none; }

    /* ── A/B point cards ── */
    .abl-points-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
    .abl-point-card {
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
      border-radius: 8px; padding: 8px 10px;
      display: flex; align-items: center; justify-content: space-between;
      transition: border-color .2s, background .2s;
    }
    .abl-point-card.set { border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.08); }
    .abl-point-left  { display: flex; align-items: center; gap: 8px; }
    .abl-point-badge {
      width: 18px; height: 18px; border-radius: 50%;
      background: rgba(255,255,255,.08);
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; color: rgba(255,255,255,.3);
      transition: background .2s, color .2s;
    }
    .abl-point-card.set .abl-point-badge { background: rgba(255,0,0,.25); color: #f66; }
    .abl-point-time {
      font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums;
      color: rgba(255,255,255,.3); transition: color .2s;
    }
    .abl-point-card.set .abl-point-time { color: #fff; }
    .abl-point-actions { display: flex; gap: 2px; }
    .abl-pt-set-btn {
      font-family: inherit; font-size: 10px; font-weight: 600;
      background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
      border-radius: 4px; color: rgba(255,255,255,.5); padding: 3px 7px;
      cursor: pointer; transition: background .15s, color .15s;
    }
    .abl-pt-set-btn:hover { background: rgba(255,255,255,.15); color: #fff; }
    .abl-pt-clr-btn {
      background: none; border: none; color: rgba(255,255,255,.2);
      font-size: 11px; cursor: pointer; padding: 3px 4px; transition: color .15s;
    }
    .abl-pt-clr-btn:hover { color: #f44; }

    /* ── Mini timeline ── */
    .abl-track-wrap {
      position: relative; height: 20px;
      display: flex; align-items: center; cursor: pointer; margin-bottom: 3px;
    }
    .abl-rail {
      position: absolute; left: 0; right: 0; height: 3px;
      background: rgba(255,255,255,.12); border-radius: 2px;
    }
    .abl-rail-prog {
      position: absolute; left: 0; height: 100%;
      background: rgba(255,255,255,.3); border-radius: 2px;
      pointer-events: none; width: 0%;
    }
    .abl-rail-range {
      position: absolute; height: 100%; background: #f00;
      border-radius: 2px; pointer-events: none;
      opacity: 0; transition: opacity .3s;
    }
    .abl-rail-range.on { opacity: .55; }
    .abl-th {
      position: absolute; top: 50%; transform: translate(-50%,-50%);
      border-radius: 50%; cursor: grab; z-index: 2;
      display: none; transition: transform .1s;
    }
    .abl-th.vis   { display: block; }
    .abl-th:hover { transform: translate(-50%,-50%) scale(1.3); }
    #abl-th-a, #abl-th-b {
      width: 11px; height: 11px; background: #fff;
      box-shadow: 0 0 0 2px rgba(255,255,255,.25);
    }
    #abl-th-play {
      width: 11px; height: 11px; background: #fff;
      box-shadow: 0 1px 5px rgba(0,0,0,.6);
      display: block; z-index: 3; left: 0%;
    }
    .abl-times-row {
      display: flex; justify-content: space-between;
      font-size: 10px; color: rgba(255,255,255,.25); font-variant-numeric: tabular-nums;
    }

    /* ── Footer: keyboard hints & reset ── */
    .abl-hint-row { display: flex; gap: 12px; }
    .abl-hint { display: flex; align-items: center; gap: 4px; font-size: 10px; color: rgba(255,255,255,.2); }
    .abl-kbd {
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
      border-radius: 3px; padding: 1px 5px; font-size: 10px;
      font-family: inherit; color: rgba(255,255,255,.3);
    }
    .abl-reset-btn {
      font-family: inherit; font-size: 11px; font-weight: 500;
      background: transparent; border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px; color: rgba(255,255,255,.3);
      padding: 5px 12px; cursor: pointer; letter-spacing: .04em;
      transition: border-color .15s, color .15s, background .15s;
    }
    .abl-reset-btn:hover { border-color: rgba(255,60,60,.5); color: #f66; background: rgba(255,0,0,.08); }

    /* ── Update banner (shown when a newer version is available) ── */
    .abl-update-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 16px; gap: 10px;
      background: rgba(255, 180, 0, .10);
      border-top: 1px solid rgba(255, 180, 0, .18);
      /* Hidden by default */
      display: none;
    }
    .abl-update-bar.visible { display: flex; }
    .abl-update-text {
      font-size: 11px; color: rgba(255, 210, 80, .9); flex: 1;
    }
    .abl-update-text strong { color: #ffd050; }
    .abl-update-link {
      font-size: 11px; font-weight: 600; color: #ffd050;
      text-decoration: none; white-space: nowrap;
      padding: 3px 9px; border-radius: 5px;
      border: 1px solid rgba(255, 208, 80, .35);
      background: rgba(255, 208, 80, .08);
      transition: background .15s, border-color .15s;
    }
    .abl-update-link:hover { background: rgba(255, 208, 80, .18); border-color: rgba(255, 208, 80, .6); }
  `;


  // ─────────────────────────────────────────────────────────────────────────────
  //  SVG ICON  (toolbar button)
  // ─────────────────────────────────────────────────────────────────────────────

  const ICON_SVG = `
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="9.5" width="17" height="3" rx="1.5" fill="white" fill-opacity="0.2"/>
      <rect x="2.5" y="9.5" width="7"  height="3" rx="1.5" fill="white" fill-opacity="0.55"/>
      <line x1="7"  y1="7" x2="7"  y2="15" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="15" y1="7" x2="15" y2="15" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="11" cy="11" r="2" fill="white"/>
    </svg>`;


  // ─────────────────────────────────────────────────────────────────────────────
  //  HTML TEMPLATE  (panel inner content — static string, parsed once per page)
  // ─────────────────────────────────────────────────────────────────────────────

  const PANEL_HTML = `
    <div class="abl-panel-header">
      <span class="abl-panel-title">A / B Loop</span>
      <div class="abl-loop-toggle" id="abl-toggle">
        <div class="abl-toggle-pill"></div>
        <span class="abl-toggle-label">Loop off</span>
      </div>
    </div>

    <div class="abl-mode-row">
      <button class="abl-mode-btn" id="abl-mode-full">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 2 A4.5 4.5 0 1 1 2 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>
          <polyline points="2,4 2,6.5 4.5,6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        Full video
      </button>
      <button class="abl-mode-btn sel" id="abl-mode-ab">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="4" width="4" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/>
          <rect x="8" y="4" width="4" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/>
          <line x1="5" y1="6.5" x2="8" y2="6.5" stroke="currentColor" stroke-width="1.3" stroke-dasharray="1 1.2"/>
        </svg>
        A → B
      </button>
    </div>

    <div class="abl-ab-section" id="abl-ab-section">
      <div class="abl-points-row">
        <div class="abl-point-card" id="abl-pt-a">
          <div class="abl-point-left">
            <div class="abl-point-badge">A</div>
            <span class="abl-point-time" id="abl-val-a">${EMPTY_TIME}</span>
          </div>
          <div class="abl-point-actions">
            <button class="abl-pt-set-btn" id="abl-set-a">Set</button>
            <button class="abl-pt-clr-btn" id="abl-clr-a">✕</button>
          </div>
        </div>
        <div class="abl-point-card" id="abl-pt-b">
          <div class="abl-point-left">
            <div class="abl-point-badge">B</div>
            <span class="abl-point-time" id="abl-val-b">${EMPTY_TIME}</span>
          </div>
          <div class="abl-point-actions">
            <button class="abl-pt-set-btn" id="abl-set-b">Set</button>
            <button class="abl-pt-clr-btn" id="abl-clr-b">✕</button>
          </div>
        </div>
      </div>

      <div class="abl-track-wrap">
        <div class="abl-rail" id="abl-rail">
          <div class="abl-rail-prog"  id="abl-prog"></div>
          <div class="abl-rail-range" id="abl-range"></div>
        </div>
        <div class="abl-th" id="abl-th-a"></div>
        <div class="abl-th" id="abl-th-b"></div>
        <div class="abl-th" id="abl-th-play"></div>
      </div>

      <div class="abl-times-row">
        <span>0:00</span>
        <span id="abl-t-end">${EMPTY_TIME}</span>
      </div>
    </div>

    <div class="abl-panel-footer">
      <div class="abl-hint-row">
        <div class="abl-hint"><span class="abl-kbd">A</span> Point A</div>
        <div class="abl-hint"><span class="abl-kbd">B</span> Point B</div>
      </div>
      <button class="abl-reset-btn" id="abl-reset">Reset</button>
    </div>

    <!-- Update banner: hidden until checkForUpdate() finds a newer version -->
    <div class="abl-update-bar" id="abl-update-bar">
      <span class="abl-update-text">
        Update available: <strong id="abl-update-version"></strong>
      </span>
      <a class="abl-update-link"
         href="https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript-/refs/heads/main/youtube-loop.js"
         target="_blank" rel="noopener">
        Install
      </a>
    </div>`;


  // ─────────────────────────────────────────────────────────────────────────────
  //  TIME FORMATTER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Formats a seconds value as "mm:ss" or "h:mm:ss".
   * Returns EMPTY_TIME for null / NaN inputs.
   */
  function fmt(seconds) {
    if (seconds == null || isNaN(seconds)) return EMPTY_TIME;
    const h  = Math.floor(seconds / 3600);
    const m  = Math.floor((seconds % 3600) / 60);
    const s  = Math.floor(seconds % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  SESSION  (one isolated object per page load)
  //
  //  All state lives here instead of in free-floating module-level variables.
  //  On SPA navigation we simply tear down the old session and create a new one —
  //  no risk of stale state leaking between pages.
  // ─────────────────────────────────────────────────────────────────────────────

  function createSession(video, btn, panel, ui) {
    return {
      // DOM references
      video, btn, panel, ui,

      // Loop state
      pointA   : null,   // loop start (seconds) — null = not set
      pointB   : null,   // loop end   (seconds) — null = not set
      loopOn   : false,
      loopMode : 'ab',   // 'ab' | 'full'

      // UI state
      panelOpen  : false,
      dragTarget : null,  // callback invoked on mousemove while dragging
      rafId      : null,

      // Per-frame cache — avoids redundant DOM writes on every RAF tick
      _lastPct      : -1,
      _lastDuration : -1,
      _lastLoStart  : -1,
      _lastLoEnd    : -1,
    };
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  POINT HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /** Sets loop point A or B to the video's current time and updates the UI. */
  function setPoint(sess, which) {
    const time = sess.video.currentTime;
    const isA  = which === 'a';
    if (isA) {
      sess.pointA = time;
      sess.ui.valA.textContent = fmt(time);
      sess.ui.ptA.classList.add('set');
      sess.ui.thA.classList.add('vis');
    } else {
      sess.pointB = time;
      sess.ui.valB.textContent = fmt(time);
      sess.ui.ptB.classList.add('set');
      sess.ui.thB.classList.add('vis');
    }
    // Invalidate the range cache so renderFrame redraws the highlighted region
    sess._lastLoStart = sess._lastLoEnd = -1;
  }

  /** Clears loop point A or B and updates the UI. */
  function clearPoint(sess, which) {
    const isA = which === 'a';
    if (isA) {
      sess.pointA = null;
      sess.ui.valA.textContent = EMPTY_TIME;
      sess.ui.ptA.classList.remove('set');
      sess.ui.thA.classList.remove('vis');
    } else {
      sess.pointB = null;
      sess.ui.valB.textContent = EMPTY_TIME;
      sess.ui.ptB.classList.remove('set');
      sess.ui.thB.classList.remove('vis');
    }
    sess._lastLoStart = sess._lastLoEnd = -1;
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  RENDER LOOP
  //
  //  Runs on every animation frame.
  //
  //  Optimisations applied vs. the original:
  //    • Per-frame value cache → DOM writes only happen when something changed.
  //    • Range highlight position is recomputed only when A or B move.
  //    • Duration label is written once (or on seek to a new video).
  // ─────────────────────────────────────────────────────────────────────────────

  function renderFrame(sess) {
    const { video, ui } = sess;
    const duration = video.duration || 0;

    // ── Duration label (written once per video, not every frame) ─────────────
    if (duration !== sess._lastDuration) {
      ui.tEnd.textContent  = fmt(duration);
      sess._lastDuration   = duration;
    }

    // ── Playhead + progress bar ───────────────────────────────────────────────
    const pct = duration ? (video.currentTime / duration) * 100 : 0;
    if (pct !== sess._lastPct) {
      ui.prog.style.width  = pct + '%';
      ui.thPlay.style.left = pct + '%';
      sess._lastPct = pct;
    }

    // ── A/B thumb positions (only written when points exist) ─────────────────
    if (sess.pointA !== null) ui.thA.style.left = (sess.pointA / duration * 100) + '%';
    if (sess.pointB !== null) ui.thB.style.left = (sess.pointB / duration * 100) + '%';

    // ── A→B highlighted range (redrawn only when boundaries change) ──────────
    const bothSet = sess.pointA !== null && sess.pointB !== null;
    if (sess.loopMode === 'ab' && bothSet && duration) {
      const lo = Math.min(sess.pointA, sess.pointB);
      const hi = Math.max(sess.pointA, sess.pointB);
      if (lo !== sess._lastLoStart || hi !== sess._lastLoEnd) {
        ui.range.style.left  = (lo / duration * 100) + '%';
        ui.range.style.width = ((hi - lo) / duration * 100) + '%';
        ui.range.classList.add('on');
        sess._lastLoStart = lo;
        sess._lastLoEnd   = hi;
      }
    } else if (ui.range.classList.contains('on')) {
      ui.range.classList.remove('on');
      sess._lastLoStart = sess._lastLoEnd = -1;
    }

    // ── Loop enforcement ──────────────────────────────────────────────────────
    if (sess.loopOn) {
      if (sess.loopMode === 'ab' && bothSet) {
        // A→B mode: jump back to A when playback passes B
        const lo = Math.min(sess.pointA, sess.pointB);
        const hi = Math.max(sess.pointA, sess.pointB);
        if (video.currentTime >= hi || video.currentTime < lo) {
          video.currentTime = lo;
        }

      } else if (sess.loopMode === 'full' && duration > 0) {
        // Full-video mode: detected via RAF instead of the 'ended' event.
        // YouTube suppresses 'ended' after the first replay — it fires only once —
        // so we poll currentTime directly, which is reliable on every loop.
        const hasEnded = video.ended || (video.paused && video.currentTime >= duration - 0.1);
        const nearEnd  = video.currentTime >= duration - 0.3;
        if (hasEnded || nearEnd) {
          video.currentTime = 0;
          video.play();
        }
      }
    }

    sess.rafId = requestAnimationFrame(() => renderFrame(sess));
  }

  function startRenderLoop(sess) {
    sess.rafId = requestAnimationFrame(() => renderFrame(sess));
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  SETUP FUNCTIONS  (each wires exactly one UI concern)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Opens / closes the floating panel on toolbar-button click. */
  function setupPanelToggle(sess) {
    const { btn, panel } = sess;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sess.panelOpen = !sess.panelOpen;
      panel.classList.toggle('open', sess.panelOpen);
      btn.classList.toggle('active', sess.panelOpen || sess.loopOn);
    });

    // Close when the user clicks anywhere outside the panel
    document.addEventListener('click', (e) => {
      if (sess.panelOpen && !panel.contains(e.target) && e.target !== btn) {
        sess.panelOpen = false;
        panel.classList.remove('open');
        btn.classList.toggle('active', sess.loopOn);
      }
    });
  }

  /** Wires the loop on/off pill toggle in the panel header. */
  function setupLoopToggle(sess) {
    const { ui, btn, video } = sess;

    ui.toggle.addEventListener('click', () => {
      sess.loopOn = !sess.loopOn;
      ui.toggle.classList.toggle('on', sess.loopOn);
      ui.toggleLabel.textContent = sess.loopOn ? 'Loop on' : 'Loop off';
      btn.classList.toggle('active', sess.loopOn || sess.panelOpen);
      // Disable YouTube's native loop so ours takes full control
      if (sess.loopOn) video.loop = false;
    });
  }

  /**
   * Wires the Full-video / A→B mode buttons.
   * Returns `setMode` so setupPointButtons (Reset) can reuse it.
   */
  function setupModeSelector(sess) {
    const { ui } = sess;

    function setMode(mode) {
      sess.loopMode = mode;
      const isAB = mode === 'ab';
      ui.modeFull.classList.toggle('sel',    !isAB);
      ui.modeAB.classList.toggle('sel',       isAB);
      ui.abSection.classList.toggle('hidden', !isAB);
      ui.footer.classList.toggle('hidden',    !isAB);
    }

    ui.modeFull.addEventListener('click', () => setMode('full'));
    ui.modeAB.addEventListener('click',   () => setMode('ab'));

    return setMode;
  }

  /** Wires the Set A, Set B, clear (✕), and Reset buttons. */
  function setupPointButtons(sess, setMode) {
    const { ui, btn } = sess;

    ui.setABtn.addEventListener('click', () => setPoint(sess, 'a'));
    ui.setBBtn.addEventListener('click', () => setPoint(sess, 'b'));
    ui.clrA.addEventListener('click',   () => clearPoint(sess, 'a'));
    ui.clrB.addEventListener('click',   () => clearPoint(sess, 'b'));

    ui.resetBtn.addEventListener('click', () => {
      clearPoint(sess, 'a');
      clearPoint(sess, 'b');
      sess.loopOn = false;
      ui.toggle.classList.remove('on');
      ui.toggleLabel.textContent = 'Loop off';
      btn.classList.remove('active');
      setMode('ab');
    });
  }

  /** Wires the mini-timeline: drag thumbs A, B, playhead; click-to-seek on rail. */
  function setupTimeline(sess) {
    const { ui, video } = sess;

    /** Maps a clientX pixel position to a 0–1 fraction along the rail. */
    function toFraction(clientX) {
      const rect = ui.rail.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    /** Makes a thumb draggable; calls onDrag(clientX) on every mousemove. */
    function makeDraggable(thumb, onDrag) {
      thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sess.dragTarget = onDrag;
      });
    }

    makeDraggable(ui.thA, (x) => {
      sess.pointA = toFraction(x) * video.duration;
      ui.valA.textContent = fmt(sess.pointA);
      ui.ptA.classList.add('set');
      ui.thA.classList.add('vis');
      sess._lastLoStart = sess._lastLoEnd = -1;  // force range redraw
    });

    makeDraggable(ui.thB, (x) => {
      sess.pointB = toFraction(x) * video.duration;
      ui.valB.textContent = fmt(sess.pointB);
      ui.ptB.classList.add('set');
      ui.thB.classList.add('vis');
      sess._lastLoStart = sess._lastLoEnd = -1;
    });

    makeDraggable(ui.thPlay, (x) => {
      video.currentTime = toFraction(x) * video.duration;
    });

    document.addEventListener('mousemove', (e) => { if (sess.dragTarget) sess.dragTarget(e.clientX); });
    document.addEventListener('mouseup',   ()  => { sess.dragTarget = null; });

    // Click directly on the rail to seek (only when not already mid-drag)
    ui.rail.addEventListener('click', (e) => {
      if (!sess.dragTarget) video.currentTime = toFraction(e.clientX) * video.duration;
    });
  }

  /**
   * Wires keyboard shortcuts A and B.
   * Ignored while the user is typing in any text input.
   */
  function setupKeyboard(sess) {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT'    ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) return;

      if (e.key === 'a' || e.key === 'A') setPoint(sess, 'a');
      if (e.key === 'b' || e.key === 'B') setPoint(sess, 'b');
    });
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  DOM BUILDER
  // ─────────────────────────────────────────────────────────────────────────────

  function buildDOM() {
    const btn = document.createElement('button');
    btn.className = 'abl-yt-btn ytp-button';
    btn.title     = 'A/B Loop';
    btn.innerHTML = ICON_SVG + '<span class="abl-dot"></span>';

    const panel = document.createElement('div');
    panel.className = 'abl-panel';
    panel.innerHTML = PANEL_HTML;

    return { btn, panel };
  }

  /**
   * Queries all interactive panel elements into a single flat object.
   * Using a helper keeps mountUI() clean and makes the element map explicit.
   */
  function queryUI(panel) {
    const q = (sel) => panel.querySelector(sel);
    return {
      toggle      : q('#abl-toggle'),
      toggleLabel : q('.abl-toggle-label'),
      modeFull    : q('#abl-mode-full'),
      modeAB      : q('#abl-mode-ab'),
      abSection   : q('#abl-ab-section'),
      footer      : q('.abl-panel-footer'),
      ptA         : q('#abl-pt-a'),
      ptB         : q('#abl-pt-b'),
      valA        : q('#abl-val-a'),
      valB        : q('#abl-val-b'),
      setABtn     : q('#abl-set-a'),
      setBBtn     : q('#abl-set-b'),
      clrA        : q('#abl-clr-a'),
      clrB        : q('#abl-clr-b'),
      resetBtn    : q('#abl-reset'),
      rail        : q('#abl-rail'),
      prog        : q('#abl-prog'),
      range       : q('#abl-range'),
      thA         : q('#abl-th-a'),
      thB         : q('#abl-th-b'),
      thPlay      : q('#abl-th-play'),
      tEnd        : q('#abl-t-end'),
      updateBar   : q('#abl-update-bar'),
      updateVersion: q('#abl-update-version'),
    };
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  UPDATE CHECK
  //  Fetches the raw script from GitHub, extracts the @version from the header,
  //  and shows the update banner in the panel if a newer version is available.
  //  Uses GM_xmlhttpRequest to bypass cross-origin restrictions.
  // ─────────────────────────────────────────────────────────────────────────────

  const CURRENT_VERSION  = '1.0.0';
  const RAW_SCRIPT_URL   = 'https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript-/refs/heads/main/youtube-loop.js';

  /**
   * Compares two semver strings (e.g. "1.0.0" vs "1.1.0").
   * Returns true if `remote` is strictly newer than `local`.
   */
  function isNewer(local, remote) {
    const toInt = (v) => v.split('.').map(Number);
    const [la, lb, lc] = toInt(local);
    const [ra, rb, rc] = toInt(remote);
    return ra > la || (ra === la && rb > lb) || (ra === la && rb === lb && rc > lc);
  }

  /**
   * Fetches the remote script, parses the @version line, and reveals the
   * update banner inside the panel if a newer version is found.
   * Called once per session, non-blocking.
   */
  function checkForUpdate(ui) {
    GM_xmlhttpRequest({
      method  : 'GET',
      url     : RAW_SCRIPT_URL,
      // Only download the first 512 bytes — the @version is always in the header
      headers : { Range: 'bytes=0-511' },
      onload  : (res) => {
        const match = res.responseText.match(/@version\s+([\d.]+)/);
        if (!match) return;
        const remoteVersion = match[1];
        if (isNewer(CURRENT_VERSION, remoteVersion)) {
          ui.updateVersion.textContent = `v${remoteVersion}`;
          ui.updateBar.classList.add('visible');
        }
      },
      onerror : () => { /* silently ignore network errors */ },
    });
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  INJECTION  (orchestrates a single page session)
  // ─────────────────────────────────────────────────────────────────────────────

  let activeSession = null;  // null between page navigations

  function inject() {
    if (activeSession) return;

    const video         = document.querySelector('video');
    const player        = document.querySelector('#movie_player');
    const rightControls = player?.querySelector('.ytp-right-controls');

    if (!video?.duration || !player || !rightControls) return;

    // Inject the stylesheet only once — it survives SPA navigations harmlessly
    if (!document.querySelector('#abl-style')) {
      const style = document.createElement('style');
      style.id = 'abl-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const { btn, panel } = buildDOM();
    rightControls.insertBefore(btn, rightControls.firstChild);
    player.style.position = 'relative';
    player.appendChild(panel);

    const ui   = queryUI(panel);
    const sess = createSession(video, btn, panel, ui);
    activeSession = sess;

    // Wire all UI concerns, then start the render loop
    const setMode = setupModeSelector(sess);
    setupPanelToggle(sess);
    setupLoopToggle(sess);
    setupPointButtons(sess, setMode);
    setupTimeline(sess);
    setupKeyboard(sess);
    startRenderLoop(sess);
    checkForUpdate(ui);
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  PLAYER-READY POLLING
  //  YouTube loads its player asynchronously; we retry until it's ready.
  // ─────────────────────────────────────────────────────────────────────────────

  function tryInject() {
    const video  = document.querySelector('video');
    const player = document.querySelector('#movie_player');
    const ready  = video?.duration > 0 && player?.querySelector('.ytp-right-controls');

    if (ready) inject();
    else setTimeout(tryInject, RETRY_DELAY_MS);
  }


  // ─────────────────────────────────────────────────────────────────────────────
  //  SPA NAVIGATION HANDLER
  //
  //  YouTube never does full page reloads between videos.
  //  We watch <title> mutations (lightweight — only fires on nav events,
  //  not on every DOM change like observing document.body).
  // ─────────────────────────────────────────────────────────────────────────────

  /** Destroys the current session cleanly: stops RAF, removes DOM nodes. */
  function teardown() {
    if (!activeSession) return;
    cancelAnimationFrame(activeSession.rafId);
    activeSession.btn.remove();
    activeSession.panel.remove();
    activeSession = null;
  }

  let lastUrl = location.href;

  new MutationObserver(() => {
    if (location.href === lastUrl) return;  // guard: <title> can change without navigation
    lastUrl = location.href;
    teardown();
    setTimeout(tryInject, SPA_NAVIGATION_DELAY);
  }).observe(document.querySelector('title'), { childList: true });


  // ─────────────────────────────────────────────────────────────────────────────
  //  ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────────

  tryInject();

})();
