import { describe, expect, it, vi } from 'vitest'
import {
  ToastStack,
  toastDuration,
  type LiveToast,
  type ToastControls,
} from '../apps/desktop/src/renderer/src/toast-stack'

/** Records what is on screen, the way Sonner would show it. */
function setup() {
  const screen = new Map<number, { toast: LiveToast; duration: number; controls: ToastControls }>()
  const stack = new ToastStack({
    show: (toast, duration, controls) => screen.set(toast.id, { toast, duration, controls }),
    dismiss: (id) => {
      const shown = screen.get(id)
      screen.delete(id)
      shown?.controls.closed()
    },
  })
  const timeOut = (id: number) => {
    const shown = screen.get(id)!
    screen.delete(id)
    shown.controls.closed()
  }
  return { stack, screen, timeOut }
}

describe('toast stack', () => {
  it('keeps every toast on screen instead of replacing the last one', () => {
    const { stack, screen } = setup()
    stack.show({ text: 'Archived', undoId: 'a' })
    stack.show({ text: 'Moved to trash', undoId: 'b' })
    stack.show({ text: 'Copied' })
    expect([...screen.values()].map((s) => s.toast.text)).toEqual([
      'Archived',
      'Moved to trash',
      'Copied',
    ])
  })

  it('undoes the newest toast that offers undo', () => {
    const { stack } = setup()
    const handler = vi.fn()
    stack.undoHandler = handler
    stack.show({ text: 'Archived', undoId: 'a' })
    stack.show({ text: 'Moved to trash', undoId: 'b' })
    stack.show({ text: 'Unsubscribed' })
    expect(stack.undoTarget()?.text).toBe('Moved to trash')
    stack.undo()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ undoId: 'b' }))
  })

  it('lets each toast undo its own action', () => {
    const { stack, screen } = setup()
    const handler = vi.fn()
    stack.undoHandler = handler
    const first = stack.show({ text: 'Archived', undoId: 'a' })
    stack.show({ text: 'Moved to trash', undoId: 'b' })
    screen.get(first)!.controls.undo()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ undoId: 'a' }))
  })

  it('falls back to an older undo once the newer toast leaves', () => {
    const { stack, timeOut } = setup()
    stack.show({ text: 'Archived', undoId: 'a' })
    const newer = stack.show({ text: 'Moved to trash', undoId: 'b' })
    timeOut(newer)
    expect(stack.undoTarget()?.undoId).toBe('a')
  })

  it('stops offering undo once a toast is replaced in place', () => {
    const { stack } = setup()
    const handler = vi.fn()
    stack.undoHandler = handler
    const id = stack.show({ text: 'Archived', undoId: 'a' })
    const archived = stack.undoTarget()
    stack.show({ text: 'Undoing…', tone: 'progress' }, id)
    expect(stack.undoTarget()).toBeUndefined()
    // A second press of the shortcut, or a stale button, does nothing.
    stack.undo(archived)
    stack.undo()
    expect(handler).not.toHaveBeenCalled()
  })

  it('commits a pending change when its own toast leaves, not when another appears', () => {
    const { stack, timeOut } = setup()
    const commit = vi.fn()
    const id = stack.show({ text: 'Draft deleted', onUndo: () => {}, onClose: commit })
    stack.show({ text: 'Archived', undoId: 'a' })
    expect(commit).not.toHaveBeenCalled()
    timeOut(id)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('commits when a toast is dismissed', () => {
    const { stack, screen } = setup()
    const commit = vi.fn()
    const id = stack.show({ text: 'Draft deleted', onUndo: () => {}, onClose: commit })
    screen.get(id)!.controls.dismiss()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(stack.get(id)).toBeUndefined()
  })

  it('never commits a change that was undone by replacing its toast', () => {
    const { stack, screen, timeOut } = setup()
    const commit = vi.fn()
    const id = stack.show({ text: 'Draft deleted', onUndo: () => {}, onClose: commit })
    const deleted = screen.get(id)!.controls
    stack.show({ text: 'Draft restored' }, id)
    // The replaced version's handlers can still fire late; they are ignored.
    deleted.closed()
    timeOut(id)
    expect(commit).not.toHaveBeenCalled()
  })

  it('tells subscribers when the undo target changes', () => {
    const { stack, timeOut } = setup()
    const listener = vi.fn()
    const unsubscribe = stack.subscribe(listener)
    const id = stack.show({ text: 'Archived', undoId: 'a' })
    timeOut(id)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    stack.show({ text: 'Copied' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ignores dismissing a toast that is already gone', () => {
    const { stack, timeOut } = setup()
    const onClose = vi.fn()
    const id = stack.show({ text: 'Copied', onClose })
    timeOut(id)
    stack.dismiss(id)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps undo toasts longer and progress toasts until they are replaced', () => {
    expect(toastDuration({ text: 'Copied' })).toBe(5000)
    expect(toastDuration({ text: 'Failed', tone: 'error' })).toBe(8000)
    expect(toastDuration({ text: 'Archived', undoId: 'a' })).toBe(9000)
    expect(toastDuration({ text: 'Undoing…', tone: 'progress' })).toBe(Infinity)
  })
})
