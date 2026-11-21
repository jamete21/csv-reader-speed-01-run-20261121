# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jamete21/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jamete21/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
every case exactly as csv-reader does, and `main.ts` is the program the
harness runs — it reads every case from `/input/cases.json`, answers each
with `run`, and writes `/output/answers.json`.

## What it does

`run({text, header})` returns `{columns, rows, errors}` by csv-reader's
broken-row policy: a U+FEFF at the very start is dropped, a record ends at LF
or CRLF, a line left with no characters is no record, a CR outside quotes
that is not followed by LF is dropped (`stray_cr`), a field that opens with a
quote runs to the next quote that is not doubled (`""` inside it is one quote,
CRLF or a lone CR inside it reads as LF), what follows its closing quote up
to the next comma or line break is appended as it stands (`quote_junk`), a
quote that never closes is a literal character and the text after it is read
again as unquoted (`unterminated_quote`), a quote inside an unquoted field is
a literal, fields stay strings, `columns` is the first record when `header`
is true, and rows are padded with `""` (`short_row`) or cut (`long_row`) to
the first record's width.

## Correctness

Checked against csv-reader 1.0.0 itself (the kit's vendored reference):
the practice set passes 6/6, two freshly drawn sets pass 6/6 each, and
differential fuzzing over ~14,000 small and structured inputs — every broken
row kind the policy names, at both `header` values — shows no difference.

## How it is fast

The reference reads one character at a time and builds each field a
character at a time. This reader never does: an unquoted run of fields is cut
out with `indexOf` and split field by field with `indexOf(',')`, a quoted
field is cut out by searching for its closing quote with `indexOf`, and the
only per-character work left is the rare broken row (a stray CR, a quote that
never closes, junk after a closing quote), which is read the careful way.
Every search is bounded by the record or field it belongs to.

## Files

- `solve.js` — the reader, a dependency-free ES module exporting `run(input)`.
- `main.ts` — the driver the harness runs (`node /bot/main.ts`, Node 22).
- `LICENSE` — MIT.

## Speed

On the practice set (10.2 MB of CSV over 6 cases), measured on this machine
with the cases already parsed: `run` takes ~0.20 s per set against ~0.89 s
for the reference `readCsv` — about 4.5x faster on the reading itself. The
whole program (JSON in, answers out) runs in ~0.8 s against ~1.4 s for the
house baseline.

## Grade locally

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```
