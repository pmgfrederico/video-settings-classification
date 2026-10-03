# Video settings: UX proposal

This proposal covers the main-menu video settings and the in-game surfaces (pause menu and live HUD tuner). Every behavior here traces to a rule in [01-taxonomy-and-rules.md](01-taxonomy-and-rules.md). Two clickable mockups run the actual rules engine against six sample rigs. See [§8](#8-mockups) to run them.

---

## 1. Principles

1. **Only what this PC can use.** Impossible things are hidden (R1). Fixable things are shown with the fix (R2). Dependent things say what controls them (R3).
2. **Concepts, not brands.** The player picks *upscaling*, *frame generation*, *latency reduction*. The vendor technology is a choice inside the concept, and only rig-valid providers appear (R14).
3. **Every value explains itself.** A setting shows what it means on this PC: the resolution, fps, VRAM or latency it produces (R13). Users compare outcomes, not preset names.
4. **Nothing changes silently.** Every edit, and every change it causes, goes into the change ledger with its cost tier before it's applied (R5, R9).
5. **Cost is visible before commit.** Each control carries its tier: Live, Quick reload or Rebuild. The Apply button states the total cost.
6. **The scene stays the hero in-game.** Live tuning uses one thin, edge-docked control at a time, with hold-to-compare.

---

## 2. Information architecture

```
System & health      (landing: rig, active pipeline, insights, technologies, Windows/CPU checks)
Display & Output     Display mode (root) · Monitor & window (Single) · Triple geometry (Triple) · VR headset (VR)
Performance & Latency  Resolution pipeline · Upscaling · Frame generation · Latency · Frame pacing & sync
Image Quality        Overall preset · Anti-aliasing & sharpening · Textures & filtering
World Detail         View distance · LOD · Lighting & shadows · Reflections · Sky & atmosphere · Terrain/vegetation/particles
Car & Cockpit        Mirrors · Vehicle detail · Cars on track · Cockpit displays
Look                 Post-process & exposure · Camera effects · VR comfort (VR)
```

- **Display mode is the root.** Choosing Single, Triple or VR changes which sections exist (R7). Section headers say why they're shown ("shown because Display mode = Triple").
- **Group headers report what's hidden**: "11 hidden: not used in Triple screen · 1 hidden: not supported by this PC · 1 more at a higher detail level". Nothing disappears without a trace.
- **Detail level** (Basic / Advanced / Expert) filters by disclosure (F9). Navigating to an expert field from a link raises the level automatically.
- **Search** ("/") covers every field, including fields not shown on this PC, with the reason they're hidden.

---

## 3. Main menu

### 3.1 Layout

```
┌ header: logo · GPU · output (res @ Hz · VRR) · est. fps ·········· [health chip] [/ search] ┐
├──────────────┬───────────────────────────────────────────────┬──────────────────────────┤
│ System       │ GROUP TITLE                                     │ CHANGES (ledger)         │
│ Display      │ hidden-count chips                              │  ⟳ Rebuild on apply      │
│ Performance ②│ ▌Section                                        │  ↻ Quick reload on apply │
│ Image        │ ┌ card ──────────────────────────────────────┐ │    └ auto: implied child │
│ World        │ │ Label  [v4]                 [Pending][↻]   │ │  ⚡ Applied live          │
│ Car          │ │ help text                                  │ │  ⚙ Adjusted for this PC  │
│ Look         │ │ [ control ]                                │ │  Estimated impact        │
│              │ │ ↳ readout on this PC                       │ ├──────────────────────────┤
│ Legend       │ │ 🔒 reason · Controlled by <link>           │ │ INSPECTOR                │
│              │ └────────────────────────────────────────────┘ │  values · on this PC ·   │
│              │                                                 │  hover preview · facets ·│
│              │                                                 │  dependencies · est.     │
├──────────────┴───────────────────────────────────────────────┴──────────────────────────┤
│ Back · Export config · GPU · VRAM · temp · fps            "3 changes · ⟳ rebuild (~2 s)" [Apply] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

This builds on the structure of [input/prototype.html](../input/prototype.html) (nav rail, setting cards, activity + inspector rail, command bar) and gives each region a rule-driven job.

### 3.2 Card anatomy and state grammar

| Element | Source | Shown when |
|---|---|---|
| Tier badge ⚡ Live / ↻ Quick reload / ⟳ Rebuild | F5 | always (except derived fields) |
| **Pending** (red edge) | user change | value differs from applied |
| **Auto** (violet edge) | implied change (R5/R6/R12) | changed as a consequence; the reason is shown |
| 🔒 **Locked** + "Controlled by X" link | R3 | dependency forces or blocks it |
| ⚠ **Needs fix** + deep link | R2 | an OS setting blocks it |
| 👁 **Read-only** | R8 / policy | context or server forbids changes |
| ⛓ **Coupled** | `force` with `unlessIn` | the value is restricted, not locked (Reflex vs Reflex+Boost under DLSS FG) |
| `v4 proposal` | `engineSupport` | not in today's config (helps stakeholders separate proposal from shipping) |
| ↳ Readout line | F11 | always when computable |

### 3.3 The concept/provider pattern (upscaling, frame generation, latency)

```
Upscaler                                                          v4  ↻ Quick reload
( ) Off                (•) NVIDIA DLSS        ( ) AMD FSR 3.1         ( ) Intel XeSS
    Native, no recon.      [Recommended]          [Also works]            [Also works]
                           ML SR on RTX…          softer in motion…       DP4a fallback on this GPU…

Upscaling mode
[DLAA            ] [Quality          ] [Balanced         ] [Performance      ] [Ultra Perf.   ]
 100% · 3840×2160   67% · 2560×1440     58% · 2228×1252     50% · 1920×1080     33% · 1280×720
```

- **Tiles** for providers. Every rig-valid provider is a tile with a tag and a one-line caveat. Blocked tiles show the fix inline (e.g. HAGS). Dependency-locked tiles show the reason ("Needs FSR as the upscaler").
- **Mode chips** carry their readout inline, so DLSS "Quality" and XeSS "Ultra Quality" visibly produce the same 2560×1440.
- **Frame-generation multipliers** show presented vs rendered fps and latency for each option ("≈ 100 fps presented from 50 rendered (capped) · 51 ms"). This is where a cap can quietly cost latency, and the UI shows it.
- **Switching provider** keeps intent: the mode falls back to the nearest scale (FSR Ultra Quality 0.77 → DLSS Quality 0.667), logged as an implied change.

### 3.4 Change ledger

- Grouped by tier: **Rebuild on apply**, **Quick reload on apply**, **Applied live · revertible**.
- Each user change lists its **implied children** with the reason ("Latency reduction: Off → Reflex. DLSS Frame Generation requires Reflex").
- **Adjusted for this PC** lists R12 fallbacks made at load (e.g. a saved 4K resolution on a 1440p monitor).
- **Estimated impact**: presented fps, VRAM, GPU frame time and PC latency, before → after.
- Per-entry revert. Revert all in the header.

### 3.5 Inspector

For the focused or hovered setting: applied / pending / effective values, the readouts on this PC, a **hover preview** for any option (readouts + est. cost delta), its classification (tier with explanation, editable contexts, scope, preview kind, impact, detail level), dependencies in both directions (clickable), DX12 notes, and the current estimates.

### 3.6 Apply flow

| Highest tier in pending set | Behavior |
|---|---|
| Live only | Button reads **Keep changes** (already applied). |
| Quick reload | Non-blocking toast "Reconfiguring features…". |
| Rebuild | Blocking "Rebuilding renderer" step (~2 s). Then, if a display/VR field changed, a **15 s Keep/Revert** countdown (R10). |

**Export config** shows the pending changes written back into today's v2 format (`toV2`). This shows that the v4 abstraction maps back to what the engine reads now.

### 3.7 System & health (landing page)

1. **Rig cards**: GPU (arch, VRAM, driver, DXR, temp, util), display (output, each monitor with VRR/HDR, HMD + runtime), CPU (cores, CCDs, X3D, P/E).
2. **Active pipeline**: one dark "terminal" block that answers *what's active right now*: render → upscaler mode → output, FG, latency tech, V-Sync, cap, est. presented/rendered fps, latency, bound by CPU/GPU.
3. **Insights**: severity, evidence, one action (stage a change, open a Windows setting, or jump to the setting).
4. **Technologies on this PC**: concept rows × provider chips (Active / Recommended / Available / Blocked · fixable / Needs X / Not supported). This is A6 made visible.
5. **Windows & CPU checks**: HAGS, VRR, Auto HDR, Game Mode, windowed optimizations, power, X3D thread affinity. Each says what it affects *on this rig* (HAGS is "required" on RTX and "not required" on Radeon).
6. **Not available on this PC**: the R1 list, collapsed.

---

## 4. In-game

### 4.1 Pause menu (`session.paused`)

- Same IA, cards and ledger as the main menu, filtered by R8: **Quick reload** and **Live** settings are editable.
- **Rebuild** settings collapse into one *"Locked during session (N) · change from the main menu"* list that shows their current values. The player can still see what's active.
- Apply with Quick-reload changes shows "Reconfiguring… (feature reload, no rebuild)", without a modal.
- Online sessions: `server-override` fields (cars drawn) become read-only with "Set by the server".

### 4.2 Live HUD tuner (`session.live`)

Eligible fields come from the engine: visible, editable in `session.live`. That means Tier 3 with live-visual or live-geometry preview, plus explicit opt-ins (frame cap). On the sample rigs that is post-process style, exposure, exposure fusion, veiling glare, depth of field, motion blur (quality/strength/clarity), temporal AA, FXAA, sharpening, AO quality and the frame cap. Triple rigs add screen width, distance, angle, bezel and Panini. VR adds sunglasses and world scale.

```
                                                    ┌ FPS 98 │ 1% 82 │ 10.2 ms │ GPU 98% │ 66°C │ VRAM 10.6/16 │ 27 ms ┐
                                                    └────────────────────── perf strip (top-right) ─────────────────────┘

                     ┌──────────────────────────── tuner (bottom, translucent) ────────────────────────────┐
                     │ ‹  Exposure          ›   ●●○○○○○○○○○○○            ⚡ Live                       ✕  │
                     │ ───────────────────────────●──────────────────────────────            +1.00 EV    │
                     │ ×2.00 brightness     hold C to compare             1 unsaved   [Revert] [Keep]    │
                     └────────────────────────────────────────────────────────────────────────────────────┘
```

- **One control in focus**: ←/→ cycles settings, ↑/↓ adjusts. A dot strip shows position and which ones changed. Collapses to a "Tune view · F2" pill.
- **Instant effect**: the scene re-renders on every input event.
- **Hold-to-compare** (C): shows the applied look while held, with a "BEFORE" tag.
- **Readout** in the footer (×2.00 brightness, per-screen hFOV, recommended angle).
- **Keep / Revert** appears only when something changed. Changes go into the same ledger as the menus.
- **Perf strip**: FPS, 1% low, frame time, GPU %, temperature, VRAM, PC latency. Values over threshold turn red.
- **Wheel / pad mapping** (proposal): D-pad left/right = setting, up/down = adjust, a rotary encoder = fine adjust, a funky-switch press = compare, a long press = Keep.
- **VR variant**: a world-locked panel just below the sightline, never head-locked. Perf strip on the same panel.

---

## 5. Health and insights

| Level | What | Where |
|---|---|---|
| Status | what's active (pipeline, effective values, R11) | System page, Resolution pipeline card, ledger |
| Telemetry | fps, frame time, GPU/CPU, temps, VRAM, latency | System page, inspector, footer, in-game perf strip |
| Insights | rules over facts + config + estimates ([insights_rules.json](../schema/insights_rules.json)) | System page, header health chip |

Shipped insight rules: HAGS blocks DLSS FG · VRAM over budget · CPU-bound · cap above refresh with V-Sync · cap above VRR range · FG without VRR · FG with low rendered fps · suggest Anti-Lag 2 with FSR FG · better upscaler available · dual-CCD affinity · hybrid CPU without Game Mode · on battery · GPU thermal limit · Auto HDR active · borderless without windowed optimizations · triple angle mismatch.

The header chip shows the worst severity (green / amber / red) and the count, and links to the System page.

---

## 6. Per-rig walkthrough

| Rig | Menu: what's different | Pause | Live HUD |
|---|---|---|---|
| RTX 5080 · 4K | DLSS recommended. FG up to 4x. Auto HDR insight. | upscaler/FG editable, textures/MSAA in the locked list | Look + AA + sharpening + AO + cap (13) |
| RX 9070 XT · triple | No DLSS/Reflex. Triple geometry section. Anti-Lag 2. | same filter | + triple width/distance/angle/bezel/Panini |
| RX 6800 · 1440p | FSR 3.1 recommended, FSR 4 hidden. CPU-bound insight. | — | Look set |
| RTX 4070 · Quest 3 | DLSS FG blocked (HAGS fix). VR mode adds the headset section and VR comfort. | FG locked in VR | + sunglasses, world scale (VR) |
| Arc B580 · 9950X3D | XeSS (XMX) recommended. XeSS FG → XeLL. Dual-CCD warning. | — | Look set |
| RTX 4060 Laptop · battery | VRAM over budget (critical, one-click fix). Battery + thermal. FG 2x only. | — | Look set |

---

## 7. Development approach

**Phase 1 — Model (done in this package, needs engine-team review).** Facts manifest, provider matrix, UI schema v4 (113 fields × 12 facets), dependency rules v3, insight rules. Open items are in [01 §8](01-taxonomy-and-rules.md#8-schema-gaps-and-open-questions).

**Phase 2 — Rules engine.** Port [mockups/engine.js](../mockups/engine.js) to the game's UI layer, or run it as is if the UI uses web tech. The contract is `evaluate(facts, appliedConfig, pending[], context) → { fields, ledger, insights, est }`. Keep it pure and data-driven, and keep the scenario tests ([tests/engine.test.mjs](../tests/engine.test.mjs)) as the regression suite. Add a fixture for every new hardware case.

**Phase 3 — Facts provider.** Engine side: DXGI adapter/output enumeration, Streamline `slIsFeatureSupported` + FidelityFX/XeSS queries, OpenXR runtime info, HAGS / Auto HDR / Game Mode / power state from the Windows APIs, CPU topology (CCD/X3D/hybrid) and sampled thread affinity. Emit an updated manifest on device-change events. The UI re-evaluates (R12).

**Phase 4 — Main menu.** Build the components in the order of the state grammar (§3.2): card → provider tiles/mode chips → ledger → inspector → apply flow → System page.

**Phase 5 — In-game.** Pause filter first (it reuses the menu components), then the HUD tuner and the compare buffer. The compare feature needs the renderer to keep the applied post-process parameter set alongside the live one.

**Phase 6 — Telemetry & estimates.** Replace the hand-set cost multipliers with profiled data per GPU class. Wire live telemetry (PresentMon-style frame times, Reflex/Anti-Lag latency markers, NVML/ADLX/IGCL temps and utilization).

Each phase can ship behind the same data files. Adding a vendor technology means adding a provider entry, an SDK fact and a fixture. No UI code changes.

---

## 8. Mockups

```bash
# from the repository root
python -m http.server 8765      # or: npx http-server -p 8765
# open http://127.0.0.1:8765/mockups/main-menu.html
#      http://127.0.0.1:8765/mockups/in-game.html
node --test tests/engine.test.mjs   # rules-engine scenario tests
```

- **Main menu**: switch rigs and detail level in the dark mockup bar. Try "Switch to DLSS" on the System page, turn on DLSS FG (watch Reflex become an implied change), or change Resolution and apply to see the Keep/Revert countdown.
- **In-game**: *Driving* shows the live HUD tuner (F2, ←/→, ↑/↓, hold C). *Paused* shows the session-filtered menu. *Online* locks server-controlled settings.
- URL parameters: `?rig=<fixture id>&group=<group id>&detail=expert` (menu), `?rig=…&mode=paused&hud=0` (in-game).
- Estimates are illustrative and labelled "est." everywhere.
