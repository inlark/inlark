import { Worker } from 'node:worker_threads'
import workerPath from './crypto-worker?modulePath'
import { CryptoClient } from './crypto-client'
export const openCryptoWorker = () => new CryptoClient(new Worker(workerPath))
