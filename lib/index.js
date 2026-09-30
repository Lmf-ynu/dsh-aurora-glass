// dsh-aurora-glass — host (Node) half.
//
// This file is the server-side Cordis plugin of the dual-face package. It is
// mounted as a Loader row named `aurora-glass` (see ./cordis.patch.yml).
//
// Since dsh 0.2 the Host no longer keeps a separate user-settings document with
// per-plugin namespaces: a plugin's editable preferences ARE its profile entry
// config. This half therefore declares `Config` — the volatile fields the
// browser half reads and writes through `ctx.configForms.get(ENTRY_ID)` — and
// opts out of the auto-generated settings form because the package ships its
// own page.
//
// The package deliberately carries no other host behaviour: the whole visual
// feature lives in the client half (./client.js).
import z from '@deepseek-ai/schemastery';

/**
 * Loader row id this plugin is mounted under. The settings form is keyed by
 * this exact id, so it must stay in sync with ./cordis.patch.yml and with the
 * `ENTRY_ID` constant in the client half.
 */
export const ENTRY_ID = 'aurora-glass';

/** Master switch: render the aurora backdrop and the glass surfaces. */
export const ENABLED_FIELD = 'enabled';
/** Backdrop style id (see PRESETS in the client half). */
export const PRESET_FIELD = 'preset';
/** Custom wallpaper: http(s) URL or a data: URL (uploaded file). */
export const IMAGE_FIELD = 'image';
/** Dim veil strength, percent 0..100. */
export const DIM_FIELD = 'dim';
/** Glass translucency, percent 0..100 (0 = native opaque surfaces). */
export const GLASS_FIELD = 'glass';

/**
 * Live appearance settings. Each field is `.volatile()` so the settings form
 * may edit it at runtime; accepted writes persist into the profile's Cordis
 * patch. Values stay permissive (a free-form preset id) because the browser
 * half normalizes anything unknown instead of rejecting a hand-edited value.
 */
export const Config = z.object({
  [ENABLED_FIELD]: z.boolean().default(false).volatile(),
  [PRESET_FIELD]: z.string().default('aurora').volatile(),
  [IMAGE_FIELD]: z.string().default('').volatile(),
  [DIM_FIELD]: z.number().min(0).max(100).default(35).volatile(),
  [GLASS_FIELD]: z.number().min(0).max(100).default(55).volatile()
});

/**
 * Claim this plugin's settings surface. The child context names the owning
 * plugin fiber, so a late-loaded or replaced Settings service still adopts the
 * policy, and the plugin keeps working without Settings composed at all.
 * @param ctx - Host context of the owning plugin.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}
