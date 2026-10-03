// Loads the schema bundle, rig fixtures and the saved v2 config over HTTP (serve the repo root).
const ROOT = new URL('../', import.meta.url);
const getJson = async p => {
  const res = await fetch(new URL(p, ROOT));
  if (!res.ok) throw new Error(`${p}: ${res.status}`);
  return res.json();
};

export async function loadAll() {
  const [ui, deps, providers, insights, v2, rigIds] = await Promise.all([
    getJson('schema/video_settings_ui_schema_Version4.json'),
    getJson('schema/video_settings.dependencies_Version3.json'),
    getJson('schema/upscaling_providers.json'),
    getJson('schema/insights_rules.json'),
    getJson('input/raw-settings-0.11.0-beta.json'),
    getJson('fixtures/rigs/index.json'),
  ]);
  const rigs = Object.fromEntries(await Promise.all(rigIds.map(async id => [id, await getJson(`fixtures/rigs/${id}.json`)])));
  return { bundle: { ui, deps, providers, insights }, v2, rigs, rigIds };
}
