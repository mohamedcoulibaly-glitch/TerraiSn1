/**
 * Harness minimal de tests (assert + compteurs) — aligné sur les scripts CDC existants.
 */
function createHarness(label = 'suite') {
  let failed = 0;
  let passed = 0;

  function assert(name, cond, extra) {
    if (!cond) {
      failed += 1;
      console.error(`FAIL  ${name}${extra != null ? ` — ${extra}` : ''}`);
    } else {
      passed += 1;
      console.log(`OK    ${name}`);
    }
  }

  function assertEqual(name, actual, expected) {
    assert(name, actual === expected, `attendu=${JSON.stringify(expected)} obtenu=${JSON.stringify(actual)}`);
  }

  function assertThrows(name, fn, match) {
    let threw = false;
    let err;
    try {
      fn();
    } catch (e) {
      threw = true;
      err = e;
    }
    if (!threw) {
      assert(name, false, 'aucune exception');
      return;
    }
    if (match == null) {
      assert(name, true);
      return;
    }
    const msg = String(err?.message || err);
    const ok = match instanceof RegExp ? match.test(msg) : msg.includes(String(match));
    assert(name, ok, msg);
  }

  async function assertThrowsAsync(name, fn, match) {
    let threw = false;
    let err;
    try {
      await fn();
    } catch (e) {
      threw = true;
      err = e;
    }
    if (!threw) {
      assert(name, false, 'aucune exception');
      return;
    }
    if (match == null) {
      assert(name, true);
      return;
    }
    const msg = String(err?.message || err);
    const ok = match instanceof RegExp ? match.test(msg) : msg.includes(String(match));
    assert(name, ok, msg);
  }

  function summary() {
    console.log(`\n[${label}] ${passed} OK, ${failed} FAIL`);
    return { passed, failed, ok: failed === 0 };
  }

  function exitIfFailed() {
    const s = summary();
    if (!s.ok) process.exit(1);
    return s;
  }

  return { assert, assertEqual, assertThrows, assertThrowsAsync, summary, exitIfFailed, get failed() { return failed; }, get passed() { return passed; } };
}

module.exports = { createHarness };
