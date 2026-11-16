import type { Released } from './types.js';

/** A map's entries ordered by their number key, the order PRs and issues are logged and posted in. */
function byNumber<Value>(map: ReadonlyMap<number, Value>): Array<[number, Value]> {
  return [...map].toSorted((one, two) => one[0] - two[0]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `released` output: plain arrays, sorted, so the JSON is stable across runs. */
function serializeReleased(
  released: Released,
): Record<number, { direct: Array<string>; dependents: Array<string> }> {
  return Object.fromEntries(
    [...released].map(([pr, entry]) => [
      pr,
      { direct: [...entry.direct].toSorted(), dependents: [...entry.dependents].toSorted() },
    ]),
  );
}

export { byNumber, errorMessage, serializeReleased };
