/**
 * Wraps `task` so a burst of calls shares runs: calls within `delay` ms share one run, and calls
 * made while it runs share a single run right after it. Each call resolves with a run that
 * started after the call, so nothing requested is missed.
 */
export function coalesce(task: () => Promise<void>, delay = 0): () => Promise<void> {
  let running: Promise<void> | undefined
  let next: Promise<void> | undefined
  return () => {
    if (next) return next
    const scheduled = (running ? running.catch(() => {}) : Promise.resolve())
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, delay)))
      .then(() => {
        next = undefined
        const run = task()
        running = run
        return run.finally(() => {
          if (running === run) running = undefined
        })
      })
    next = scheduled
    return scheduled
  }
}
