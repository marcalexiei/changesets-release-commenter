import type { Outcome } from './comment.js';
import type { Released } from './types.js';
import { byNumber } from './util.js';

const RESULT: Record<Outcome['result'], string> = {
  commented: 'commented',
  'already-commented': 'skipped, already commented',
  'dry-run': 'dry run, not posted',
  failed: '❌ failed',
};

/** A table cell: a pipe or newline in an error message would break the row. */
function cell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll(/\s*\n\s*/gu, ' ');
}

function refs(set: ReadonlySet<string>): string {
  return set.size === 0
    ? '—'
    : [...set]
        .toSorted()
        .map((ref) => `\`${ref}\``)
        .join(', ');
}

/** The job summary: what each PR shipped in, then what happened on each thread. */
function renderSummary(released: Released, outcomes: ReadonlyArray<Outcome>): string {
  const shipped = byNumber(released).map(
    ([pr, entry]) => `| #${pr} | ${refs(entry.direct)} | ${refs(entry.dependents)} |`,
  );
  const threads = outcomes.map(({ kind, number, result, error }) => {
    const detail = error === undefined ? '' : `: ${cell(error)}`;
    return `| ${kind} #${number} | ${RESULT[result]}${detail} |`;
  });
  return [
    '## Changesets release commenter',
    '',
    '| PR | Released in | Also republished |',
    '| --- | --- | --- |',
    ...shipped,
    '',
    '| Thread | Result |',
    '| --- | --- |',
    ...threads,
    '',
  ].join('\n');
}

export { renderSummary };
