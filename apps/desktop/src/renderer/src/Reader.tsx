import { cn } from '@inlark/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  ArrowLeft,
  Archive,
  Trash2,
  Star,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  Reply,
  ReplyAll,
  Forward,
  Download,
  ImageOff,
  ChevronRight,
  ShieldX,
  Mail,
  FileText,
  File,
  FileImage,
  FileArchive,
  FileSpreadsheet,
  FolderInput,
  Inbox,
  Paperclip,
  ShieldCheck,
  Check,
  MailMinus,
  PencilEdit,
} from '@inlark/ui/icons'
import { Tooltip } from '@base-ui/react/tooltip'
import { Button, IconButton, Dropdown, MenuItem, Spinner } from '@inlark/ui'
import {
  friendlyError,
  isDraft,
  type Account,
  type Message,
  type Settings,
  type MailAction,
  type View,
} from '@inlark/core'
import { api } from './api'
import { SenderAvatar } from './SenderAvatar'
import { useResolvedTheme, token } from './theme'
import { formatBytes, longDate, messageDate } from './mail-date'
import { AccountMark } from './AccountMark'
import { HintIconButton } from './HintIconButton'
import { actionLimit } from './account-limits'
import { ShortcutHint, useShortcutText } from './shortcuts'
import { emailSanitizeOptions } from './email-html'
import { offersAction } from './view-actions'

const formatAddress = (a: { name: string; email: string }) =>
  a.name ? a.name + ' <' + a.email + '>' : a.email

const linkPattern = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g
const escapeText = (value: string) => {
  const holder = document.createElement('div')
  holder.textContent = value
  return holder.innerHTML
}
/** Plain text as HTML with web addresses made clickable. */
const plainHtml = (value: string) =>
  '<div style="white-space:pre-wrap">' +
  escapeText(value).replace(linkPattern, (url) => '<a href="' + url + '">' + url + '</a>') +
  '</div>'
/**
 * Mail that paints its own backgrounds, lays itself out with tables, or carries images (logos
 * are usually drawn for white) is shown on white paper, as its sender designed it. Everything
 * else adopts the app theme, so a short note reads like part of the app.
 */
const hasOwnStyling = (root: DocumentFragment) =>
  !!root.querySelector('[bgcolor],[background],table table,img') ||
  [...root.querySelectorAll('[style]')].some((element) =>
    /(?:^|;)\s*background(?:-color|-image)?\s*:/i.test(element.getAttribute('style') || ''),
  )
const luminance = (color: string) => {
  const [r, g, b] = (color.match(/[\d.]+/g) || []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return r === undefined ? null : 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Sender text colours stay unless they would be hard to read on the theme background. */
const softenColors = (doc: Document, background: string) => {
  const base = luminance(background)
  if (base === null) return
  for (const element of doc.body.querySelectorAll<HTMLElement>('[style*="color"],font[color]')) {
    const value = luminance(getComputedStyle(element).color)
    if (value === null) continue
    const contrast = (Math.max(base, value) + 0.05) / (Math.min(base, value) + 0.05)
    if (contrast < 3.2) {
      element.style.color = 'inherit'
      element.removeAttribute('color')
    }
  }
}
const fontStack = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const paperStyles =
  'html,body{margin:0;background:#fff;color:#24262b;font:16px/1.75 ' +
  fontStack +
  ';overflow-wrap:anywhere}body{padding:22px 24px 26px}p{margin:0 0 16px}a{color:#5a4fb0}blockquote{margin:16px 0;padding-left:16px;border-l:2px solid #d5d5dc;color:#5d6068}hr{border:0;border-t:1px solid #e3e3e8;margin:24px 0}summary{color:#70737d}summary:hover{background:#f0f0f3}'
const adaptiveStyles = (theme: 'light' | 'dark') =>
  'html,body{margin:0;background:transparent;color:' +
  token('--text') +
  ';font:15px/1.7 ' +
  fontStack +
  ';overflow-wrap:anywhere;color-scheme:' +
  theme +
  '}body{padding:2px 0 4px}p{margin:0 0 14px}a{color:' +
  token('--accent') +
  ';text-decoration:underline;text-decoration-color:' +
  token('--border-strong') +
  ';text-underline-offset:3px}a:hover{text-decoration-color:currentColor}blockquote{margin:14px 0;padding-left:14px;border-l:2px solid ' +
  token('--border-strong') +
  ';color:' +
  token('--muted') +
  '}hr{border:0;border-t:1px solid ' +
  token('--border-strong') +
  ';margin:22px 0}summary{color:' +
  token('--muted') +
  ';border-color:' +
  token('--border-strong') +
  '}summary:hover{color:' +
  token('--text') +
  '}::selection{background:' +
  token('--accent') +
  '44}'
const sharedStyles =
  'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}details{margin-top:14px}summary{display:inline-flex;align-items:center;height:18px;padding:0 8px;border:1px solid #d5d5dc;border-radius:9px;cursor:pointer;font-size:11px;letter-spacing:1px;list-style:none;user-select:none}summary::-webkit-details-marker{display:none}details[open]>summary{margin-bottom:10px}'

export function EmailBody({
  message,
  remoteImages,
  loading = false,
  onLinkHover,
  onMailto,
}: {
  message: Message
  remoteImages: boolean
  /** The message body is still being fetched; show its shape instead of the preview. */
  loading?: boolean
  onLinkHover?: (href: string | null) => void
  onMailto?: (url: string) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const linkedDocument = useRef<Document | null>(null)
  const writtenSource = useRef<string | null>(null)
  const [source, setSource] = useState('')
  const [adaptive, setAdaptive] = useState(false)
  const adaptiveFrame = useRef(false)
  const [blocked, setBlocked] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [renderIssue, setRenderIssue] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const theme = useResolvedTheme()
  const hover = useRef(onLinkHover)
  hover.current = onLinkHover
  const mailto = useRef(onMailto)
  mailto.current = onMailto
  const describeIssue = (stage: string, error: string, currentSource = source) =>
    JSON.stringify(
      {
        stage,
        error,
        htmlChars: message.html?.length ?? 0,
        textChars: message.text?.length ?? 0,
        sourceChars: currentSource.length,
        sourceWritten: writtenSource.current === currentSource,
        frame: (() => {
          try {
            const doc = frame.current?.contentDocument
            return {
              present: !!frame.current,
              documentAccessible: !!doc,
              documentKind: doc?.URL.startsWith('blob:')
                ? 'blob'
                : doc?.URL.startsWith('about:')
                  ? doc.URL
                  : doc
                    ? 'other'
                    : null,
              readyState: doc?.readyState ?? null,
              bodyPresent: !!doc?.body,
              bodyTextChars: doc?.body?.textContent?.length ?? null,
              bodyHtmlChars: doc?.body?.innerHTML.length ?? null,
            }
          } catch (cause) {
            return {
              inspectionError:
                cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
            }
          }
        })(),
      },
      null,
      2,
    )
  useEffect(() => {
    let active = true
    const run = async () => {
      const template = document.createElement('template')
      const plain = plainHtml(
        (message.text?.trim() ? message.text : message.preview) ||
          'No readable message body is available.',
      )
      template.innerHTML = DOMPurify.sanitize(
        (message.html?.trim() ? message.html : '') || plain,
        emailSanitizeOptions,
      )
      if (
        !template.content.textContent?.trim() &&
        (message.text?.trim() || message.preview?.trim())
      )
        template.innerHTML = DOMPurify.sanitize(plain)
      const imageJobs = [...template.content.querySelectorAll('img')].map(async (image) => {
        const original = image.getAttribute('src') || ''
        image.removeAttribute('src')
        if (
          image.hidden ||
          image.style.display === 'none' ||
          image.style.visibility === 'hidden' ||
          (image.style.width === '1px' && image.style.height === '1px') ||
          (image.getAttribute('width') === '1' && image.getAttribute('height') === '1')
        ) {
          image.remove()
          return
        }
        image.setAttribute('referrerpolicy', 'no-referrer')
        image.style.maxWidth = '100%'
        try {
          if (original.startsWith('cid:')) {
            const attachment = message.attachments?.find(
              (a) => a.cid?.replace(/^<|>$/g, '') === original.slice(4),
            )
            if (attachment) image.src = await api.inlineImage(message.accountId, attachment)
            else image.replaceWith(document.createTextNode(image.alt || ''))
          } else if (/^https?:/.test(original) && remoteImages) {
            const source = await api.remoteImage(original)
            if (source) image.src = source
            else image.replaceWith(document.createTextNode(image.alt || ''))
          } else if (/^https?:/.test(original) && active) setBlocked(true)
        } catch {
          image.replaceWith(document.createTextNode(image.alt || ''))
        }
      })
      // Tracking pixels were removed synchronously above, so they do not count as images.
      const ownStyling = hasOwnStyling(template.content)
      const html = () =>
        '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="' +
        (ownStyling ? 'light' : theme) +
        '"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><meta name="referrer" content="no-referrer"><style>' +
        sharedStyles +
        (ownStyling ? paperStyles : adaptiveStyles(theme)) +
        '</style></head><body>' +
        template.innerHTML +
        '</body></html>'
      for (const quote of template.content.querySelectorAll('blockquote')) {
        const details = document.createElement('details'),
          summary = document.createElement('summary')
        summary.textContent = '•••'
        summary.title = 'Show quoted text'
        details.append(summary)
        quote.replaceWith(details)
        details.append(quote)
      }
      if (active) {
        adaptiveFrame.current = !ownStyling
        setAdaptive(!ownStyling)
        setSource(html())
      }
      await Promise.allSettled(imageJobs)
      if (active) setSource(html())
    }
    setBlocked(false)
    setFrameReady(false)
    setRenderIssue(null)
    setCopyStatus('')
    writtenSource.current = null
    setSource('')
    if (loading) return
    void run().catch((cause: unknown) => {
      if (!active) return
      const error =
        cause instanceof Error ? (cause.stack ?? `${cause.name}: ${cause.message}`) : String(cause)
      setRenderIssue(describeIssue('Preparing HTML', error))
    })
    return () => {
      active = false
    }
  }, [message.id, message.html, message.text, remoteImages, theme, loading])
  useEffect(() => {
    if (!source || frameReady || renderIssue) return
    const timeout = window.setTimeout(() => {
      setRenderIssue(
        (current) =>
          current ??
          describeIssue('Loading HTML frame', 'No readable frame content after 3 seconds.', source),
      )
    }, 3000)
    return () => window.clearTimeout(timeout)
  }, [source, frameReady, renderIssue])
  const resizeFrame = () => {
    try {
      const element = frame.current
      const body = element?.contentDocument?.body
      if (element && body)
        element.style.height = Math.min(30000, Math.max(80, body.scrollHeight + 8)) + 'px'
    } catch (cause) {
      setFrameReady(false)
      const error =
        cause instanceof Error ? (cause.stack ?? `${cause.name}: ${cause.message}`) : String(cause)
      setRenderIssue(describeIssue('Resizing HTML frame', error))
    }
  }
  const onFrameLoad = () => {
    observer.current?.disconnect()
    if (!source || writtenSource.current !== source) return
    try {
      const doc = frame.current?.contentDocument
      if (!doc?.body) {
        setFrameReady(false)
        setRenderIssue(
          describeIssue('Loading HTML frame', 'The frame loaded without an accessible body.'),
        )
        return
      }
      const hasContent = !!(doc.body.textContent?.trim() || doc.body.querySelector('img'))
      setFrameReady(hasContent)
      if (!hasContent) {
        setRenderIssue(
          describeIssue(
            'Loading HTML frame',
            'The frame body contains no readable text or images.',
          ),
        )
        return
      }
      setRenderIssue(null)
      if (adaptiveFrame.current) softenColors(doc, getComputedStyle(document.body).backgroundColor)
      resizeFrame()
      observer.current = new ResizeObserver(resizeFrame)
      observer.current.observe(doc.body)
      if (linkedDocument.current !== doc) {
        linkedDocument.current = doc
        doc.addEventListener('click', (event) => {
          const link = (event.target as Element).closest('a')
          if (link) {
            event.preventDefault()
            const href = link.getAttribute('href')
            if (!href || href.startsWith('#')) return
            if (/^mailto:/i.test(href) && mailto.current) mailto.current(href)
            else void api.openExternal(href).catch(() => {})
          }
        })
        doc.addEventListener('mouseover', (event) => {
          const href = (event.target as Element).closest?.('a')?.getAttribute('href')
          hover.current?.(href && !href.startsWith('#') ? href : null)
        })
        doc.addEventListener('mouseleave', () => hover.current?.(null))
        // Keep app shortcuts working after clicking into the message body.
        doc.addEventListener('keydown', (event) => {
          const forwarded = new KeyboardEvent('keydown', {
            key: event.key,
            code: event.code,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            repeat: event.repeat,
            bubbles: true,
            cancelable: true,
          })
          document.dispatchEvent(forwarded)
          if (forwarded.defaultPrevented) event.preventDefault()
        })
      }
    } catch (cause) {
      setFrameReady(false)
      const error =
        cause instanceof Error ? (cause.stack ?? `${cause.name}: ${cause.message}`) : String(cause)
      setRenderIssue(describeIssue('Inspecting HTML frame', error))
    }
  }
  useLayoutEffect(() => {
    if (!source) {
      observer.current?.disconnect()
      return
    }
    try {
      const doc = frame.current?.contentDocument
      if (!doc) {
        setRenderIssue(
          describeIssue('Writing HTML frame', 'The blank frame document is inaccessible.', source),
        )
        return
      }
      observer.current?.disconnect()
      setFrameReady(false)
      setRenderIssue(null)
      writtenSource.current = null
      linkedDocument.current = null
      doc.open()
      doc.write(source)
      doc.close()
      writtenSource.current = source
      onFrameLoad()
    } catch (cause) {
      setFrameReady(false)
      const error =
        cause instanceof Error ? (cause.stack ?? `${cause.name}: ${cause.message}`) : String(cause)
      setRenderIssue(describeIssue('Writing HTML frame', error, source))
    }
  }, [source])
  useLayoutEffect(() => {
    if (frameReady) resizeFrame()
  }, [frameReady, source])
  useEffect(() => () => observer.current?.disconnect(), [])
  return (
    <>
      {blocked && (
        <div className="image-notice flex gap-1.75 items-center text-muted text-[11px] pt-2 pb-4.25 px-0">
          <ImageOff size={13} />
          Remote images are off. You can enable them in Settings.
        </div>
      )}
      {source && (
        <iframe
          ref={frame}
          title={'Message from ' + (message.from[0]?.name || message.from[0]?.email || 'sender')}
          sandbox="allow-same-origin"
          className={cn(
            'email-frame [color-scheme:light] w-full border-0 block min-h-10',
            adaptive
              ? 'email-frame-adaptive [color-scheme:inherit] bg-transparent rounded-none'
              : 'bg-white rounded-lg',
          )}
          referrerPolicy="no-referrer"
          onLoad={onFrameLoad}
          onError={() => {
            setFrameReady(false)
            setRenderIssue(describeIssue('Loading HTML frame', 'The frame emitted an error event.'))
          }}
          style={{ display: frameReady ? 'block' : 'none' }}
        />
      )}
      {loading && (
        <div
          className={cn(
            'body-skeleton [&_span]:block [&_span]:h-2.5 [&_span]:rounded-sm',
            '[&_span]:bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
            '[&_span]:[background-size:200%_100%] [&_span]:animate-[shimmer_1.4s_ease-in-out_infinite]',
            '[&_span:nth-child(1)]:w-[32%] [&_span:nth-child(2)]:w-[92%] [&_span:nth-child(3)]:w-[84%]',
            '[&_span:nth-child(4)]:w-[58%] grid gap-3 pt-1.5 pb-2.5 px-0',
          )}
          aria-label="Loading message"
          role="status"
        >
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      {!frameReady && !loading && (
        <>
          <div className="email-fallback font-sans text-[15px] leading-[1.7] [overflow-wrap:anywhere] pt-[2px] pb-1 px-0 text-foreground whitespace-pre-wrap">
            {(message.text?.trim() ? message.text : message.preview?.trim()) ||
              'No readable message body is available.'}
          </div>
          {renderIssue && (
            <details
              className={cn(
                'email-render-details [&_summary]:cursor-pointer [&_p]:my-2 [&_p]:mx-0 [&_pre]:max-h-55 [&_pre]:p-3',
                '[&_pre]:overflow-auto [&_pre]:border [&_pre]:border-solid [&_pre]:border-border [&_pre]:rounded-md',
                '[&_pre]:select-text [&_pre]:whitespace-pre-wrap [&_button]:mr-2.5 [&_button]:py-1.25 [&_button]:px-2',
                '[&_button]:border [&_button]:border-solid [&_button]:border-border [&_button]:rounded-sm',
                '[&_button]:bg-transparent [&_button]:text-inherit [&_button]:cursor-pointer mt-3 text-muted text-[12px]',
              )}
            >
              <summary>HTML rendering details</summary>
              <p>
                Review these details before sharing them. Error text can contain message
                information.
              </p>
              <pre>{renderIssue}</pre>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(renderIssue).then(
                    () => setCopyStatus('Copied render details.'),
                    () => setCopyStatus('Could not copy. Select the details above instead.'),
                  )
                }}
              >
                Copy render details
              </button>
              {copyStatus && <span role="status">{copyStatus}</span>}
            </details>
          )}
        </>
      )}
    </>
  )
}
interface ReaderProps {
  messages: Message[]
  account: Account
  settings: Settings
  /** Where the conversation was opened from, which decides the actions worth offering. */
  view: View
  backLabel: string
  busy: boolean
  onBack: () => void
  onPrevious?: () => void
  onNext?: () => void
  position?: string
  onAction: (action: MailAction) => void
  onMove: () => void
  onReply: (message: Message, kind: 'reply' | 'replyAll' | 'forward') => void
  onEditDraft: (message: Message) => void
  onDiscardDraft: (message: Message) => void
  notify: (message: string, tone?: 'error' | 'info') => void
  onMailto: (url: string) => void
  /** Set when the conversation comes from a mailing list that can be left. */
  unsubscribe?: UnsubscribeState
  onUnsubscribe: () => void
  /** Messages are list summaries while the full conversation loads. */
  loading?: boolean
}
export type UnsubscribeState = 'available' | 'pending' | 'done'
const unsubscribeLabels = {
  available: 'Unsubscribe',
  pending: 'Unsubscribing…',
  done: 'Unsubscribed',
} satisfies Record<UnsubscribeState, string>
function UnsubscribeButton({ state, onClick }: { state: UnsubscribeState; onClick: () => void }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            variant="ghost"
            className={cn(
              'unsubscribe-button min-h-7.25 h-7.25 py-0 pr-2.5 pl-2 gap-1.5 [&_svg]:shrink-0 disabled:opacity-100 @max-[440px]/mail:w-7.25 @max-[440px]/mail:p-1.25 @max-[440px]/mail:[&_span]:hidden unsubscribe-' +
                state,
              state === 'pending' ? ' text-muted' : state === 'done' ? ' text-success' : '',
            )}
            aria-label={
              state === 'available'
                ? 'Unsubscribe from this mailing list'
                : unsubscribeLabels[state]
            }
            aria-busy={state === 'pending'}
            disabled={state !== 'available'}
            onClick={onClick}
          />
        }
      >
        {state === 'pending' ? (
          <Spinner size={15} />
        ) : state === 'done' ? (
          <Check size={15} />
        ) : (
          <MailMinus size={15} />
        )}
        <span>{unsubscribeLabels[state]}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={7}>
          <Tooltip.Popup className="tooltip flex gap-3 items-center py-1.5 px-2.25 bg-raised border border-solid border-border-strong rounded-md text-[11px] shadow-popup z-200">
            Unsubscribe from this mailing list
            <ShortcutHint id="unsubscribe" />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
const attachmentIcon = (type: string, name: string) =>
  type.startsWith('image/')
    ? FileImage
    : /zip|compressed|tar|gzip|x-7z|rar/.test(type) || /\.(zip|tar|gz|7z|rar)$/i.test(name)
      ? FileArchive
      : /spreadsheet|excel|csv/.test(type) || /\.(xlsx?|csv|ods)$/i.test(name)
        ? FileSpreadsheet
        : type === 'application/pdf' || /^text\//.test(type) || /word|document/.test(type)
          ? FileText
          : File
const extension = (name: string) => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  return match ? match[1].toUpperCase() : 'File'
}
export function Reader({
  messages,
  account,
  settings,
  view,
  backLabel,
  busy,
  onBack,
  onPrevious,
  onNext,
  position,
  onAction,
  onMove,
  onReply,
  onEditDraft,
  onDiscardDraft,
  notify,
  onMailto,
  unsubscribe,
  onUnsubscribe,
  loading = false,
}: ReaderProps) {
  const keys = useShortcutText()
  // Unsent drafts sit below the conversation they would continue, never among what was said.
  const history = messages.filter((m) => !isDraft(m))
  const drafts = messages.filter(isDraft)
  const last = history.at(-1)
  const initiallyExpanded = () =>
    new Set(
      messages
        .filter((m) => !m.keywords.$seen || isDraft(m))
        .map((m) => m.id)
        .concat(last?.id || ''),
    )
  const [expanded, setExpanded] = useState<Set<string>>(initiallyExpanded)
  const [details, setDetails] = useState<Set<string>>(new Set())
  const [link, setLink] = useState<string | null>(null)
  const messageIds = messages.map((m) => m.id).join()
  const firstIds = useRef(messageIds)
  useEffect(() => {
    // A newly arrived reply (or the full thread replacing its summary) opens unread messages.
    if (firstIds.current !== messageIds) {
      firstIds.current = messageIds
      setExpanded(initiallyExpanded())
    }
  }, [messageIds])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Space, Page Up/Down, Home and End scroll the conversation without clicking into it first.
    // Never take focus from a field or dialog, e.g. when a notification opens a conversation.
    const active = document.activeElement
    if (!active?.closest('[role="dialog"], input, textarea, [contenteditable="true"]'))
      scroller.current?.focus({ preventScroll: true })
  }, [])
  const starred = messages.some((m) => m.keywords.$flagged)
  const moveLimit = actionLimit(account, 'move')
  const destroyLimit = actionLimit(account, 'destroy')
  const toggle = (id: string, setter: typeof setExpanded) =>
    setter((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const [showAll, setShowAll] = useState(false)
  const newest = last || drafts.at(-1)
  if (!newest) return null
  // Long threads show their first message and the latest few; the middle folds into one row.
  const folded =
    !showAll && history.length > 4
      ? history.slice(1, -2).filter((m) => !expanded.has(m.id) || m.id === last?.id)
      : []
  const foldedIds = new Set(folded.length > 1 ? folded.map((m) => m.id) : [])
  const participants = [
    ...new Set(history.flatMap((m) => m.from.map((a) => a.name || a.email.split('@')[0]))),
  ]
  return (
    <div className="reader-page flex-1 flex flex-col min-h-0 relative">
      <div
        className={cn(
          'reader-toolbar h-14.25 border-b border-solid border-b-border flex items-center py-0 px-5 gap-1.25 shrink-0',
          '@max-[680px]/mail:py-0 @max-[680px]/mail:px-4 @max-[680px]/mail:gap-[2px] @max-[440px]/mail:py-0',
          '@max-[440px]/mail:px-2.5 @max-[440px]/mail:[&>.toolbar-divider]:my-0',
          '@max-[440px]/mail:[&>.toolbar-divider]:mx-[2px]',
        )}
      >
        <Button
          variant="ghost"
          className="reader-back [&_span]:overflow-hidden [&_span]:text-ellipsis @max-[680px]/mail:[&_span]:hidden max-w-45 -ml-1.5"
          aria-label={'Back to ' + backLabel.toLowerCase()}
          onClick={onBack}
          title={'Back' + (keys('back') ? ' · ' + keys('back') : '')}
        >
          <ArrowLeft size={16} />
          <span>{backLabel}</span>
        </Button>
        <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
        {offersAction(view, 'archive') && (
          <HintIconButton
            disabled={busy}
            label="Archive"
            shortcut={keys('archive')}
            hint={moveLimit}
            onClick={() => onAction('archive')}
          >
            <Archive size={16} />
          </HintIconButton>
        )}
        {offersAction(view, 'trash') && (
          <HintIconButton
            disabled={busy}
            label="Move to trash"
            shortcut={keys('trash')}
            hint={moveLimit}
            onClick={() => onAction('trash')}
          >
            <Trash2 size={16} />
          </HintIconButton>
        )}
        <IconButton
          disabled={busy}
          label="Mark as unread"
          shortcut={keys('unread')}
          onClick={() => onAction('unread')}
        >
          <Mail size={16} />
        </IconButton>
        <IconButton
          disabled={busy}
          aria-pressed={starred}
          label={starred ? 'Remove star' : 'Star conversation'}
          shortcut={keys('star')}
          onClick={() => onAction(starred ? 'unstar' : 'star')}
        >
          <Star size={16} className={cn(starred && 'starred [&:is(svg)]:fill-current text-star')} />
        </IconButton>
        <Dropdown
          trigger={
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="More conversation actions"
            >
              <MoreHorizontal size={17} />
            </Button>
          }
        >
          <MenuItem onClick={onMove} disabled={!!moveLimit}>
            <FolderInput size={14} />
            Move to folder
            <ShortcutHint id="move" className="menu-shortcut ml-auto" />
          </MenuItem>
          {offersAction(view, 'spam') && (
            <MenuItem onClick={() => onAction('spam')} disabled={!!moveLimit}>
              <ShieldX size={14} />
              Mark as spam
              <ShortcutHint id="spam" className="menu-shortcut ml-auto" />
            </MenuItem>
          )}
          {offersAction(view, 'notSpam') && (
            <MenuItem onClick={() => onAction('notSpam')} disabled={!!moveLimit}>
              <ShieldCheck size={14} />
              Not spam
              <ShortcutHint id="notSpam" className="menu-shortcut ml-auto" />
            </MenuItem>
          )}
          {offersAction(view, 'restore') && (
            <MenuItem onClick={() => onAction('restore')} disabled={!!moveLimit}>
              <Inbox size={14} />
              Restore to inbox
              <ShortcutHint id="restore" className="menu-shortcut ml-auto" />
            </MenuItem>
          )}
          {offersAction(view, 'destroy') && (
            <MenuItem danger onClick={() => onAction('destroy')} disabled={!!destroyLimit}>
              <Trash2 size={14} />
              Delete permanently
            </MenuItem>
          )}
          {[...new Set([moveLimit, offersAction(view, 'destroy') && destroyLimit])]
            .filter(Boolean)
            .map((reason) => (
              <p
                className="menu-note max-w-60 mt-1 mb-0 mx-0 pt-1.75 pb-1.25 px-2.5 border-t border-solid border-t-border text-[11px] leading-[1.5] text-muted"
                key={String(reason)}
              >
                {reason}
              </p>
            ))}
        </Dropdown>
        {unsubscribe && (
          <>
            <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
            <UnsubscribeButton state={unsubscribe} onClick={onUnsubscribe} />
          </>
        )}
        <div
          className={cn(
            'reader-navigation ml-auto flex gap-1.5 items-center [&>span]:text-[11px] [&>span]:text-muted [&>span]:mr-2.5',
            '[&>span]:tabular-nums [&>span]:whitespace-nowrap @max-[680px]/mail:gap-[2px] @max-[680px]/mail:[&>span]:mr-1',
            '@max-[440px]/mail:[&>span]:text-[10px]',
          )}
        >
          <span role="status">{busy ? 'Updating…' : position}</span>
          <IconButton
            label="Previous conversation"
            shortcut={keys('previous')}
            onClick={onPrevious}
            disabled={!onPrevious}
          >
            <ChevronUp size={16} />
          </IconButton>
          <IconButton
            label="Next conversation"
            shortcut={keys('next')}
            onClick={onNext}
            disabled={!onNext}
          >
            <ChevronDown size={16} />
          </IconButton>
        </div>
      </div>
      <div
        className="reader-scroll flex-1 overflow-auto focus-visible:outline-none"
        ref={scroller}
        tabIndex={-1}
      >
        <div
          className={cn(
            'reader-content w-[min(840px,_100%)] my-0 mx-auto pt-10 pb-12 px-10 [&_h1]:text-[27px] [&_h1]:font-[550]',
            '[&_h1]:tracking-[-0.7px] [&_h1]:leading-[1.4] [&_h1]:mt-3.5 [&_h1]:mb-7.5 [&_h1]:mx-0',
            '[&_h1]:[overflow-wrap:anywhere] @max-[680px]/mail:py-7 @max-[680px]/mail:px-6.5',
            '@max-[680px]/mail:[&_h1]:text-[24px] @max-[680px]/mail:[&_h1]:mb-6 @max-[440px]/mail:py-6.5',
            '@max-[440px]/mail:px-5',
          )}
        >
          <div className="reader-eyebrow [&>span:last-child]:text-muted flex gap-2.25 items-center text-[11px] text-secondary">
            <AccountMark account={account} size={16} />
            <span title={account.email}>{account.name}</span>
            <ChevronRight size={11} />
            <span>
              {history.length > 1
                ? history.length +
                  ' messages · ' +
                  participants.slice(0, 3).join(', ') +
                  (participants.length > 3 ? ' +' + (participants.length - 3) : '')
                : 'Conversation'}
            </span>
          </div>
          <h1>{newest.subject || '(No subject)'}</h1>
          <div className="conversation-messages">
            {[...history, ...drafts].map((message) => {
              if (foldedIds.has(message.id))
                return message.id === folded[0].id ? (
                  <button
                    key="folded"
                    className={cn(
                      'folded-messages [&_span]:absolute [&_span]:-top-2.75 [&_span]:py-[2px] [&_span]:px-2.5 [&_span]:text-[11px]',
                      '[&_span]:text-muted [&_span]:bg-background [&_span]:border [&_span]:border-solid [&_span]:border-border-strong',
                      '[&_span]:rounded-[11px] [&_span]:transition-[color,border-color] [&_span]:duration-120 [&_span]:ease-[ease]',
                      '[&:hover_span]:text-foreground [&:hover_span]:border-foreground/30 [&+.message-card]:border-t-0',
                      '[&+.message-card]:pt-0 relative flex justify-center w-full h-8.5 m-0 p-0 border-0 border-t border-solid',
                      'border-t-border-strong bg-none bg-transparent',
                    )}
                    onClick={() => setShowAll(true)}
                  >
                    <span>{folded.length} earlier messages</span>
                  </button>
                ) : null
              const open = expanded.has(message.id) || messages.length === 1
              const draft = isDraft(message)
              const sender = message.from[0]
              const when = messageDate(message.receivedAt)
              const recipients = [...message.to, ...message.cc].map((a) => a.name || a.email)
              const attachments =
                message.attachments?.filter((a) => !a.cid || a.disposition === 'attachment') || []
              return (
                <article
                  className={cn(
                    'message-card py-6 px-0 border-t border-solid border-t-border-strong',
                    draft &&
                      'draft-message mt-1.5 mb-0 -mx-5 pt-4.5 pb-5 px-5 border border-dashed border-foreground/22 rounded-xl [&+.draft-message]:mt-2.5 [&.collapsed-message]:pt-3.5 [&.collapsed-message]:pb-3.5 [&.collapsed-message_.message-heading]:opacity-100 [&_.sender-name]:flex [&_.sender-name]:items-center [&_.sender-name]:gap-2 [&_.sender-name]:text-secondary [&_.sender-name]:font-medium [&_.message-content]:pt-4.5',
                    !open &&
                      'collapsed-message [&_.message-heading]:opacity-70 py-4.5 px-0 [&:hover_.message-heading]:opacity-100',
                  )}
                  aria-label={draft ? 'Draft, not sent' : undefined}
                  key={message.id}
                >
                  <div className="message-heading flex gap-3 items-center [&_time]:text-muted [&_time]:text-[11px] [&_time]:whitespace-nowrap @max-[680px]/mail:gap-2.25 @max-[680px]/mail:[&_time_span]:hidden">
                    {draft ? (
                      <span
                        className="draft-mark grid place-items-center w-8.75 h-8.75 shrink-0 border border-dashed border-foreground/28 rounded-full text-muted"
                        aria-hidden="true"
                      >
                        <PencilEdit size={16} />
                      </span>
                    ) : (
                      <SenderAvatar
                        name={sender?.name || sender?.email || '?'}
                        email={sender?.email}
                        color={account.color}
                        size={35}
                        remoteImages={settings.remoteImages}
                      />
                    )}
                    <button
                      className="message-person flex flex-col min-w-0 flex-1 items-start text-left bg-none bg-transparent border-0 p-0 disabled:cursor-default disabled:opacity-100"
                      onClick={() => toggle(message.id, setExpanded)}
                      aria-expanded={open}
                      disabled={messages.length === 1}
                    >
                      {draft ? (
                        <span className="sender-name text-[13px] font-[550] max-w-full overflow-hidden text-ellipsis">
                          <span className="draft-badge py-0 px-1.5 rounded-xs bg-draft/14 text-draft text-[11px] font-[550] leading-[18px]">
                            Draft
                          </span>
                          Not sent yet
                        </span>
                      ) : (
                        <span className="sender-name text-[13px] font-[550] max-w-full overflow-hidden text-ellipsis">
                          {sender?.name || sender?.email}
                          <span className="sender-address font-normal text-[11px] text-muted ml-2 @max-[900px]/mail:hidden">
                            {sender?.name ? sender.email : ''}
                          </span>
                        </span>
                      )}
                      <span className="message-to text-muted text-[11px] mt-[3px] whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                        {!open
                          ? message.preview
                          : recipients.length
                            ? 'to ' + recipients.join(', ')
                            : draft
                              ? 'No recipients yet'
                              : 'to undisclosed recipients'}
                      </span>
                    </button>
                    {!!message.attachments?.length && !open && (
                      <Paperclip
                        size={13}
                        className="message-attachment-hint text-muted shrink-0"
                      />
                    )}
                    <time dateTime={message.receivedAt} title={longDate(message.receivedAt)}>
                      {draft && 'Saved '}
                      {when.date}
                      <span> · {when.time}</span>
                    </time>
                    {!draft && (
                      <IconButton
                        label="Message details"
                        aria-expanded={details.has(message.id)}
                        onClick={() => toggle(message.id, setDetails)}
                      >
                        <ChevronDown
                          size={13}
                          className={cn(
                            'details-chevron transition-[transform] duration-140 ease-[ease] [&.open]:transform-[rotate(180deg)]',
                            details.has(message.id) && 'open',
                          )}
                        />
                      </IconButton>
                    )}
                  </div>
                  {details.has(message.id) && (
                    <dl
                      className={cn(
                        'message-details grid grid-cols-[70px_1fr] gap-1.5 py-3.5 px-4 mt-4 mb-0 mr-0 ml-11.75 bg-surface rounded-[7px]',
                        'text-[11px] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere] [&+.message-content]:pt-4.5',
                        '@max-[680px]/mail:ml-0',
                      )}
                    >
                      <dt>From</dt>
                      <dd>{message.from.map(formatAddress).join(', ')}</dd>
                      {message.replyTo.length > 0 && (
                        <>
                          <dt>Reply to</dt>
                          <dd>{message.replyTo.map(formatAddress).join(', ')}</dd>
                        </>
                      )}
                      <dt>To</dt>
                      <dd>{message.to.map(formatAddress).join(', ') || '—'}</dd>
                      {message.cc.length > 0 && (
                        <>
                          <dt>Cc</dt>
                          <dd>{message.cc.map(formatAddress).join(', ')}</dd>
                        </>
                      )}
                      <dt>Date</dt>
                      <dd>{longDate(message.receivedAt)}</dd>
                      <dt>Account</dt>
                      <dd>
                        {account.name} · {account.email}
                      </dd>
                      <dt>Message ID</dt>
                      <dd>{message.messageId?.join(', ') || message.id}</dd>
                    </dl>
                  )}
                  {open && (
                    <div className="message-content pt-6 pb-[2px] pr-0 pl-11.75 @max-[680px]/mail:pl-0">
                      <EmailBody
                        message={message}
                        remoteImages={settings.remoteImages}
                        loading={loading && !message.html && !message.text}
                        onLinkHover={setLink}
                        onMailto={onMailto}
                      />
                      {attachments.length > 0 && (
                        <div className="attachment-list flex gap-2.5 flex-wrap mt-5">
                          {attachments.map((attachment) => {
                            const Icon = attachmentIcon(attachment.type, attachment.name)
                            return (
                              <div
                                className={cn(
                                  'attachment-card flex items-center border border-solid border-border-strong rounded-lg p-2.75 max-w-full',
                                  'bg-surface [&>button:not(.button)]:border-0 [&>button:not(.button)]:bg-none',
                                  '[&>button:not(.button)]:bg-transparent [&>button:not(.button)]:text-left [&>button:not(.button)]:p-0',
                                  '[&>button:not(.button)]:min-w-0 [&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis',
                                  '[&_strong]:whitespace-nowrap [&_strong]:text-[11px] [&_strong]:font-medium [&_span]:text-muted',
                                  '[&_span]:text-[11px] py-1.5 pr-1.5 pl-2 gap-1 transition-[border-color] duration-120 ease-[ease]',
                                  'hover:border-foreground/22',
                                )}
                                key={attachment.blobId}
                              >
                                <button
                                  className="attachment-open flex items-center gap-2.5 min-w-0 max-w-65 py-[3px] pr-1 pl-0 border-0 bg-none bg-transparent text-left"
                                  title={'Open ' + attachment.name}
                                  onClick={() =>
                                    void api
                                      .attachment(account.id, attachment, true)
                                      .catch((e) => notify(friendlyError(e), 'error'))
                                  }
                                >
                                  <span className="attachment-icon grid place-items-center w-8.5 h-8.5 shrink-0 p-0 rounded-[7px] text-primary bg-primary-tint">
                                    <Icon size={18} strokeWidth={1.6} />
                                  </span>
                                  <span className="attachment-label [&>span]:block [&>span]:mt-[1px] min-w-0">
                                    <strong>{attachment.name}</strong>
                                    <span>
                                      {extension(attachment.name)} · {formatBytes(attachment.size)}
                                    </span>
                                  </span>
                                </button>
                                <IconButton
                                  label={'Save ' + attachment.name}
                                  onClick={() =>
                                    void api
                                      .attachment(account.id, attachment, false)
                                      .catch((e) => notify(friendlyError(e), 'error'))
                                  }
                                >
                                  <Download size={14} />
                                </IconButton>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {draft && (
                        <div className="draft-message-actions flex gap-1.5 mt-4">
                          <Button onClick={() => onEditDraft(message)}>
                            <PencilEdit size={14} />
                            Continue editing
                          </Button>
                          <Button variant="ghost" onClick={() => onDiscardDraft(message)}>
                            <Trash2 size={14} />
                            Discard draft
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {last && (
            <div
              className={cn(
                'reply-panel mt-3 mb-0 mr-0 ml-11.75 border border-solid border-border-strong rounded-xl',
                'bg-[color-mix(in_srgb,_var(--surface)_45%,_var(--bg))] overflow-hidden @max-[680px]/mail:ml-0',
              )}
            >
              <button
                className={cn(
                  'reply-prompt flex items-center gap-3.25 w-full bg-none bg-transparent border-0 text-left p-5 text-muted',
                  'hover:bg-hover [&>span:not(.shortcut-keys)]:flex-1 [&>span:not(.shortcut-keys)]:min-w-0 [&_strong]:block',
                  '[&_strong]:text-foreground [&_strong]:text-[13px] [&_strong]:font-medium [&_strong]:overflow-hidden',
                  '[&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_span_span]:block [&_span_span]:text-[12px]',
                  '[&_span_span]:mt-1',
                )}
                onClick={() => onReply(last, 'reply')}
              >
                <Reply size={17} />
                <span>
                  <strong>Reply to {last.from[0]?.name || last.from[0]?.email || 'sender'}</strong>
                </span>
                <ShortcutHint id="reply" />
              </button>
              <div className="reply-bar flex gap-2.5 pt-0 pb-3 pr-3.5 pl-11.25 [&_.button]:text-[11px] @max-[680px]/mail:pl-11 [&_kbd]:ml-[2px] [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px]">
                <Button variant="ghost" onClick={() => onReply(last, 'replyAll')}>
                  <ReplyAll size={14} />
                  Reply all
                  <ShortcutHint id="replyAll" />
                </Button>
                <Button variant="ghost" onClick={() => onReply(last, 'forward')}>
                  <Forward size={14} />
                  Forward
                  <ShortcutHint id="forward" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {link && (
        <div
          className={cn(
            'link-status shadow-[0_4px_14px_#0003] absolute left-3 bottom-3 max-w-[min(640px,_calc(100%_-_24px))] py-1.25',
            'px-2.25 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-secondary bg-raised border',
            'border-solid border-border-strong rounded-md pointer-events-none z-5',
          )}
          aria-hidden="true"
        >
          {link}
        </div>
      )}
    </div>
  )
}
