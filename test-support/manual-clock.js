function createManualClock(initialTime = 1000) {
  let currentTime = initialTime;
  const pending = new Set();
  const scheduled = [];
  return {
    pending,
    scheduled,
    now: () => currentTime,
    setTimer(callback, delay) {
      const timer = { callback, delay };
      pending.add(timer);
      scheduled.push(timer);
      return timer;
    },
    clearTimer: (timer) => pending.delete(timer),
    advanceTo(time) { currentTime = time; },
    fire(timer) {
      pending.delete(timer);
      timer.callback();
    }
  };
}

module.exports = { createManualClock };
