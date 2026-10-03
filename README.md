# Video settings: a playground for deterministic UI rules

This repo explores one idea: **a settings UI can be derived, not hand-designed.** Every setting is classified on a fixed set of facets. A small set of declarative rules turns *what the PC is* plus *what the player chose* into *what the UI shows*. The UI then renders the result and makes no decisions of its own.

The test subject is the video settings of a DX12 racing game: 113 fields across display, upscaling (DLSS / FSR / XeSS), frame generation, latency, world detail, triple screens and VR. It is complex enough that ad-hoc UI logic breaks down.

## The approach

```
 FACTS                     CAPABILITIES                  SETTING STATE
 (detected, read-only)  →  (derived predicates)       →  (per field, per context)
 GPU, displays, VR,        "DLSS supported",             visible / hidden (why)
 CPU, OS state, SDKs       "DLSS FG blocked by HAGS"     editable / locked / blocked / read-only
                                                         effective value, readouts, cost
```

- **Facets (F1–F12).** Every field has exactly one value per facet: display scope, group, gate, dependency role, apply tier, editability, preview kind, impact, disclosure, policy, readouts, and concept/provider.
- **Rules (R1–R14).** Each rule maps a facet or condition to a UI behavior. For example: impossible → hide (R1), fixable → disable and show the fix (R2), dependent → lock and link to the controller (R3), and couplings show up as implied changes (R5).
- **One engine, same answers everywhere.** [mockups/engine.js](mockups/engine.js) is a pure function, `evaluate(bundle, facts, config, pending, context, disclosure) → view model`. The mockups and the Node tests run the same module, so a rule behaves the same on screen as it does in a test.

Changing a rule or a facet value in the schema changes the UI on every rig at once. Nothing is special-cased in the page code.

## What's here

| Path | What it is |
|---|---|
| [docs/01-taxonomy-and-rules.md](docs/01-taxonomy-and-rules.md) | The contract: the three-layer model, the 12 facets, apply tiers, the condition language, and rules R1–R14 with worked examples. |
| [docs/02-ux-proposal.md](docs/02-ux-proposal.md) | The UX derived from those rules: main menu, change ledger, apply flow, in-game pause menu and live HUD tuner. |
| [schema/](schema/) | The data the engine reads: UI schema v4 (fields × facets), dependency rules v3, the upscaling provider matrix, insight rules and the system-facts schema. Older versions are kept for reference. |
| [tools/build-ui-schema.mjs](tools/build-ui-schema.mjs) | Generates the UI schema from one compact table, so facet defaults stay consistent. |
| [fixtures/rigs/](fixtures/rigs/) | Six sample PCs (RTX 5080, RTX 4060 laptop on battery, RTX 4070 + VR, RX 6800, RX 9070 triple-screen, Arc B580) used as facts. |
| [mockups/](mockups/) | Two clickable mockups driven by the engine: `main-menu.html` and `in-game.html`. |
| [tests/engine.test.mjs](tests/engine.test.mjs) | Scenario tests that check the rules against the rigs. |
| [input/](input/) | The original game config (v2) and the first UI prototype. |
| [sankey.html](sankey.html), [sankey_rows.json](sankey_rows.json) | An earlier visualization of the classification (reset tier → scope → class → field). |
| [HANDOVER.md](HANDOVER.md) | How the work got here: the original handover notes and the history of the classification. |

## Running it

```bash
# from the repository root
python -m http.server 8765        # or: npx http-server -p 8765
# open http://127.0.0.1:8765/mockups/main-menu.html
#      http://127.0.0.1:8765/mockups/in-game.html

node tools/build-ui-schema.mjs    # regenerate the UI schema after editing the field table
node --test tests/engine.test.mjs # run the rule scenario tests
```

The mockups need HTTP because they load the schemas with `fetch`. Use the dark bar at the top of the main menu to switch rigs and detail level. URL parameters: `?rig=<fixture id>&group=<group id>&detail=basic|advanced|expert`.

## Playing with it

- **Change a rule:** edit [schema/video_settings.dependencies_Version3.json](schema/video_settings.dependencies_Version3.json), reload the mockup and run the tests.
- **Reclassify a field:** change its facets in [tools/build-ui-schema.mjs](tools/build-ui-schema.mjs) and regenerate.
- **Try a different PC:** add a fixture to [fixtures/rigs/](fixtures/rigs/) and list it in `index.json`.
- **Pin a behavior:** add a scenario to [tests/engine.test.mjs](tests/engine.test.mjs).

Cost and performance figures in the mockups are illustrative estimates and are labelled "est." everywhere.
