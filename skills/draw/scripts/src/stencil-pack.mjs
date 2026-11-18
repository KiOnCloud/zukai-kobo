import { brotliDecompressSync } from 'node:zlib';

/**
 * The form the table of stencils has in stencil-paths.json. A path is a run of commands and
 * whole numbers, x and y in turn; in the file every number is written as the difference to
 * the number before it on its axis, which starts at 0 with each path. The points of an
 * outline lie close together, so the differences are short and repeat, and the table
 * compresses to under two thirds of what the plain numbers take. The table that comes back is
 * the one that went in, number for number.
 */
const eachNumber = (path, next) => {
  let at = [0, 0];
  let axis = 0;
  return path.split(' ').map((token) => {
    if (token >= 'A') { axis = 0; return token; }
    const [written, now] = next(Number(token), at[axis]);
    at[axis] = now;
    axis = 1 - axis;
    return String(written);
  }).join(' ');
};
/** A path with every number as the difference to the one before it on its axis. */
export const pathToSteps = (path) => eachNumber(path, (value, before) => [value - before, value]);
/** The path `pathToSteps` was given. */
export const stepsToPath = (steps) => eachNumber(steps, (step, before) => [before + step, before + step]);

const mapPaths = (stencils, fn) => Object.fromEntries(Object.entries(stencils).map(([name, g]) => [name, { ...g, paint: g.paint.map(([mode, path, ...rest]) => [mode, fn(path), ...rest]) }]));
/** The table of stencils as it is compressed: every path in steps. */
export const stencilsInSteps = (stencils) => mapPaths(stencils, pathToSteps);

/** The table of stencils back from the data file. */
export const unpackStencils = (packed) => mapPaths(JSON.parse(brotliDecompressSync(Buffer.from(packed, 'base64')).toString('utf8')), stepsToPath);
