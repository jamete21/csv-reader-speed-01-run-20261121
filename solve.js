// A fast drop-in for csv-reader 1.0.0.
//
// run(input) reads {text, header} and returns {columns, rows, errors}, exactly
// as csv-reader 1.0.0 reads it: a U+FEFF at the very start is dropped, a record
// ends at LF or CRLF, a line left with no characters is no record, a CR outside
// quotes that is not followed by LF is dropped (stray_cr), a field that opens
// with a quote runs to the next quote that is not doubled ("" inside it is one
// quote, CRLF or a lone CR inside it reads as LF), what follows its closing
// quote up to the next comma or line break is appended as it stands
// (quote_junk, when the field ends), a quote that never closes is a literal
// character and the text after it is read again as unquoted
// (unterminated_quote), a quote inside an unquoted field is a literal, fields
// stay strings, columns is the first record when header is true, and rows are
// padded with "" (short_row) or cut (long_row) to the first record's width.
//
// How it is fast: the reference reads one character at a time and builds each
// field a character at a time. This reader never does. An unquoted run of
// fields is cut out with indexOf and split field by field with indexOf(','),
// a quoted field is cut out by searching for its closing quote with indexOf,
// and the only per-character work left is the rare broken row (a stray CR, a
// quote that never closes, junk after a closing quote), which is read the
// careful way. Every search is bounded by the record or field it belongs to,
// so no scan ever runs away to the end of the text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // What the last field read did: how it ended (0 comma, 1 line break, 2 end
  // of text) and how many characters the read appended to the value.
  let fEnded = 2;
  let fAdded = 0;

  // Count non-overlapping occurrences of `needle` inside the (short) string s.
  function countIn(s, needle) {
    let k = 0;
    let i = s.indexOf(needle);
    while (i !== -1) { k++; i = s.indexOf(needle, i + needle.length); }
    return k;
  }

  // Push the comma-separated fields of text[from..to) onto `out`.
  function pushRun(out, from, to) {
    let p = from;
    for (;;) {
      const c = text.indexOf(',', p);
      if (c === -1 || c >= to) { out.push(text.slice(p, to)); return; }
      out.push(text.slice(p, c));
      p = c + 1;
    }
  }

  // An unquoted field read from pos, with `init` already in the value. A CR
  // not followed by LF is dropped and reported; the read always leaves pos
  // past what it read, even when the field runs to the end of the text.
  function unquotedField(init, recordLine, recordRow) {
    let value = init;
    let added = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const nl = text.indexOf('\n', pos);
      const r = text.indexOf('\r', pos);
      let end = n;
      let kind = 2;
      if (comma !== -1 && comma < end) { end = comma; kind = 0; }
      if (nl !== -1 && nl < end) { end = nl; kind = 1; }
      if (r !== -1 && r < end) { end = r; kind = 4; }
      if (kind === 4) {
        if (text.charCodeAt(end + 1) === 10) {
          kind = 3; // CRLF
        } else {
          if (end > pos) { value += text.slice(pos, end); added += end - pos; }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = end + 1;
          continue;
        }
      }
      if (end > pos) { value += text.slice(pos, end); added += end - pos; }
      if (kind === 0) { pos = end + 1; fEnded = 0; fAdded = added; return value; }
      if (kind === 1) { pos = end + 1; line += 1; fEnded = 1; fAdded = added; return value; }
      if (kind === 3) { pos = end + 2; line += 1; fEnded = 1; fAdded = added; return value; }
      pos = end; fEnded = 2; fAdded = added; return value;
    }
  }

  // A quoted field whose opening quote is at pos.
  function quotedField(recordLine, recordRow) {
    const open = pos;
    let from = open + 1;
    let q;
    for (;;) {
      q = text.indexOf('"', from);
      if (q === -1) {
        // Never closes: the quote is a literal character, and the text after
        // it is read again as unquoted. The line is still where the field
        // opened, because the failed scan counted nothing.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        return unquotedField('"', recordLine, recordRow);
      }
      if (text.charCodeAt(q + 1) === 34) { from = q + 2; continue; }
      break;
    }
    const span = text.slice(open + 1, q);
    const hasDD = span.indexOf('""') !== -1;
    const hasCR = span.indexOf('\r') !== -1;
    const hasLF = span.indexOf('\n') !== -1;
    let value;
    if (!hasCR) {
      value = hasDD ? span.replaceAll('""', '"') : span;
      if (hasLF) line += countIn(span, '\n');
    } else {
      // Each CRLF and each lone CR inside quotes reads as one LF, and the
      // line count is the line breaks the span holds: its LFs plus its CRs
      // that are not part of a CRLF.
      value = span.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      if (hasDD) value = value.replaceAll('""', '"');
      line += countIn(span, '\n') + countIn(span, '\r') - countIn(span, '\r\n');
    }
    pos = q + 1;
    // A direct return leaves fAdded untouched: nothing reads it on this
    // path, only fEnded matters to the caller, and the junk path below sets
    // fAdded itself through unquotedField before anyone reads it.
    if (pos >= n) { fEnded = 2; return value; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; fEnded = 0; return value; }
    if (c === 10) { pos += 1; line += 1; fEnded = 1; return value; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fEnded = 1; return value; }
    // Junk follows the closing quote: appended as it stands.
    const junk = unquotedField(value, recordLine, recordRow);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        fields.push(quotedField(recordLine, recordRow));
        lastQuoted = true;
        if (fEnded !== 0) break;
        continue;
      }
      // An unquoted run: it ends at the next quote that opens a field (a '"'
      // right after a comma), at the next line break, or at the end of the
      // text. A '"' that does not follow a comma is a literal inside an
      // unquoted field, so the search walks past it.
      let q = text.indexOf('"', pos);
      while (q !== -1 && text.charCodeAt(q - 1) !== 44) q = text.indexOf('"', q + 1);
      const nl = text.indexOf('\n', pos);
      let runEnd = n;
      let kind = 2; // 0 = quoted field next, 1 = LF, 2 = end of text
      if (q !== -1) { runEnd = q - 1; kind = 0; }
      if (nl !== -1 && nl < runEnd) { runEnd = nl; kind = 1; }
      const runStr = text.slice(pos, runEnd);
      const ri = runStr.indexOf('\r');
      if (ri !== -1) {
        // A CR at the very end of the run is the CR of a CRLF only when a
        // line break follows it: at the end of the text the same CR is a
        // stray CR instead, so the CRLF branch needs kind === 1, not just
        // the trailing position.
        if (kind === 1 && ri === runStr.length - 1) {
          // Trailing CR of a CRLF line break: it is not part of the run.
          pushRun(fields, pos, runEnd - 1);
          pos = runEnd + 1; line += 1;
          lastQuoted = false;
          break;
        }
        // A stray CR: read the rest of this record field by field.
        for (;;) {
          if (text.charCodeAt(pos) === 34) {
            fields.push(quotedField(recordLine, recordRow));
            lastQuoted = true;
          } else {
            fields.push(unquotedField('', recordLine, recordRow));
            lastQuoted = false;
          }
          if (fEnded !== 0) break;
        }
        break;
      }
      if (kind === 0) {
        // The run ends at the comma before the quoted field: its fields are
        // complete, and the next field is quoted.
        pushRun(fields, pos, runEnd);
        pos = runEnd + 1;
        lastQuoted = false;
        continue;
      }
      // The run is the whole rest of the record; the record ends here.
      pushRun(fields, pos, runEnd);
      if (kind === 1) { pos = runEnd + 1; line += 1; }
      else pos = n;
      lastQuoted = false;
      break;
    }
    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
