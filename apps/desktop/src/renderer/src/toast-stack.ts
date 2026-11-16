export type ToastTone = 'error' | 'info' | 'progress'

export interface ToastInput {
  text: string
  /** `progress` stays until it is replaced or dismissed. */
  tone?: ToastTone
  /** Undoes a server change through the service. */
  undoId?: string
  /** Undoes a change the client has not committed yet. */
  onUndo?: () => void
  /**
   * Runs once when this toast leaves the screen: it timed out or was dismissed. It does not run
   * when the toast is replaced in place, so an undone change is never committed.
   */
  onClose?: () => void
}

export interface LiveToast extends ToastInput {
  id: number
}

export interface ToastControls {
  /** Call when the toast has left the screen. */
  closed: () => void
  undo: () => void
  dismiss: () => void
}

/** Puts toasts on screen and takes them off. Sonner in the app, a fake in tests. */
export interface ToastPresenter {
  show(toast: LiveToast, duration: number, controls: ToastControls): void
  dismiss(id: number): void
}

export const canUndo = (toast: ToastInput) => !!toast.undoId || !!toast.onUndo

export const toastDuration = (toast: ToastInput) =>
  toast.tone === 'progress'
    ? Infinity
    : canUndo(toast)
      ? 9000
      : toast.tone === 'error'
        ? 8000
        : 5000

/**
 * The toasts on screen, oldest first. Several can be visible at once, so each keeps its own
 * undo for as long as it is shown, and undo shortcuts act on the newest one that offers it.
 */
export class ToastStack {
  private live = new Map<number, LiveToast>()
  private sequence = 0
  private target: LiveToast | undefined
  private listeners = new Set<() => void>()
  /** Runs an undo the user asked for, from a toast's button or a shortcut. */
  undoHandler?: (toast: LiveToast) => void

  constructor(private presenter: ToastPresenter) {}

  /** Shows a toast, or replaces the one with `id` in place. Returns its id. */
  show = (input: ToastInput, id = ++this.sequence): number => {
    const toast: LiveToast = { ...input, id }
    this.live.set(id, toast)
    this.presenter.show(toast, toastDuration(toast), {
      closed: () => this.closed(toast),
      undo: () => this.undo(toast),
      dismiss: () => this.dismiss(id),
    })
    this.changed()
    return id
  }

  dismiss = (id: number) => {
    if (this.live.has(id)) this.presenter.dismiss(id)
  }

  get = (id: number) => this.live.get(id)

  /** The newest toast that still offers undo. */
  undoTarget = () => this.target

  /** Undoes the given toast, or the newest one that offers undo. */
  undo = (toast = this.target) => {
    if (toast && canUndo(toast) && this.live.get(toast.id) === toast) this.undoHandler?.(toast)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private closed(toast: LiveToast) {
    // A toast that was replaced in place has handed over to its replacement.
    if (this.live.get(toast.id) !== toast) return
    this.live.delete(toast.id)
    this.changed()
    toast.onClose?.()
  }

  private changed() {
    this.target = [...this.live.values()].reverse().find(canUndo)
    for (const listener of this.listeners) listener()
  }
}
