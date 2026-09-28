import { Worker } from 'node:worker_threads'
import type { MetadataIndex } from '@inlark/imap'
import { WorkerMetadataIndex } from './client'
import workerPath from './worker?modulePath'

/** Opens the IMAP metadata index in its own worker thread so SQLite never blocks the main process. */
export function openWorkerIndex(path: string): MetadataIndex {
  return new WorkerMetadataIndex(new Worker(workerPath, { workerData: { path } }))
}
