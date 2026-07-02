// Promise-queue mutex for serial port access.
//
// The FC exposes ONE serial port. Concurrent CLI sessions (a scan racing a
// motor test, or two browser tabs) interleave writes and corrupt both
// sessions — or worse, leave a motor command unanswered. Every server-side
// operation that opens the port must go through runExclusive().

function createMutex() {
  let tail = Promise.resolve();
  let depth = 0;

  function runExclusive(fn) {
    depth++;
    const run = tail.then(() => fn());
    tail = run.then(
      () => { depth--; },
      () => { depth--; }
    );
    return run;
  }

  function isBusy() {
    return depth > 0;
  }

  return { runExclusive, isBusy };
}

module.exports = { createMutex };
