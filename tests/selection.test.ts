import { describe, expect, it } from 'vitest'
import { selectConversation, stepIndex } from '../apps/desktop/src/renderer/src/selection'

describe('conversation selection', () => {
  const keys = ['personal:1', 'studio:1', 'personal:2', 'studio:2', 'personal:3']

  it('selects and deselects a single conversation without mutating existing selection', () => {
    const selected = new Set(['personal:1'])
    expect(selectConversation(keys, selected, 'studio:1')).toEqual(new Set(keys.slice(0, 2)))
    expect(selectConversation(keys, selected, 'personal:1')).toEqual(new Set())
    expect(selected).toEqual(new Set(['personal:1']))
  })

  it.each([
    ['studio:1', 'studio:2'],
    ['studio:2', 'studio:1'],
  ])('selects the range from %s to %s, preserving selections outside it', (anchor, target) => {
    expect(selectConversation(keys, new Set(['personal:3']), target, anchor)).toEqual(
      new Set(keys.slice(1)),
    )
  })

  it('falls back to single selection when an anchor is no longer in the list', () => {
    expect(selectConversation(keys, new Set(), 'studio:1', 'removed')).toEqual(
      new Set(['studio:1']),
    )
  })

  it('ignores a target that is no longer in the list', () => {
    expect(selectConversation(keys, new Set(['personal:1']), 'removed', 'studio:1')).toEqual(
      new Set(['personal:1']),
    )
  })
})

describe('stepping through conversations', () => {
  it('moves one conversation at a time', () => {
    expect(stepIndex(5, 1, 1)).toBe(2)
    expect(stepIndex(5, 1, -1)).toBe(0)
  })

  it('stays put at either end, which is how a key that went nowhere is told apart', () => {
    expect(stepIndex(5, 0, -1)).toBe(0)
    expect(stepIndex(5, 4, 1)).toBe(4)
    expect(stepIndex(1, 0, 1)).toBe(0)
  })

  it('lands on the first conversation when none is current, whichever way the step goes', () => {
    expect(stepIndex(5, -1, 1)).toBe(0)
    expect(stepIndex(5, -1, -1)).toBe(0)
    // Even a single conversation can be reached by key.
    expect(stepIndex(1, -1, 1)).toBe(0)
  })

  it('has nowhere to land in an empty list', () => {
    expect([][stepIndex(0, -1, 1)]).toBeUndefined()
  })
})
