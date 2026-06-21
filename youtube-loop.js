// ==UserScript==
// @name         YouTube A/B Loop
// @version      3.0.0
// @description  A/B loop for YouTube — universal userscript manager support
// @author       Black0S
// @match        https://www.youtube.com/watch*
// @noframes
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript/refs/heads/main/youtube-loop.js
// @downloadURL  https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript/refs/heads/main/youtube-loop.js
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  //  0.  SENTINEL  — abort if already injected on this page load
  // ═══════════════════════════════════════════════════════════════════════════

  const SENTINEL = '__abl_injected__';
  if (window[SENTINEL]) return;
  window[SENTINEL] = true;


  // ═══════════════════════════════════════════════════════════════════════════
  //  1.  CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  const VERSION        = '3.0.0';
  const UPDATE_URL     = 'https://raw.githubusercontent.com/Black0S/Youtube-Loop-UserScript/refs/heads/main/youtube-loop.js';
  const POLL_MS        = 700;   // player-ready retry interval
  const NAV_DELAY_MS   = 1600;  // wait after SPA navigation before re-injecting
  const URL_CHECK_MS   = 600;   // URL-polling interval for SPA detection
  const MAX_POLLS      = 150;   // ~105 s maximum wait
  const EMPTY          = '–:––';


  // ═══════════════════════════════════════════════════════════════════════════
  //  2.  CROSS-MANAGER HTTP  (update check only)
  //      Priority: GM_xmlhttpRequest → GM.xmlHttpRequest → fetch()
  // ═══════════════════════════════════════════════════════════════════════════

  function xhrGet(url, onText) {
    // — Tampermonkey · ScriptCat · Violentmonkey MV2 · Greasemonkey 3 —
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        GM_xmlhttpRequest({
          method : 'GET', url,
          headers: { Range: 'bytes=0-511' },
          onload : (r) => onText(r.responseText),
          onerror: () => {},
        });
        return;
      } catch { /* ignore */ }
    }

    // — Greasemonkey 4 · Violentmonkey async API —
    if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
      try {
        GM.xmlHttpRequest({
          method : 'GET', url,
          headers: { Range: 'bytes=0-511' },
          onload : (r) => onText(r.responseText),
          onerror: () => {},
        });
        return;
      } catch { /* ignore */ }
    }

    // — Universal fallback (GitHub raw sends Access-Control-Allow-Origin: *) —
    try {
      fetch(url, { headers: { Range: 'bytes=0-511' }, cache: 'no-store' })
        .then((r) => r.text()).then(onText).catch(() => {});
    } catch { /* ignore */ }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  3.  UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Formats seconds → "mm:ss" or "h:mm:ss". Returns EMPTY for invalid input. */
  function fmt(s) {
    if (s == null || !isFinite(s) || s < 0) return EMPTY;
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  }

  /**
   * Parses a strict "m:ss" or "h:mm:ss" string → seconds.
   * Returns null on any invalid format. Inverse of fmt().
   *   "0:05"→5  "1:23"→83  "12:09"→729  "1:02:03"→3723
   *   "83"·"1:2"·"1:60"·":30" → null
   */
  function parseTime(str) {
    const m = String(str).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hasH = m[1] != null;
    const h  = hasH ? Number(m[1]) : 0;
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    if (ss >= 60) return null;
    if (hasH && mm >= 60) return null; // minutes must be < 60 only when hours present
    return h * 3600 + mm * 60 + ss;
  }

  /** Returns true if semver string `b` is strictly newer than `a`. */
  function semverGt(a, b) {
    // Pad to 3 segments so "2.0" compares correctly against "2.0.0".
    const p = (v) => {
      const [x = 0, y = 0, z = 0] = String(v).split('.').map((n) => Number(n) || 0);
      return [x, y, z];
    };
    const [a0,a1,a2] = p(a), [b0,b1,b2] = p(b);
    return b0 > a0 || (b0===a0 && b1>a1) || (b0===a0 && b1===a1 && b2>a2);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  4.  CSS  (injected once into <head>, survives SPA navigations)
  // ═══════════════════════════════════════════════════════════════════════════

  const CSS = `
    /* ── toolbar button ── */
    .abl-btn {
      border:none; background:transparent; cursor:pointer;
      padding:0; margin:0; width:48px; height:48px;
      display:inline-flex; align-items:center; justify-content:center;
      position:relative; vertical-align:top;
      opacity:.9; transition:opacity .15s;
    }
    .abl-btn:hover { opacity:1; }
    .abl-btn .abl-dot {
      position:absolute; top:9px; right:9px;
      width:5px; height:5px; border-radius:50%;
      background:#f00; opacity:0; transform:scale(0);
      transition:opacity .2s, transform .25s cubic-bezier(.34,1.56,.64,1);
    }
    .abl-btn.active .abl-dot { opacity:1; transform:scale(1); }

    /* ── floating panel ── */
    .abl-panel {
      position:absolute; bottom:54px; right:4px; width:340px;
      background:rgba(30,30,30,.72);
      backdrop-filter:blur(28px) saturate(1.6) brightness(.85);
      -webkit-backdrop-filter:blur(28px) saturate(1.6) brightness(.85);
      border-radius:12px; border:1px solid rgba(255,255,255,.08);
      box-shadow:0 8px 32px rgba(0,0,0,.5);
      font-family:'Roboto','YouTube Sans',Arial,sans-serif; color:#fff;
      z-index:99999; overflow:hidden;
      opacity:0; transform:translateY(8px) scale(.97);
      transform-origin:bottom right;
      transition:opacity .18s, transform .18s cubic-bezier(.4,0,.2,1);
      pointer-events:none; user-select:none;
    }
    .abl-panel.open { opacity:1; transform:none; pointer-events:all; }

    /* ── panel header ── */
    .abl-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px 8px; border-bottom:1px solid rgba(255,255,255,.08);
    }
    .abl-title {
      font-size:12px; font-weight:500; letter-spacing:.06em;
      text-transform:uppercase; color:rgba(255,255,255,.45);
    }

    /* ── loop toggle (pill) ── */
    .abl-toggle {
      display:flex; align-items:center; gap:8px; cursor:pointer;
      padding:4px 8px; border-radius:20px; transition:background .15s;
    }
    .abl-toggle:hover { background:rgba(255,255,255,.08); }
    .abl-pill {
      width:30px; height:17px; border-radius:9px;
      background:rgba(255,255,255,.18); position:relative;
      transition:background .2s; flex-shrink:0;
    }
    .abl-pill::after {
      content:''; position:absolute; top:2.5px; left:2.5px;
      width:12px; height:12px; border-radius:50%;
      background:rgba(255,255,255,.5);
      transition:transform .22s cubic-bezier(.34,1.56,.64,1), background .2s;
    }
    .abl-toggle.on .abl-pill           { background:#f00; }
    .abl-toggle.on .abl-pill::after    { transform:translateX(13px); background:#fff; }
    .abl-toggle-lbl {
      font-size:13px; font-weight:500;
      color:rgba(255,255,255,.6); transition:color .15s;
    }
    .abl-toggle.on .abl-toggle-lbl { color:#fff; }

    /* ── mode selector ── */
    .abl-modes {
      display:grid; grid-template-columns:1fr 1fr; gap:6px;
      padding:10px 16px; border-bottom:1px solid rgba(255,255,255,.08);
    }
    .abl-mode {
      height:32px; border-radius:6px; border:1px solid rgba(255,255,255,.1);
      background:rgba(255,255,255,.05); font-family:inherit;
      font-size:12px; font-weight:500; color:rgba(255,255,255,.45);
      cursor:pointer; transition:background .15s, color .15s, border-color .15s;
      display:flex; align-items:center; justify-content:center; gap:6px;
    }
    .abl-mode:hover { background:rgba(255,255,255,.1); color:rgba(255,255,255,.8); }
    .abl-mode.sel   { background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.3); color:#fff; }

    /* ── A/B section ── */
    .abl-ab {
      padding:10px 16px; border-bottom:1px solid rgba(255,255,255,.08);
      overflow:hidden; max-height:200px;
      transition:opacity .2s, max-height .2s, padding .2s;
    }
    .abl-ab.hidden { opacity:0; max-height:0; padding:0 16px; pointer-events:none; }

    /* ── footer ── */
    .abl-footer {
      display:flex; align-items:center; justify-content:space-between;
      padding:8px 16px 12px; overflow:hidden; max-height:80px;
      transition:opacity .2s, max-height .2s, padding .2s;
    }
    .abl-footer.hidden { opacity:0; max-height:0; padding:0; pointer-events:none; }

    /* ── A/B point cards ── */
    .abl-pts { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; }
    .abl-card {
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);
      border-radius:8px; padding:8px 10px;
      display:flex; align-items:center; justify-content:space-between;
      transition:border-color .2s, background .2s;
    }
    .abl-card.set { border-color:rgba(255,255,255,.2); background:rgba(255,255,255,.08); }
    .abl-card-l   { display:flex; align-items:center; gap:8px; }
    .abl-badge {
      width:18px; height:18px; border-radius:50%;
      background:rgba(255,255,255,.08);
      display:flex; align-items:center; justify-content:center;
      font-size:9px; font-weight:700; color:rgba(255,255,255,.3);
      transition:background .2s, color .2s;
    }
    .abl-card.set .abl-badge { background:rgba(255,0,0,.25); color:#f66; }
    .abl-time {
      font-size:13px; font-weight:500; font-variant-numeric:tabular-nums;
      color:rgba(255,255,255,.3); transition:color .2s;
    }
    .abl-card.set .abl-time { color:#fff; }
    .abl-time .abl-time-input {
      width:54px; box-sizing:border-box;
      background:rgba(255,255,255,.12);
      border:1px solid rgba(255,255,255,.3); border-radius:4px;
      color:#fff; font-family:inherit; font-size:13px; font-weight:500;
      font-variant-numeric:tabular-nums; padding:1px 4px;
      outline:none; text-align:left;
    }
    .abl-card-r { display:flex; gap:2px; }
    .abl-set {
      font-family:inherit; font-size:10px; font-weight:600;
      background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1);
      border-radius:4px; color:rgba(255,255,255,.5); padding:3px 7px;
      cursor:pointer; transition:background .15s, color .15s;
    }
    .abl-set:hover { background:rgba(255,255,255,.15); color:#fff; }
    .abl-clr {
      background:none; border:none; color:rgba(255,255,255,.2);
      font-size:11px; cursor:pointer; padding:3px 4px; transition:color .15s;
    }
    .abl-clr:hover { color:#f44; }

    /* ── mini timeline ── */
    .abl-track {
      position:relative; height:20px;
      display:flex; align-items:center; cursor:pointer; margin-bottom:3px;
    }
    .abl-rail {
      position:absolute; left:0; right:0; height:3px;
      background:rgba(255,255,255,.12); border-radius:2px;
    }
    .abl-prog {
      position:absolute; left:0; height:100%;
      background:rgba(255,255,255,.3); border-radius:2px;
      pointer-events:none; width:0%;
    }
    .abl-range {
      position:absolute; height:100%; background:#f00;
      border-radius:2px; pointer-events:none;
      opacity:0; transition:opacity .3s;
    }
    .abl-range.on { opacity:.55; }
    .abl-th {
      position:absolute; top:50%; transform:translate(-50%,-50%);
      border-radius:50%; cursor:grab; z-index:2;
      display:none; transition:transform .1s;
    }
    .abl-th.vis   { display:block; }
    .abl-th:hover { transform:translate(-50%,-50%) scale(1.3); }
    .abl-th-ab {
      width:11px; height:11px; background:#fff;
      box-shadow:0 0 0 2px rgba(255,255,255,.25);
    }
    .abl-th-play {
      width:11px; height:11px; background:#fff;
      box-shadow:0 1px 5px rgba(0,0,0,.6);
      display:block; z-index:3; left:0%;
    }
    .abl-times {
      display:flex; justify-content:space-between;
      font-size:10px; color:rgba(255,255,255,.25); font-variant-numeric:tabular-nums;
    }

    /* ── footer: hints + reset ── */
    .abl-hints { display:flex; gap:12px; }
    .abl-hint  { display:flex; align-items:center; gap:4px; font-size:10px; color:rgba(255,255,255,.2); }
    .abl-kbd {
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1);
      border-radius:3px; padding:1px 5px; font-size:10px;
      font-family:inherit; color:rgba(255,255,255,.3);
    }
    .abl-reset {
      font-family:inherit; font-size:11px; font-weight:500;
      background:transparent; border:1px solid rgba(255,255,255,.1);
      border-radius:6px; color:rgba(255,255,255,.3);
      padding:5px 12px; cursor:pointer; letter-spacing:.04em;
      transition:border-color .15s, color .15s, background .15s;
    }
    .abl-reset:hover { border-color:rgba(255,60,60,.5); color:#f66; background:rgba(255,0,0,.08); }

    /* ── update banner ── */
    .abl-update {
      display:none; align-items:center; justify-content:space-between;
      padding:7px 16px; gap:10px;
      background:rgba(255,180,0,.10);
      border-top:1px solid rgba(255,180,0,.18);
    }
    .abl-update.show { display:flex; }
    .abl-update-txt  { font-size:11px; color:rgba(255,210,80,.9); flex:1; }
    .abl-update-txt strong { color:#ffd050; }
    .abl-update-lnk {
      font-size:11px; font-weight:600; color:#ffd050;
      text-decoration:none; white-space:nowrap;
      padding:3px 9px; border-radius:5px;
      border:1px solid rgba(255,208,80,.35);
      background:rgba(255,208,80,.08);
      transition:background .15s, border-color .15s;
    }
    .abl-update-lnk:hover { background:rgba(255,208,80,.18); border-color:rgba(255,208,80,.6); }
  `;


  // ═══════════════════════════════════════════════════════════════════════════
  //  5.  TRUSTED-TYPES-SAFE DOM HELPERS
  //
  //  Helium enforces YouTube's Trusted Types CSP so aggressively that even
  //  DOMParser.parseFromString() is blocked ("This document requires
  //  TrustedHTML assignment").
  //
  //  The ONLY approach that works is building every node with pure DOM APIs:
  //  document.createElement(), document.createTextNode(),
  //  document.createElementNS() for SVG — no string parsing of any kind.
  // ═══════════════════════════════════════════════════════════════════════════

  const NS_SVG = 'http://www.w3.org/2000/svg';

  /** Create an HTML element with optional className and/or id. */
  function el(tag, cls, id) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (id)  e.id = id;
    return e;
  }

  /** Create a text node. */
  const txt = (s) => document.createTextNode(s);

  /** Append multiple children to a parent and return the parent. */
  function app(parent, ...children) {
    for (const c of children) parent.appendChild(c);
    return parent;
  }

  /** Create an SVG element in the SVG namespace. */
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS_SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  }

  /** Build the toolbar SVG icon entirely via DOM APIs. */
  function buildIcon() {
    const svg = svgEl('svg', { width:22, height:22, viewBox:'0 0 22 22', fill:'none' });
    app(svg,
      app(svgEl('rect', { x:2.5, y:9.5, width:17, height:3, rx:1.5, fill:'white', 'fill-opacity':0.2 })),
      app(svgEl('rect', { x:2.5, y:9.5, width:7,  height:3, rx:1.5, fill:'white', 'fill-opacity':0.55 })),
      svgEl('line', { x1:7,  y1:7, x2:7,  y2:15, stroke:'white', 'stroke-width':1.8, 'stroke-linecap':'round' }),
      svgEl('line', { x1:15, y1:7, x2:15, y2:15, stroke:'white', 'stroke-width':1.8, 'stroke-linecap':'round' }),
      svgEl('circle', { cx:11, cy:11, r:2, fill:'white' })
    );
    return svg;
  }

  /** Build the "Full video" mode button SVG. */
  function buildSvgFull() {
    const svg = svgEl('svg', { width:13, height:13, viewBox:'0 0 13 13', fill:'none' });
    app(svg,
      svgEl('path', { d:'M6.5 2 A4.5 4.5 0 1 1 2 6.5', stroke:'currentColor', 'stroke-width':1.4, 'stroke-linecap':'round', fill:'none' }),
      svgEl('polyline', { points:'2,4 2,6.5 4.5,6.5', stroke:'currentColor', 'stroke-width':1.4, 'stroke-linecap':'round', 'stroke-linejoin':'round', fill:'none' })
    );
    return svg;
  }

  /** Build the "A→B" mode button SVG. */
  function buildSvgAB() {
    const svg = svgEl('svg', { width:13, height:13, viewBox:'0 0 13 13', fill:'none' });
    app(svg,
      svgEl('rect', { x:1, y:4, width:4, height:5, rx:1, stroke:'currentColor', 'stroke-width':1.3, fill:'none' }),
      svgEl('rect', { x:8, y:4, width:4, height:5, rx:1, stroke:'currentColor', 'stroke-width':1.3, fill:'none' }),
      svgEl('line', { x1:5, y1:6.5, x2:8, y2:6.5, stroke:'currentColor', 'stroke-width':1.3, 'stroke-dasharray':'1 1.2' })
    );
    return svg;
  }

  /**
   * Make a point card (A or B).
   * Returns { card, val, setBtn, clrBtn }.
   */
  function buildCard(label, valId, setId, clrId, cardId) {
    const card   = el('div', 'abl-card', cardId);
    const cardL  = el('div', 'abl-card-l');
    const badge  = el('div', 'abl-badge');
    badge.textContent = label;
    const val    = el('span', 'abl-time', valId);
    val.textContent   = EMPTY;
    app(cardL, badge, val);

    const cardR  = el('div', 'abl-card-r');
    const setBtn = el('button', 'abl-set', setId);
    setBtn.textContent = 'Set';
    const clrBtn = el('button', 'abl-clr', clrId);
    clrBtn.textContent = '✕';
    app(cardR, setBtn, clrBtn);

    app(card, cardL, cardR);
    return { card, val, setBtn, clrBtn };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  6.  PANEL HTML
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build the entire panel using pure DOM APIs — zero HTML string parsing.
   * Returns { panel, refs } where refs is the same shape as collectRefs().
   */
  function buildPanel() {
    // ── Header ──────────────────────────────────────────────────────────────
    const header    = el('div', 'abl-header');
    const title     = el('span', 'abl-title');
    title.textContent = 'A / B Loop';
    const toggle    = el('div', 'abl-toggle', 'abl-toggle');
    const pill      = el('div', 'abl-pill');
    const toggleLbl = el('span', 'abl-toggle-lbl');
    toggleLbl.textContent = 'Loop off';
    app(toggle, pill, toggleLbl);
    app(header, title, toggle);

    // ── Mode selector ────────────────────────────────────────────────────────
    const modes    = el('div', 'abl-modes');
    const modeFull = el('button', 'abl-mode', 'abl-mode-full');
    app(modeFull, buildSvgFull(), txt(' Full video'));
    const modeAB   = el('button', 'abl-mode sel', 'abl-mode-ab');
    app(modeAB, buildSvgAB(), txt(' A → B'));
    app(modes, modeFull, modeAB);

    // ── A / B cards ──────────────────────────────────────────────────────────
    const cardAEls = buildCard('A', 'abl-va', 'abl-sa', 'abl-xa', 'abl-ca');
    const cardBEls = buildCard('B', 'abl-vb', 'abl-sb', 'abl-xb', 'abl-cb');
    const pts      = el('div', 'abl-pts');
    app(pts, cardAEls.card, cardBEls.card);

    // ── Mini timeline ────────────────────────────────────────────────────────
    const prog  = el('div', 'abl-prog',  'abl-prog');
    const range = el('div', 'abl-range', 'abl-range');
    const rail  = el('div', 'abl-rail',  'abl-rail');
    app(rail, prog, range);
    const thA   = el('div', 'abl-th abl-th-ab',   'abl-tha');
    const thB   = el('div', 'abl-th abl-th-ab',   'abl-thb');
    const thPlay= el('div', 'abl-th abl-th-play',  'abl-thp');
    const track = el('div', 'abl-track');
    app(track, rail, thA, thB, thPlay);

    const timesRow = el('div', 'abl-times');
    const t0 = el('span'); t0.textContent = '0:00';
    const tEnd = el('span', '', 'abl-tend'); tEnd.textContent = EMPTY;
    app(timesRow, t0, tEnd);

    const ab = el('div', 'abl-ab', 'abl-ab');
    app(ab, pts, track, timesRow);

    // ── Footer ───────────────────────────────────────────────────────────────
    const hints  = el('div', 'abl-hints');
    const hintA  = el('div', 'abl-hint');
    const kbdA   = el('span', 'abl-kbd'); kbdA.textContent = 'A';
    app(hintA, kbdA, txt(' Point A'));
    const hintB  = el('div', 'abl-hint');
    const kbdB   = el('span', 'abl-kbd'); kbdB.textContent = 'B';
    app(hintB, kbdB, txt(' Point B'));
    app(hints, hintA, hintB);
    const resetBtn = el('button', 'abl-reset', 'abl-reset');
    resetBtn.textContent = 'Reset';
    const footer = el('div', 'abl-footer', 'abl-footer');
    app(footer, hints, resetBtn);

    // ── Update banner ────────────────────────────────────────────────────────
    const updateBar  = el('div', 'abl-update', 'abl-update');
    const updateTxt  = el('span', 'abl-update-txt');
    const updateStrong = el('strong', '', 'abl-uver');
    app(updateTxt, txt('Update available: '), updateStrong);
    const updateLink = el('a', 'abl-update-lnk');
    updateLink.href   = UPDATE_URL;
    updateLink.target = '_blank';
    updateLink.rel    = 'noopener';
    updateLink.textContent = 'Install';
    app(updateBar, updateTxt, updateLink);

    // ── Assemble panel ───────────────────────────────────────────────────────
    const panel = el('div', 'abl-panel');
    app(panel, header, modes, ab, footer, updateBar);

    // Return panel + all refs (same shape as collectRefs() was expecting)
    const refs = {
      toggle, toggleLbl, modeFull, modeAB, ab, footer,
      cardA: cardAEls.card, cardB: cardBEls.card,
      valA:  cardAEls.val,  valB:  cardBEls.val,
      setA:  cardAEls.setBtn, setB: cardBEls.setBtn,
      clrA:  cardAEls.clrBtn, clrB: cardBEls.clrBtn,
      rail, prog, range, thA, thB, thPlay, tEnd,
      updateBar, updateVer: updateStrong,
      resetBtn,
    };
    return { panel, refs };
  }




  // ═══════════════════════════════════════════════════════════════════════════
  //  7.  SESSION  — all state for a single watch-page lifetime
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} Session
   * @property {HTMLVideoElement} video
   * @property {HTMLButtonElement} btn
   * @property {HTMLElement} panel
   * @property {Object} r  - DOM refs from collectRefs()
   * @property {number|null} ptA
   * @property {number|null} ptB
   * @property {boolean} loopOn
   * @property {'ab'|'full'} mode
   * @property {boolean} open      - panel visibility
   * @property {Function|null} drag - active drag callback
   * @property {number|null} raf
   * // render cache
   * @property {number} _pct
   * @property {number} _dur
   * @property {number} _lo
   * @property {number} _hi
   */
  function mkSession(video, btn, panel, r) {
    return {
      video, btn, panel, r,
      ptA: null, ptB: null,
      loopOn: false, mode: 'ab',
      open: false, drag: null, raf: null,
      // All document/window listeners register against this signal so a single
      // controller.abort() in teardown() removes them — prevents leak across
      // SPA navigations.
      ac: new AbortController(),
      _pct: -1, _dur: -1, _lo: -1, _hi: -1,
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  8.  POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set point A or B to an explicit time (seconds). Shared by Set/drag/edit. */
  function applyPoint(s, ab, t) {
    if (ab === 'a') {
      s.ptA = t;
      s.r.valA.textContent = fmt(t);
      s.r.cardA.classList.add('set');
      s.r.thA.classList.add('vis');
    } else {
      s.ptB = t;
      s.r.valB.textContent = fmt(t);
      s.r.cardB.classList.add('set');
      s.r.thB.classList.add('vis');
    }
    s._lo = s._hi = -1; // invalidate range cache
  }

  /** Set a point to the video's current playback position. */
  function setPoint(s, ab) {
    applyPoint(s, ab, s.video.currentTime);
  }

  function clrPoint(s, ab) {
    if (ab === 'a') {
      s.ptA = null;
      s.r.valA.textContent = EMPTY;
      s.r.cardA.classList.remove('set');
      s.r.thA.classList.remove('vis');
    } else {
      s.ptB = null;
      s.r.valB.textContent = EMPTY;
      s.r.cardB.classList.remove('set');
      s.r.thB.classList.remove('vis');
    }
    s._lo = s._hi = -1;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  9.  RENDER LOOP  (RAF — runs once per animation frame)
  // ═══════════════════════════════════════════════════════════════════════════

  function frame(s) {
    try {
      const { video: v, r } = s;
      const dur = v.duration || 0;
      const both = s.ptA !== null && s.ptB !== null;

      // ── Timeline visuals — skipped while the panel is closed ───────────────
      if (s.open) {
        // Duration label — written once per video
        if (dur !== s._dur) {
          r.tEnd.textContent = fmt(dur);
          s._dur = dur;
        }

        // Playhead position
        const pct = dur ? (v.currentTime / dur) * 100 : 0;
        if (pct !== s._pct) {
          r.prog.style.width   = pct + '%';
          r.thPlay.style.left  = pct + '%';
          s._pct = pct;
        }

        // A / B thumb positions (only when the point is set and duration known)
        if (s.ptA !== null && dur) r.thA.style.left = (s.ptA / dur * 100) + '%';
        if (s.ptB !== null && dur) r.thB.style.left = (s.ptB / dur * 100) + '%';

        // A→B highlight range (redrawn only when boundaries change)
        if (s.mode === 'ab' && both && dur) {
          const lo = Math.min(s.ptA, s.ptB);
          const hi = Math.max(s.ptA, s.ptB);
          if (lo !== s._lo || hi !== s._hi) {
            r.range.style.left  = (lo / dur * 100) + '%';
            r.range.style.width = ((hi - lo) / dur * 100) + '%';
            r.range.classList.add('on');
            s._lo = lo; s._hi = hi;
          }
        } else if (r.range.classList.contains('on')) {
          r.range.classList.remove('on');
          s._lo = s._hi = -1;
        }
      }

      // ── Loop enforcement — always runs, panel open or not ──────────────────
      if (s.loopOn) {
        if (s.mode === 'ab' && both) {
          const lo = Math.min(s.ptA, s.ptB);
          const hi = Math.max(s.ptA, s.ptB);
          if (v.currentTime >= hi || v.currentTime < lo) v.currentTime = lo;
        } else if (s.mode === 'full' && dur > 0) {
          // YouTube suppresses the `ended` event after the first replay.
          // Poll currentTime directly instead — reliable on every loop.
          if (v.ended || v.currentTime >= dur - 0.3) {
            v.currentTime = 0;
            v.play().catch(() => {});
          }
        }
      }
    } catch { /* keep RAF alive even on transient errors */ }

    s.raf = requestAnimationFrame(() => frame(s));
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  10.  WIRING  — one function per UI concern
  // ═══════════════════════════════════════════════════════════════════════════

  function wirePanel(s) {
    s.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      s.open = !s.open;
      s.panel.classList.toggle('open', s.open);
      s.btn.classList.toggle('active', s.open || s.loopOn);
      // Force the next frame to redraw the timeline (visuals are skipped while
      // the panel is closed, so caches may be stale on reopen).
      if (s.open) s._pct = s._dur = s._lo = s._hi = -1;
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (s.open && !s.panel.contains(e.target) && e.target !== s.btn) {
        s.open = false;
        s.panel.classList.remove('open');
        s.btn.classList.toggle('active', s.loopOn);
      }
    }, { signal: s.ac.signal });
  }

  function wireToggle(s) {
    s.r.toggle.addEventListener('click', () => {
      s.loopOn = !s.loopOn;
      s.r.toggle.classList.toggle('on', s.loopOn);
      s.r.toggleLbl.textContent = s.loopOn ? 'Loop on' : 'Loop off';
      s.btn.classList.toggle('active', s.loopOn || s.open);
      // Disable YouTube's native loop so our RAF loop has full control
      if (s.loopOn) s.video.loop = false;
    });
  }

  /** Returns `setMode` so Reset can reuse it. */
  function wireMode(s) {
    function setMode(m) {
      s.mode = m;
      const ab = m === 'ab';
      s.r.modeFull.classList.toggle('sel', !ab);
      s.r.modeAB.classList.toggle('sel',    ab);
      s.r.ab.classList.toggle('hidden',    !ab);
      s.r.footer.classList.toggle('hidden', !ab);
    }
    s.r.modeFull.addEventListener('click', () => setMode('full'));
    s.r.modeAB.addEventListener('click',   () => setMode('ab'));
    return setMode;
  }

  function wirePoints(s, setMode) {
    s.r.setA.addEventListener('click', () => setPoint(s, 'a'));
    s.r.setB.addEventListener('click', () => setPoint(s, 'b'));
    s.r.clrA.addEventListener('click', () => clrPoint(s, 'a'));
    s.r.clrB.addEventListener('click', () => clrPoint(s, 'b'));
    s.r.resetBtn.addEventListener('click', () => {
      clrPoint(s, 'a'); clrPoint(s, 'b');
      s.loopOn = false;
      s.r.toggle.classList.remove('on');
      s.r.toggleLbl.textContent = 'Loop off';
      s.btn.classList.remove('active');
      setMode('ab');
    });
  }

  function wireTimeline(s) {
    const { r, video: v } = s;

    function frac(clientX) {
      const rect = r.rail.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function draggable(el, cb) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        s.drag = cb;
      });
    }

    draggable(r.thA, (x) => applyPoint(s, 'a', frac(x) * (v.duration || 0)));
    draggable(r.thB, (x) => applyPoint(s, 'b', frac(x) * (v.duration || 0)));
    draggable(r.thPlay, (x) => {
      if (v.duration) v.currentTime = frac(x) * v.duration;
    });

    document.addEventListener('mousemove', (e) => { if (s.drag) s.drag(e.clientX); }, { signal: s.ac.signal });
    document.addEventListener('mouseup',   ()  => { s.drag = null; }, { signal: s.ac.signal });

    r.rail.addEventListener('click', (e) => {
      if (!s.drag && v.duration) v.currentTime = frac(e.clientX) * v.duration;
    });
  }

  /**
   * Click a point's time label → edit it in place as "m:ss" / "h:mm:ss".
   * Enter / blur commits (clamped to [0, duration]); Escape or invalid reverts.
   * Empty input commits as a cleared point.
   */
  function wireTimeEdit(s) {
    const { r } = s;

    function spanOf(ab)  { return ab === 'a' ? r.valA : r.valB; }
    function timeOf(ab)  { return ab === 'a' ? s.ptA  : s.ptB; }

    function revert(ab) {
      const cur = timeOf(ab);
      spanOf(ab).textContent = cur !== null ? fmt(cur) : EMPTY;
    }

    function edit(ab) {
      const span = spanOf(ab);
      if (span.querySelector('input')) return; // already editing
      const cur = timeOf(ab);

      const input = el('input', 'abl-time-input');
      input.type        = 'text';
      input.value       = cur !== null ? fmt(cur) : '';
      input.placeholder = 'm:ss';
      span.textContent  = '';
      span.appendChild(input);
      input.focus();
      input.select();

      let done = false;
      function finish(commit) {
        if (done) return;
        done = true;
        if (commit) {
          const raw = input.value.trim();
          if (raw === '') { clrPoint(s, ab); return; }
          const secs = parseTime(raw);
          if (secs !== null) {
            const dur = s.video.duration || 0;
            const t = dur ? Math.min(secs, dur) : secs;
            applyPoint(s, ab, Math.max(0, t));
            return;
          }
          // invalid format → fall through to revert
        }
        revert(ab);
      }

      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // don't trigger A/B shortcuts or YouTube hotkeys
        if (e.key === 'Enter')       { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur',  () => finish(true));
      input.addEventListener('click', (e) => e.stopPropagation());
    }

    r.valA.style.cursor = 'pointer';
    r.valB.style.cursor = 'pointer';
    r.valA.addEventListener('click', () => edit('a'));
    r.valB.addEventListener('click', () => edit('b'));
  }

  function wireKeyboard(s) {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'a' || e.key === 'A') setPoint(s, 'a');
      if (e.key === 'b' || e.key === 'B') setPoint(s, 'b');
    }, { signal: s.ac.signal });
  }

  function wireUpdate(r) {
    xhrGet(UPDATE_URL, (text) => {
      try {
        const m = text.match(/@version\s+([\d.]+)/);
        if (m && semverGt(VERSION, m[1])) {
          r.updateVer.textContent = `v${m[1]}`;
          r.updateBar.classList.add('show');
        }
      } catch { /* ignore */ }
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  11.  PLAYER READINESS CHECK
  //
  //  Minimal: only requires .ytp-right-controls to exist in the live DOM.
  //  Does NOT require video.duration > 0 — autoplay may be blocked (Helium).
  //  Does NOT require #movie_player — selector may differ in some layouts.
  // ═══════════════════════════════════════════════════════════════════════════

  function playerReady() {
    try {
      return !!(
        document.querySelector('.ytp-right-controls') &&
        document.querySelector('video')
      );
    } catch {
      return false;
    }
  }

  /** Resolve controls, player container and video element robustly. */
  function getPlayerEls() {
    const controls = document.querySelector('.ytp-right-controls');
    const player   =
      document.querySelector('#movie_player') ||
      (controls && controls.closest('.html5-video-player')) ||
      (controls && controls.parentElement);
    const video    = document.querySelector('video');
    if (!controls || !player || !video) return null;
    return { controls, player, video };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  12.  INJECT  — mount everything onto the current page
  // ═══════════════════════════════════════════════════════════════════════════

  /** @type {Session|null} */
  let session = null;

  function inject() {
    if (session) return;
    const els = getPlayerEls();
    if (!els) return;
    const { controls, player, video } = els;

    // Stylesheet — injected once, survives SPA navigations
    if (!document.querySelector('#abl-css')) {
      const style = document.createElement('style');
      style.id = 'abl-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // Toolbar button — pure DOM, zero string parsing (Trusted Types safe)
    const btn = el('button', 'abl-btn ytp-button');
    btn.title = 'A/B Loop';
    btn.appendChild(buildIcon());
    const dot = el('span', 'abl-dot');
    btn.appendChild(dot);

    // Panel — built entirely via DOM APIs (Trusted Types safe)
    const { panel, refs: r } = buildPanel();

    // Mount
    try { controls.insertBefore(btn, controls.firstChild); }
    catch { controls.appendChild(btn); }

    player.style.position = 'relative';
    player.appendChild(panel);
    const s = mkSession(video, btn, panel, r);
    session = s;

    const setMode = wireMode(s);
    wirePanel(s);
    wireToggle(s);
    wirePoints(s, setMode);
    wireTimeline(s);
    wireTimeEdit(s);
    wireKeyboard(s);
    requestAnimationFrame(() => frame(s));
    wireUpdate(r);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  13.  TEARDOWN  — clean up before a SPA navigation
  // ═══════════════════════════════════════════════════════════════════════════

  function teardown() {
    if (!session) return;
    try { cancelAnimationFrame(session.raf); } catch { /* ignore */ }
    try { session.ac.abort(); }               catch { /* ignore */ }
    try { session.btn.remove(); }             catch { /* ignore */ }
    try { session.panel.remove(); }           catch { /* ignore */ }
    session = null;
    polls   = 0;
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  14.  POLLING + DOM WATCHER  — get the button in as soon as controls appear
  //
  //  Two complementary strategies run in parallel:
  //
  //  A) MutationObserver on <body> — fires the instant .ytp-right-controls is
  //     added to the DOM. Zero polling overhead, immediate reaction.
  //     Works in all managers that share the same DOM (every Chromium manager).
  //
  //  B) setTimeout polling — reliable fallback when the observer is set up
  //     after the controls already exist, or the observer fires too early.
  // ═══════════════════════════════════════════════════════════════════════════

  let polls = 0;
  let domObserver = null;

  function tryInject() {
    if (session) return;
    if (polls++ > MAX_POLLS) return;
    if (playerReady()) {
      inject();
    } else {
      setTimeout(tryInject, POLL_MS);
    }
  }

  /** Watch the DOM for .ytp-right-controls to appear, then inject immediately. */
  function watchForControls() {
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
    const target = document.body || document.documentElement;
    domObserver = new MutationObserver(() => {
      if (session || !playerReady()) return;
      domObserver.disconnect();
      domObserver = null;
      inject();
    });
    domObserver.observe(target, { childList: true, subtree: true });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  15.  SPA NAVIGATION DETECTION  — 3 independent layers, deduplicated
  //
  //  Layer 1 — yt-navigate-finish on document + window (fastest, YouTube native)
  //  Layer 2 — setInterval URL poll (100 % reliable regardless of world context)
  //  Layer 3 — MutationObserver on <title> (lightweight secondary fallback)
  //
  //  All 3 funnel into onNav(), which is debounced so rapid concurrent firings
  //  (all 3 layers triggering within milliseconds) result in a single teardown.
  // ═══════════════════════════════════════════════════════════════════════════

  let _navTimer = null;

  function onNav() {
    // Debounce: collapse multiple simultaneous triggers into one
    if (_navTimer) return;
    _navTimer = setTimeout(() => {
      _navTimer = null;
      teardown();
      if (location.pathname.startsWith('/watch')) {
        setTimeout(() => { watchForControls(); tryInject(); }, NAV_DELAY_MS);
      }
    }, 50);
  }

  // Layer 1
  document.addEventListener('yt-navigate-finish', onNav);
  window.addEventListener('yt-navigate-finish',   onNav);

  // Layer 2 — URL polling
  let _lastHref = location.href;
  setInterval(() => {
    if (location.href !== _lastHref) {
      _lastHref = location.href;
      onNav();
    }
  }, URL_CHECK_MS);

  // Layer 3 — <title> observer
  (function watchTitle() {
    const el = document.querySelector('title');
    if (!el) { setTimeout(watchTitle, 400); return; }
    let _last = location.href;
    new MutationObserver(() => {
      if (location.href === _last) return;
      _last = location.href;
      onNav();
    }).observe(el, { childList: true });
  })();


  // ═══════════════════════════════════════════════════════════════════════════
  //  16.  BOOT
  // ═══════════════════════════════════════════════════════════════════════════

  // Start DOM watcher first (catches controls appearing), then poll as fallback
  watchForControls();
  tryInject();

})();