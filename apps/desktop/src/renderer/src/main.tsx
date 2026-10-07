import { cn } from '@inlark/ui'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { TooltipProvider } from '@inlark/ui'
import { queryClient, restoreCache } from './cache'
import { App } from './App'
import { ShortcutsProvider } from './ShortcutsProvider'
import '@inlark/ui/styles.css'
import './styles.css'

export interface RouteSearch {
  view?: string
  account?: string
  folder?: string
  thread?: string
  threadAccount?: string
  q?: string
}
const rootRoute = createRootRoute()
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (input: Record<string, unknown>): RouteSearch =>
    Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) =>
          ['view', 'account', 'folder', 'thread', 'threadAccount', 'q'].includes(key) &&
          typeof value === 'string',
      ),
    ),
  component: App,
})
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  history: createHashHistory(),
})
if (!location.hash || location.hash === '#/') {
  try {
    const saved = JSON.parse(localStorage.getItem('last-location') || 'null') as RouteSearch | null
    const search = Object.fromEntries(
      Object.entries(saved || {}).filter(
        ([key, value]) => ['view', 'account', 'folder'].includes(key) && typeof value === 'string',
      ),
    )
    if (Object.keys(search).length) void router.navigate({ to: '/', search, replace: true })
  } catch {
    /* Start in the inbox when there is nothing valid to restore. */
  }
}
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  render() {
    return this.state.error ? (
      <div className="startup-error [&_h1]:text-[23px] [&_p]:text-muted [&_p]:leading-[1.8] max-w-130 my-[20vh] mx-auto p-6.25">
        <h1>Something went wrong</h1>
        <p>inlark ran into an unexpected problem. Your saved drafts are safe on this device.</p>
        <button
          className={cn(
            'button inline-flex items-center justify-center gap-1.75 border border-solid border-border-strong bg-surface',
            'rounded-md py-1.5 px-2.75 text-[12px] font-medium whitespace-nowrap transition-[background,color] duration-120',
            'ease-[ease] min-h-8 [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:border-foreground/24',
            "[&[aria-disabled='true']]:opacity-40 [&[aria-disabled='true']]:cursor-default",
          )}
          onClick={() => location.reload()}
        >
          Reload inlark
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
void restoreCache().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* Drags the window like a native title bar, on every screen including the error page. */}
      <div
        aria-hidden
        className="titlebar fixed inset-x-0 top-0 h-(--titlebar-height) bg-sidebar [app-region:drag]"
      />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={500}>
            <ShortcutsProvider>
              <RouterProvider router={router} />
            </ShortcutsProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  ),
)
