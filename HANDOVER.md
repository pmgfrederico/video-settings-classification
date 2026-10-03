# Handover Package — Video Settings UX/UI Classification

> **v4 update (taxonomy, rules engine, mockups).** Start with [docs/01-taxonomy-and-rules.md](docs/01-taxonomy-and-rules.md) and [docs/02-ux-proposal.md](docs/02-ux-proposal.md).
> New: system facts schema, concept → provider matrix (DLSS / FSR / XeSS), UI schema v4 (113 fields × 12 facets), dependency rules v3, insight rules, six rig fixtures, a rules engine with scenario tests, and two clickable mockups (`mockups/main-menu.html`, `mockups/in-game.html`; serve the repo root over HTTP).
> Rebuild the UI schema with `node tools/build-ui-schema.mjs`. Run the tests with `node --test tests/engine.test.mjs`.
> The open questions from the "next steps" below are addressed or listed in docs/01 §8.

Summary of Work
Goal: Classify a game's video settings config (DX12 engine, NVIDIA Streamline w/ DLSS 4.5 + FSR4) to drive a settings UI redesign — grouping by display mode, menu-vs-session editability, and live-preview suitability.

Progression of the conversation:

Initial classification — Grouped the raw settings JSON into: General / Single / Triple / HMD display scopes; Menu-only vs. in-session editability; and candidates for a "live layer widget" (instant visual diff, no reinit).
UI schema v1 — Converted that into a per-field metadata schema (uiCategory, displayScope, requiresReinit, livePreview, editableAt) suitable for driving UI generation.
JSON Schema + dependency rules — Added type/enum/range validation, plus a declarative conditional-visibility/dependency rules table (e.g., Upscaler mode hides/shows FSR vs. DLSS sub-fields).
Reset-tier refinement — Introduced a 3-tier reset model (Tier 1 = full device/swapchain reset, Tier 2 = targeted resource reallocation, Tier 3 = free/live-safe), first generically, then explicitly reasoned through DX12 semantics (PSO/root-signature rebuilds, ResizeBuffers, DXR BVH builds, sampler static-binding constraints).
Streamline correction — Revised the tier assignment for Upscaling, Frame Generation, and Reflex downward from Tier 1 → Tier 2, since NVIDIA Streamline's proxy swapchain (installed once at init) means switching DLSS↔FSR4 or toggling Frame Gen/Reflex is a feature reload + resource re-tag, not a swapchain recreate.
Display settings restructuring — Partial reorganization of the raw display block into user-facing groupings: Monitor+Resolution, Window Model (Borderless/Fullscreen), Frame Pacing (V-Sync + Latency/Anti-Lag2/Reflex) — left incomplete when the conversation shifted to visualization.
Chart-type exploration — Evaluated Tidy Tree, Sankey, and Venn for visualizing the 5-dimension classification; concluded Sankey fits best only when dimensions form a strict hierarchy (which Reset Tier → Display Scope → Setting Class → Field does), while a heatmap/matrix table is better for ad-hoc multi-dimension lookup.
Deliverables built: a full CSV matrix (one row per field, one column per dimension), aggregated bar-chart datasets, and finally a working D3 Sankey diagram (d3-sankey, modeled on Observable's @d3/sankey/2) — iterated to add wide/scrollable layout and a light theme.
Open/next steps (not yet done):

Full restructuring of the display block per the Monitor/Window-Model/Frame-Pacing grouping (only sketched, not completed into the schema).
In-session perspective (editableAt: session) was explicitly deferred — only in-menu fields are reflected in the Sankey dataset.
Cross-field validators (e.g., "Frame Gen multiplier must match active upscaler backend") were suggested but not fully written out as code.
Package Contents
1. Original Input — Raw Settings Config
The source JSON payload provided at the start (major_version 2, display/graphics/vr blocks) — unchanged, used as the basis for all classification work.

2. video_settings_ui_schema.json
Per-field UI metadata: uiCategory, displayScope, resetTier (1/2/3, DX12+Streamline-aware), requiresReinit, livePreview, editableAt, plus dx12 rationale notes per field.

3. video_settings.schema.json
Standard JSON Schema (draft-07) with types, enums, and min/max ranges for every field — usable as a live config validator.

4. video_settings.dependencies.json
Declarative conditional-visibility rules (show/hide/enable/disable/force_value/restrictOptions) — covers Upscaler mode↔FSR/DLSS sub-fields, Frame Generation↔Reflex, Supersampling↔Upscaler mutual exclusivity, View Distance preset↔custom unlock, Mirror mode cascades, VR foveation, and the "General preset locks all children" rule.

5. video_settings_matrix.csv
Flat one-row-per-field table (setting, uiCategory, displayScope, resetTier, editableAt, livePreview) — intended for a spreadsheet with conditional-formatting color scales (the heatmap approach).

6. chart_uiCategory_resetTier.csv / chart_displayScope_resetTier.csv
Pre-aggregated counts for faceted bar charts (resetTier distribution per category/scope).

7. sankey_full_paths.csv / sankey_rows.json
The 4-stage path dataset (Reset Tier → Display Scope → Setting Class → Field), in-menu fields only — same data, two formats (CSV for BI tools, JSON for the D3 viewer).

8. sankey.html
Standalone D3 Sankey viewer (light theme, wide/scrollable canvas, hover tooltips showing field counts and full paths). Requires serving over local HTTP (not file://) alongside sankey_rows.json.

9. Narrative/Reasoning Artifacts (markdown, embedded in this conversation)
Initial 3-part classification (display scope / menu vs. session / live-widget candidates)
DX12-specific reset-tier justification per field
Streamline architecture correction and its downstream effect on 4 fields
Chart-type evaluation (why Tree/Venn don't fit, why Sankey works for this specific 4-stage hierarchy)