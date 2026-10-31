/** Extract pass/fail counts from common test runner output (node:test, vitest, jest, mocha, pytest, cargo, go). */
export function parseTestOutput(output: string): { passed: number; failed: number } | null {
  // eslint-disable-next-line no-control-regex
  const text = output.replace(/\u001b\[[0-9;]*m/g, '');
  let m: RegExpMatchArray | null;
  // node --test (TAP summary): "# pass 5" / "# fail 1"  or spec reporter "ℹ pass 5"
  const np = text.match(/^(?:#|ℹ)\s*pass\s+(\d+)/m);
  const nf = text.match(/^(?:#|ℹ)\s*fail\s+(\d+)/m);
  if (np || nf) return { passed: Number(np?.[1] ?? 0), failed: Number(nf?.[1] ?? 0) };
  // vitest: "Tests  3 passed | 1 failed (4)" or "Tests  3 failed | 1 passed"
  if ((m = text.match(/Tests\s+(.+?)\s*\(\d+\)/))) {
    const passed = Number(m[1].match(/(\d+) passed/)?.[1] ?? 0);
    const failed = Number(m[1].match(/(\d+) failed/)?.[1] ?? 0);
    return { passed, failed };
  }
  // jest: "Tests:       1 failed, 3 passed, 4 total"
  if ((m = text.match(/Tests:\s+(.+total)/))) {
    return { passed: Number(m[1].match(/(\d+) passed/)?.[1] ?? 0), failed: Number(m[1].match(/(\d+) failed/)?.[1] ?? 0) };
  }
  // mocha: "5 passing" "1 failing"
  const mp = text.match(/(\d+) passing/);
  if (mp) return { passed: Number(mp[1]), failed: Number(text.match(/(\d+) failing/)?.[1] ?? 0) };
  // pytest: "== 3 passed, 1 failed in 0.12s =="
  if ((m = text.match(/=+ (.*?(?:passed|failed).*?) in [\d.]+s/))) {
    return { passed: Number(m[1].match(/(\d+) passed/)?.[1] ?? 0), failed: Number(m[1].match(/(\d+) failed/)?.[1] ?? 0) };
  }
  // cargo: "test result: ok. 3 passed; 0 failed"
  if ((m = text.match(/test result: \w+\. (\d+) passed; (\d+) failed/))) return { passed: Number(m[1]), failed: Number(m[2]) };
  // go: count "--- PASS" / "--- FAIL"
  const gp = (text.match(/^--- PASS/gm) ?? []).length;
  const gf = (text.match(/^--- FAIL/gm) ?? []).length;
  if (gp || gf) return { passed: gp, failed: gf };
  return null;
}

export function looksLikeTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|mocha)\b/.test(command) || /node\s+--test/.test(command);
}
