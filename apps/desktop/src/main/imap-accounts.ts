import { join } from 'node:path'
import { ImapProvider } from '@inlark/imap'
import { openWorkerIndex } from './imap-index/open'
import { openInProcessIndex } from './imap-index/sqlite-index'
import type { ProviderFactory } from './service'

/** Creates IMAP providers whose metadata index lives in a worker thread beside the connection. */
export const imapProviders: ProviderFactory = (input) => {
  if (input.config.protocol !== 'imap') throw new Error('Not an IMAP connection.')
  return new ImapProvider({
    connectionId: input.connectionId,
    name: input.name,
    config: input.config,
    password: input.secrets.password,
    outgoingPassword: input.secrets.outgoingPassword,
    folders: input.folders,
    // A connection test keeps nothing: its index lives only in memory.
    index: input.temporary
      ? openInProcessIndex(':memory:')
      : openWorkerIndex(join(input.directory, 'metadata.sqlite')),
    readAttachment: input.readAttachment,
    background: !input.temporary,
  })
}
