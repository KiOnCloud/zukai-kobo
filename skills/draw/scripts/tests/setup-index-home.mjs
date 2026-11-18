/**
 * The run index is per user: a test that runs a command which registers a project must not
 * write the index of the person running the tests. Each test file gets its own folder, and
 * the CLIs it spawns inherit it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ZUKAI_HOME = mkdtempSync(join(tmpdir(), 'zukai-home-'));
