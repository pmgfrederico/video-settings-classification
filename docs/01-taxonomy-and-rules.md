# Video settings: taxonomy and rules

This document defines how every video setting is classified, and the rules that turn *what the PC is* plus *what the player chose* into *what the UI shows*. The UX proposal ([02-ux-proposal.md](02-ux-proposal.md)) is derived from these rules. The rules engine ([mockups/engine.js](../mockups/engine.js)) is their executable form, and [tests/engine.test.mjs](../tests/engine.test.mjs) checks them against six rig fixtures.

---

## 1. The model: three layers

```
 FACTS                     CAPABILITIES                  SETTING STATE
 (detected, read-only)  →  (derived predicates)       →  (per field, per context)
 GPU, displays, VR,        "DLSS supported",             visible / hidden(why)
 CPU topology, OS state,   "DLSS FG blocked by HAGS",    editable / locked / blocked / read-only
 SDK feature queries       "max FG multiplier = 4"       effective value, readouts, cost
```

- **Facts** are produced at boot and again on device events: display hot-plug, HMD connect, driver update, power-source change. Schema: [system_capabilities.schema.json](../schema/system_capabilities.schema.json).
- **Capabilities** are conditions over facts. The v2 config's `is_dlss_available`, `can_use_*_Nx` and `vr.can_use_eye_tracking` flags are capabilities, not settings. Schema v4 moves them to `capabilityOutputs`.
- **Setting state** is computed. Nothing in the UI decides on its own whether a control is visible or enabled. It asks the engine.

The split between hardware facts (`sdk.*`) and OS facts (`os.*`) matters. It lets the UI tell **impossible** (R1, hide it) apart from **fixable** (R2, show it with a fix).

### Fact domains

| Domain | Examples | Drives |
|---|---|---|
| GPU | vendor, architecture, VRAM, driver, DXR tier, mobile | provider availability, VRAM budget, RTAO option |
| SDK feature queries | `sdk.dlss`, `sdk.dlss_g.maxMultiplier`, `sdk.fsr4`, `sdk.xess.path` (xmx/dp4a), `sdk.reflex`, `sdk.antilag2`, `sdk.xell` | concept → provider options (A6), option-level gating |
| Display topology | monitors (res, refresh, VRR, HDR), triple surface (native/spanned) | display scope (Single/Triple/HMD), resolution list, pacing advice |
| VR runtime | connected, OpenXR runtime, HMD, per-eye resolution, refresh, eye tracking | HMD scope, foveation options |
| CPU topology | cores/threads, CCD count, X3D cache CCD, hybrid P/E, sampled game-thread affinity | CPU-bound insights, affinity warnings |
| OS state | HAGS, Auto HDR, Game Mode, windowed-game optimizations, VRR toggle, power source/plan | R2 gates with fixes, insights |
| Session context | `menu`, `session.paused`, `session.live`, online | editability (R8), server policy |

---

## 2. Facets: what every setting is classified on

Every field in [video_settings_ui_schema_Version4.json](../schema/video_settings_ui_schema_Version4.json) has one value per facet. That file is generated from the table in [tools/build-ui-schema.mjs](../tools/build-ui-schema.mjs), which keeps the defaults consistent.

| # | Facet | Vocabulary | Notes |
|---|---|---|---|
| F1 | **Display scope** (`scope`) | general · single · triple · hmd · cockpit | Visible only when it matches the active display mode (R7). |
| F2 | **User group** (`group`, `section`) | Display & Output · Performance & Latency · Image Quality · World Detail · Car & Cockpit · Look | Groups are task-oriented. The engine-oriented "setting class" from the Sankey work maps into sections. |
| F3 | **Gate** (`gate.hw`, `gate.os`, option `gate`) | none · hardware · OS · dependency · preset | Records why a field or option may be unavailable. |
| F4 | **Dependency role** (`role`) | independent · controller · dependent · derived · coupled | `derived` = calculated, shown read-only (R11). |
| F5 | **Apply tier** (`tier`) | 3 Live · 2 Quick reload · 1 Rebuild · R Restart · dynamic | See §4. |
| F6 | **Editable in** (`editableIn`) | ⊂ {menu, session.paused, session.live} | Derived from F5 + F7 by default. Can be overridden per field. |
| F7 | **Preview kind** (`preview`) | live-visual · live-geometry · snapshot · metric-only · none | Decides which surface can host it (HUD tuner, A/B, metrics). |
| F8 | **Impact** (`impact`) | gpu · cpu · vram · latency | Picks which metrics the inspector shows. Feeds the cost model. |
| F9 | **Disclosure** (`disclosure`) | basic · advanced · expert | Progressive disclosure. Never hides something the user has to act on. |
| F10 | **Policy** (`policy`) | server-override · comfort | Online servers may clamp a value. VR comfort warnings. |
| F11 | **Readouts** (`readouts`, `readoutInline`) | ids of derived values | What the value means on this PC (R13). |
| F12 | **Concept / provider** (`concept`, `optionsFrom: providers.*`) | upscaling · frameGeneration · latency | Vendor technology behind a vendor-neutral concept (§3). |

Additional per-field metadata: `cost` (estimate model), `presetParent`/`presetChild` (R6), `engineSupport` (`shipping` = in the v2 config today, `proposed` = introduced by v4), `v2` (mapping to today's config), `dx12` (rationale), `reclassified`.

### Default editability (F6) from tier and preview

| Tier | Preview | Editable in |
|---|---|---|
| 1 / R | any | menu |
| 2 | any | menu, paused |
| 3 | live-visual, live-geometry | menu, paused, **live HUD** |
| 3 | snapshot, metric-only, none | menu, paused |
| dynamic | — | menu, paused (cost is computed per change) |

Explicit override example: `gameplay_frame_rate_limit` is metric-only but opts into the live HUD, because the perf strip shows its effect right away.

---

## 3. Vendor technology complexity drives the contextual UX

NVIDIA, AMD and Intel expose different depth and different names for the same three ideas. That asymmetry is the main reason the UI must be contextual. The UI is organized by **concept**, and **providers** sit inside a concept ([upscaling_providers.json](../schema/upscaling_providers.json)).

| Concept | NVIDIA | AMD | Intel | Native |
|---|---|---|---|---|
| **Upscaling** (render lower, reconstruct) | DLSS SR: DLAA, Quality…Ultra Performance, custom. Model choice at expert level. | FSR 4 (ML, RDNA 4 only) or FSR 3.1 (analytical, any GPU): Native AA, modes, custom | XeSS: XMX on Arc, DP4a elsewhere. Native AA + 6 modes | off / supersampling |
| **Frame generation** | DLSS FG 2x. RTX 50 multi-frame up to the engine-reported max. Needs HAGS, forces Reflex. | FSR FG (broad GPU support). Pairs with Anti-Lag 2. | XeSS FG. Always with XeLL. | — |
| **Latency reduction** | Reflex / Reflex + Boost | Anti-Lag 2 | XeLL | frame cap, late latching |
| **Sharpening** | none built in (global pass) | RCAS | XeSS sharpness | global pass |

### Rules this produces

1. **Cross-vendor availability is not exclusive.** FSR 3.1 and XeSS DP4a also run on NVIDIA and older AMD cards. The provider list is therefore *every provider whose `requires` passes*. One is tagged **Recommended** (the first match in the vendor's preference list) and the others **Also works**, with a one-line honest caveat (`crossVendorNote`).
2. **Depth follows the active provider.** Only the active provider's parameters render. Basic shows concept + mode. Advanced adds custom scale and native AA. Expert adds the DLSS model.
3. **Couplings across concepts are declared.** FG provider → latency provider (force or suggest). The engine pairs FG with the same vendor's upscaler (`engineConstraint: true` rules; remove them if the engine supports mixing).
4. **Normalized scale, native names.** Vendors use the same words for different scales. XeSS "Quality" is 0.59 per axis, while DLSS/FSR "Quality" is 0.667, and XeSS calls 0.667 "Ultra Quality". The UI keeps vendor names, and every mode shows its actual render resolution (R13), so the comparison happens on resolution, not on names.

| Per-axis scale | DLSS | FSR 4 / 3.1 | XeSS |
|---|---|---|---|
| 1.00 | DLAA | Native AA | Native AA |
| 0.77 | — | Ultra Quality (engine-specific ratio) | Ultra Quality Plus |
| 0.667 | Quality | Quality | Ultra Quality |
| 0.58–0.59 | Balanced | Balanced | Quality |
| 0.50 | Performance | Performance | Balanced |
| 0.435 | — | — | Performance |
| 0.333 | Ultra Performance | Ultra Performance | Ultra Performance |

---

## 4. Apply tiers (F5)

| Tier | Meaning (DX12 + Streamline) | UI consequence |
|---|---|---|
| **3 · Live** | Constant-buffer / shader-parameter changes only | Applies instantly. Logged and revertible. Eligible for the live HUD if visual. |
| **2 · Quick reload** | Streamline feature load/unload and re-tag, resource reallocation, PSO permutation swap from cache | Staged. Brief non-blocking toast ("Reconfiguring…"). Allowed while paused. |
| **1 · Rebuild** | Swapchain/ResizeBuffers, render-target formats (MSAA), static samplers in root signatures (AF), DXR pipeline (RTAO), mirror/dash target graph | Staged. Main menu only. Blocking "Rebuilding renderer" step. Keep/Revert countdown for display changes (R10). |
| **R · Restart** | Adapter selection, runtime-level changes | Reserved. No v2 field needs it today. |
| **dynamic** | Preset parents (`overallGraphics`) | Cost = highest tier among the children the preset actually changes. |

**Reclassification:** `display.v_sync` moves from Tier 1 to Tier 3. With the flip model, sync interval is a `Present()` argument and tearing support is decided once at swapchain creation. This needs confirmation from the engine team. Streamline-based upscaling, FG and Reflex stay at Tier 2, per the earlier Streamline analysis.

---

## 5. Condition language

Rules, gates and insights share one small JSON condition form:

```json
{ "ref": "facts:os.hags", "eq": false }
{ "all": [ { "ref": "cfg:graphics.frame_generation.provider", "neq": "off" }, { "ref": "der:vrr", "eq": false } ] }
```

- Ref namespaces: `cfg:` (effective config, v4 paths, includes pending changes), `facts:`, `der:` (derived values such as `scope`, `upscalerFamily`, `fgMaxMultiplier`, `refreshHz`, `tripleRecommendedAngle`), `est:` (performance estimates), `ctx:`.
- Operators: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `all`, `any`, `not`.
- Text can interpolate refs: `"This GPU supports up to {der:fgMaxMultiplier}x"`.

Dependency effects ([video_settings.dependencies_Version3.json](../schema/video_settings.dependencies_Version3.json)):

| Action | Effect |
|---|---|
| `hide` (`quiet: true`) | Conditional disclosure. The field isn't relevant now (e.g. custom scale when mode ≠ Custom). It is not listed as "unavailable". |
| `lock` | Shown disabled, with the reason and a link to the controller. |
| `force` | Sets an effective value and locks it. `unlessIn` keeps already-compatible values. `lock: false` restricts without locking. |
| `excludeOptions` | Option-level gating. `kind: hw` hides the option. `kind: dependency` shows it disabled with the reason. |

---

## 6. Rules (the engine contract)

| # | Rule | Engine behavior | Example |
|---|---|---|---|
| **R1** | Hardware-impossible → **hide** | `gate.hw` / provider `requires` false → `hidden`, listed under *Not available on this PC* | DLSS on Radeon. Eye-tracked foveation without eye tracking. |
| **R2** | User-fixable → **disable + explain + fix** | `gate.os` / provider `blockedBy` → `blocked`, with `fix` deep link | DLSS FG with HAGS off → `ms-settings:display-advancedgraphics`. VR mode with no headset. |
| **R3** | Dependency-locked → **disable + link the controller** | `lock`/`force` → `locked`, `controller` | Supersampling locked by Upscaler. Mirror detail locked when mirrors are off. |
| **R4** | Option-level gating | options carry their own status | FG 3x/4x hidden below the reported max. RTAO without DXR 1.1. |
| **R5** | Couplings are visible | forced values become **implied** ledger children of the user's change | DLSS FG → Reflex. XeSS FG → XeLL. |
| **R6** | Preset governance | parent → children cascade. Editing a child flips the parent (and grandparent) to Custom. | Quality preset → View distance → distances. |
| **R7** | Scope follows topology | `display.mode` is the root controller. Out-of-scope fields are hidden, and groups with nothing left disappear. | Triple geometry only in Triple. VR group only in VR. |
| **R8** | Context editability | `editableIn` vs session → `readOnly` ("Change from the main menu" / "Pause to change"). Online + `server-override` → read-only. | Textures read-only while paused. Only T3 visual fields in the HUD. |
| **R9** | Staging by tier | ledger groups by tier. Apply cost = max tier of pending + implied changes. | "Apply 3 changes · renderer rebuild (~2 s)" |
| **R10** | Safe display changes | Tier 1 display/VR changes → 15 s Keep/Revert | Resolution, display mode |
| **R11** | Effective vs configured | derived fields show the calculated value and where it comes from | Render 2560×1440 → DLSS Quality → 3840×2160 |
| **R12** | Re-evaluate on fact change | invalid values fall back to the nearest valid option. The change is logged with its reason ("Adjusted for this PC" on load, or implied under the user change that caused it). | Saved 4K on a 1440p monitor. FSR "Ultra Quality" → DLSS "Quality" (nearest scale). |
| **R13** | Readouts are always on | every visible field renders its readouts. Options show theirs inline (modes, FG multipliers) or on hover/focus (est. cost delta). Values that can't be computed are omitted. | "67% · renders 2560×1440 → 3840×2160" |
| **R14** | Concept first, provider second | provider controls are built from the provider matrix, filtered by facts | Upscaler tiles differ per GPU |

Precedence when several apply to one field: hidden (scope/hw) → blocked (OS) → locked (dependency) → read-only (context/policy) → editable.

---

## 7. Worked examples (the six fixtures)

| Rig | What the rules produce |
|---|---|
| **RTX 5080 · 4K 144 Hz** ([fixture](../fixtures/rigs/rtx5080-single.json)) | Upscaler: DLSS (Recommended), FSR 3.1 / XeSS (Also works), FSR 4 hidden. FG multiplier 2x/3x/4x. The saved FSR config triggers the insight "DLSS is available". Auto HDR insight (schema gap: no native HDR). MSAA 4x kept alongside the upscaler. |
| **RX 9070 XT · triple 1440p** | DLSS/Reflex hidden (R1). FSR 4 recommended, Anti-Lag 2 available. Triple geometry visible with per-screen hFOV and a recommended-angle readout. Single-screen resolution hidden (R7). |
| **RX 6800 · 1440p** | No FSR 4 (RDNA 2), so FSR 3.1 is recommended and XeSS DP4a also works. CPU-bound insight steers the player to view distance and cars drawn, not GPU settings. |
| **RTX 4070 · Quest 3 · HAGS off** | DLSS FG tile **blocked** with a HAGS fix link (R2). In VR mode: FG forced off (R7), HMD fields appear, eye-tracked foveation hidden (no eye tracking). |
| **Arc B580 · 9950X3D** | XeSS (XMX) recommended, XeSS FG forces XeLL. Dual-CCD insight: game threads are on the non-cache CCD. |
| **RTX 4060 Laptop · battery · 8 GB** | Ultra textures → **VRAM over budget** (critical, one-click "Lower textures to High"). On-battery and thermal warnings. FG limited to 2x. |

---

## 8. Schema gaps and open questions

| Gap | Proposal |
|---|---|
| No XeSS, Anti-Lag 2, XeLL, DLAA/Native AA, DLSS model in v2 | v4 provider abstraction: `upscaling.provider/mode/custom_scale/dlss_model`, `frame_generation.provider`, `latency.mode`. `fromV2`/`toV2` keep today's config readable. |
| No native HDR setting | Add an HDR output group (paper white, peak nits, tone-map), gated on `display.hdr`. Until then, show the Auto HDR insight. |
| Preset tables (overall quality, AF/clouds Low/Medium) are illustrative | Replace with the engine's real tables. The view-distance tables are real (from the saved config). |
| Supersampling factor assumed per axis | Confirm whether `Supersampling_2x` means per axis or total pixels. |
| `post_processing_preset` option list unknown | Load from the engine's post-process library. |
| FG vendor-mixing constraint | Keep or drop the `engineConstraint` rules depending on the integration. |
| `server-override` on car visibility | Confirm with the multiplayer team which settings a server may clamp. |
| Cost model (`cost`, telemetry coefficients) | Replace the hand-set multipliers with profiled per-GPU-class data. Every estimate is labelled "est." in the UI. |
| V-Sync tier | Confirm the Tier 1 → Tier 3 reclassification. |

## 9. Files

| File | Role |
|---|---|
| [schema/system_capabilities.schema.json](../schema/system_capabilities.schema.json) | Facts manifest (layer 1) |
| [schema/upscaling_providers.json](../schema/upscaling_providers.json) | Concept → provider → mode matrix (F12) |
| [schema/video_settings_ui_schema_Version4.json](../schema/video_settings_ui_schema_Version4.json) | 113 fields × facets (generated by [tools/build-ui-schema.mjs](../tools/build-ui-schema.mjs)) |
| [schema/video_settings.dependencies_Version3.json](../schema/video_settings.dependencies_Version3.json) | Dependency rules + preset groups |
| [schema/insights_rules.json](../schema/insights_rules.json) | Health/advisory rules |
| [fixtures/rigs/](../fixtures/rigs/) | Six scenario rigs |
| [mockups/engine.js](../mockups/engine.js) | Rules engine: `evaluate`, `fromV2`/`toV2`, `derive`, `estimate`, `readouts` |
| [tests/engine.test.mjs](../tests/engine.test.mjs) | Scenario tests (`node --test tests/engine.test.mjs`) |
