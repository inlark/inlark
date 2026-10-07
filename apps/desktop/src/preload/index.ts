import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopMailAPI, AppEvent } from '@inlark/core'
const methods = [
  'bootstrap',
  'updateStatus',
  'ready',
  'discover',
  'testConnection',
  'connect',
  'connectionSettings',
  'folderMappings',
  'setFolderMappings',
  'disconnect',
  'reconnect',
  'updateAccount',
  'updateAccountDetails',
  'setAliases',
  'mailboxes',
  'identities',
  'query',
  'conversation',
  'mutate',
  'mutateAll',
  'undo',
  'folder',
  'drafts',
  'resumeDraft',
  'stageRemoteAttachments',
  'saveDraft',
  'syncDraft',
  'deleteDraft',
  'deleteServerDraft',
  'send',
  'reconcile',
  'submissions',
  'retrySentCopy',
  'recoverRejected',
  'replaceUncertain',
  'dismissSubmission',
  'stageAttachments',
  'attachment',
  'inlineImage',
  'remoteImage',
  'senderAvatar',
  'unsubscribe',
  'openExternal',
  'settings',
  'restart',
  'diagnostics',
] as const satisfies readonly (keyof DesktopMailAPI)[]
// Fails to compile when an API method is missing from the allowlist above.
type Missing = Exclude<keyof DesktopMailAPI, 'onEvent' | (typeof methods)[number]>
const complete: Missing extends never ? true : Missing = true
void complete
const api = Object.fromEntries(
  methods.map((name) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke('mail:' + name, ...args),
  ]),
)
contextBridge.exposeInMainWorld('mail', {
  ...api,
  onEvent: (callback: (event: AppEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AppEvent) => callback(data)
    ipcRenderer.on('mail:event', listener)
    return () => {
      ipcRenderer.removeListener('mail:event', listener)
    }
  },
} as unknown as DesktopMailAPI)
