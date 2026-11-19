// =============================================================================
// Warm pixel-art CSS theme for the whole DOM UI. Injected once by UIManager.
// No external fonts/assets: everything is procedural DOM + CSS.
// =============================================================================
export const UI_STYLES = `
:root {
  --acg-ink: #171320;
  --acg-ink-soft: #1d1826;
  --acg-panel: #221c2bee;
  --acg-panel-solid: #241e2e;
  --acg-panel-deep: #191420;
  --acg-panel-raised: #2c2439;
  --acg-border: #4c3f5a;
  --acg-border-bright: #7a6390;
  --acg-border-dim: #362e42;
  --acg-text: #f0e6d2;
  --acg-text-dim: #c4b79f;
  --acg-text-muted: #918473;
  --acg-amber: #e0b060;
  --acg-amber-bright: #f2c878;
  --acg-ember: #ff8a3c;
  --acg-ember-deep: #c85a24;
  --acg-green: #a8c98a;
  --acg-green-deep: #5f7a4a;
  --acg-red: #e08a7a;
  --acg-red-deep: #8a4a3c;
  --acg-blue: #8fc4e0;
  --acg-purple: #c8a8d8;
  --acg-shadow: 0 10px 30px #000000b8;
  --acg-font: 'Courier New', 'Lucida Console', 'Consolas', monospace;
}

#ui-root {
  font-family: var(--acg-font);
  color: var(--acg-text);
  font-size: 12px;
  line-height: 1.45;
  letter-spacing: 0.2px;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: none;
  image-rendering: pixelated;
}

#ui-root *,
#ui-root *::before,
#ui-root *::after {
  box-sizing: border-box;
}

#ui-root button,
#ui-root input,
#ui-root select,
#ui-root textarea {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

#ui-root .ui-interactive,
#ui-root button,
#ui-root input,
#ui-root select,
#ui-root textarea,
#ui-root .ui-panel,
#ui-root .ui-modal,
#ui-root .ui-toast,
#ui-root .ui-menu {
  pointer-events: auto;
}

#ui-root ::selection {
  background: var(--acg-amber);
  color: var(--acg-ink);
}

/* Scrollbars ------------------------------------------------------------- */
#ui-root .ui-panel-scroll,
#ui-root .ui-scroll,
#ui-root .ui-modal {
  scrollbar-width: thin;
  scrollbar-color: var(--acg-border-bright) var(--acg-panel-deep);
}
#ui-root .ui-panel-scroll::-webkit-scrollbar,
#ui-root .ui-scroll::-webkit-scrollbar,
#ui-root .ui-modal::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
#ui-root .ui-panel-scroll::-webkit-scrollbar-track,
#ui-root .ui-scroll::-webkit-scrollbar-track,
#ui-root .ui-modal::-webkit-scrollbar-track {
  background: var(--acg-panel-deep);
}
#ui-root .ui-panel-scroll::-webkit-scrollbar-thumb,
#ui-root .ui-scroll::-webkit-scrollbar-thumb,
#ui-root .ui-modal::-webkit-scrollbar-thumb {
  background: var(--acg-border);
  border: 1px solid var(--acg-border-bright);
}

/* HUD -------------------------------------------------------------------- */
#ui-root .ui-hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: stretch;
  padding: 8px 10px 2px;
  pointer-events: none;
  background: linear-gradient(180deg, #171320e8 0%, #171320aa 62%, #17132000 100%);
  z-index: 20;
  transition: opacity 180ms ease-out;
}
#ui-root .ui-hud.ui-hidden { opacity: 0; }
#ui-root .ui-hud-block {
  position: relative;
  background: linear-gradient(180deg, #2a2336f2, #1d1826f2);
  border: 1px solid var(--acg-border);
  box-shadow: inset 0 1px 0 #ffffff14, inset 0 -1px 0 #00000055, 2px 2px 0 #0b0810aa;
  border-radius: 4px;
  padding: 6px 10px;
  min-height: 58px;
}
#ui-root .ui-hud-block.ui-hud-cigar { width: 300px; flex: 0 0 auto; }
#ui-root .ui-hud-block.ui-hud-place { flex: 1 1 auto; min-width: 220px; }
#ui-root .ui-hud-block.ui-hud-purse { flex: 0 0 auto; text-align: right; min-width: 168px; }
#ui-root .ui-hud-label {
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--acg-text-muted);
}
#ui-root .ui-hud-title {
  font-size: 14px;
  color: var(--acg-amber-bright);
  letter-spacing: 1px;
  text-shadow: 0 1px 0 #000;
}
#ui-root .ui-hud-location {
  font-size: 15px;
  color: var(--acg-text);
  margin-top: 1px;
}
#ui-root .ui-hud-location small { color: var(--acg-text-muted); font-size: 10px; letter-spacing: 1px; }
#ui-root .ui-hud-sub {
  font-size: 10px;
  color: var(--acg-text-dim);
  margin-top: 2px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
#ui-root .ui-hud-sub .sep { color: var(--acg-border-bright); }
#ui-root .ui-hud-money {
  font-size: 18px;
  color: var(--acg-amber-bright);
  letter-spacing: 1px;
  text-shadow: 0 1px 0 #000, 0 0 12px #e0b06033;
}
#ui-root .ui-hud-hint {
  margin-top: 3px;
  font-size: 9px;
  color: var(--acg-text-muted);
  letter-spacing: 0.5px;
}
#ui-root .ui-hud-keys { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
#ui-root .ui-hud-key {
  border: 1px solid var(--acg-border);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 9px;
  color: var(--acg-text-muted);
  background: #17132080;
}
#ui-root .ui-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }

/* Cigarette visual ------------------------------------------------------- */
#ui-root .ui-cigarette {
  position: relative;
  height: 22px;
  margin-top: 5px;
  display: flex;
  align-items: flex-end;
  border-radius: 3px;
  background: #120f16;
  border: 1px solid var(--acg-border-dim);
  box-shadow: inset 0 2px 6px #000000b0;
  overflow: hidden;
}
#ui-root .ui-cigarette-body {
  position: relative;
  height: 16px;
  align-self: center;
  border-radius: 2px 0 0 2px;
  transition: width 450ms linear;
  background-size: 8px 8px;
}
#ui-root .ui-cigarette-filter {
  position: absolute;
  right: 0;
  top: 3px;
  bottom: 3px;
  width: 17%;
  min-width: 22px;
  border-radius: 0 2px 2px 0;
  border-left: 1px solid #00000066;
  box-shadow: inset -2px 0 3px #00000055;
}
#ui-root .ui-cigarette-ash {
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 8px;
  background: linear-gradient(90deg, #6f6a63, #3c3835);
  border-radius: 2px 0 0 2px;
  opacity: 0.85;
}
#ui-root .ui-cigarette-moisture {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(180deg, #4a7a9488, #2a5a7855);
  pointer-events: none;
  transition: width 450ms linear;
}
#ui-root .ui-cigarette-ember {
  position: absolute;
  top: 3px;
  bottom: 3px;
  width: 7px;
  margin-left: -3px;
  border-radius: 3px;
  background: radial-gradient(circle at 50% 45%, #ffd27a, var(--acg-ember) 55%, #5a1a08 100%);
  box-shadow: 0 0 8px #ff8a3cbb, 0 0 16px #ff8a3c66;
  animation: ui-ember-pulse 1.6s ease-in-out infinite;
}
#ui-root .ui-cigarette-ember::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 100%;
  width: 5px;
  height: 12px;
  transform: translateX(-50%);
  background: linear-gradient(0deg, #ffffff55, transparent);
  filter: blur(1px);
  animation: ui-smoke 2.4s ease-out infinite;
  opacity: 0;
}
#ui-root .ui-cigarette-pattern-stripe .ui-cigarette-body { background-image: repeating-linear-gradient(45deg, #ffffff22 0 2px, transparent 2px 6px); }
#ui-root .ui-cigarette-pattern-dots .ui-cigarette-body { background-image: radial-gradient(#ffffff33 1px, transparent 1px); background-size: 6px 6px; }
#ui-root .ui-cigarette-pattern-zigzag .ui-cigarette-body { background-image: linear-gradient(135deg, #ffffff22 25%, transparent 25%, transparent 75%, #ffffff22 75%); background-size: 8px 8px; }
#ui-root .ui-cigarette-face {
  position: absolute;
  right: 26%;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  filter: drop-shadow(0 1px 1px #000);
}
@keyframes ui-ember-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; box-shadow: 0 0 10px #ff8a3cdd, 0 0 22px #ff8a3c88; }
}
@keyframes ui-smoke {
  0% { opacity: 0; transform: translate(-50%, 0) scaleX(1); }
  20% { opacity: 0.5; }
  100% { opacity: 0; transform: translate(-50%, -16px) scaleX(2.4); }
}

/* Badges & chips --------------------------------------------------------- */
#ui-root .ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  font-size: 9px;
  letter-spacing: 0.5px;
  border-radius: 2px;
  border: 1px solid var(--acg-border);
  background: #17132099;
  color: var(--acg-text-dim);
  white-space: nowrap;
}
#ui-root .ui-badge-ok { border-color: var(--acg-green-deep); color: var(--acg-green); background: #2a3a2444; }
#ui-root .ui-badge-warn { border-color: #8a6a3a; color: var(--acg-amber); background: #3a2e1a55; }
#ui-root .ui-badge-bad { border-color: var(--acg-red-deep); color: var(--acg-red); background: #3a1e1a55; }
#ui-root .ui-badge-accent { border-color: #8a6a3a; color: var(--acg-amber-bright); background: #3a2e1a66; }
#ui-root .ui-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  font-size: 10px;
  border: 1px solid var(--acg-border);
  border-radius: 3px;
  background: var(--acg-panel-deep);
  color: var(--acg-text-dim);
}
#ui-root .ui-chip-ok { color: var(--acg-green); border-color: var(--acg-green-deep); }
#ui-root .ui-chip-warn { color: var(--acg-amber); border-color: #8a6a3a; }
#ui-root .ui-chip-bad { color: var(--acg-red); border-color: var(--acg-red-deep); }
#ui-root .ui-chip-accent { color: var(--acg-amber-bright); border-color: #8a6a3a; }

/* Buttons ---------------------------------------------------------------- */
#ui-root .ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
  padding: 4px 10px;
  margin: 1px 0;
  color: var(--acg-text);
  background: linear-gradient(180deg, #3a3049, #2a2336);
  border: 1px solid var(--acg-border-bright);
  border-radius: 3px;
  box-shadow: 0 1px 0 #ffffff18 inset, 0 -2px 0 #00000044 inset, 1px 2px 0 #0b0810aa;
  transition: background 120ms ease-out, transform 80ms ease-out, border-color 120ms ease-out;
  text-align: center;
  line-height: 1.3;
}
#ui-root .ui-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #4a3d5e, #352b45);
  border-color: var(--acg-amber);
  color: var(--acg-amber-bright);
}
#ui-root .ui-button:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 0 #00000055 inset; }
#ui-root .ui-button:focus-visible {
  outline: 2px solid var(--acg-amber);
  outline-offset: 1px;
}
#ui-root .ui-button:disabled,
#ui-root .ui-button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.42;
  filter: grayscale(0.5);
}
#ui-root .ui-button-primary {
  background: linear-gradient(180deg, #7a5a2e, #4a351c);
  border-color: var(--acg-amber);
  color: #ffeccc;
}
#ui-root .ui-button-primary:hover:not(:disabled) { background: linear-gradient(180deg, #9a7038, #5c4224); }
#ui-root .ui-button-danger { border-color: var(--acg-red-deep); color: var(--acg-red); }
#ui-root .ui-button-danger:hover:not(:disabled) { border-color: var(--acg-red); color: #ffb0a0; }
#ui-root .ui-button-small { padding: 2px 7px; font-size: 10px; }
#ui-root .ui-button-icon {
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}
#ui-root .ui-link {
  background: none;
  border: none;
  box-shadow: none;
  color: var(--acg-blue);
  text-decoration: underline;
  padding: 0 2px;
  margin: 0;
}
#ui-root .ui-link:hover { color: var(--acg-amber-bright); background: none; border: none; }

/* Inputs ---------------------------------------------------------------- */
#ui-root .ui-input,
#ui-root .ui-select,
#ui-root .ui-textarea {
  background: #151119;
  border: 1px solid var(--acg-border);
  border-radius: 3px;
  color: var(--acg-text);
  padding: 3px 6px;
  min-width: 0;
  box-shadow: inset 0 1px 3px #00000088;
}
#ui-root .ui-input:focus-visible,
#ui-root .ui-select:focus-visible,
#ui-root .ui-textarea:focus-visible {
  outline: 2px solid var(--acg-amber);
  outline-offset: 1px;
  border-color: var(--acg-amber);
}
#ui-root .ui-input[type='range'] {
  appearance: none;
  -webkit-appearance: none;
  height: 18px;
  padding: 0;
  background: transparent;
  box-shadow: none;
  border: none;
  accent-color: var(--acg-amber);
}
#ui-root .ui-input[type='range']::-webkit-slider-runnable-track {
  height: 6px;
  background: #151119;
  border: 1px solid var(--acg-border);
  border-radius: 3px;
}
#ui-root .ui-input[type='range']::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 16px;
  margin-top: -6px;
  background: linear-gradient(180deg, var(--acg-amber-bright), var(--acg-ember-deep));
  border: 1px solid #00000088;
  border-radius: 2px;
}
#ui-root .ui-input[type='color'] {
  width: 38px;
  height: 26px;
  padding: 1px;
  cursor: pointer;
}
#ui-root .ui-textarea {
  width: 100%;
  min-height: 90px;
  resize: vertical;
  font-size: 10px;
  line-height: 1.4;
}
#ui-root .ui-select { cursor: pointer; }
#ui-root .ui-input-error { border-color: var(--acg-red); }
#ui-root .ui-form-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  flex-wrap: wrap;
}
#ui-root .ui-label {
  min-width: 120px;
  color: var(--acg-text-dim);
  font-size: 11px;
}

/* Panels ---------------------------------------------------------------- */
#ui-root .ui-panel-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
}
#ui-root .ui-panel {
  position: absolute;
  top: 100px;
  right: 12px;
  bottom: 14px;
  width: min(600px, 48vw);
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #241e2ef8, #1b1623f8);
  border: 1px solid var(--acg-border-bright);
  border-radius: 5px;
  box-shadow: var(--acg-shadow), inset 0 1px 0 #ffffff14;
  pointer-events: auto;
  overflow: hidden;
  z-index: 31;
}
#ui-root .ui-panel::before {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1px solid #ffffff0a;
  border-radius: 3px;
  pointer-events: none;
}
#ui-root .ui-panel-left { right: auto; left: 12px; }
#ui-root .ui-panel-wide { width: min(900px, 74vw); }
#ui-root .ui-panel-narrow { width: min(460px, 42vw); }
#ui-root .ui-panel-full { width: min(1080px, 92vw); right: 4vw; }
#ui-root .ui-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(180deg, #342b44, #241d30);
  border-bottom: 1px solid var(--acg-border);
  box-shadow: 0 2px 0 #00000033;
  flex: 0 0 auto;
}
#ui-root .ui-panel-icon {
  font-size: 16px;
  line-height: 1;
  filter: drop-shadow(0 1px 0 #000);
}
#ui-root .ui-panel-title-wrap { flex: 1; min-width: 0; }
#ui-root .ui-panel-title {
  font-size: 14px;
  letter-spacing: 1.5px;
  color: var(--acg-amber-bright);
  text-transform: uppercase;
  text-shadow: 0 1px 0 #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#ui-root .ui-panel-subtitle {
  font-size: 9px;
  color: var(--acg-text-muted);
  letter-spacing: 0.6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#ui-root .ui-panel-close { flex: 0 0 auto; }
#ui-root .ui-panel-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 12px 26px;
  scrollbar-gutter: stable;
}
#ui-root .ui-panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#ui-root .ui-panel-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-bottom: 1px solid var(--acg-border-dim);
  background: #1b1623;
  flex: 0 0 auto;
}
#ui-root .ui-panel-error {
  margin: 0 12px;
  padding: 6px 8px;
  border: 1px solid var(--acg-red-deep);
  background: #3a1e1a55;
  color: var(--acg-red);
  border-radius: 3px;
  font-size: 11px;
}

/* Sections / rows / cards ------------------------------------------------ */
#ui-root .ui-section {
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  background: #201a2b99;
  box-shadow: inset 0 1px 0 #ffffff08;
  overflow: hidden;
}
#ui-root .ui-section-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 9px;
  background: linear-gradient(180deg, #2c2438, #231d2e);
  border-bottom: 1px solid var(--acg-border-dim);
}
#ui-root .ui-section-title {
  margin: 0;
  font-size: 11px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--acg-amber);
}
#ui-root .ui-section-hint {
  font-size: 9px;
  color: var(--acg-text-muted);
  margin-left: auto;
}
#ui-root .ui-section-body {
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
#ui-root .ui-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  font-size: 11px;
  min-width: 0;
}
#ui-root .ui-row-label { color: var(--acg-text-dim); }
#ui-root .ui-row-hint { color: var(--acg-text-muted); font-size: 9px; }
#ui-root .ui-row-value { margin-left: auto; color: var(--acg-text); text-align: right; }
#ui-root .ui-kv {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 0;
  font-size: 11px;
  border-bottom: 1px dashed #ffffff10;
}
#ui-root .ui-kv-key { color: var(--acg-text-muted); }
#ui-root .ui-kv-value { color: var(--acg-text); text-align: right; }
#ui-root .ui-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 6px; }
#ui-root .ui-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  background: #18131f;
  border: 1px solid var(--acg-border-dim);
  border-radius: 3px;
}
#ui-root .ui-stat-label { font-size: 9px; color: var(--acg-text-muted); text-transform: uppercase; letter-spacing: 1px; }
#ui-root .ui-stat-value { font-size: 15px; color: var(--acg-amber-bright); }
#ui-root .ui-stat-hint { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-card {
  background: linear-gradient(180deg, #251f30, #1d1826);
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#ui-root .ui-card.selected { border-color: var(--acg-amber); box-shadow: 0 0 0 1px var(--acg-amber) inset; }
#ui-root .ui-card-title { font-size: 12px; color: var(--acg-amber-bright); }
#ui-root .ui-card-sub { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-card-text { font-size: 10px; color: var(--acg-text-dim); line-height: 1.5; white-space: pre-wrap; }
#ui-root .ui-card-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
#ui-root .ui-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
#ui-root .ui-grid-tight { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 4px; }
#ui-root .ui-list { display: flex; flex-direction: column; gap: 2px; }
#ui-root .ui-list-item { font-size: 11px; color: var(--acg-text-dim); padding-left: 13px; position: relative; }
#ui-root .ui-list-item::before { content: '›'; position: absolute; left: 2px; color: var(--acg-ember); }
#ui-root .ui-empty { color: var(--acg-text-muted); font-size: 10px; font-style: italic; padding: 8px 2px; }

/* Tabs ------------------------------------------------------------------- */
#ui-root .ui-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 2px 0;
  border-bottom: 1px solid var(--acg-border-dim);
}
#ui-root .ui-tab {
  border: 1px solid var(--acg-border);
  border-radius: 3px 3px 0 0;
  border-bottom-color: transparent;
  background: linear-gradient(180deg, #2a2336, #1e1928);
  color: var(--acg-text-muted);
  font-size: 10px;
  letter-spacing: 0.8px;
  padding: 4px 9px;
}
#ui-root .ui-tab-active {
  color: var(--acg-amber-bright);
  border-color: var(--acg-border-bright);
  border-bottom-color: var(--acg-panel-solid);
  background: linear-gradient(180deg, #3d334e, #2a2336);
  box-shadow: 0 -1px 0 var(--acg-amber) inset;
}
#ui-root .ui-tab:hover { color: var(--acg-text); }

/* Bars ------------------------------------------------------------------- */
#ui-root .ui-bar {
  position: relative;
  height: 9px;
  flex: 1 1 auto;
  min-width: 60px;
  background: #120e17;
  border: 1px solid var(--acg-border-dim);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: inset 0 1px 2px #000000aa;
}
#ui-root .ui-bar-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #8a6a4a, var(--acg-amber));
  transition: width 220ms ease-out;
}
#ui-root .ui-bar-warn .ui-bar-fill { background: linear-gradient(90deg, #7a5a2a, var(--acg-amber)); }
#ui-root .ui-bar-bad .ui-bar-fill { background: linear-gradient(90deg, #6a2a24, var(--acg-red)); }
#ui-root .ui-bar-ok .ui-bar-fill { background: linear-gradient(90deg, #4a6a3a, var(--acg-green)); }
#ui-root .ui-bar-accent .ui-bar-fill { background: linear-gradient(90deg, #8a6a4a, var(--acg-amber-bright)); }
#ui-root .ui-bar-muted .ui-bar-fill { background: linear-gradient(90deg, #4a4152, #7a6a80); }
#ui-root .ui-labelled-bar { display: flex; flex-direction: column; gap: 2px; width: 100%; }
#ui-root .ui-labelled-bar-head { display: flex; justify-content: space-between; font-size: 10px; }
#ui-root .ui-labelled-bar-label { color: var(--acg-text-dim); }
#ui-root .ui-labelled-bar-value { color: var(--acg-text-muted); }
#ui-root .ui-progress-row { display: flex; align-items: center; gap: 8px; font-size: 10px; }
#ui-root .ui-progress-label { width: 96px; color: var(--acg-text-dim); flex: 0 0 auto; }
#ui-root .ui-progress-value { width: 66px; text-align: right; color: var(--acg-text-muted); flex: 0 0 auto; }

/* Toasts ----------------------------------------------------------------- */
#ui-root .ui-notify-layer {
  position: absolute;
  top: 104px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  width: min(560px, 80vw);
  pointer-events: none;
  z-index: 60;
}
#ui-root .ui-toast {
  max-width: 100%;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--acg-text);
  background: linear-gradient(180deg, #2a2336f5, #1d1826f5);
  border: 1px solid var(--acg-border-bright);
  border-left: 3px solid var(--acg-amber);
  border-radius: 3px;
  box-shadow: 0 6px 18px #000000aa;
  pointer-events: auto;
  cursor: pointer;
  animation: ui-toast-in 160ms ease-out;
}
#ui-root .ui-toast-success { border-left-color: var(--acg-green); color: #d8f0c0; }
#ui-root .ui-toast-warning { border-left-color: var(--acg-amber); color: #f0e0b8; }
#ui-root .ui-toast-error { border-left-color: var(--acg-red); color: #f0c0b0; }
#ui-root .ui-toast-info { border-left-color: var(--acg-blue); }
@keyframes ui-toast-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Modals ----------------------------------------------------------------- */
#ui-root .ui-modal-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 2vw;
  background: #0b0810c0;
  backdrop-filter: blur(2px);
  pointer-events: auto;
  z-index: 80;
}
#ui-root .ui-modal-layer.ui-hidden { display: none; }
#ui-root .ui-modal {
  width: min(760px, 94vw);
  max-height: 90vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #262031f8, #1a1522f8);
  border: 1px solid var(--acg-border-bright);
  border-radius: 6px;
  box-shadow: 0 24px 70px #000000dd, inset 0 1px 0 #ffffff14;
  padding: 16px 18px;
}
#ui-root .ui-modal-wide { width: min(1040px, 96vw); }
#ui-root .ui-modal-title {
  margin: 0 0 4px;
  font-size: 19px;
  letter-spacing: 2px;
  color: var(--acg-amber-bright);
  text-transform: uppercase;
  text-shadow: 0 2px 0 #000;
}
#ui-root .ui-modal-sub { font-size: 10px; color: var(--acg-text-muted); margin-bottom: 10px; }
#ui-root .ui-modal-inner { display: flex; flex-direction: column; gap: 8px; }
#ui-root .ui-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--acg-border-dim);
}

/* Main menu -------------------------------------------------------------- */
#ui-root .ui-menu-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 70;
  background: radial-gradient(ellipse at center, #1a152288 0%, #0b0810dd 72%);
}
#ui-root .ui-menu-layer.ui-hidden { display: none; }
#ui-root .ui-menu {
  width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 22px 26px 20px;
  background: linear-gradient(180deg, #241e2ef2, #17121ef2);
  border: 1px solid var(--acg-border-bright);
  border-radius: 6px;
  box-shadow: var(--acg-shadow), inset 0 1px 0 #ffffff14;
  pointer-events: auto;
  position: relative;
}
#ui-root .ui-menu::before {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid #ffffff0c;
  border-radius: 4px;
  pointer-events: none;
}
#ui-root .ui-menu-title {
  font-size: 26px;
  letter-spacing: 3px;
  text-align: center;
  color: var(--acg-amber-bright);
  text-shadow: 0 2px 0 #000, 0 0 22px #e0b06044;
  margin-bottom: 2px;
  line-height: 1.15;
}
#ui-root .ui-menu-sub {
  text-align: center;
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--acg-text-muted);
  margin-bottom: 12px;
  text-transform: uppercase;
}
#ui-root .ui-menu .ui-button { justify-content: flex-start; padding: 7px 12px; font-size: 12px; letter-spacing: 1px; }
#ui-root .ui-menu-foot { margin-top: 12px; text-align: center; font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-menu-divider { height: 1px; background: var(--acg-border-dim); margin: 4px 0; }

/* Dialogue --------------------------------------------------------------- */
#ui-root .ui-dialogue-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 40;
}
#ui-root .ui-dialogue {
  width: min(880px, 94vw);
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: linear-gradient(180deg, #241e2ef8, #171220f8);
  border: 1px solid var(--acg-border-bright);
  border-radius: 6px;
  box-shadow: 0 14px 40px #000000cc, inset 0 1px 0 #ffffff14;
  pointer-events: auto;
}
#ui-root .ui-dialogue-portrait {
  width: 62px;
  height: 62px;
  flex: 0 0 62px;
  border-radius: 4px;
  border: 1px solid #00000088;
  box-shadow: inset 0 0 0 1px #ffffff22, 2px 2px 0 #00000066;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  font-size: 30px;
}
#ui-root .ui-dialogue-portrait .initial {
  position: absolute;
  bottom: 1px;
  right: 4px;
  font-size: 10px;
  color: #171320;
  opacity: 0.75;
  font-weight: bold;
}
#ui-root .ui-dialogue-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
#ui-root .ui-dialogue-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
#ui-root .ui-dialogue-name { font-size: 14px; color: var(--acg-amber-bright); letter-spacing: 1px; }
#ui-root .ui-dialogue-meta { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-dialogue-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--acg-text);
  min-height: 44px;
  white-space: pre-wrap;
}
#ui-root .ui-dialogue-text.typing::after {
  content: '▌';
  color: var(--acg-amber);
  animation: ui-caret 0.9s steps(1) infinite;
}
@keyframes ui-caret { 50% { opacity: 0; } }
#ui-root .ui-dialogue-choices { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
#ui-root .ui-dialogue-choice {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  text-align: left;
  background: #1d1826;
  border-color: var(--acg-border);
  color: var(--acg-text-dim);
  font-size: 11px;
  padding: 4px 8px;
}
#ui-root .ui-dialogue-choice:hover:not(:disabled) { border-color: var(--acg-amber); color: var(--acg-amber-bright); }
#ui-root .ui-dialogue-choice .num {
  display: inline-block;
  min-width: 16px;
  color: var(--acg-ember);
  font-size: 10px;
}
#ui-root .ui-dialogue-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px; font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-dialogue-skip { cursor: pointer; color: var(--acg-text-muted); text-decoration: underline dotted; }
#ui-root .ui-dialogue-skip:hover { color: var(--acg-amber); }

/* Inventory -------------------------------------------------------------- */
#ui-root .ui-inv-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr); gap: 10px; align-items: start; }
#ui-root .ui-inv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 5px; }
#ui-root .ui-item-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px;
  background: linear-gradient(180deg, #262031, #1d1826);
  border: 1px solid var(--acg-border-dim);
  border-radius: 3px;
  cursor: pointer;
  min-height: 76px;
  text-align: left;
  color: var(--acg-text);
}
#ui-root .ui-item-cell:hover { border-color: var(--acg-border-bright); background: #2c2438; }
#ui-root .ui-item-cell.selected { border-color: var(--acg-amber); box-shadow: 0 0 0 1px var(--acg-amber) inset; }
#ui-root .ui-item-cell:focus-visible { outline: 2px solid var(--acg-amber); }
#ui-root .ui-item-icon { font-size: 20px; line-height: 1.1; filter: drop-shadow(0 1px 1px #000); }
#ui-root .ui-item-name { font-size: 10px; color: var(--acg-text); line-height: 1.25; }
#ui-root .ui-item-sub { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-item-qty {
  position: absolute;
  top: 3px;
  right: 4px;
  font-size: 9px;
  color: var(--acg-amber-bright);
  background: #0b0810aa;
  border-radius: 2px;
  padding: 0 3px;
}
#ui-root .ui-item-stars { font-size: 9px; letter-spacing: 1px; }
#ui-root .ui-item-detail { display: flex; flex-direction: column; gap: 8px; }
#ui-root .ui-item-detail-head { display: flex; gap: 10px; align-items: flex-start; }
#ui-root .ui-item-detail-icon {
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  background: radial-gradient(circle at 50% 40%, #3a3049, #17121e);
  border: 1px solid var(--acg-border);
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px #ffffff10;
}
#ui-root .ui-item-detail-title { font-size: 14px; color: var(--acg-amber-bright); }
#ui-root .ui-detail-actions { display: flex; flex-wrap: wrap; gap: 4px; }
#ui-root .ui-filter-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#ui-root .ui-filter-chip {
  padding: 1px 6px;
  font-size: 9px;
  border: 1px solid var(--acg-border);
  border-radius: 10px;
  background: #17121e;
  color: var(--acg-text-muted);
  cursor: pointer;
}
#ui-root .ui-filter-chip.active { border-color: var(--acg-amber); color: var(--acg-amber-bright); background: #3a2e1a66; }
#ui-root .ui-equipment-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(138px, 1fr)); gap: 5px; }
#ui-root .ui-equipment-slot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px dashed var(--acg-border);
  border-radius: 3px;
  background: #18131f;
  min-height: 58px;
}
#ui-root .ui-equipment-slot.filled { border-style: solid; border-color: var(--acg-green-deep); }
#ui-root .ui-equipment-slot-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--acg-text-muted); }
#ui-root .ui-equipment-slot-value { font-size: 11px; color: var(--acg-text); }
#ui-root .ui-recipe-list { display: flex; flex-direction: column; gap: 6px; }
#ui-root .ui-recipe {
  display: flex;
  gap: 9px;
  padding: 7px;
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  background: linear-gradient(180deg, #241e2e, #1b1623);
}
#ui-root .ui-recipe.unavailable { opacity: 0.72; }
#ui-root .ui-recipe-icon { font-size: 22px; width: 30px; text-align: center; flex: 0 0 auto; }
#ui-root .ui-recipe-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
#ui-root .ui-recipe-title { font-size: 12px; color: var(--acg-text); display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
#ui-root .ui-recipe-title small { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-recipe-inputs { display: flex; flex-wrap: wrap; gap: 4px; }
#ui-root .ui-ingredient { font-size: 9px; padding: 1px 5px; border-radius: 2px; border: 1px solid var(--acg-border-dim); background: #17121e; color: var(--acg-text-dim); }
#ui-root .ui-ingredient.missing { border-color: var(--acg-red-deep); color: var(--acg-red); }
#ui-root .ui-ingredient.have { border-color: var(--acg-green-deep); color: var(--acg-green); }
#ui-root .ui-recipe-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
#ui-root .ui-qty-stepper { display: inline-flex; align-items: center; gap: 2px; }
#ui-root .ui-qty-stepper input { width: 44px; text-align: center; }
#ui-root .ui-house-grid-preview {
  display: grid;
  gap: 1px;
  background: #151119;
  border: 1px solid var(--acg-border);
  padding: 3px;
  width: max-content;
  max-width: 100%;
  overflow: auto;
}
#ui-root .ui-house-cell {
  width: 22px;
  height: 22px;
  background: #241e2e;
  border: 1px solid #2f2839;
  cursor: crosshair;
  position: relative;
}
#ui-root .ui-house-cell:hover { background: #352b45; }
#ui-root .ui-house-cell.placed { background: #4a3f56; border-color: #6a5a74; }
#ui-root .ui-house-cell.preview-fit { background: #5f7a4a88; border-color: var(--acg-green); }
#ui-root .ui-house-cell.preview-bad { background: #8a4a3c88; border-color: var(--acg-red); }
#ui-root .ui-house-cell.origin { box-shadow: 0 0 0 2px var(--acg-amber) inset; }
#ui-root .ui-house-grid-wrap { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
#ui-root .ui-swatch-row { display: flex; gap: 4px; flex-wrap: wrap; }
#ui-root .ui-swatch {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid #00000088;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px #ffffff22;
}
#ui-root .ui-swatch.active { outline: 2px solid var(--acg-amber); outline-offset: 1px; }
#ui-root .ui-furniture-row { display: flex; align-items: center; gap: 6px; font-size: 10px; padding: 2px 0; border-bottom: 1px dashed #ffffff0c; }

/* Map -------------------------------------------------------------------- */
#ui-root .ui-map { display: flex; flex-direction: column; gap: 8px; }
#ui-root .ui-map-region {
  position: relative;
  background: radial-gradient(ellipse at 40% 30%, #22302633, transparent 70%), #17131d;
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  overflow: hidden;
}
#ui-root .ui-map-region-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--acg-amber);
  border-bottom: 1px solid var(--acg-border-dim);
  background: #201a2bcc;
}
#ui-root .ui-map-svg { display: block; width: 100%; height: auto; max-height: 340px; }
#ui-root .ui-map-svg .map-edge { stroke: #5a4a6a; stroke-width: 2; stroke-dasharray: 5 4; }
#ui-root .ui-map-svg .map-edge.rail { stroke: var(--acg-amber); stroke-dasharray: 8 5; }
#ui-root .ui-map-svg .map-node { cursor: pointer; }
#ui-root .ui-map-svg .map-node circle { fill: #3a3049; stroke: var(--acg-border-bright); stroke-width: 2; transition: fill 120ms; }
#ui-root .ui-map-svg .map-node text { fill: var(--acg-text-dim); font-size: 11px; font-family: var(--acg-font); paint-order: stroke; stroke: #0b0810cc; stroke-width: 3px; }
#ui-root .ui-map-svg .map-node:hover circle { fill: #4a3d5e; stroke: var(--acg-amber); }
#ui-root .ui-map-svg .map-node.selected circle { fill: #5a3a2e; stroke: var(--acg-amber-bright); stroke-width: 3; }
#ui-root .ui-map-svg .map-node.current circle { fill: #7a4a1c; stroke: var(--acg-ember); stroke-width: 3; filter: drop-shadow(0 0 6px var(--acg-ember)); }
#ui-root .ui-map-svg .map-node.current text { fill: var(--acg-amber-bright); }
#ui-root .ui-map-svg .map-node.locked circle { fill: #241e2e; stroke: #4a4152; stroke-dasharray: 3 2; }
#ui-root .ui-map-svg .map-node.adjacent circle { stroke: var(--acg-green); }
#ui-root .ui-map-svg .map-npc-dot { fill: var(--acg-purple); }
#ui-root .ui-map-legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 9px; color: var(--acg-text-muted); padding: 4px 2px; }
#ui-root .ui-map-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
#ui-root .ui-train-table { width: 100%; border-collapse: collapse; font-size: 10px; }
#ui-root .ui-train-table th { text-align: left; color: var(--acg-text-muted); font-weight: normal; text-transform: uppercase; letter-spacing: 1px; font-size: 9px; padding: 2px 5px; border-bottom: 1px solid var(--acg-border-dim); }
#ui-root .ui-train-table td { padding: 3px 5px; border-bottom: 1px dashed #ffffff10; color: var(--acg-text-dim); }
#ui-root .ui-train-table tr:hover td { background: #ffffff06; }
#ui-root .ui-train-table .soon { color: var(--acg-amber-bright); }

/* Social ----------------------------------------------------------------- */
#ui-root .ui-npc-card {
  display: flex;
  gap: 9px;
  padding: 8px;
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  background: linear-gradient(180deg, #251f30, #1b1623);
}
#ui-root .ui-npc-card.selected { border-color: var(--acg-amber); box-shadow: 0 0 0 1px #e0b06055 inset; }
#ui-root .ui-npc-portrait {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  border-radius: 4px;
  border: 1px solid #00000088;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  box-shadow: inset 0 0 0 1px #ffffff22;
  position: relative;
}
#ui-root .ui-npc-portrait .initial {
  position: absolute;
  bottom: 0;
  right: 3px;
  font-size: 9px;
  color: #171320aa;
  font-weight: bold;
}
#ui-root .ui-npc-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
#ui-root .ui-npc-name { font-size: 12px; color: var(--acg-amber-bright); display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
#ui-root .ui-npc-name small { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-rel-bars { display: grid; grid-template-columns: 52px 1fr; gap: 2px 6px; align-items: center; font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-rel-bars .ui-bar { height: 6px; }
#ui-root .ui-memory-list { margin: 2px 0 0; padding-left: 12px; font-size: 9px; color: var(--acg-text-muted); font-style: italic; }
#ui-root .ui-memory-list li { margin: 1px 0; }
#ui-root .ui-invite {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid var(--acg-border-dim);
  border-radius: 3px;
  background: #1d1826;
  font-size: 10px;
}
#ui-root .ui-invite .grow { flex: 1; min-width: 0; }

/* Shop / work ------------------------------------------------------------ */
#ui-root .ui-shop-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 0.7fr); gap: 10px; align-items: start; }
#ui-root .ui-shop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px dashed #ffffff10;
  font-size: 10px;
  width: 100%;
  background: none;
  border-left: none;
  border-right: none;
  border-top: none;
  color: var(--acg-text-dim);
  cursor: pointer;
  text-align: left;
}
#ui-root .ui-shop-row:hover { background: #ffffff08; color: var(--acg-text); }
#ui-root .ui-shop-row.selected { background: #3a2e1a55; color: var(--acg-amber-bright); }
#ui-root .ui-shop-price { margin-left: auto; color: var(--acg-amber); white-space: nowrap; }
#ui-root .ui-shop-stock { width: 46px; text-align: right; color: var(--acg-text-muted); font-size: 9px; }
#ui-root .ui-shop-total { font-size: 12px; color: var(--acg-amber-bright); }
#ui-root .ui-owner-row { display: flex; align-items: center; gap: 6px; font-size: 10px; padding: 3px 0; border-bottom: 1px dashed #ffffff0c; flex-wrap: wrap; }
#ui-root .ui-owner-row .grow { flex: 1; min-width: 100px; }
#ui-root .ui-buy-card { padding: 6px; border: 1px solid var(--acg-border-dim); border-radius: 3px; background: #18131f; font-size: 10px; }

/* Skills / goals / achievements ------------------------------------------ */
#ui-root .ui-skill-row { display: grid; grid-template-columns: 92px 42px 1fr 74px; gap: 6px; align-items: center; font-size: 10px; padding: 3px 0; }
#ui-root .ui-skill-name { color: var(--acg-text-dim); }
#ui-root .ui-skill-level { color: var(--acg-amber-bright); text-align: right; }
#ui-root .ui-skill-meta { color: var(--acg-text-muted); font-size: 9px; text-align: right; }
#ui-root .ui-achievement-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 5px; }
#ui-root .ui-achievement {
  display: flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--acg-border-dim);
  border-radius: 3px;
  background: #18131f;
  font-size: 10px;
  color: var(--acg-text-muted);
}
#ui-root .ui-achievement.unlocked { border-color: #8a6a3a; color: var(--acg-text); background: #2e2718; }
#ui-root .ui-achievement .ach-icon { font-size: 17px; }
#ui-root .ui-goal-card { border-left: 3px solid var(--acg-amber); }
#ui-root .ui-goal-card.complete { border-left-color: var(--acg-green); }

/* Events / journal / archive --------------------------------------------- */
#ui-root .ui-timeline { position: relative; display: flex; flex-direction: column; gap: 0; padding-left: 14px; }
#ui-root .ui-timeline::before { content: ''; position: absolute; left: 4px; top: 4px; bottom: 4px; width: 2px; background: var(--acg-border-dim); }
#ui-root .ui-timeline-entry { position: relative; padding: 4px 0 6px 8px; border-bottom: 1px dashed #ffffff10; }
#ui-root .ui-timeline-entry::before {
  content: '';
  position: absolute;
  left: -14px;
  top: 9px;
  width: 6px;
  height: 6px;
  background: var(--acg-ember);
  border-radius: 1px;
  box-shadow: 0 0 0 1px #00000088;
}
#ui-root .ui-timeline-entry.important::before { background: var(--acg-amber-bright); width: 8px; height: 8px; left: -15px; }
#ui-root .ui-timeline-title { font-size: 11px; color: var(--acg-text); }
#ui-root .ui-timeline-desc { font-size: 10px; color: var(--acg-text-muted); }
#ui-root .ui-timeline-meta { font-size: 9px; color: var(--acg-text-muted); margin-top: 1px; display: flex; gap: 8px; flex-wrap: wrap; }
#ui-root .ui-event-card { border-left: 3px solid var(--acg-border-bright); }
#ui-root .ui-event-card.lucky { border-left-color: var(--acg-green); }
#ui-root .ui-event-card.unlucky { border-left-color: var(--acg-red); }
#ui-root .ui-event-card.special { border-left-color: var(--acg-purple); }
#ui-root .ui-festival-card { border-left: 3px solid var(--acg-amber); }
#ui-root .ui-letter { border-left: 3px solid var(--acg-blue); }
#ui-root .ui-letter.unread { border-left-color: var(--acg-amber-bright); background: #2a2436; }
#ui-root .ui-photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
#ui-root .ui-photo {
  aspect-ratio: 4 / 3;
  border: 1px solid var(--acg-border);
  border-radius: 3px;
  background: linear-gradient(135deg, #3a3049, #17121e 70%);
  padding: 6px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  font-size: 9px;
  color: var(--acg-text-muted);
  box-shadow: inset 0 0 24px #00000088;
}
#ui-root .ui-photo-title { font-size: 11px; color: var(--acg-text); }
#ui-root .ui-archive-card { border-left: 3px solid var(--acg-border-bright); }
#ui-root .ui-archive-card.current { border-left-color: var(--acg-amber); }
#ui-root .ui-memento-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; }
#ui-root .ui-memento {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px dashed var(--acg-border);
  border-radius: 3px;
  background: #18131f;
  font-size: 10px;
  cursor: pointer;
  color: var(--acg-text-dim);
}
#ui-root .ui-memento.selected { border-style: solid; border-color: var(--acg-amber); color: var(--acg-amber-bright); background: #3a2e1a55; }
#ui-root .ui-memento input { pointer-events: none; }

/* Life panel ------------------------------------------------------------- */
#ui-root .ui-life-cigarette {
  display: flex;
  justify-content: center;
  padding: 12px 6px 16px;
  background: radial-gradient(ellipse at 50% 100%, #3a2e1a55, transparent 70%);
}
#ui-root .ui-life-cigarette .ui-cigarette { width: min(420px, 100%); height: 30px; }
#ui-root .ui-life-cigarette .ui-cigarette-body { height: 22px; }
#ui-root .ui-life-big-face { font-size: 22px; }
#ui-root .ui-influence-ladder { display: flex; flex-direction: column; gap: 3px; }
#ui-root .ui-tier-row { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--acg-text-muted); padding: 1px 0; }
#ui-root .ui-tier-row.current { color: var(--acg-amber-bright); }
#ui-root .ui-tier-row .tier-mark { width: 14px; text-align: center; }

/* Fishing ---------------------------------------------------------------- */
#ui-root .ui-fishing { display: flex; flex-direction: column; gap: 10px; }
#ui-root .ui-fishing-fish {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px;
  background: radial-gradient(ellipse at 50% 120%, #2a4a5a88, transparent 70%), #121820;
  border: 1px solid var(--acg-border);
  border-radius: 4px;
  font-size: 34px;
  min-height: 76px;
  position: relative;
  overflow: hidden;
}
#ui-root .ui-fishing-fish .waterline {
  position: absolute;
  left: 0;
  right: 0;
  top: 52%;
  height: 1px;
  background: #8fc4e044;
}
#ui-root .ui-fishing-fish .silhouette { filter: drop-shadow(0 2px 3px #000) brightness(0.85); animation: ui-fish-wiggle 2.2s ease-in-out infinite; }
@keyframes ui-fish-wiggle {
  0%, 100% { transform: translate(0, 2px) rotate(0deg); }
  25% { transform: translate(-4px, 0) rotate(-4deg); }
  75% { transform: translate(4px, 3px) rotate(4deg); }
}
#ui-root .ui-fish-meter { position: relative; display: flex; flex-direction: column; gap: 3px; }
#ui-root .ui-fish-meter-label { display: flex; justify-content: space-between; font-size: 10px; color: var(--acg-text-muted); }
#ui-root .ui-fish-tension { height: 16px; }
#ui-root .ui-fish-tension .ui-bar-fill { transition: width 90ms linear; }
#ui-root .ui-fish-tension.danger .ui-bar-fill { background: linear-gradient(90deg, #8a2a1c, #ff5a3c); }
#ui-root .ui-fish-progress { height: 14px; }
#ui-root .ui-fish-cast-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#ui-root .ui-fish-hold {
  padding: 12px;
  font-size: 14px;
  letter-spacing: 2px;
  user-select: none;
  touch-action: none;
  width: 100%;
}
#ui-root .ui-fish-hold.holding {
  background: linear-gradient(180deg, #7a4a1c, #4a2a10);
  border-color: var(--acg-ember);
  color: #ffe0b0;
  box-shadow: 0 0 18px #ff8a3c66 inset;
}
#ui-root .ui-fish-message { font-size: 10px; color: var(--acg-text-dim); min-height: 16px; }

/* Probability debug ------------------------------------------------------ */
#ui-root .ui-prob-streams { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px; }
#ui-root .ui-prob-stream {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 9px;
  padding: 2px 5px;
  background: #18131f;
  border: 1px solid var(--acg-border-dim);
  border-radius: 2px;
  color: var(--acg-text-muted);
}
#ui-root .ui-prob-decision { border-left: 3px solid var(--acg-border-bright); }
#ui-root .ui-prob-decision.selected { border-left-color: var(--acg-amber); }
#ui-root .ui-candidate-bar { display: flex; align-items: center; gap: 6px; font-size: 9px; }
#ui-root .ui-candidate-bar .name { width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--acg-text-dim); }
#ui-root .ui-candidate-bar .track { flex: 1; height: 10px; background: #120e17; border: 1px solid var(--acg-border-dim); position: relative; }
#ui-root .ui-candidate-bar .fill { height: 100%; }
#ui-root .ui-candidate-bar .pct { width: 46px; text-align: right; color: var(--acg-text-muted); }
#ui-root .ui-candidate-bar.ineligible { opacity: 0.4; }
#ui-root .ui-code {
  background: #100d15;
  border: 1px solid var(--acg-border-dim);
  border-radius: 3px;
  padding: 6px;
  font-size: 9px;
  color: #b8c9b0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}

/* Settings / saves / help ------------------------------------------------ */
#ui-root .ui-settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 2px;
  border-bottom: 1px dashed #ffffff0c;
  flex-wrap: wrap;
  font-size: 11px;
}
#ui-root .ui-settings-row .grow { flex: 1; min-width: 140px; color: var(--acg-text-dim); }
#ui-root .ui-settings-row .hint { font-size: 9px; color: var(--acg-text-muted); width: 100%; padding-left: 2px; }
#ui-root .ui-keybinding {
  min-width: 74px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 1px;
  border: 1px solid var(--acg-border);
  border-radius: 3px;
  padding: 2px 6px;
  background: #17121e;
  color: var(--acg-text);
  cursor: pointer;
}
#ui-root .ui-keybinding.listening { border-color: var(--acg-amber); color: var(--acg-amber-bright); animation: ui-listening 0.9s ease-in-out infinite; }
@keyframes ui-listening { 50% { background: #3a2e1a; } }
#ui-root .ui-save-slot {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  background: linear-gradient(180deg, #241e2e, #1b1623);
  flex-wrap: wrap;
}
#ui-root .ui-save-slot .info { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 1px; }
#ui-root .ui-save-slot .slot-name { font-size: 12px; color: var(--acg-text); }
#ui-root .ui-save-slot .slot-meta { font-size: 9px; color: var(--acg-text-muted); }
#ui-root .ui-save-slot .actions { display: flex; gap: 4px; flex-wrap: wrap; }
#ui-root .ui-import-box { display: flex; flex-direction: column; gap: 5px; }
#ui-root .ui-kbd-hint {
  display: inline-block;
  min-width: 20px;
  text-align: center;
  border: 1px solid var(--acg-border);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: #221c2b;
  color: var(--acg-text-dim);
  padding: 0 5px;
  font-size: 10px;
  margin-right: 2px;
}
#ui-root .ui-help-list { display: flex; flex-direction: column; gap: 3px; }
#ui-root .ui-help-row { display: flex; gap: 8px; align-items: baseline; font-size: 11px; padding: 2px 0; border-bottom: 1px dashed #ffffff0c; }
#ui-root .ui-help-row .keys { width: 128px; flex: 0 0 auto; }

/* Character creation ----------------------------------------------------- */
#ui-root .ui-charcreate { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 18px; align-items: start; }
#ui-root .ui-charcreate-form { display: flex; flex-direction: column; gap: 5px; }
#ui-root .ui-charcreate-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 8px 22px;
  background: radial-gradient(ellipse at 50% 80%, #3a2e1a66, transparent 70%), #17121e;
  border: 1px solid var(--acg-border-dim);
  border-radius: 4px;
  position: sticky;
  top: 0;
}
#ui-root .ui-preview-cigarette { position: relative; width: 44px; height: 150px; border-radius: 5px; border: 1px solid #00000088; background-size: 8px 8px; box-shadow: inset -4px 0 8px #00000044; }
#ui-root .ui-preview-filter { width: 44px; height: 34px; border-radius: 0 0 5px 5px; border: 1px solid #00000088; margin-top: -1px; }
#ui-root .ui-preview-face { position: absolute; top: 26px; left: 50%; transform: translateX(-50%); font-size: 18px; }
#ui-root .ui-preview-label { font-size: 9px; color: var(--acg-text-muted); letter-spacing: 1px; text-transform: uppercase; }
#ui-root .ui-preview-name { font-size: 14px; color: var(--acg-amber-bright); }
#ui-root .ui-charcreate .ui-form-line { flex-wrap: nowrap; }
#ui-root .ui-charcreate .ui-label { min-width: 92px; }
#ui-root .ui-inline-error { color: var(--acg-red); font-size: 10px; min-height: 14px; }

/* Offline summary / life review ------------------------------------------ */
#ui-root .ui-offline-headline {
  font-size: 13px;
  color: var(--acg-text);
  padding: 8px 10px;
  border-left: 3px solid var(--acg-ember);
  background: #1d1826;
  border-radius: 2px;
}
#ui-root .ui-offline-changes { display: flex; flex-direction: column; gap: 2px; }
#ui-root .ui-offline-change { display: flex; gap: 6px; font-size: 10px; color: var(--acg-text-dim); align-items: baseline; }
#ui-root .ui-offline-change .kind { flex: 0 0 auto; }
#ui-root .ui-life-review-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }

/* Responsive ------------------------------------------------------------- */
@media (max-width: 900px) {
  #ui-root .ui-panel { top: 96px; width: min(560px, 72vw); }
  #ui-root .ui-panel-wide { width: min(760px, 88vw); }
  #ui-root .ui-inv-layout, #ui-root .ui-shop-layout, #ui-root .ui-charcreate { grid-template-columns: 1fr; }
  #ui-root .ui-hud-block.ui-hud-cigar { width: 230px; }
}
@media (max-width: 620px) {
  #ui-root .ui-hud { flex-wrap: wrap; }
  #ui-root .ui-hud-block.ui-hud-cigar { width: 100%; }
  #ui-root .ui-panel { left: 6px; right: 6px; top: 170px; width: auto; bottom: 6px; }
  #ui-root .ui-panel-left { left: 6px; right: 6px; }
}
@media (prefers-reduced-motion: reduce) {
  #ui-root *, #ui-root *::before, #ui-root *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
#ui-root.ui-reduced-motion *, #ui-root.ui-reduced-motion *::before, #ui-root.ui-reduced-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
}

/* Utility ---------------------------------------------------------------- */
#ui-root .ui-hidden { display: none !important; }
#ui-root .ui-muted { color: var(--acg-text-muted); }
#ui-root .ui-dim { color: var(--acg-text-dim); }
#ui-root .ui-warn { color: var(--acg-amber); }
#ui-root .ui-bad { color: var(--acg-red); }
#ui-root .ui-good { color: var(--acg-green); }
#ui-root .ui-accent { color: var(--acg-amber-bright); }
#ui-root .ui-grow { flex: 1; min-width: 0; }
#ui-root .ui-row-actions { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#ui-root .ui-stack { display: flex; flex-direction: column; gap: 6px; }
#ui-root .ui-inline { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
#ui-root .ui-sep { height: 1px; background: var(--acg-border-dim); margin: 4px 0; }
#ui-root .ui-spacer { flex: 1 1 auto; }
#ui-root .ui-center { text-align: center; }
#ui-root .ui-pixel-hr { height: 2px; background: repeating-linear-gradient(90deg, var(--acg-border) 0 4px, transparent 4px 8px); margin: 6px 0; }
`;
