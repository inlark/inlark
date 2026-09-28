import type { MetadataIndex } from '@inlark/imap'

/** The part of `worker_threads.Worker` the client uses, so tests can supply a fake. */
export interface IndexPort {
  postMessage(value: unknown): void
  on(event: 'message', listener: (value: any) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

type Reply = { id: number; result?: unknown; error?: { message: string } }
type Args<K extends keyof MetadataIndex> = Parameters<MetadataIndex[K]>

/** Forwards every index call to the worker that owns the SQLite database. */
export class WorkerMetadataIndex implements MetadataIndex {
  private next = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private failure: Error | undefined
  private closing: Promise<void> | undefined

  constructor(private readonly port: IndexPort) {
    port.on('message', (reply: Reply) => {
      const call = this.pending.get(reply.id)
      if (!call) return
      this.pending.delete(reply.id)
      if (reply.error) call.reject(new Error(reply.error.message))
      else call.resolve(reply.result)
    })
    port.on('error', (error) => this.fail(new Error(error.message || 'The mail index failed.')))
    port.on('exit', (code) =>
      this.fail(new Error('The mail index stopped unexpectedly (exit code ' + code + ').')),
    )
  }

  private fail(error: Error) {
    this.failure ??= error
    for (const call of this.pending.values()) call.reject(this.failure)
    this.pending.clear()
  }

  private call<K extends keyof MetadataIndex>(method: K, args: Args<K>) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.failure) return reject(this.failure)
      if (this.closing && method !== 'close') return reject(new Error('The mail index is closed.'))
      const id = this.next++
      this.pending.set(id, { resolve, reject })
      try {
        this.port.postMessage({ id, method, args })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    }) as ReturnType<MetadataIndex[K]>
  }

  close() {
    this.closing ??= (async () => {
      try {
        if (!this.failure) await this.call('close', [])
      } finally {
        this.failure ??= new Error('The mail index is closed.')
        await this.port.terminate()
      }
    })()
    return this.closing
  }

  syncMailboxes(...args: Args<'syncMailboxes'>) {
    return this.call('syncMailboxes', args)
  }
  listMailboxes(...args: Args<'listMailboxes'>) {
    return this.call('listMailboxes', args)
  }
  renameMailbox(...args: Args<'renameMailbox'>) {
    return this.call('renameMailbox', args)
  }
  updateMailbox(...args: Args<'updateMailbox'>) {
    return this.call('updateMailbox', args)
  }
  resetMailbox(...args: Args<'resetMailbox'>) {
    return this.call('resetMailbox', args)
  }
  upsertMessages(...args: Args<'upsertMessages'>) {
    return this.call('upsertMessages', args)
  }
  updateFlags(...args: Args<'updateFlags'>) {
    return this.call('updateFlags', args)
  }
  removeUids(...args: Args<'removeUids'>) {
    return this.call('removeUids', args)
  }
  removeMessages(...args: Args<'removeMessages'>) {
    return this.call('removeMessages', args)
  }
  knownUids(...args: Args<'knownUids'>) {
    return this.call('knownUids', args)
  }
  relocate(...args: Args<'relocate'>) {
    return this.call('relocate', args)
  }
  setPreview(...args: Args<'setPreview'>) {
    return this.call('setPreview', args)
  }
  messages(...args: Args<'messages'>) {
    return this.call('messages', args)
  }
  messagesAt(...args: Args<'messagesAt'>) {
    return this.call('messagesAt', args)
  }
  threadMessages(...args: Args<'threadMessages'>) {
    return this.call('threadMessages', args)
  }
  resolveThread(...args: Args<'resolveThread'>) {
    return this.call('resolveThread', args)
  }
  findByMessageId(...args: Args<'findByMessageId'>) {
    return this.call('findByMessageId', args)
  }
  conversations(...args: Args<'conversations'>) {
    return this.call('conversations', args)
  }
  counts(...args: Args<'counts'>) {
    return this.call('counts', args)
  }
  getMeta(...args: Args<'getMeta'>) {
    return this.call('getMeta', args)
  }
  setMeta(...args: Args<'setMeta'>) {
    return this.call('setMeta', args)
  }
}
