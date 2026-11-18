import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { figjamReaderScript } from '../src/extract-figjam.mjs';
import { combineNative } from '../src/figjam-native.mjs';
import { standInFigma } from './figma-stand-in.mjs';
import { loadFixture, scriptData } from './helpers.mjs';

/**
 * Every script the CLI writes for `use_figma` is copied by an agent into the call. Tool output
 * cuts long lines, so the scripts keep their lines short, and each one checks that its data
 * arrived whole before it touches the board: a copy that lost or changed a character, inside a
 * label too, stops with an error that says to pass the script again from its file.
 */

/** The most characters a line of a script may have. */
const LINE = 200;

/** The same script with its data written on one line and no check, as the CLI wrote it before. */
const oneLine = (script) => `const D = ${JSON.stringify(scriptData(script))};\n${script.slice(script.indexOf('const TAG = '))}`;
/** The page of a stand-in as plain data, ids and parents left out. */
const treeOf = (page) => JSON.stringify(page.children, (k, v) => (k === 'parent' || k === 'id' ? undefined : v));
/** The script with the first `from` replaced by `to`, which must be there. */
const changed = (script, from, to) => {
  expect(script).toContain(from);
  return script.replace(from, to);
};

async function nativeOf(kind, name) {
  const r = await emit(loadFixture(kind, name), 'figjam', { native: true, nativeOnly: true, allowSensitive: true });
  expect(r.errors).toEqual([]);
  return r;
}

async function overlayOf() {
  const ir = loadFixture('sequence', 'valid');
  const r = await emit(ir, 'figjam');
  return { ir, text: r.output, overlay: r.overlay };
}

describe('scripts for use_figma', () => {
  it('keep every line short, the data of a long drawing included', async () => {
    const aws = await nativeOf('architecture', 'valid-aws');
    const { overlay } = await overlayOf();
    const usecase = await nativeOf('usecase', 'valid');
    // The script of bundle --to figjam --native, two drawings in one.
    const bundled = combineNative([...aws.nativeData, ...usecase.nativeData]);
    expect(bundled.drawings).toEqual([2]);
    const scripts = [...aws.native, ...usecase.native, ...bundled.parts, overlay, figjamReaderScript({ section: 'Checkout', from: 12 })];
    // The AWS diagram carries stencil paths of thousands of characters each.
    expect(aws.native[0].length).toBeGreaterThan(20000);
    for (const script of scripts) {
      const long = script.split('\n').filter((l) => l.length > LINE);
      expect(long.map((l) => `${l.length}: ${l.slice(0, 60)}`)).toEqual([]);
    }
    expect(scriptData(figjamReaderScript({ section: 'Checkout', from: 12 }))).toMatchObject({ section: 'Checkout', from: 12 });
  });

  it('draw what the same data on one line draws', async () => {
    for (const [kind, name] of [['architecture', 'valid-aws'], ['usecase', 'valid']]) {
      const [script] = (await nativeOf(kind, name)).native;
      const wrapped = standInFigma();
      const plain = standInFigma();
      const a = await wrapped.run(script);
      const b = await plain.run(oneLine(script));
      expect(a).toEqual(b);
      expect(treeOf(wrapped.page)).toBe(treeOf(plain.page));
    }
  });

  it('stop before they touch the board when the copy lost or changed a character of a native drawing', async () => {
    const { native: [script], nativeCreated: [count] } = await nativeOf('usecase', 'valid');
    const board = standInFigma();
    expect((await board.run(script)).created).toBe(count);
    const before = treeOf(board.page);
    const copies = [
      changed(script, '"Borrow a book"', '"Borrow a b0ok"'),
      changed(script, '"Borrow a book"', '"Borrow a bok"'),
      changed(script, '"Search the catalogue"', '"Search  the catalogue"'),
    ];
    for (const copy of copies) {
      const empty = standInFigma();
      await expect(empty.run(copy)).rejects.toThrow(/^zukai native: .*Nothing was changed\. .*again from its file/);
      expect(empty.page.children).toEqual([]);
      await expect(board.run(copy)).rejects.toThrow(/zukai native: /);
      expect(treeOf(board.page)).toBe(before);
    }
  });

  it('stop before they read the board when the copy of the reader script lost a character', async () => {
    const script = figjamReaderScript({ section: 'Checkout' });
    const board = standInFigma();
    const section = board.figma.createSection();
    section.name = 'Checkout';
    expect((await board.run(script)).section).toBe('Checkout');
    await expect(board.run(changed(script, '45000', '4500'))).rejects.toThrow(/^zukai recook: .*again from its file/);
  });
});
