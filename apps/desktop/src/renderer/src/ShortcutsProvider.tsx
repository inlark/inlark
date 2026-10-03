import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Bootstrap } from '@inlark/core'
import { api } from './api'
import { queryClient } from './cache'
import { ShortcutsContext, overridesFor, resolveShortcuts, type ShortcutsValue } from './shortcuts'

/** Provides the saved shortcuts everywhere, including the settings and the shortcuts dialog. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({ queryKey: ['bootstrap'], queryFn: () => api.bootstrap() })
  const saved = data?.settings.shortcuts
  const value = useMemo<ShortcutsValue>(
    () => ({
      bindings: resolveShortcuts(saved),
      save: async (bindings) => {
        const current = queryClient.getQueryData<Bootstrap>(['bootstrap'])
        if (!current) return
        const next = { ...current.settings, shortcuts: overridesFor(bindings) }
        queryClient.setQueryData<Bootstrap>(['bootstrap'], { ...current, settings: next })
        try {
          await api.settings(next)
        } catch (error) {
          queryClient.setQueryData<Bootstrap>(
            ['bootstrap'],
            (old) => old && { ...old, settings: { ...old.settings, shortcuts: saved } },
          )
          throw error
        }
      },
    }),
    [saved],
  )
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}
