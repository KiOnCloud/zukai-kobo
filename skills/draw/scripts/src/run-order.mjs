import { basename, dirname } from 'node:path';

/**
 * The order of the diagrams of a run: a main diagram, then its business view, then its parts
 * (`<slug>-NN-<part>`), each followed by its own business view. A file-name sort puts
 * `checkout-01-login.ir.json` and `checkout-business.ir.json` before `checkout.ir.json`,
 * because `-` sorts before `.`; this order is taken from the diagram ids instead.
 *
 * When the folder is a run folder (`<yyyymmdd>_<run-slug>`), the diagram named after the run
 * and everything that starts with its name come first, so a diagram added later under an
 * earlier name never takes the first page.
 */

const BUSINESS = '-business';
const subjectOf = (id) => (id.endsWith(BUSINESS) ? id.slice(0, -BUSINESS.length) : id);

/**
 * The run slug of a run folder, of its `source/` folder, or of a copy of the run inside it
 * (`drafts/<x>`, `history/<rev>`); undefined when no folder on the way up is named like a run.
 */
export function runSlugOf(dir) {
  let at = dir;
  for (let up = 0; up < 4; up++) {
    const m = /^\d{8}_(.+)$/.exec(basename(at));
    if (m) return m[1];
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return undefined;
}

/**
 * @param {string[]} ids diagram ids (IR file names without `.ir.json`)
 * @param {string} [runSlug]
 * @returns {string[]} the ids in run order
 */
export function runOrder(ids, runSlug) {
  const ofRun = (subject) => (runSlug !== undefined && (subject === runSlug || subject.startsWith(`${runSlug}-`)) ? 0 : 1);
  const key = (id) => {
    const subject = subjectOf(id);
    return { run: ofRun(subject), subject, business: id === subject ? 0 : 1, id };
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return ids.map(key).sort((a, b) => a.run - b.run || cmp(a.subject, b.subject) || a.business - b.business || cmp(a.id, b.id)).map((k) => k.id);
}

/** IR file names (`*.ir.json`) in run order. */
export function orderIrFiles(names, runSlug) {
  const byId = new Map(names.map((f) => [f.slice(0, -'.ir.json'.length), f]));
  return runOrder([...byId.keys()], runSlug).map((id) => byId.get(id));
}
