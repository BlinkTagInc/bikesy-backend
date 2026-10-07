// performance.now() is measured from Node process initialization, including module
// loading. It cannot measure platform scheduling, image provisioning, or ingress.
export function createStartupTiming({
  instance,
  now = () => performance.now(),
  log = value => console.log(JSON.stringify(value)),
} = {}) {
  const phases = {};
  const attempts = {};
  const failures = {};
  const elapsed = () => now();
  const context = { instance, timing_scope: 'node_process', platform_provisioning_included: false };

  function phase(name) {
    const start = now();
    const attempt = attempts[name] = (attempts[name] || 0) + 1;
    let ended = false;
    return (status = 'ok') => {
      if (ended) return;
      ended = true;
      const end = now();
      const duration = end - start;
      phases[name] = (phases[name] || 0) + duration;
      if (status !== 'ok') {
        failures[name] = (failures[name] || 0) + 1;
        log({ event: 'startup_phase', ...context, phase: name, attempt, status,
          duration_ms: duration, startup_ms: end });
      }
    };
  }
  function measureSync(name, action) {
    const end = phase(name);
    try { const result = action(); end(); return result; }
    catch (error) { end('failed'); throw error; }
  }
  async function measure(name, action) {
    const end = phase(name);
    try { const result = await action(); end(); return result; }
    catch (error) { end('failed'); throw error; }
  }
  return { phase, measureSync, measure, summary: () => ({ ...context,
    startup_ms: elapsed(), startup_phases_ms: { ...phases },
    startup_phase_attempts: { ...attempts }, startup_phase_failures: { ...failures },
  }) };
}
