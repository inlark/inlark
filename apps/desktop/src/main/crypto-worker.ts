import { parentPort } from 'node:worker_threads'
import { CryptoEngine, type CryptoMethods } from '@inlark/crypto'
const engine = new CryptoEngine()
let queue = Promise.resolve()
const methods: (keyof CryptoMethods)[] = [
  'load',
  'lock',
  'inspect',
  'generate',
  'importPrivate',
  'backup',
  'revoke',
  'encrypt',
  'decrypt',
  'sign',
  'verify',
  'setupExport',
  'setupImport',
  'verifyInline',
  'mergePublic',
  'autocryptKey',
]
parentPort!.on('message', ({ id, method, args }) => {
  queue = queue.then(async () => {
    try {
      if (!methods.includes(method)) throw new Error('Unsupported cryptographic operation.')
      const result = await (
        engine[method as keyof CryptoMethods] as (...args: any[]) => unknown
      ).apply(engine, args)
      parentPort!.postMessage({ id, result })
    } catch (error) {
      // Never serialize stacks or payloads containing key/message material.
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : 'Cryptographic operation failed.',
      })
    }
  })
})
