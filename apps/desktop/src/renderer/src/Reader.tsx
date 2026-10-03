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
} from '@inlark/ui/icons'
import { Tooltip } from '@base-ui/react/tooltip'
import { Button, IconButton, Dropdown, MenuItem, Spinner } from '@inlark/ui'
import {
  friendlyError,
  type Account,
  type Message,
  type Settings,
  type MailAction,
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
  ';overflow-wrap:anywhere}body{padding:22px 24px 26px}p{margin:0 0 16px}a{color:#5a4fb0}blockquote{margin:16px 0;padding-left:16px;border-left:2px solid #d5d5dc;color:#5d6068}hr{border:0;border-top:1px solid #e3e3e8;margin:24px 0}summary{color:#70737d}summary:hover{background:#f0f0f3}'
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
  ';text-underline-offset:3px}a:hover{text-decoration-color:currentColor}blockquote{margin:14px 0;padding-left:14px;border-left:2px solid ' +
  token('--border-strong') +
  ';color:' +
  token('--muted') +
  '}hr{border:0;border-top:1px solid ' +
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
        <div className="image-notice">
          <ImageOff size={13} />
          Remote images are off. You can enable them in Settings.
        </div>
      )}
      {source && (
        <iframe
          ref={frame}
          title={'Message from ' + (message.from[0]?.name || message.from[0]?.email || 'sender')}
          sandbox="allow-same-origin"
          className={'email-frame' + (adaptive ? ' email-frame-adaptive' : '')}
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
        <div className="body-skeleton" aria-label="Loading message" role="status">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      {!frameReady && !loading && (
        <>
          <div className="email-fallback">
            {(message.text?.trim() ? message.text : message.preview?.trim()) ||
              'No readable message body is available.'}
          </div>
          {renderIssue && (
            <details className="email-render-details">
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
  backLabel: string
  busy: boolean
  onBack: () => void
  onPrevious?: () => void
  onNext?: () => void
  position?: string
  onAction: (action: MailAction) => void
  onMove: () => void
  onReply: (message: Message, kind: 'reply' | 'replyAll' | 'forward') => void
  notify: (message: string) => void
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
            className={'unsubscribe-button unsubscribe-' + state}
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
          <Tooltip.Popup className="tooltip">
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
  backLabel,
  busy,
  onBack,
  onPrevious,
  onNext,
  position,
  onAction,
  onMove,
  onReply,
  notify,
  onMailto,
  unsubscribe,
  onUnsubscribe,
  loading = false,
}: ReaderProps) {
  const keys = useShortcutText()
  const last = messages[messages.length - 1]
  const initiallyExpanded = () =>
    new Set(
      messages
        .filter((m) => !m.keywords.$seen)
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
  const starred = messages.some((m) => m.keywords.$flagged)
  const moveLimit = actionLimit(account, 'move')
  const toggle = (id: string, setter: typeof setExpanded) =>
    setter((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const [showAll, setShowAll] = useState(false)
  if (!last) return null
  // Long threads show their first message and the latest few; the middle folds into one row.
  const folded =
    !showAll && messages.length > 4
      ? messages.slice(1, -2).filter((m) => !expanded.has(m.id) || m.id === last.id)
      : []
  const foldedIds = new Set(folded.length > 1 ? folded.map((m) => m.id) : [])
  const participants = [
    ...new Set(messages.flatMap((m) => m.from.map((a) => a.name || a.email.split('@')[0]))),
  ]
  return (
    <div className="reader-page">
      <div className="reader-toolbar">
        <Button
          variant="ghost"
          className="reader-back"
          aria-label={'Back to ' + backLabel.toLowerCase()}
          onClick={onBack}
          title="Back · Esc"
        >
          <ArrowLeft size={16} />
          <span>{backLabel}</span>
        </Button>
        <span className="toolbar-divider" />
        <HintIconButton
          disabled={busy}
          label="Archive"
          shortcut={keys('archive')}
          hint={moveLimit}
          onClick={() => onAction('archive')}
        >
          <Archive size={16} />
        </HintIconButton>
        <HintIconButton
          disabled={busy}
          label="Move to trash"
          shortcut={keys('trash')}
          hint={moveLimit}
          onClick={() => onAction('trash')}
        >
          <Trash2 size={16} />
        </HintIconButton>
        <IconButton
          disabled={busy}
          label="Mark unread"
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
          <Star size={16} className={starred ? 'starred' : ''} />
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
            <ShortcutHint id="move" className="menu-shortcut" />
          </MenuItem>
          <MenuItem onClick={() => onAction('spam')} disabled={!!moveLimit}>
            <ShieldX size={14} />
            Mark as spam
            <ShortcutHint id="spam" className="menu-shortcut" />
          </MenuItem>
          <MenuItem onClick={() => onAction('notSpam')} disabled={!!moveLimit}>
            <ShieldCheck size={14} />
            Not spam
            <ShortcutHint id="notSpam" className="menu-shortcut" />
          </MenuItem>
          <MenuItem onClick={() => onAction('restore')} disabled={!!moveLimit}>
            <Inbox size={14} />
            Restore to inbox
            <ShortcutHint id="restore" className="menu-shortcut" />
          </MenuItem>
          {moveLimit && <p className="menu-note">{moveLimit}</p>}
        </Dropdown>
        {unsubscribe && (
          <>
            <span className="toolbar-divider" />
            <UnsubscribeButton state={unsubscribe} onClick={onUnsubscribe} />
          </>
        )}
        <div className="reader-navigation">
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
      <div className="reader-scroll">
        <div className="reader-content">
          <div className="reader-eyebrow">
            <AccountMark account={account} size={16} />
            <span title={account.email}>{account.name}</span>
            <ChevronRight size={11} />
            <span>
              {messages.length > 1
                ? messages.length +
                  ' messages · ' +
                  participants.slice(0, 3).join(', ') +
                  (participants.length > 3 ? ' +' + (participants.length - 3) : '')
                : 'Conversation'}
            </span>
          </div>
          <h1>{last.subject || '(No subject)'}</h1>
          <div className="conversation-messages">
            {messages.map((message) => {
              if (foldedIds.has(message.id))
                return message.id === folded[0].id ? (
                  <button key="folded" className="folded-messages" onClick={() => setShowAll(true)}>
                    <span>{folded.length} earlier messages</span>
                  </button>
                ) : null
              const open = expanded.has(message.id) || messages.length === 1
              const sender = message.from[0]
              const when = messageDate(message.receivedAt)
              const attachments =
                message.attachments?.filter((a) => !a.cid || a.disposition === 'attachment') || []
              return (
                <article
                  className={'message-card ' + (!open ? 'collapsed-message' : '')}
                  key={message.id}
                >
                  <div className="message-heading">
                    <SenderAvatar
                      name={sender?.name || sender?.email || '?'}
                      email={sender?.email}
                      color={account.color}
                      size={35}
                      remoteImages={settings.remoteImages}
                    />
                    <button
                      className="message-person"
                      onClick={() => toggle(message.id, setExpanded)}
                      aria-expanded={open}
                      disabled={messages.length === 1}
                    >
                      <span className="sender-name">
                        {sender?.name || sender?.email}
                        <span className="sender-address">{sender?.name ? sender.email : ''}</span>
                      </span>
                      <span className="message-to">
                        {open
                          ? 'to ' +
                            ([...message.to, ...message.cc]
                              .map((a) => a.name || a.email)
                              .join(', ') || 'undisclosed recipients')
                          : message.preview}
                      </span>
                    </button>
                    {!!message.attachments?.length && !open && (
                      <Paperclip size={13} className="message-attachment-hint" />
                    )}
                    <time dateTime={message.receivedAt} title={longDate(message.receivedAt)}>
                      {when.date}
                      <span> · {when.time}</span>
                    </time>
                    <IconButton
                      label="Message details"
                      aria-expanded={details.has(message.id)}
                      onClick={() => toggle(message.id, setDetails)}
                    >
                      <ChevronDown
                        size={13}
                        className={'details-chevron' + (details.has(message.id) ? ' open' : '')}
                      />
                    </IconButton>
                  </div>
                  {details.has(message.id) && (
                    <dl className="message-details">
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
                    <div className="message-content">
                      <EmailBody
                        message={message}
                        remoteImages={settings.remoteImages}
                        loading={loading && !message.html && !message.text}
                        onLinkHover={setLink}
                        onMailto={onMailto}
                      />
                      {attachments.length > 0 && (
                        <div className="attachment-list">
                          {attachments.map((attachment) => {
                            const Icon = attachmentIcon(attachment.type, attachment.name)
                            return (
                              <div className="attachment-card" key={attachment.blobId}>
                                <button
                                  className="attachment-open"
                                  title={'Open ' + attachment.name}
                                  onClick={() =>
                                    void api
                                      .attachment(account.id, attachment, true)
                                      .catch((e) => notify(friendlyError(e)))
                                  }
                                >
                                  <span className="attachment-icon">
                                    <Icon size={18} strokeWidth={1.6} />
                                  </span>
                                  <span className="attachment-label">
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
                                      .catch((e) => notify(friendlyError(e)))
                                  }
                                >
                                  <Download size={14} />
                                </IconButton>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          <div className="reply-panel">
            <button className="reply-prompt" onClick={() => onReply(last, 'reply')}>
              <Reply size={17} />
              <span>
                <strong>Reply to {last.from[0]?.name || last.from[0]?.email || 'sender'}</strong>
              </span>
              <ShortcutHint id="reply" />
            </button>
            <div className="reply-bar">
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
        </div>
      </div>
      {link && (
        <div className="link-status" aria-hidden="true">
          {link}
        </div>
      )}
    </div>
  )
}
