import { parentPort, workerData } from 'node:worker_threads'
import { SqliteMetadataIndex, indexMethods } from './sqlite-index'

// An open failure (e.g. a newer schema) throws here and reaches the client as the worker error.
const index = new SqliteMetadataIndex((workerData as { path: string }).path)
const methods = new Set<string>(indexMethods)
const port = parentPort!

port.on('message', (request: { id: number; method: string; args: unknown[] }) => {
  try {
    if (!methods.has(request.method)) throw new Error('Unknown mail index method.')
    const method = index[request.method as keyof SqliteMetadataIndex] as (
      ...args: unknown[]
    ) => unknown
    port.postMessage({ id: request.id, result: method.apply(index, request.args) })
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  }
})
