/**
 * Runs the tasks it's given one at a time, in the order they were given: each starts once every
 * earlier one has settled, whether it succeeded or failed.
 */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = last.then(task)
    last = run.catch(() => {})
    return run
  }
}
