export const app = { getVersion: () => 'test' }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  getSelectedStorageBackend: () => 'basic_text',
}
export const dialog = {}
export const shell = {}
export const clipboard = { writeText: async (_text: string) => {}, readText: async () => '' }
export const Notification = { isSupported: () => false }
