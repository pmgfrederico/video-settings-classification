// Builds schema/video_settings_ui_schema_Version4.json from the compact field table below.
// Facet defaults (editableIn derived from tier + preview, option labels from v2 enums) are applied here
// so every field is classified consistently. Run: node tools/build-ui-schema.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v2 = JSON.parse(readFileSync(join(root, 'schema/video_settings.schema_Version2.json'), 'utf8'));

// ---- v2 schema lookup -------------------------------------------------------
function v2Node(path) {
  let node = v2;
  for (const key of path.split('.')) {
    node = node?.properties?.[key];
    if (!node) return null;
  }
  return node;
}

const LABEL_OVERRIDES = {
  Supersampling_1x5: '1.5x', Supersampling_2x: '2x', Supersampling_4x: '4x',
  FrameGeneration_2x: '2x', FrameGeneration_3x: '3x', FrameGeneration_4x: '4x',
  NumDashDisplays_None: 'None', NumDashDisplays_MaxOne: 'Max 1', NumDashDisplays_MaxTwo: 'Max 2',
  ScreenSpaceShadowQuality_HalfRes: 'Half res', ScreenSpaceShadowQuality_FullRes: 'Full res',
  AmbientOcclusionType_SSAO: 'SSAO', AmbientOcclusionType_RTAO: 'RTAO (ray traced)',
  Multi_Fixed: 'Fixed', Multi_Dynamic: 'Dynamic', Multi_VR: 'On', Multi_VR_Off: 'Off',
  Mirror_Single: 'Single', Mirror_Multi: 'Multi', Mirror_Off: 'Off',
  CloudsRenderingMode_Quality: 'Quality', CloudsRenderingMode_Performance: 'Performance',
};
function prettyOption(value) {
  if (typeof value === 'number') return String(value);
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  const m = /^videoOption(.+)$/.exec(value);
  if (m) return m[1];
  const tail = value.includes('_') ? value.slice(value.lastIndexOf('_') + 1) : value;
  return tail.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^Off$/, 'Off');
}

// ---- metadata ---------------------------------------------------------------
const groups = [
  { id: 'display', label: 'Display & Output', icon: 'monitor', sections: [
    { id: 'mode', label: 'Display mode' },
    { id: 'monitor', label: 'Monitor & window' },
    { id: 'triple', label: 'Triple-screen geometry' },
    { id: 'vr', label: 'VR headset' } ] },
  { id: 'performance', label: 'Performance & Latency', icon: 'speed', sections: [
    { id: 'resolution', label: 'Resolution pipeline' },
    { id: 'upscaling', label: 'Upscaling' },
    { id: 'framegen', label: 'Frame generation' },
    { id: 'latency', label: 'Latency' },
    { id: 'pacing', label: 'Frame pacing & sync' } ] },
  { id: 'image', label: 'Image Quality', icon: 'hd', sections: [
    { id: 'preset', label: 'Overall quality preset' },
    { id: 'aa', label: 'Anti-aliasing & sharpening' },
    { id: 'textures', label: 'Textures & filtering' } ] },
  { id: 'world', label: 'World Detail', icon: 'landscape', sections: [
    { id: 'distance', label: 'View distance' },
    { id: 'lod', label: 'Level of detail' },
    { id: 'lighting', label: 'Lighting & shadows' },
    { id: 'reflections', label: 'Environment reflections' },
    { id: 'atmosphere', label: 'Sky & atmosphere' },
    { id: 'vegetation', label: 'Terrain, vegetation & particles' } ] },
  { id: 'car', label: 'Car & Cockpit', icon: 'directions_car', sections: [
    { id: 'mirrors', label: 'Mirrors' },
    { id: 'vehicle', label: 'Vehicle detail' },
    { id: 'visibility', label: 'Cars on track' },
    { id: 'cockpit', label: 'Cockpit displays' } ] },
  { id: 'look', label: 'Look', icon: 'tune', sections: [
    { id: 'grading', label: 'Post-process & exposure' },
    { id: 'camera', label: 'Camera effects' },
    { id: 'vrcomfort', label: 'VR comfort' } ] },
];

// Default editability from tier + preview kind (facet F6, rule R8). Fields may override.
function defaultEditableIn(tier, preview) {
  if (tier === 1 || tier === 'R') return ['menu'];
  if (tier === 2) return ['menu', 'session.paused'];
  if (preview === 'live-visual' || preview === 'live-geometry') return ['menu', 'session.paused', 'session.live'];
  return ['menu', 'session.paused'];
}

// ---- field table ------------------------------------------------------------
// Short keys: g group, s section, sc scope, t tier, p preview, i impact, d disclosure, r role
const Q4 = { Low: 0.9, Medium: 0.95, High: 1, Ultra: 1.06 };
function qmap(prefix, mults) {
  const out = {};
  for (const [k, v] of Object.entries(mults)) out[`${prefix}_${k}`] = v;
  return out;
}

const F = [];
const add = (path, o) => F.push({ path, ...o });

// Display & Output — mode
add('display.mode', { label: 'Display mode', help: 'Choose how the game is shown: one monitor, three monitors, or a VR headset. Other display settings depend on this choice.',
  g: 'display', s: 'mode', sc: ['general'], t: 1, p: 'none', i: ['gpu', 'cpu'], d: 'basic', r: 'controller', control: 'segmented', engineSupport: 'proposed',
  options: [
    { value: 'single', label: 'Single screen' },
    { value: 'triple', label: 'Triple screen', gate: { hw: { ref: 'facts:display.monitors.length', gte: 3 }, hwReason: 'Needs three connected monitors' } },
    { value: 'vr', label: 'VR headset', gate: { os: [{ when: { ref: 'facts:vr.connected', neq: true }, reason: 'No headset detected. Connect it and start your OpenXR runtime.' }] } },
  ],
  readouts: ['outputResolution'],
  v2: { from: ['display.is_triple', 'display.is_stereo'], note: 'is_stereo → vr, is_triple → triple, otherwise single' },
  dx12: 'Mode switch recreates the swapchain(s): one, three child windows, or an OpenXR swapchain pair.' });

// Monitor & window
add('display.monitor', { label: 'Monitor', help: 'Which display the game opens on.', g: 'display', s: 'monitor', sc: ['single'], t: 1, p: 'none', i: [], d: 'basic', r: 'independent', control: 'select', optionsFrom: 'facts.monitors', dx12: 'Swapchain is recreated on the new output (IDXGIOutput).' });
add('display.resolution', { label: 'Resolution', help: 'Output resolution of the game window.', g: 'display', s: 'monitor', sc: ['single'], t: 1, p: 'none', i: ['gpu', 'vram'], d: 'basic', r: 'controller', control: 'select', optionsFrom: 'facts.resolutions', engineSupport: 'proposed',
  readouts: ['outputResolution'], v2: { from: ['display.window_width', 'display.window_height'] }, dx12: 'ResizeBuffers + every resolution-dependent render target is reallocated.' });
add('display.window_mode', { label: 'Window mode', help: 'Exclusive fullscreen, borderless window, or a regular window.', g: 'display', s: 'monitor', sc: ['single'], t: 1, p: 'none', i: ['latency'], d: 'basic', r: 'independent', control: 'segmented', engineSupport: 'proposed',
  options: [ { value: 'fullscreen', label: 'Fullscreen' }, { value: 'borderless', label: 'Borderless' }, { value: 'windowed', label: 'Windowed' } ],
  readouts: ['windowModeNote'], v2: { from: ['display.is_fullscreen', 'display.is_maximized'] }, dx12: 'Fullscreen transition changes the swapchain present model.' });
add('display.aspect_ratio', { label: 'Aspect ratio', help: 'Aspect ratio of the rendered image. Auto matches the monitor.', g: 'display', s: 'monitor', sc: ['single'], t: 1, p: 'none', i: [], d: 'advanced', r: 'independent', control: 'segmented', engineSupport: 'proposed',
  options: [ { value: 'auto', label: 'Auto' }, { value: '16:9', label: '16:9' }, { value: '16:10', label: '16:10' }, { value: '21:9', label: '21:9' }, { value: '32:9', label: '32:9' } ],
  v2: { from: ['display.aspect_ratio_x', 'display.aspect_ratio_y'] } });

// Triple geometry
const tri = { g: 'display', s: 'triple', sc: ['triple'], t: 3, p: 'live-geometry', i: [], d: 'basic', r: 'independent', control: 'slider', readouts: ['tripleFov'] };
add('display.triple_screen.width', { ...tri, label: 'Screen width', help: 'Visible width of one panel, without bezels.', range: { min: 300, max: 1000, step: 1, unit: 'mm' } });
add('display.triple_screen.distance', { ...tri, label: 'Eye-to-screen distance', help: 'Distance from your eyes to the center screen.', range: { min: 300, max: 1500, step: 5, unit: 'mm' } });
add('display.triple_screen.screen_angle', { ...tri, label: 'Side screen angle', help: 'Angle of each side screen relative to the center one.', range: { min: 0, max: 90, step: 0.5, unit: '°' }, readouts: ['tripleFov', 'tripleAngleAdvice'] });
add('display.triple_screen.bezel', { ...tri, label: 'Bezel width', help: 'Bezel width per screen edge. Hides the part of the image that would sit behind it.', range: { min: 0, max: 60, step: 1, unit: 'mm' }, d: 'advanced' });
add('display.panini.distance', { ...tri, label: 'Panini projection', help: 'Reduces stretching at the edges of a wide field of view.', range: { min: 0, max: 1, step: 0.01 }, d: 'advanced', readouts: [] });
add('display.panini.vertical_compression', { ...tri, label: 'Panini vertical compression', help: 'Straightens vertical lines when Panini projection is on.', range: { min: 0, max: 1, step: 0.01 }, d: 'expert', readouts: [] });

// VR headset
const vr = { g: 'display', s: 'vr', sc: ['hmd'], t: 1, p: 'none', d: 'basic', r: 'independent' };
add('vr.pixel_density', { ...vr, label: 'Pixel density', help: 'Render resolution as a percentage of the headset runtime recommendation.', i: ['gpu', 'vram'], control: 'slider', range: { min: 50, max: 200, step: 5, unit: '%' }, readouts: ['vrResolution'] });
add('vr.foveated_rendering', { ...vr, label: 'Foveated rendering', help: 'Renders the edge of each lens at lower detail.', i: ['gpu'], r: 'controller', control: 'segmented' });
add('vr.eye_tracked_foveated_rendering', { ...vr, label: 'Eye-tracked foveation', help: 'Moves the full-detail region to where you are looking.', i: ['gpu'], r: 'dependent', control: 'toggle',
  gate: { hw: { ref: 'facts:vr.eyeTracking', eq: true }, hwReason: 'Headset has no eye tracking' }, v2: { capability: 'vr.can_use_eye_tracking' } });
add('vr.prefer_framerate_over_latency', { ...vr, label: 'Prefer frame rate over latency', help: 'Allows deeper frame queuing to hold the headset refresh rate.', i: ['latency'], d: 'advanced', control: 'toggle' });
add('vr.disable_hidden_area_mask', { ...vr, label: 'Disable hidden-area mask', help: 'Renders pixels outside the lens view. For debugging only.', i: ['gpu'], d: 'expert', control: 'toggle' });
add('vr.enable_spectator_view', { ...vr, label: 'Spectator view', help: 'Mirrors the headset view to the desktop window.', i: ['gpu'], d: 'advanced', control: 'toggle' });
add('vr.render_to_intermediate_target', { ...vr, label: 'Render to intermediate target', help: 'Adds a copy step before submitting to the runtime. Can fix compatibility with some runtimes.', i: ['gpu'], d: 'expert', control: 'toggle' });
add('vr.log_vr_pacing', { ...vr, label: 'Log VR frame pacing', help: 'Writes frame-timing diagnostics to the log.', t: 3, i: [], d: 'expert', control: 'toggle', p: 'metric-only' });

// Performance — resolution pipeline
add('display.render_resolution', { label: 'Render → output', help: 'The resolution the game renders at internally and the resolution it outputs. Calculated from upscaling, supersampling and display settings.', g: 'performance', s: 'resolution', sc: ['general'], t: null, p: 'none', i: [], d: 'basic', r: 'derived', control: 'readout', readouts: ['pipeline'],
  v2: { from: ['display.render_width', 'display.render_height', 'display.output_width', 'display.output_height', 'display.child_width', 'display.child_height'], note: 'Derived values, shown read-only (R11)' } });
add('display.supersampling', { label: 'Supersampling', help: 'Renders above the output resolution, then downsamples. Very expensive.', g: 'performance', s: 'resolution', sc: ['general'], t: 1, p: 'snapshot', i: ['gpu', 'vram'], d: 'advanced', r: 'dependent', control: 'segmented', readouts: ['supersamplingResolution'],
  dx12: 'Reallocates every resolution-dependent target and rebuilds the downsample PSO.', note: 'Factor assumed per axis (1.5x at 4K = 5760×3240, same as the prototype). Confirm with the engine team.' });

// Upscaling (concept-first, R14)
add('graphics.upscaling.provider', { label: 'Upscaler', help: 'Renders at a lower resolution and reconstructs the image at your output resolution. The list shows only the technologies this PC can run.', g: 'performance', s: 'upscaling', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu', 'vram'], d: 'basic', r: 'controller', control: 'provider', concept: 'upscaling', optionsFrom: 'providers.upscaling', engineSupport: 'proposed',
  v2: { from: ['graphics.upscaling.mode'], note: 'Upscaling_DLSS → dlss; Upscaling_FSR → fsr4 if supported else fsr31' },
  dx12: 'Streamline proxy swapchain persists. Switching unloads one sl feature, loads another and re-tags color/depth/MV/exposure resources via slSetTag. No swapchain recreation.' });
add('graphics.upscaling.mode', { label: 'Upscaling mode', help: 'How much lower the game renders before reconstruction. Each option shows the actual resolution on this PC.', g: 'performance', s: 'upscaling', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'dependent', control: 'chips', concept: 'upscaling', optionsFrom: 'providers.upscaling.modes', readouts: ['renderResolution'], readoutInline: true, engineSupport: 'proposed',
  v2: { from: ['graphics.upscaling.fsr_preset', 'graphics.upscaling.dlss_preset'] },
  dx12: 'Preset change resizes tagged inputs within the loaded feature context.' });
add('graphics.upscaling.custom_scale', { label: 'Custom render scale', help: 'Render scale per axis.', g: 'performance', s: 'upscaling', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'dependent', control: 'slider', concept: 'upscaling', range: { min: 0.33, max: 1, step: 0.01, unit: '×' }, readouts: ['renderResolution'], engineSupport: 'proposed',
  v2: { from: ['graphics.upscaling.fsr_custom_val', 'graphics.upscaling.dlss_custom_val'] } });
add('graphics.upscaling.dlss_model', { label: 'DLSS model', help: 'Which DLSS model the game uses. Driver default follows NVIDIA\'s recommendation.', g: 'performance', s: 'upscaling', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'expert', r: 'dependent', control: 'segmented', concept: 'upscaling', engineSupport: 'proposed',
  options: [ { value: 'default', label: 'Driver default' }, { value: 'transformer', label: 'Transformer' }, { value: 'cnn', label: 'CNN (legacy)' } ] });

// Frame generation
add('graphics.frame_generation.provider', { label: 'Frame generation', help: 'Generates extra frames between rendered ones. Motion looks smoother, but latency goes up by about one rendered frame.', g: 'performance', s: 'framegen', sc: ['general'], t: 2, p: 'metric-only', i: ['gpu', 'vram', 'latency'], d: 'basic', r: 'controller', control: 'provider', concept: 'frameGeneration', optionsFrom: 'providers.frameGeneration', engineSupport: 'proposed',
  v2: { from: ['graphics.frame_generation.mode'] },
  dx12: 'DLSS-G / FSR FG load as sl features through the resident proxy swapchain. Allocates interpolated-frame buffers and enables latency markers.' });
add('graphics.frame_generation.multiplier', { label: 'Frame generation multiplier', help: 'Presented frames per rendered frame.', g: 'performance', s: 'framegen', sc: ['general'], t: 2, p: 'metric-only', i: ['gpu', 'vram', 'latency'], d: 'basic', r: 'dependent', control: 'chips', concept: 'frameGeneration', readouts: ['presentedFps'], readoutInline: true,
  dx12: 'Changes the count of interpolated buffers within the loaded FG feature.' });

// Latency
add('graphics.latency.mode', { label: 'Latency reduction', help: 'Shortens the queue of frames waiting for the GPU, so your inputs reach the screen sooner.', g: 'performance', s: 'latency', sc: ['general'], t: 2, p: 'metric-only', i: ['latency'], d: 'basic', r: 'coupled', control: 'provider', concept: 'latency', optionsFrom: 'providers.latency', readouts: ['latency'], engineSupport: 'proposed',
  v2: { from: ['graphics.reflex'], note: 'Reflex_Off/On/OnPlusBoost → off/reflex/reflex_boost' },
  dx12: 'sl.reflex marker insertion via the shared proxy (no NVAPI pipeline reinit).' });

// Frame pacing
add('display.v_sync', { label: 'V-Sync', help: 'Waits for the display refresh before showing a frame. Prevents tearing but adds latency. With VRR, Off plus a frame cap is usually best.', g: 'performance', s: 'pacing', sc: ['general'], t: 3, p: 'metric-only', i: ['latency'], d: 'basic', r: 'independent', control: 'segmented', readouts: ['syncNote'],
  reclassified: { from: 1, why: 'DX12 flip model: sync interval is a Present() argument (tearing support is decided once at swapchain creation), so this needs no rebuild. Confirm with the engine team.' } });
add('display.frame_rate_limit.gameplay_frame_rate_limit', { label: 'Frame rate limit', help: 'Caps frames per second while driving.', g: 'performance', s: 'pacing', sc: ['general'], t: 3, p: 'metric-only', i: ['gpu', 'cpu', 'latency'], d: 'basic', r: 'independent', control: 'slider', range: { min: 30, max: 500, step: 1, unit: 'fps' }, readouts: ['frameCap'],
  editableIn: ['menu', 'session.paused', 'session.live'], editableNote: 'Allowed in the live HUD because its effect shows up in the perf strip.' });
add('display.frame_rate_limit.occluded_frame_rate_limit', { label: 'Background frame rate limit', help: 'Caps frames per second when the window is hidden or not focused.', g: 'performance', s: 'pacing', sc: ['general'], t: 3, p: 'metric-only', i: ['gpu'], d: 'advanced', r: 'independent', control: 'slider', range: { min: 10, max: 500, step: 1, unit: 'fps' } });
add('display.frame_rate_limit.menu_frame_rate_limit', { label: 'Limit frame rate in menus', help: 'Caps menus at a lower rate to save power and reduce heat.', g: 'performance', s: 'pacing', sc: ['general'], t: 3, p: 'metric-only', i: ['gpu'], d: 'advanced', r: 'independent', control: 'toggle' });
add('display.physics_late_latching', { label: 'Physics late latching', help: 'Samples the newest physics state just before rendering, which lowers perceived input latency.', g: 'performance', s: 'pacing', sc: ['general'], t: 3, p: 'metric-only', i: ['cpu', 'latency'], d: 'advanced', r: 'independent', control: 'toggle' });

// Image quality — preset
add('graphics.overallGraphics', { label: 'Quality preset', help: 'Sets the detail settings below in one step. Changing any of them switches the preset to Custom.', g: 'image', s: 'preset', sc: ['general'], t: 'dynamic', p: 'snapshot', i: ['gpu', 'cpu', 'vram'], d: 'basic', r: 'controller', control: 'segmented', presetParent: true,
  note: 'Apply tier is dynamic: the cost is the highest tier among the children the preset actually changes (R6, R9).' });
// AA & sharpening
add('graphics.msaa', { label: 'MSAA', help: 'Multi-sample anti-aliasing for geometry edges. Works alongside an upscaler.', g: 'image', s: 'aa', sc: ['general'], t: 1, p: 'snapshot', i: ['gpu', 'vram'], d: 'basic', r: 'independent', control: 'segmented',
  cost: { gpu: { MSAA_Off: 1, MSAA_2x: 1.08, MSAA_4x: 1.16, MSAA_8x: 1.32 }, vramPerMP: { MSAA_Off: 0, MSAA_2x: 0.03, MSAA_4x: 0.07, MSAA_8x: 0.14 } },
  dx12: 'Sample count is baked into render-target formats and PSOs, so a full PSO rebuild is needed.' });
add('graphics.antialising.filmicAntialiasing.setting', { label: 'Temporal AA', help: 'The engine\'s temporal anti-aliasing filter. Soft reduces shimmer; Sharp keeps more detail.', g: 'image', s: 'aa', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented' });
add('graphics.antialising.fxaa.enable', { label: 'FXAA', help: 'Cheap post-process edge smoothing. Slightly blurs the image.', g: 'image', s: 'aa', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'advanced', r: 'independent', control: 'toggle' });
add('graphics.sharpening.strength', { label: 'Sharpening', help: 'Restores detail softened by upscaling and temporal AA.', g: 'image', s: 'aa', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'independent', control: 'slider', range: { min: 0, max: 1, step: 0.01 }, readouts: ['sharpeningPath'] });
// Textures
add('graphics.textureQuality', { label: 'Texture quality', help: 'Resolution of surface textures. Mostly uses VRAM.', g: 'image', s: 'textures', sc: ['general'], t: 1, p: 'snapshot', i: ['vram'], d: 'basic', r: 'independent', control: 'segmented', readouts: ['vram'], presetChild: 'graphics.overallGraphics',
  cost: { vramGB: { TextureQuality_Low: 1.2, TextureQuality_Medium: 2.2, TextureQuality_High: 3.6, TextureQuality_Ultra: 5.8 } },
  dx12: 'Streaming mip ranges and descriptor heaps are rebuilt.' });
add('graphics.texturePoolSize', { label: 'Texture streaming pool', help: 'VRAM reserved for streaming textures. Larger pools mean less pop-in but need more VRAM.', g: 'image', s: 'textures', sc: ['general'], t: 1, p: 'none', i: ['vram'], d: 'advanced', r: 'independent', control: 'segmented', readouts: ['vram'],
  cost: { vramGB: { TexturePoolSize_Low: 0.5, TexturePoolSize_Medium: 1.0, TexturePoolSize_High: 1.5, TexturePoolSize_Ultra: 2.5 } }, dx12: 'Pool heap is reallocated.' });
add('graphics.materialQuality', { label: 'Material quality', help: 'Shader complexity of surfaces.', g: 'image', s: 'textures', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: qmap('MaterialQuality', Q4) }, dx12: 'Permutation PSOs swapped from cache.' });
add('graphics.anisotropicFiltering.anisotropicFilteringQuality', { label: 'Anisotropic filtering', help: 'Keeps textures sharp at glancing angles, such as the road ahead.', g: 'image', s: 'textures', sc: ['general'], t: 1, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'controller', control: 'segmented', presetParent: true,
  dx12: 'Static samplers are baked into root signatures, so a root-signature/PSO rebuild is needed.' });
const af = { g: 'image', s: 'textures', sc: ['general'], t: 1, p: 'snapshot', i: ['gpu'], d: 'expert', r: 'dependent', control: 'segmented', presetChild: 'graphics.anisotropicFiltering.anisotropicFilteringQuality' };
add('graphics.anisotropicFiltering.customSettings.mainAnisotropicFiltering', { ...af, label: 'AF — main' });
add('graphics.anisotropicFiltering.customSettings.mainLowAnisotropicFiltering', { ...af, label: 'AF — main (low detail)' });
add('graphics.anisotropicFiltering.customSettings.cubemapMirrorAnisotropicFiltering', { ...af, label: 'AF — cubemaps & mirrors' });
add('graphics.anisotropicFiltering.customSettings.mainAnisotropicMipBias', { ...af, t: 3, p: 'live-visual', control: 'slider', range: { min: -2, max: 2, step: 0.05 }, label: 'Mip bias — main', help: 'Negative values sharpen textures but increase shimmer.' });
add('graphics.anisotropicFiltering.customSettings.mainLowAnisotropicMipBias', { ...af, t: 3, p: 'live-visual', control: 'slider', range: { min: -2, max: 2, step: 0.05 }, label: 'Mip bias — main (low detail)' });

// World — distance
add('graphics.viewDistance.quality', { label: 'View distance', help: 'How far scenery, objects and shadows are drawn. Mostly costs CPU time.', g: 'world', s: 'distance', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu', 'gpu'], d: 'basic', r: 'controller', control: 'segmented', presetParent: true, presetChild: 'graphics.overallGraphics', readouts: ['distance'],
  cost: { cpu: { ViewDistanceQuality_Low: 0.82, ViewDistanceQuality_Medium: 0.9, ViewDistanceQuality_High: 1, ViewDistanceQuality_Ultra: 1.18 }, gpu: { ViewDistanceQuality_Low: 0.95, ViewDistanceQuality_Medium: 0.97, ViewDistanceQuality_High: 1, ViewDistanceQuality_Ultra: 1.05 } } });
const vd = { g: 'world', s: 'distance', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu'], d: 'advanced', r: 'dependent', control: 'slider', presetChild: 'graphics.viewDistance.quality', readouts: ['distance'] };
add('graphics.viewDistance.overallDistance', { ...vd, label: 'Overall distance', range: { min: 500, max: 20000, step: 100, unit: 'm' } });
add('graphics.viewDistance.objectDistance', { ...vd, label: 'Object distance', range: { min: 200, max: 6000, step: 50, unit: 'm' } });
add('graphics.viewDistance.treeDistance', { ...vd, label: 'Tree distance', range: { min: 200, max: 8000, step: 50, unit: 'm' } });
add('graphics.viewDistance.vegetationDistance', { ...vd, label: 'Vegetation distance', range: { min: 50, max: 1500, step: 10, unit: 'm' } });
add('graphics.viewDistance.crowdDistance', { ...vd, label: 'Crowd distance', range: { min: 100, max: 3000, step: 50, unit: 'm' } });
add('graphics.viewDistance.shadowDistance', { ...vd, label: 'Shadow distance', range: { min: 100, max: 1500, step: 10, unit: 'm' }, i: ['gpu', 'cpu'] });
// LOD
add('graphics.levelOfDetail.levelOfDetail', { label: 'Level of detail', help: 'How soon models switch to simpler versions as they move away.', g: 'world', s: 'lod', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu', 'gpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { cpu: qmap('LevelOfDetailQuality', { Low: 0.92, Medium: 0.96, High: 1, Ultra: 1.08 }), gpu: qmap('LevelOfDetailQuality', { Low: 0.95, Medium: 0.97, High: 1, Ultra: 1.04 }) } });
add('graphics.levelOfDetail.experimentalStaticLevelOfDetail', { label: 'Static LOD (experimental)', help: 'Uses fixed LOD levels for static scenery instead of distance-based switching.', g: 'world', s: 'lod', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu'], d: 'expert', r: 'controller', control: 'toggle' });
add('graphics.levelOfDetail.staticLevelOfDetail', { label: 'Static LOD level', g: 'world', s: 'lod', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu'], d: 'expert', r: 'dependent', control: 'segmented' });
const lod = { g: 'world', s: 'lod', sc: ['general'], t: 3, p: 'snapshot', i: ['cpu', 'gpu'], d: 'expert', r: 'independent', control: 'slider', range: { min: 0, max: 4, step: 0.05, unit: '×' } };
add('graphics.levelOfDetail.levelOfDetailCustomSettings.mainLodDistanceScale', { ...lod, label: 'LOD distance scale — main' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.mirrorLodDistanceScale', { ...lod, label: 'LOD distance scale — mirrors' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.cubemapLodDistanceScale', { ...lod, label: 'LOD distance scale — cubemaps' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.shadowLodDistanceScale', { ...lod, label: 'LOD distance scale — shadows' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.mainLodOutDistanceScale', { ...lod, label: 'LOD fade-out scale — main' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.mirrorLodOutDistanceScale', { ...lod, label: 'LOD fade-out scale — mirrors' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.cubemapLodOutDistanceScale', { ...lod, label: 'LOD fade-out scale — cubemaps' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.shadowLodOutDistanceScale', { ...lod, label: 'LOD fade-out scale — shadows' });
// Lighting & shadows
add('graphics.shadow.shadowQuality', { label: 'Shadow quality', help: 'Resolution and filtering of world shadows.', g: 'world', s: 'lighting', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu', 'vram'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: qmap('ShadowQuality', { Low: 0.9, Medium: 0.95, High: 1, Ultra: 1.08 }), vramGB: qmap('ShadowQuality', { Low: 0.1, Medium: 0.2, High: 0.35, Ultra: 0.7 }) }, dx12: 'Shadow atlas reallocated.' });
add('graphics.shadow.screenSpaceShadowQuality', { label: 'Contact shadows', help: 'Screen-space shadows for small details.', g: 'world', s: 'lighting', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'segmented',
  cost: { gpu: { ScreenSpaceShadowQuality_Off: 0.97, ScreenSpaceShadowQuality_HalfRes: 0.99, ScreenSpaceShadowQuality_FullRes: 1.02 } } });
add('graphics.ambientOcclusion', { label: 'Ambient occlusion', help: 'Soft shadowing where surfaces meet.', g: 'world', s: 'lighting', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'basic', r: 'controller', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: { AmbientOcclusionQuality_Off: 0.94, AmbientOcclusionQuality_Low: 0.97, AmbientOcclusionQuality_Medium: 0.99, AmbientOcclusionQuality_High: 1 } } });
add('graphics.ambientOcclusionType', { label: 'Ambient occlusion technique', help: 'Screen-space (SSAO) or ray traced (RTAO). RTAO is more accurate and much more expensive.', g: 'world', s: 'lighting', sc: ['general'], t: 1, p: 'snapshot', i: ['gpu', 'vram'], d: 'advanced', r: 'dependent', control: 'segmented',
  optionGates: { AmbientOcclusionType_RTAO: { hw: { ref: 'facts:gpu.dxr', eq: '1.1' }, hwReason: 'Needs DirectX Raytracing 1.1' } },
  cost: { gpu: { AmbientOcclusionType_SSAO: 1, AmbientOcclusionType_RTAO: 1.15 } }, dx12: 'RTAO needs BLAS/TLAS builds and a DXR pipeline state object.' });
add('graphics.giUpdateFrequency', { label: 'Global illumination updates', help: 'How often bounced light is recalculated as time of day and weather change.', g: 'world', s: 'lighting', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'segmented' });
add('graphics.enviromentReflection', { label: 'Environment reflections', help: 'Quality of reflections on the world (not on cars).', g: 'world', s: 'reflections', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu', 'vram'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: { EnvironmentReflectionQuality_Off: 0.93, EnvironmentReflectionQuality_Low: 0.96, EnvironmentReflectionQuality_Medium: 0.98, EnvironmentReflectionQuality_High: 1 } } });
// Atmosphere
add('graphics.clouds.cloudsQuality', { label: 'Cloud quality', help: 'Detail of volumetric clouds.', g: 'world', s: 'atmosphere', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'controller', control: 'segmented', presetParent: true, presetChild: 'graphics.overallGraphics',
  cost: { gpu: { CloudsQuality_Low: 0.93, CloudsQuality_Medium: 0.97, CloudsQuality_High: 1, CloudsQuality_Custom: 1 } } });
add('graphics.clouds.cloudsCustomSettings.resolution', { label: 'Cloud resolution', g: 'world', s: 'atmosphere', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu', 'vram'], d: 'expert', r: 'dependent', control: 'segmented', presetChild: 'graphics.clouds.cloudsQuality' });
add('graphics.clouds.cloudsCustomSettings.renderingTimeslicedOverFramesNumber', { label: 'Cloud update spread (frames)', help: 'Spreads cloud rendering across N frames. Higher is cheaper but may smear when clouds move fast.', g: 'world', s: 'atmosphere', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'expert', r: 'dependent', control: 'slider', range: { min: 1, max: 32, step: 1 }, presetChild: 'graphics.clouds.cloudsQuality' });
add('graphics.clouds.cloudsRenderingMode', { label: 'Cloud rendering mode', g: 'world', s: 'atmosphere', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'segmented' });
add('graphics.volumetricsQuality', { label: 'Volumetric lighting', help: 'Light shafts and fog volumes.', g: 'world', s: 'atmosphere', sc: ['general'], t: 2, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: { VolumetricsQuality_Off: 0.92, VolumetricsQuality_Low: 0.96, VolumetricsQuality_Medium: 1, VolumetricsQuality_High: 1.06 } } });
// Terrain, vegetation, particles
add('graphics.terrain.groundQuality', { label: 'Ground detail', g: 'world', s: 'vegetation', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics' });
add('graphics.grass', { label: 'Grass density', g: 'world', s: 'vegetation', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu', 'cpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics',
  cost: { gpu: { GrassDensity_Off: 0.95, GrassDensity_Low: 0.97, GrassDensity_Medium: 0.99, GrassDensity_High: 1 } } });
add('graphics.vegetationWind', { label: 'Vegetation wind', g: 'world', s: 'vegetation', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'segmented' });
add('graphics.particles.quality', { label: 'Particle quality', help: 'Smoke, dust, spray and debris.', g: 'world', s: 'vegetation', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented', presetChild: 'graphics.overallGraphics' });
add('graphics.particles.essential', { label: 'Essential particles only', help: 'Keeps only particles that matter for driving, such as tyre smoke and spray from cars ahead.', g: 'world', s: 'vegetation', sc: ['general'], t: 3, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'toggle' });

// Car & cockpit
add('graphics.mirror.mirror_mode', { label: 'Mirrors', help: 'Off, one combined mirror render, or separate renders for each mirror.', g: 'car', s: 'mirrors', sc: ['cockpit'], t: 1, p: 'snapshot', i: ['gpu', 'cpu'], d: 'basic', r: 'controller', control: 'segmented',
  cost: { gpu: { Mirror_Off: 0.92, Mirror_Single: 0.97, Mirror_Multi: 1 }, cpu: { Mirror_Off: 0.9, Mirror_Single: 0.95, Mirror_Multi: 1 } }, dx12: 'Mirror render targets and their pass graph are rebuilt.' });
const mir = { g: 'car', s: 'mirrors', sc: ['cockpit'], p: 'snapshot', d: 'basic', r: 'dependent', control: 'segmented' };
add('graphics.mirror.mirror_resolution', { ...mir, label: 'Mirror resolution', t: 2, i: ['gpu', 'vram'] });
add('graphics.mirror.mirror_view_distance', { ...mir, label: 'Mirror view distance', t: 3, i: ['cpu'] });
add('graphics.mirror.mirror_level_of_detail', { ...mir, label: 'Mirror detail', t: 3, i: ['cpu', 'gpu'] });
add('graphics.mirror.alternate_rendering', { ...mir, label: 'Alternate-frame mirrors', help: 'Updates mirrors every other frame. Halves their cost, but mirror motion is less smooth.', t: 1, i: ['gpu', 'cpu'], d: 'advanced', control: 'toggle' });
add('graphics.mirror.multi_mode', { ...mir, label: 'Multi-mirror mode', t: 1, i: ['gpu'], d: 'advanced', sc: ['cockpit'] });
add('graphics.mirror.multi_mode_vr', { ...mir, label: 'Multi-mirror in VR', t: 1, i: ['gpu'], d: 'advanced', sc: ['hmd'] });
add('graphics.vehicleLevelOfDetail', { label: 'Vehicle detail', help: 'Model detail of the other cars.', g: 'car', s: 'vehicle', sc: ['cockpit'], t: 3, p: 'snapshot', i: ['gpu', 'cpu'], d: 'basic', r: 'independent', control: 'segmented' });
add('graphics.shadow.vehicleShadowQuality', { label: 'Vehicle shadows', g: 'car', s: 'vehicle', sc: ['cockpit'], t: 3, p: 'snapshot', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented' });
add('graphics.carReflection.carReflectionQuality', { label: 'Car reflections', help: 'Reflection cubemaps on car bodies and the cockpit.', g: 'car', s: 'vehicle', sc: ['cockpit'], t: 2, p: 'snapshot', i: ['gpu', 'vram'], d: 'basic', r: 'controller', control: 'segmented', presetParent: true, presetChild: 'graphics.overallGraphics',
  cost: { gpu: { CarReflectionQuality_Off: 0.9, CarReflectionQuality_Low: 0.94, CarReflectionQuality_Medium: 0.97, CarReflectionQuality_High: 1, CarReflectionQuality_Custom: 1 } } });
const cr = { g: 'car', s: 'vehicle', sc: ['cockpit'], p: 'snapshot', d: 'expert', r: 'dependent', presetChild: 'graphics.carReflection.carReflectionQuality' };
add('graphics.carReflection.carReflectionCustomSettings.vehicleCubemapResolution', { ...cr, label: 'Vehicle cubemap resolution', t: 2, i: ['gpu', 'vram'], control: 'segmented' });
add('graphics.carReflection.carReflectionCustomSettings.cockpitCubemapResolution', { ...cr, label: 'Cockpit cubemap resolution', t: 2, i: ['gpu', 'vram'], control: 'segmented' });
add('graphics.carReflection.carReflectionCustomSettings.vehicleCubemapFarPlane', { ...cr, label: 'Vehicle cubemap far plane', t: 3, i: ['gpu'], control: 'slider', range: { min: 1, max: 2000, step: 10, unit: 'm' } });
add('graphics.carReflection.carReflectionCustomSettings.cockpitCubemapFarPlane', { ...cr, label: 'Cockpit cubemap far plane', t: 3, i: ['gpu'], control: 'slider', range: { min: 1, max: 2000, step: 10, unit: 'm' } });
const cfl = { g: 'car', s: 'vehicle', sc: ['cockpit'], t: 3, p: 'snapshot', i: ['gpu', 'cpu'], d: 'expert', r: 'independent', control: 'slider', range: { min: 0, max: 5, step: 1 } };
add('graphics.levelOfDetail.levelOfDetailCustomSettings.carFixedLodInCubemapRendering', { ...cfl, label: 'Car LOD in cubemaps' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.carFixedLodInMirrorRendering', { ...cfl, label: 'Car LOD in mirrors' });
add('graphics.levelOfDetail.levelOfDetailCustomSettings.carFixedLodInShadowRendering', { ...cfl, label: 'Car LOD in shadows' });
const vis = { g: 'car', s: 'visibility', sc: ['cockpit'], t: 3, p: 'snapshot', i: ['cpu'], r: 'independent', policy: 'server-override' };
add('graphics.car_visibility.max_ahead_car', { ...vis, label: 'Cars drawn ahead', help: 'Maximum number of cars rendered in front of you. Large grids are CPU-heavy.', d: 'basic', control: 'slider', range: { min: 0, max: 40, step: 1 }, readouts: ['carsCpu'],
  cost: { cpuPerUnit: 0.012, ref: 10 } });
add('graphics.car_visibility.max_behind_car', { ...vis, label: 'Cars drawn behind', d: 'basic', control: 'slider', range: { min: 0, max: 40, step: 1 }, cost: { cpuPerUnit: 0.008, ref: 4 } });
add('graphics.car_visibility.skip_filtering_when_driving', { ...vis, label: 'Draw all cars while driving', d: 'advanced', control: 'toggle' });
add('graphics.car_visibility.filter_when_spectating', { ...vis, label: 'Limit cars when spectating', d: 'advanced', control: 'toggle' });
add('graphics.num_dash_displays', { label: 'Live dashboard screens', help: 'How many in-car digital displays are rendered live.', g: 'car', s: 'cockpit', sc: ['cockpit'], t: 1, p: 'snapshot', i: ['gpu'], d: 'advanced', r: 'independent', control: 'segmented', dx12: 'Dash render targets are allocated at init.' });

// Look
add('graphics.post_processing_preset', { label: 'Post-process style', help: 'Color grading and tone-mapping style.', g: 'look', s: 'grading', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'independent', control: 'select',
  options: ['Default', 'Natural', 'Cinematic 1', 'Cinematic 2', 'Cinematic 3', 'Vivid'].map(v => ({ value: v, label: v })), note: 'Placeholder option list. The real presets come from the engine\'s post-process library.' });
add('graphics.exposureBias', { label: 'Exposure', help: 'Overall brightness compensation in EV stops.', g: 'look', s: 'grading', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'independent', control: 'slider', range: { min: -3, max: 3, step: 0.05, unit: 'EV' }, readouts: ['exposure'] });
add('graphics.exposureFusion', { label: 'Exposure fusion', help: 'Local tone compression. Recovers detail in bright skies and dark cockpits.', g: 'look', s: 'grading', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'advanced', r: 'independent', control: 'slider', range: { min: 0, max: 1, step: 0.01 } });
add('graphics.veil', { label: 'Veiling glare', help: 'Simulates glare scattering in the eye or lens.', g: 'look', s: 'grading', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'independent', control: 'segmented' });
add('graphics.depthOfField', { label: 'Depth of field', help: 'Blurs things outside the focus distance (replays and photo mode).', g: 'look', s: 'camera', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'basic', r: 'independent', control: 'segmented',
  cost: { gpu: { DepthOfFieldQuality_Off: 0.97, DepthOfFieldQuality_Low: 0.98, DepthOfFieldQuality_Medium: 0.99, DepthOfFieldQuality_High: 1, DepthOfFieldQuality_Ultra: 1.02 } } });
add('graphics.motionBlur.quality', { label: 'Motion blur', g: 'look', s: 'camera', sc: ['general'], t: 3, p: 'live-visual', i: ['gpu'], d: 'basic', r: 'controller', control: 'segmented' });
add('graphics.motionBlur.strength', { label: 'Motion blur strength', g: 'look', s: 'camera', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'dependent', control: 'slider', range: { min: 0, max: 2, step: 0.05 } });
add('graphics.motionBlur.centralClarity', { label: 'Motion blur center clarity', help: 'Keeps the center of the screen sharp while the edges blur.', g: 'look', s: 'camera', sc: ['general'], t: 3, p: 'live-visual', i: [], d: 'advanced', r: 'dependent', control: 'slider', range: { min: 0, max: 1, step: 0.01 } });
add('vr.sunglasses', { label: 'Sunglasses', help: 'Darkens the image in the headset for comfort in bright scenes.', g: 'look', s: 'vrcomfort', sc: ['hmd'], t: 3, p: 'live-visual', i: [], d: 'basic', r: 'independent', control: 'segmented' });
add('vr.world_scale', { label: 'World scale', help: 'Perceived size of the world. 1.0 is real-world scale.', g: 'look', s: 'vrcomfort', sc: ['hmd'], t: 3, p: 'live-geometry', i: [], d: 'advanced', r: 'independent', control: 'slider', range: { min: 0.5, max: 2, step: 0.01, unit: '×' }, policy: 'comfort' });

// ---- expand -----------------------------------------------------------------
const PREVIEW_DEFAULT = 'none';
const fields = {};
for (const f of F) {
  const node = v2Node(f.path);
  let options = f.options;
  if (!options && !f.optionsFrom && node?.enum) {
    options = node.enum.map(v => ({ value: v, label: prettyOption(v) }));
  }
  if (options && f.optionGates) {
    options = options.map(o => (f.optionGates[o.value] ? { ...o, gate: f.optionGates[o.value] } : o));
  }
  if (f.control === 'toggle' && !options) options = undefined;
  const preview = f.p ?? PREVIEW_DEFAULT;
  const tier = f.t;
  const editableIn = f.editableIn ?? (tier === null ? [] : tier === 'dynamic' ? ['menu', 'session.paused'] : defaultEditableIn(tier, preview));
  const entry = {
    label: f.label,
    ...(f.help ? { help: f.help } : {}),
    group: f.g,
    section: f.s,
    scope: f.sc,
    tier,
    editableIn,
    preview,
    impact: f.i,
    disclosure: f.d,
    role: f.r,
    control: f.control,
    ...(f.concept ? { concept: f.concept } : {}),
    ...(f.range ? { range: f.range } : (node && (node.minimum !== undefined || node.maximum !== undefined) && f.control === 'slider' ? { range: { min: node.minimum, max: node.maximum } } : {})),
    ...(options ? { options } : {}),
    ...(f.optionsFrom ? { optionsFrom: f.optionsFrom } : {}),
    ...(f.gate ? { gate: f.gate } : {}),
    ...(f.readouts?.length ? { readouts: f.readouts } : {}),
    ...(f.readoutInline ? { readoutInline: true } : {}),
    ...(f.presetParent ? { presetParent: true } : {}),
    ...(f.presetChild ? { presetChild: f.presetChild } : {}),
    ...(f.policy ? { policy: f.policy } : {}),
    ...(f.cost ? { cost: f.cost } : {}),
    ...(f.engineSupport ? { engineSupport: f.engineSupport } : { engineSupport: 'shipping' }),
    ...(f.v2 ? { v2: f.v2 } : {}),
    ...(f.reclassified ? { reclassified: f.reclassified } : {}),
    ...(f.dx12 ? { dx12: f.dx12 } : {}),
    ...(f.note ? { note: f.note } : {}),
    ...(f.editableNote ? { editableNote: f.editableNote } : {}),
  };
  if (node?.type && !entry.v2) entry.v2 = { path: f.path, type: node.type };
  fields[f.path] = entry;
}

// v2 fields that are capabilities (layer 2 outputs), not settings
const capabilityOutputs = Object.entries(v2.properties.graphics.properties)
  .filter(([, n]) => n.readOnly).map(([k]) => `graphics.${k}`)
  .concat(['vr.can_use_eye_tracking']);

const out = {
  $comment: 'Generated by tools/build-ui-schema.mjs — edit the table there, then rebuild. Facets F1–F12 are defined in docs/01-taxonomy-and-rules.md.',
  version: 4,
  vocabularies: {
    scope: ['general', 'single', 'triple', 'hmd', 'cockpit'],
    tier: { '1': 'Pipeline/device rebuild', '2': 'Feature reload / reallocation', '3': 'Live (constants only)', R: 'App restart', dynamic: 'Max tier of the children actually changed' },
    editableIn: ['menu', 'session.paused', 'session.live'],
    preview: ['live-visual', 'live-geometry', 'snapshot', 'metric-only', 'none'],
    impact: ['gpu', 'cpu', 'vram', 'latency'],
    disclosure: ['basic', 'advanced', 'expert'],
    role: ['independent', 'controller', 'dependent', 'derived', 'coupled'],
    policy: ['server-override', 'comfort'],
  },
  groups,
  fields,
  capabilityOutputs,
};
writeFileSync(join(root, 'schema/video_settings_ui_schema_Version4.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(fields).length} fields, ${capabilityOutputs.length} capability outputs`);
