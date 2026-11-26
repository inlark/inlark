import { describe, expect, it } from 'vitest'
import {
  focusAfterRemoval,
  selectConversation,
  stepIndex,
} from '../apps/desktop/src/renderer/src/selection'

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

describe('focus after conversations leave the list', () => {
  const keys = ['a', 'b', 'c', 'd', 'e']

  it('moves on to the conversation that took its place', () => {
    expect(focusAfterRemoval(keys, new Set(['b']), 'b', 'next')).toBe('c')
  })

  it('moves back instead when the user prefers the previous conversation', () => {
    expect(focusAfterRemoval(keys, new Set(['b']), 'b', 'previous')).toBe('a')
  })

  it('turns the other way at either end of the list', () => {
    expect(focusAfterRemoval(keys, new Set(['e']), 'e', 'next')).toBe('d')
    expect(focusAfterRemoval(keys, new Set(['a']), 'a', 'previous')).toBe('b')
  })

  it('skips past every conversation that left with it', () => {
    expect(focusAfterRemoval(keys, new Set(['b', 'c', 'd']), 'c', 'next')).toBe('e')
    expect(focusAfterRemoval(keys, new Set(['a', 'b', 'c']), 'b', 'previous')).toBe('d')
  })

  it('stays on a conversation that is still there', () => {
    expect(focusAfterRemoval(keys, new Set(['b', 'd']), 'c', 'next')).toBe('c')
  })

  it('has nothing left to focus when every conversation left', () => {
    expect(focusAfterRemoval(keys, new Set(keys), 'c', 'next')).toBeUndefined()
    expect(focusAfterRemoval(keys, new Set(['x']), 'x', 'next')).toBeUndefined()
  })
})
