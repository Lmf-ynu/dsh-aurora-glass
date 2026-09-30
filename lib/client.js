// dsh-aurora-glass — client (browser) half.
//
// A DeepSeek Harness "client plugin" bundle: a classic script that registers
// itself on the web boot module table. The host composes `window.__DSH_BOOT__`
// from every package that declares `dsh.client`; when the shell imports this
// module it materializes the factory below with a synchronous `require` that is
// bound to the module table (static words such as `react` plus other client
// bundle ids).
//
// What this bundle does, all in the browser:
//   1. Injects a full-viewport, GPU-composited aurora backdrop layer (preset
//      palettes, drifting light blobs, optional custom wallpaper, dim veil).
//   2. When "glass" is enabled, stacks translucent overrides over the native
//      design-token alias variables (`--dsw-alias-*`), turning the whole UI's
//      surfaces into lightweight alpha-composited glass — no backdrop-filter,
//      no live blur pipeline, no repaint during streaming output.
//   3. Registers its own "Aurora Glass" page inside the Settings shell and
//      persists every choice through the plugin entry's settings form
//      (`ctx.configForms.get(ENTRY_ID)`), whose volatile fields the host half
//      declares in its exported `Config`.
//
// Everything is reversible: styles and DOM are owned by this plugin's context
// and are removed on dispose/disable/uninstall. No code from third-party
// appearance plugins is used — the palettes, layout and token logic below are
// original.
window.__ModuleLoader__.load({
  id: 'dsh-aurora-glass',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ─────────────────────────────────────────────────────────────────────
    // React is a static module-table word provided by the web shell.
    // ─────────────────────────────────────────────────────────────────────
    const React = require('react');
    const e = React.createElement;
    const { useState, useSyncExternalStore, useEffect, useRef } = React;

    // ─────────────────────────────────────────────────────────────────────
    // Identity constants.
    // ─────────────────────────────────────────────────────────────────────
    const PLUGIN_ID = 'dsh-aurora-glass';
    /** Loader row id (== profile entry id) whose settings form this page edits. */
    const ENTRY_ID = 'aurora-glass';
    /** Locale dictionary namespace for this feature's copy. */
    const LOCALE_NS = 'settings.auroraGlass';
    const BACKDROP_ID = 'ag-backdrop';
    const CSS_ID = `${PLUGIN_ID}/aurora.css`;
    const FIELDS = ['enabled', 'preset', 'image', 'dim', 'glass'];

    /** Maximum accepted uploaded wallpaper size (kept small: the image is
     *  persisted inside the settings document as a data URL). */
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    /** Defaults mirroring the host schema. */
    const DEFAULTS = Object.freeze({
      enabled: false,
      preset: 'aurora',
      image: '',
      dim: 35,
      glass: 55
    });

    // ─────────────────────────────────────────────────────────────────────
    // Backdrop palettes. Each entry: two deep base colors plus five blob
    // colors; swatches reuse the same colors so the settings preview always
    // matches the live backdrop.
    // ─────────────────────────────────────────────────────────────────────
    const PRESETS = [
      { id: 'aurora', base: ['#050d1f', '#0d1f35'], blobs: ['#22d3ee', '#34d399', '#8b5cf6', '#f472b6', '#38bdf8'] },
      { id: 'nebula', base: ['#0a0716', '#150b30'], blobs: ['#a78bfa', '#f0abfc', '#818cf8', '#c084fc', '#60a5fa'] },
      { id: 'ocean', base: ['#021420', '#063542'], blobs: ['#38bdf8', '#2dd4bf', '#60a5fa', '#22d3ee', '#67e8f9'] },
      { id: 'sunset', base: ['#1d0a13', '#3d0d1f'], blobs: ['#fb7185', '#fbbf24', '#f472b6', '#fb923c', '#fda4af'] },
      { id: 'meadow', base: ['#07160e', '#0e2b1b'], blobs: ['#4ade80', '#a3e635', '#2dd4bf', '#86efac', '#34d399'] },
      { id: 'sakura', base: ['#160a18', '#2b0f23'], blobs: ['#f9a8d4', '#c4b5fd', '#fda4af', '#e879f9', '#fbcfe8'] },
      { id: 'graphite', base: ['#0a0c10', '#14181f'], blobs: ['#64748b', '#94a3b8', '#475569', '#cbd5e1', '#7f8ea3'] }
    ];

    /** Normalize one stored value into a full settings object. */
    function normalize(value) {
      const raw = value && typeof value === 'object' ? value : {};
      const glass = Number(raw.glass);
      const dim = Number(raw.dim);
      return {
        enabled: raw.enabled === true,
        preset: PRESETS.some((p) => p.id === raw.preset) ? raw.preset
          : raw.preset === 'custom' ? 'custom'
            : DEFAULTS.preset,
        image: typeof raw.image === 'string' ? raw.image : '',
        dim: Number.isFinite(dim) ? Math.min(100, Math.max(0, dim)) : DEFAULTS.dim,
        glass: Number.isFinite(glass) ? Math.min(100, Math.max(0, glass)) : DEFAULTS.glass
      };
    }

    /** Clamp + stringify a translucent rgba helper. */
    function rgba(r, g, b, alpha) {
      const a = Math.min(1, Math.max(0, alpha));
      return `rgba(${r},${g},${b},${a})`;
    }

    /** Whether a custom image string is safe to hand to CSS url(). */
    function isSafeImageSource(source) {
      if (typeof source !== 'string') return false;
      return /^https?:\/\//i.test(source) || /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(source);
    }

    function clamp01(x) {
      return Math.min(1, Math.max(0, x));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Static CSS. Values that change with the settings live on `:root` custom
    // properties; the attributes below are set from JS:
    //   html[data-ag="on"]        – backdrop enabled
    //   html[data-ag-glass="on"]  – translucent alias-token overrides active
    //   html[data-ag-custom="on"] – wallpaper layer shown, blobs hidden
    // ─────────────────────────────────────────────────────────────────────
    const AURORA_CSS = `
/* ===== dsh-aurora-glass backdrop ===== */
#ag-backdrop{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;contain:strict;background:#04060b;opacity:0;visibility:hidden;transition:opacity .45s ease}
html[data-ag="on"] #ag-backdrop{opacity:1;visibility:visible}
#ag-backdrop .ag-base,#ag-backdrop .ag-img,#ag-backdrop .ag-veil{position:absolute;inset:0}
#ag-backdrop .ag-base{background:linear-gradient(135deg,var(--ag-c0,#0a1020) 0%,var(--ag-c1,#101b36) 100%)}
#ag-backdrop .ag-img{background-position:center;background-size:cover;opacity:0;transition:opacity .5s ease}
html[data-ag-custom="on"] #ag-backdrop .ag-img{opacity:1}
html[data-ag-custom="on"] #ag-backdrop .ag-base,html[data-ag-custom="on"] #ag-backdrop .ag-blob{opacity:0}
#ag-backdrop .ag-veil{background:var(--ag-veil,rgba(3,6,12,.35))}
#ag-backdrop .ag-blob{position:absolute;width:56vmax;height:56vmax;border-radius:50%;filter:blur(72px);opacity:.5;will-change:transform;transition:opacity .5s ease}
#ag-backdrop .ag-b1{top:-14%;left:-10%;background:radial-gradient(circle at 38% 40%,var(--ag-b0,#38bdf8),transparent 62%);animation:agDrift1 36s ease-in-out infinite alternate}
#ag-backdrop .ag-b2{top:-6%;right:-12%;background:radial-gradient(circle at 55% 45%,var(--ag-b1,#34d399),transparent 62%);animation:agDrift2 44s ease-in-out infinite alternate}
#ag-backdrop .ag-b3{bottom:-18%;left:18%;background:radial-gradient(circle at 50% 50%,var(--ag-b2,#8b5cf6),transparent 62%);animation:agDrift3 40s ease-in-out infinite alternate}
#ag-backdrop .ag-b4{top:30%;right:8%;width:42vmax;height:42vmax;background:radial-gradient(circle at 60% 40%,var(--ag-b3,#f472b6),transparent 62%);animation:agDrift4 32s ease-in-out infinite alternate}
#ag-backdrop .ag-b5{bottom:-10%;right:-6%;width:46vmax;height:46vmax;background:radial-gradient(circle at 45% 55%,var(--ag-b4,#60a5fa),transparent 62%);animation:agDrift1 48s ease-in-out infinite alternate-reverse}
@keyframes agDrift1{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(9vw,6vh,0) scale(1.12)}}
@keyframes agDrift2{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(-8vw,9vh,0) scale(1.15)}}
@keyframes agDrift3{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(7vw,-7vh,0) scale(1.1)}}
@keyframes agDrift4{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(-6vw,-8vh,0) scale(1.14)}}
@media (prefers-reduced-motion: reduce){#ag-backdrop .ag-blob{animation:none!important}}

/* ===== dsh-aurora-glass glass token overrides ===== */
html[data-ag-glass="on"] body{--dsw-alias-bg-base:var(--ag-surf-l);--dsw-alias-bg-layer-1:var(--ag-surf-l);--dsw-alias-bg-layer-2:var(--ag-surf-l);--dsw-alias-bg-layer-3:var(--ag-surf-l);--dsw-alias-bg-module-platform:var(--ag-surf2-l);--dsw-alias-bg-multi-select:var(--ag-surf2-l);--dsw-alias-bg-overlay:var(--ag-surf2-l);--dsw-alias-border-l1:var(--ag-bord1-l);--dsw-alias-border-l2:var(--ag-bord2-l);--dsw-alias-border-l3:var(--ag-bord3-l);--dsw-alias-border-l4:var(--ag-bord4-l);--dsw-alias-markdown-code-block:var(--ag-code-l);--dsw-alias-markdown-code-block-banner:var(--ag-code-l);--dsw-alias-markdown-inline-code:var(--ag-code-l)}
html[data-ag-glass="on"] body[data-ds-dark-theme]{--dsw-alias-bg-base:var(--ag-surf-d);--dsw-alias-bg-layer-1:var(--ag-surf-d);--dsw-alias-bg-layer-2:var(--ag-surf-d);--dsw-alias-bg-layer-3:var(--ag-surf-d);--dsw-alias-bg-module-platform:var(--ag-surf2-d);--dsw-alias-bg-multi-select:var(--ag-surf2-d);--dsw-alias-bg-overlay:var(--ag-surf2-d);--dsw-alias-border-l1:var(--ag-bord1-d);--dsw-alias-border-l2:var(--ag-bord2-d);--dsw-alias-border-l3:var(--ag-bord3-d);--dsw-alias-border-l4:var(--ag-bord4-d);--dsw-alias-markdown-code-block:var(--ag-code-d);--dsw-alias-markdown-code-block-banner:var(--ag-code-d);--dsw-alias-markdown-inline-code:var(--ag-code-d)}
/* The window shell must paint nothing while the backdrop is on. The dsh 0.2
   shell nests three containers that all paint --dsw-alias-bg-base, so the
   translucent value above would compose to ~95% opacity and hide the aurora
   entirely. Panels keep their own surfaces; only these containers drop out. */
html[data-ag="on"] body,
html[data-ag="on"] body[data-ds-dark-theme]{--dsw-alias-bg-base:transparent}

/* ===== dsh-aurora-glass settings page ===== */
.agp-heading{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.agp-sub{margin:2px 0 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.agp-banner{margin:6px 0 4px;border-radius:10px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:8px 12px}
.agp-banner strong{color:var(--dsw-alias-label-primary);font-weight:500}
.agp-row{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.agp-row:first-of-type{border-top:0}
.agp-stack{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;padding-right:8px}
.agp-rowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.agp-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.agp-blockTitle{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:16px 0 8px}
.agp-switch{position:relative;flex:none;width:42px;height:24px;border-radius:999px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-label-dimmed);transition:background .18s ease}
.agp-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:var(--dsw-static-neutral-00);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s ease}
.agp-switch[aria-checked="true"]{background:var(--dsw-static-deepseek-500)}
.agp-switch[aria-checked="true"]::after{transform:translateX(18px)}
.agp-switch:disabled{opacity:.5;cursor:default}
.agp-control{display:flex;align-items:center;gap:10px;flex:none}
.agp-range{width:190px;accent-color:var(--dsw-static-deepseek-500);margin:0}
.agp-value{min-width:40px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:13px;font-variant-numeric:tabular-nums}
.agp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.agp-swatch{margin:0;padding:0;border:0;border-radius:14px;overflow:hidden;cursor:pointer;background:transparent;text-align:left;outline:.5px solid var(--dsw-alias-border-l2);outline-offset:0;font:inherit}
.agp-swatch:hover{outline-color:var(--dsw-alias-label-tertiary)}
.agp-swatchOn{outline:1.5px solid var(--dsw-static-deepseek-500);outline-offset:1px}
.agp-swatchBg{height:50px;display:block}
.agp-swatchLabel{display:block;padding:6px 8px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.agp-swatchOn .agp-swatchLabel{color:var(--dsw-alias-label-primary)}
.agp-preview{position:relative;height:132px;border-radius:18px;overflow:hidden;margin:10px 0 4px;outline:.5px solid var(--dsw-alias-border-l3)}
.agp-previewBg{position:absolute;inset:0;background:linear-gradient(135deg,var(--ag-c0,#0a1020),var(--ag-c1,#101b36))}
.agp-previewImg{position:absolute;inset:0;background-position:center;background-size:cover;opacity:0;transition:opacity .3s ease}
.agp-preview[data-custom="on"] .agp-previewImg{opacity:1}
.agp-preview[data-custom="on"] .agp-previewBg{opacity:0}
.agp-previewVeil{position:absolute;inset:0;background:var(--ag-veil,rgba(3,6,12,.35))}
.agp-previewChip{position:absolute;top:10px;right:10px;display:flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-size:12px;line-height:16px;background:rgba(15,17,21,.55);color:rgba(255,255,255,.92);backdrop-filter:blur(8px)}
.agp-previewChip::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ag-chip,#22d3ee)}
.agp-preview[data-state="off"] .agp-previewChip::before{background:#94a3b8}
.agp-inputRow{display:flex;gap:8px;align-items:center;min-width:0;width:100%}
.agp-text{flex:1;min-width:0;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px}
.agp-text:focus{outline:1.5px solid var(--dsw-static-deepseek-500);outline-offset:-1px;border-color:transparent}
.agp-btn{border:0;border-radius:9px;padding:6px 12px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.agp-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.agp-btn:disabled{opacity:.5;cursor:default}
.agp-btnGhost{background:transparent;color:var(--dsw-alias-label-secondary)}
.agp-btnGhost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.agp-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:6px 0 0}
.agp-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:6px 0 0}
.agp-footer{display:flex;justify-content:flex-end;margin-top:16px}
.agp-disabled{opacity:.55;pointer-events:none}
`;

    // ─────────────────────────────────────────────────────────────────────
    // Locale dictionaries (zh is the key-set source, en mirrors it fully).
    // ─────────────────────────────────────────────────────────────────────
    const zh = {
      nav: '极光玻璃',
      title: '背景与玻璃质感',
      intro: '给 DeepSeek Harness 加一层缓慢流动的极光背景与柔和玻璃面板。所有效果只存在于本插件生命周期内，随时可以一键关闭或移除插件恢复原样。',
      live: '实时预览',
      on: '已开启',
      off: '已关闭',
      loading: '载入设置…',
      saveFailed: '保存失败，请重试。',
      resetDone: '已恢复默认设置。',
      enabledTitle: '启用美化背景',
      enabledDesc: '开启后背景图层与玻璃面板同时生效；关闭即完全恢复默认外观。',
      presetTitle: '背景方案',
      presetDesc: '点击方块切换预设配色；画面以轻量 GPU 合成缓慢漂移，不遮挡任何交互。',
      presetAurora: '极光',
      presetNebula: '星云',
      presetOcean: '深海',
      presetSunset: '落日',
      presetMeadow: '原野',
      presetSakura: '樱落',
      presetGraphite: '石墨',
      presetCustom: '自定义',
      customTitle: '自定义壁纸',
      customDesc: '填远程图片地址，或从本机上传（≤4 MB，存为 data URL，不离开本机）。',
      customUrl: '图片地址',
      customApply: '应用',
      customUpload: '上传图片…',
      customRemove: '移除',
      customSize: '图片超过 4 MB，请压缩后再上传。',
      customInvalid: '仅支持 http(s) 或本地上传的图片地址。',
      customNote: '远程图片由浏览器直接加载，访问该图片服务时会暴露本机 IP。',
      dimTitle: '压暗背景',
      dimDesc: '在背景上加一层暗色薄纱，帮助文字与面板保持对比度。',
      glassTitle: '玻璃通透度',
      glassDesc: '控制面板表面的透光程度。0% 为默认不透明外观；建议 40–70%。',
      percent: '%',
      reset: '恢复默认设置',
      resetHint: '清除本插件写入的全部设置，恢复未安装时的默认外观。',
      unavailable: '当前部署没有暴露本插件的设置命名空间，背景美化不可用。',
      readonly: '此部署的设置是只读的；改动只在当前页面生效，刷新后恢复。',
      codeHint: '小贴士：在「通用 → 外观」里切换深浅色，玻璃面板会自动跟随配色。'
    };

    const en = {
      nav: 'Aurora Glass',
      title: 'Background & Glass',
      intro: 'Give DeepSeek Harness a slowly drifting aurora backdrop and soft glass panels. Every effect lives only inside this plugin’s lifetime — switch it off or remove the plugin to restore the original look.',
      live: 'Live preview',
      on: 'On',
      off: 'Off',
      loading: 'Loading settings…',
      saveFailed: 'Failed to save — please try again.',
      resetDone: 'Reset to defaults.',
      enabledTitle: 'Enable beautified background',
      enabledDesc: 'Turns on both the backdrop layer and the glass surfaces; turning it off fully restores the default look.',
      presetTitle: 'Backdrop',
      presetDesc: 'Pick a palette below. The scene drifts on lightweight GPU-composited layers and never blocks interaction.',
      presetAurora: 'Aurora',
      presetNebula: 'Nebula',
      presetOcean: 'Ocean',
      presetSunset: 'Sunset',
      presetMeadow: 'Meadow',
      presetSakura: 'Sakura',
      presetGraphite: 'Graphite',
      presetCustom: 'Custom',
      customTitle: 'Custom wallpaper',
      customDesc: 'Point to a remote image URL or upload a local file (≤4 MB, stored as a data URL, never uploaded elsewhere).',
      customUrl: 'Image URL',
      customApply: 'Apply',
      customUpload: 'Upload…',
      customRemove: 'Remove',
      customSize: 'Image is larger than 4 MB; please compress it first.',
      customInvalid: 'Only http(s) URLs or uploaded images are accepted.',
      customNote: 'Remote images are fetched directly by the browser, which reveals this machine’s IP to that image host.',
      dimTitle: 'Dim backdrop',
      dimDesc: 'A dark veil over the backdrop that keeps text and panels readable.',
      glassTitle: 'Glass translucency',
      glassDesc: 'How much the panel surfaces let the backdrop through. 0% keeps the native opaque look; 40–70% is the sweet spot.',
      percent: '%',
      reset: 'Reset to defaults',
      resetHint: 'Clears every value this plugin wrote and restores the out-of-the-box look.',
      unavailable: 'This deployment does not expose the plugin’s settings namespace, so the appearance feature is unavailable.',
      readonly: 'This deployment stores settings read-only; changes apply only for this page and reset on reload.',
      codeHint: 'Tip: switch light/dark under General → Appearance — the glass adapts automatically.'
    };

    // ─────────────────────────────────────────────────────────────────────
    // DOM/style plumbing (browser only, idempotent).
    // ─────────────────────────────────────────────────────────────────────
    function ensureStylesheet(ctx) {
      if (typeof document === 'undefined') return null;
      let tag = document.head.querySelector(`style[data-plugin-css="${CSS_ID}"]`);
      if (tag) return null;
      tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = AURORA_CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /** Create (once) the backdrop layer as the first child of <body>. */
    function ensureBackdrop() {
      if (typeof document === 'undefined') return null;
      let node = document.getElementById(BACKDROP_ID);
      if (node) return null;
      node = document.createElement('div');
      node.id = BACKDROP_ID;
      node.setAttribute('aria-hidden', 'true');
      node.appendChild(Object.assign(document.createElement('i'), { className: 'ag-base' }));
      for (let i = 1; i <= 5; i += 1) {
        node.appendChild(Object.assign(document.createElement('i'), { className: `ag-blob ag-b${i}` }));
      }
      node.appendChild(Object.assign(document.createElement('i'), { className: 'ag-img' }));
      node.appendChild(Object.assign(document.createElement('i'), { className: 'ag-veil' }));
      document.body.insertBefore(node, document.body.firstChild);
      return () => node.remove();
    }

    function styleRoot(root) {
      const s = root.style;
      return {
        set(key, value) { s.setProperty(key, value); },
        unset(key) { s.removeProperty(key); }
      };
    }

    /** Compute every derived CSS value for one normalized settings object. */
    function derivePalette(settings) {
      const preset = settings.preset === 'custom'
        ? PRESETS.find((p) => p.id === DEFAULTS.preset) ?? PRESETS[0]
        : PRESETS.find((p) => p.id === settings.preset) ?? PRESETS[0];
      const glass = clamp01(settings.glass / 100);
      const dim = clamp01(settings.dim / 100);
      // Surface opacity: 0% glass → 0.96 (visually native), 100% → 0.36.
      const surf = 0.96 - 0.6 * glass;
      const surf2 = surf * 0.94;
      const edge = 0.1 + 0.1 * glass;
      const edges = [edge * 0.75, edge * 0.95, edge * 1.1, edge * 1.25];
      return {
        palette: preset,
        colors: [...preset.base, ...preset.blobs],
        veil: rgba(3, 6, 12, dim),
        surfLight: rgba(255, 255, 255, surf),
        surfDark: rgba(14, 17, 24, surf),
        surf2Light: rgba(252, 253, 255, surf2),
        surf2Dark: rgba(20, 24, 32, surf2),
        codeLight: rgba(244, 246, 250, Math.min(1, surf + 0.22)),
        codeDark: rgba(9, 11, 16, Math.min(1, surf + 0.24)),
        borderLight: edges.map((a) => rgba(23, 33, 58, a)),
        borderDark: edges.map((a) => rgba(255, 255, 255, a * 0.8))
      };
    }

    /** Push one derived palette into :root custom properties + attributes. */
    function applyPalette(settings) {
      if (typeof document === 'undefined') return;
      const derived = derivePalette(settings);
      const root = document.documentElement;
      const style = styleRoot(root);
      const colors = derived.colors;
      const setBase = (name, index) => style.set(name, colors[index] ?? '');
      setBase('--ag-c0', 0);
      setBase('--ag-c1', 1);
      setBase('--ag-b0', 2);
      setBase('--ag-b1', 3);
      setBase('--ag-b2', 4);
      setBase('--ag-b3', 5);
      setBase('--ag-b4', 6);
      style.set('--ag-veil', derived.veil);
      style.set('--ag-surf-l', derived.surfLight);
      style.set('--ag-surf-d', derived.surfDark);
      style.set('--ag-surf2-l', derived.surf2Light);
      style.set('--ag-surf2-d', derived.surf2Dark);
      style.set('--ag-code-l', derived.codeLight);
      style.set('--ag-code-d', derived.codeDark);
      style.set('--ag-bord1-l', derived.borderLight[0]);
      style.set('--ag-bord2-l', derived.borderLight[1]);
      style.set('--ag-bord3-l', derived.borderLight[2]);
      style.set('--ag-bord4-l', derived.borderLight[3]);
      style.set('--ag-bord1-d', derived.borderDark[0]);
      style.set('--ag-bord2-d', derived.borderDark[1]);
      style.set('--ag-bord3-d', derived.borderDark[2]);
      style.set('--ag-bord4-d', derived.borderDark[3]);
      style.set('--ag-chip', settings.preset === 'custom' ? '#cbd5e1' : colors[2] ?? '#22d3ee');

      const backdrop = document.getElementById(BACKDROP_ID);
      if (backdrop) {
        backdrop.dataset.state = settings.enabled ? 'on' : 'off';
        const imgLayer = backdrop.querySelector('.ag-img');
        if (imgLayer) {
          if (settings.enabled && settings.preset === 'custom' && isSafeImageSource(settings.image)) {
            imgLayer.style.backgroundImage = `url("${settings.image.replace(/["\\\n\r]/g, '')}")`;
            root.dataset.agCustom = 'on';
          } else {
            imgLayer.style.backgroundImage = '';
            root.dataset.agCustom = 'off';
          }
        }
      }
      root.dataset.ag = settings.enabled ? 'on' : 'off';
      root.dataset.agGlass = settings.enabled && settings.glass > 0 ? 'on' : 'off';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Settings-page React tree.
    // ─────────────────────────────────────────────────────────────────────
    function swatchBackground(presetId) {
      const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
      const [c0, , c2, c3, c4] = [...preset.base, ...preset.blobs];
      return `linear-gradient(120deg, ${c0} 0%, ${c2} 45%, ${c3} 75%, ${c4} 100%)`;
    }

    /** A labelled slider that previews while dragging and persists on release. */
    function SliderRow(props) {
      const { t, value, min, max, onChange, disabled, title, desc } = props;
      const [local, setLocal] = useState(value);
      const dragging = useRef(false);
      useEffect(() => {
        if (!dragging.current) setLocal(value);
      }, [value]);
      return e('div', { className: 'agp-row' },
        e('div', { className: 'agp-stack' },
          e('div', { className: 'agp-rowTitle' }, title),
          e('div', { className: 'agp-rowDesc' }, desc)
        ),
        e('div', { className: 'agp-control' },
          e('input', {
            className: 'agp-range',
            type: 'range',
            min,
            max,
            step: 1,
            value: local,
            disabled,
            'aria-label': title,
            onInput: (event) => {
              dragging.current = true;
              const next = Number(event.target.value);
              setLocal(next);
              onChange(next, true);
            },
            onChange: (event) => {
              const next = Number(event.target.value);
              setLocal(next);
              dragging.current = false;
              onChange(next, false);
            }
          }),
          e('span', { className: 'agp-value' }, `${Math.round(local)}${t('percent')}`)
        )
      );
    }

    function PreviewBanner(props) {
      const { t, settings, presets } = props;
      const preset = presets.find((p) => p.id === settings.preset) ?? presets[0];
      const [c0, c1] = preset.base;
      const custom = settings.preset === 'custom' && isSafeImageSource(settings.image);
      const derived = derivePalette(settings);
      const veil = derived.veil;
      const chip = settings.preset === 'custom' ? '#cbd5e1' : preset.blobs[0];
      return e('div', {
          className: 'agp-preview',
          role: 'img',
          'aria-label': t('live'),
          'data-state': settings.enabled ? 'on' : 'off',
          'data-custom': custom ? 'on' : 'off',
          style: {
            ['--ag-c0']: c0,
            ['--ag-c1']: c1,
            ['--ag-veil']: veil,
            ['--ag-chip']: chip
          }
        },
        e('div', { className: 'agp-previewBg' }),
        custom ? e('div', {
          className: 'agp-previewImg',
          style: { backgroundImage: `url("${settings.image.replace(/["\\\n\r]/g, '')}")` }
        }) : null,
        e('div', { className: 'agp-previewVeil' }),
        e('div', { className: 'agp-previewChip' }, settings.enabled ? t('on') : t('off'))
      );
    }

    function AuroraGlassSection(props) {
      const {
        t,
        face
      } = props;
      const snapshot = useSyncExternalStore(face.subscribe, face.getSnapshot);
      const { status, value, writable } = snapshot;
      const ready = status === 'ready' && value !== undefined;
      const settings = ready ? normalize(value) : DEFAULTS;
      // Controls stay usable when the deployment is read-only so the user can
      // still preview; writes are skipped below instead.
      const disabled = !ready;
      const [notice, setNotice] = useState(null);
      const noticeTimer = useRef(null);

      useEffect(() => () => {
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      }, []);

      function flash(message) {
        setNotice(message);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
      }

      function commit(patch, okKey) {
        const next = normalize({ ...settings, ...patch });
        face.preview(next);
        if (!writable) return;
        face.update(patch).then(
          () => { if (okKey) flash(t(okKey)); },
          () => flash(t('saveFailed'))
        );
      }

      const onEnabled = (next) => commit({ enabled: next });
      const onPreset = (next) => commit({ preset: next });
      const onDim = (next, live) => {
        if (live) face.preview(normalize({ ...settings, dim: next }));
        else commit({ dim: next });
      };
      const onGlass = (next, live) => {
        if (live) face.preview(normalize({ ...settings, glass: next }));
        else commit({ glass: next });
      };

      const presetRow = PRESETS.map((preset) => e('button', {
          key: preset.id,
          type: 'button',
          className: `agp-swatch${settings.preset === preset.id ? ' agp-swatchOn' : ''}`,
          disabled,
          'aria-pressed': settings.preset === preset.id,
          onClick: () => onPreset(preset.id)
        },
        e('span', { className: 'agp-swatchBg', style: { background: swatchBackground(preset.id) } }),
        e('span', { className: 'agp-swatchLabel' }, t(`preset${preset.id[0].toUpperCase()}${preset.id.slice(1)}`))
      ));
      presetRow.push(e('button', {
        key: 'custom',
        type: 'button',
        className: `agp-swatch${settings.preset === 'custom' ? ' agp-swatchOn' : ''}`,
        disabled,
        'aria-pressed': settings.preset === 'custom',
        onClick: () => onPreset('custom')
      },
        e('span', {
          className: 'agp-swatchBg',
          style: {
            background: 'conic-gradient(from 210deg at 60% 45%, #38bdf8, #f472b6, #fbbf24, #34d399, #38bdf8)'
          }
        }),
        e('span', { className: 'agp-swatchLabel' }, t('presetCustom'))
      ));

      const image = typeof settings.image === 'string' ? settings.image : '';
      const customActive = settings.preset === 'custom';

      return e('div', {},
        status === 'unavailable'
          ? e('div', { className: 'agp-banner' }, t('unavailable'))
          : !ready
            ? e('div', { className: 'agp-banner' }, t('loading'))
            : e('div', {},
              e('div', { className: 'agp-heading' }, t('title')),
              e('p', { className: 'agp-sub' }, t('intro')),
              PreviewBanner({ t, settings, presets: PRESETS }),
              notice ? e('div', { className: 'agp-banner' }, notice) : null,

              e('div', { className: 'agp-row' },
                e('div', { className: 'agp-stack' },
                  e('div', { className: 'agp-rowTitle' }, t('enabledTitle')),
                  e('div', { className: 'agp-rowDesc' }, t('enabledDesc'))
                ),
                e('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': settings.enabled,
                  'aria-label': t('enabledTitle'),
                  className: 'agp-switch',
                  disabled,
                  onClick: () => onEnabled(!settings.enabled)
                })
              ),

              e('div', { className: 'agp-blockTitle' }, t('presetTitle')),
              e('p', { className: 'agp-rowDesc', style: { margin: '0 0 8px' } }, t('presetDesc')),
              e('div', { className: 'agp-grid' }, presetRow),

              customActive ? e('div', { className: 'agp-blockTitle' }, t('customTitle')) : null,
              customActive ? e('p', { className: 'agp-rowDesc', style: { margin: '0 0 8px' } }, t('customDesc')) : null,
              customActive ? e(CustomWallpaperRow, {
                t,
                image,
                disabled,
                onApply: (source) => commit({ image: source }),
                onRemove: () => commit({ image: '' }),
                onError: (key) => flash(t(key)),
                maxBytes: MAX_IMAGE_BYTES,
                allowedBytesKey: 'customSize',
                invalidKey: 'customInvalid'
              }) : null,
              customActive ? e('p', { className: 'agp-hint' }, t('customNote')) : null,

              e(SliderRow, {
                t,
                value: settings.dim,
                min: 0,
                max: 100,
                disabled,
                title: t('dimTitle'),
                desc: t('dimDesc'),
                onChange: onDim
              }),
              e(SliderRow, {
                t,
                value: settings.glass,
                min: 0,
                max: 100,
                disabled,
                title: t('glassTitle'),
                desc: t('glassDesc'),
                onChange: onGlass
              }),

              e('div', { className: 'agp-footer' },
                e('button', {
                  type: 'button',
                  className: 'agp-btn agp-btnGhost',
                  disabled: !writable,
                  onClick: () => {
                    face.reset().then(
                      () => flash(t('resetDone')),
                      () => flash(t('saveFailed'))
                    );
                  }
                }, t('reset'))
              ),
              e('p', { className: 'agp-hint' }, t('resetHint')),
              e('p', { className: 'agp-hint' }, t('codeHint')),

              !writable && ready ? e('div', { className: 'agp-banner' }, t('readonly')) : null
            )
      );
    }

    function CustomWallpaperRow(props) {
      const { t, image, disabled, onApply, onRemove, onError, maxBytes } = props;
      const [text, setText] = useState(image);
      const fileRef = useRef(null);
      useEffect(() => setText(image), [image]);
      const apply = () => {
        const source = text.trim();
        if (!source) return;
        if (!/^https?:\/\//i.test(source)) {
          onError('customInvalid');
          return;
        }
        onApply(source);
      };
      const onFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (file.size > maxBytes) {
          onError('customSize');
          event.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          onApply(String(reader.result ?? ''));
          event.target.value = '';
        };
        reader.onerror = () => onError('customInvalid');
        reader.readAsDataURL(file);
      };
      return e('div', {},
        e('div', { className: 'agp-inputRow' },
          e('input', {
            className: 'agp-text',
            type: 'text',
            value: text,
            placeholder: 'https://…',
            disabled,
            'aria-label': t('customUrl'),
            onInput: (event) => setText(event.target.value)
          }),
          e('button', { type: 'button', className: 'agp-btn', disabled, onClick: apply }, t('customApply'))
        ),
        e('div', { className: 'agp-inputRow', style: { marginTop: 8 } },
          e('button', {
            type: 'button',
            className: 'agp-btn',
            disabled,
            onClick: () => fileRef.current && fileRef.current.click()
          }, t('customUpload')),
          image ? e('button', {
            type: 'button',
            className: 'agp-btn agp-btnGhost',
            disabled,
            onClick: onRemove
          }, t('customRemove')) : null,
          e('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: onFile
          })
        )
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Plugin body.
    // ─────────────────────────────────────────────────────────────────────
    /** Services required before this plugin activates (native client ids). */
    const inject = ['slots', 'locale', 'remote', 'configForms'];

    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS);
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }),
        'aurora-glass: dictionaries');

      // Static CSS + backdrop layer exist for the whole plugin lifetime; the
      // "off" state simply hides them (gated through the root attributes).
      ctx.effect(() => ensureStylesheet(ctx), 'aurora-glass: stylesheet');
      ctx.effect(() => ensureBackdrop(), 'aurora-glass: backdrop layer');

      // Durable form mirror: the shared, revision-fenced view of this entry's
      // volatile config that every editor on the page reads and writes.
      const scope = ctx.configForms.get(ENTRY_ID);
      let lastApplied = null;

      const preview = (settings) => {
        if (settings !== lastApplied) {
          lastApplied = settings;
          applyPalette(settings);
        }
      };

      const adopt = () => {
        const snapshot = scope.getSnapshot();
        if (snapshot.status !== 'ready' || snapshot.value === undefined) return;
        const settings = normalize(snapshot.value);
        lastApplied = settings;
        applyPalette(settings);
      };

      ctx.effect(() => {
        const dispose = scope.subscribe(adopt);
        adopt();
        return dispose;
      }, 'aurora-glass: settings adoption');

      // Face handed to the settings section; functions keep stable identity so
      // React's useSyncExternalStore sees a stable getSnapshot/subscribe pair.
      const face = {
        getSnapshot: () => scope.getSnapshot(),
        subscribe: (listener) => scope.subscribe(listener),
        preview,
        update: (patch) => {
          const field = patchField(patch);
          const value = patchValue(patch);
          if (field === null) return Promise.resolve();
          const next = normalize({ ...(scope.getSnapshot().value ?? DEFAULTS), ...patch });
          preview(next);
          return scope.set(field, value);
        },
        reset: () => {
          // Unset every field in order so the document re-inherits the schema
          // defaults; each unset uses the documented scope API.
          let chain = Promise.resolve();
          for (const field of FIELDS) chain = chain.then(() => scope.unset(field));
          return chain;
        }
      };

      // The page follows the Host's served namespaces: it is registered only
      // while the `aurora-glass` entry is active and its volatile fields are
      // served, and is withdrawn when that entry stops being served.
      ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () =>
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'aurora-glass',
          order: 40,
          label: () => t('nav'),
          locale: LOCALE_NS,
          inject: () => ({ face })
        }, AuroraGlassSection))
      ), 'aurora-glass: settings section');
    }

    /** Extract the single field name of a one-key patch (used by face.update). */
    function patchField(patch) {
      for (const key of FIELDS) if (key in patch) return key;
      return null;
    }
    function patchValue(patch) {
      for (const key of FIELDS) if (key in patch) return patch[key];
      return undefined;
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
