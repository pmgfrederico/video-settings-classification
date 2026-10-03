# Video settings classification handover

This repository contains the generated Sankey visualization and its source dataset for the in-menu video-settings classification discussed in the handover conversation.

## Files

- `data/sankey_rows.json` — one record per classified setting: reset tier, display scope, setting class, and original config field path.
- `viz/sankey.html` — light-theme, wide, horizontally/vertically scrollable D3 Sankey viewer. It loads the JSON dataset from `../data/sankey_rows.json`.

## View locally

From the repository root, serve the files over HTTP (fetching JSON from `file://` is typically blocked):

```sh
python -m http.server 8000
```

Then open `http://localhost:8000/viz/sankey.html`.

## Download as ZIP

Use GitHub's **Code → Download ZIP** menu on this repository page.

## Important classification caveat

Reset tiers are informed guesses for a custom DX12 engine using NVIDIA Streamline with DLSS 4.5 and FidelityFX/FSR4. The config payload alone does not reveal the engine's resource lifetime, preallocation, PSO caching, or SDK integration details. Treat Tier 1/2/3 assignments as hypotheses to validate against the renderer. Tier 1 means likely renderer/display reconfiguration, Tier 2 targeted GPU-resource/context reconfiguration, and Tier 3 likely runtime parameter updates. This visualization is the in-menu perspective; session-only exposure and post-processing controls and the separate editability dimension are excluded.

The original payload in the conversation contained truncated enum strings and is not a valid JSON document as pasted, so it is not copied here as a purportedly valid input file. Field paths in the dataset preserve the names from that payload.
