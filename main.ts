// The program the harness runs: `node /bot/main.ts` on Node 22.
//
// It reads every case from /input/cases.json (a JSON array of {id, input}),
// answers each one alone with run() from solve.js, and writes
// /output/answers.json: a JSON array of the answers, one per case and in the
// cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output.
//
// V8's incremental marking is turned off before solve.js is imported, so all
// of its work runs under it: the plain reader builds its answers out of
// chains of joined strings, and marking those a step at a time costs more
// than the reading itself.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract.
 *  The import is dynamic, not static, so the flag above is set before
 *  solve.js is first evaluated. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
// Compact JSON, one array in the cases' order: the run is pure (no clock,
// no randomness), so two executions on the same input write the same bytes.
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
