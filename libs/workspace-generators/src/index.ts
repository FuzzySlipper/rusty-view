/**
 * @rusty-view/workspace-generators (`rv`) — local Nx generator collection.
 *
 * This module is the package entry Nx loads when it loads the plugin at
 * runtime. The invokable generators are declared in `../generators.json` and
 * implemented under `./generators/*`. This file intentionally exports a no-op
 * plugin (no createNodes): the package exists to expose generators, not to
 * participate in project-graph inference.
 */
const rvPlugin = { name: 'rv' };

export default rvPlugin;
