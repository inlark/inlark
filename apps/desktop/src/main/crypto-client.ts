import type { CryptoMethods } from '@inlark/crypto'
export interface CryptoPort {
  postMessage(value: unknown): void
  on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): unknown
  terminate(): Promise<number>
}
export class CryptoClient {
  private next = 1
  private failure?: Error
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >()
  constructor(private port: CryptoPort) {
    port.on('message', ({ id, result, error }) => {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    })
    const fail = () => {
      this.failure = new Error(
        'The encryption worker stopped. Lock and unlock the vault before trying again.',
      )
      for (const p of this.pending.values()) p.reject(this.failure)
      this.pending.clear()
    }
    port.on('error', fail)
    port.on('exit', fail)
  }
  call<K extends keyof CryptoMethods>(
    method: K,
    ...args: Parameters<CryptoMethods[K]>
  ): Promise<Awaited<ReturnType<CryptoMethods[K]>>> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure)
      if (this.pending.size >= 100)
        return reject(new Error('Too many encryption operations. Try again shortly.'))
      const id = this.next++
      this.pending.set(id, { resolve, reject })
      try {
        this.port.postMessage({ id, method, args })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  async close() {
    await this.port.terminate()
  }
}
