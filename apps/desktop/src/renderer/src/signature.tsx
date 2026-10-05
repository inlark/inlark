import { cn } from '@inlark/ui'
import { useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { X } from '@inlark/ui/icons'
import { api } from './api'
import { emailSanitizeOptions } from './email-html'
import { htmlText } from './message-text'

/** Marks an HTML signature in a draft, so it reopens as one block instead of loose markup. */
const marker = 'data-inlark-signature'

/** Remembers the latest result: the composer serializes its signature on every keystroke. */
const lastResult = (compute: (html: string) => string) => {
  let input: string | undefined
  let output = ''
  return (html: string) => {
    if (html !== input) [input, output] = [html, compute(html)]
    return output
  }
}

export const sanitizeSignature = lastResult(
  (html) => DOMPurify.sanitize(html, emailSanitizeOptions) as string,
)

/**
 * The plain-text alternative of an HTML signature. Whitespace in the code isn't layout, and
 * table cells, usually separate blocks of contact details, each end a line.
 */
export const signatureText = lastResult((html) =>
  htmlText(
    sanitizeSignature(html)
      .replace(/\s+/g, ' ')
      .replace(/<\/t[dh]>/gi, '$&<br>'),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n'),
)

/** An HTML signature as the composer's starting markup. */
export const signatureBlock = (html: string) =>
  '<div ' + marker + '="">' + sanitizeSignature(html) + '</div>'

const fontStack = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
/**
 * Shows signature HTML inside `host`, isolated in a shadow root so neither its markup nor the
 * app's styles leak across. Signatures are designed for the white most recipients read on, so
 * they're always shown on paper, in their own colours. Remote images load through the same privacy rules as mail; the
 * stored markup keeps their original addresses. Returns a function that stops pending loads.
 */
export function showSignature(host: HTMLElement, html: string): () => void {
  let active = true
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const template = document.createElement('template')
  template.innerHTML = sanitizeSignature(html)
  const style = document.createElement('style')
  // The paper is an element of its own: the app's reset outranks `:host` box styles.
  style.textContent =
    ':host{display:block;contain:layout paint}.paper{overflow:hidden;font:13px/1.6 ' +
    fontStack +
    ';overflow-wrap:anywhere;background:#fff;color:#24262b;border-radius:6px;padding:14px 16px}' +
    'p{margin:0 0 8px}p:last-child{margin:0}img{max-width:100%}a{color:#5a4fb0}'
  const images = [...template.content.querySelectorAll('img')].map((image) => {
    const source = image.getAttribute('src') || ''
    image.setAttribute('referrerpolicy', 'no-referrer')
    if (!source.startsWith('data:')) image.removeAttribute('src')
    return { image, source }
  })
  const paper = document.createElement('div')
  paper.className = 'paper'
  paper.append(template.content)
  root.replaceChildren(style, paper)
  for (const { image, source } of images) {
    if (source.startsWith('data:')) continue
    const fallback = () => {
      if (active) image.replaceWith(document.createTextNode(image.alt || ''))
    }
    if (!/^https?:/i.test(source)) fallback()
    else
      void api
        .remoteImage(source)
        .then((data) => {
          if (!active) return
          if (data) image.src = data
          else fallback()
        })
        .catch(fallback)
  }
  return () => {
    active = false
  }
}

/** A read-only rendering of signature HTML, as recipients will see it. */
export function SignaturePreview({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => showSignature(host.current!, html), [html])
  return (
    <div
      ref={host}
      // A preview is only something to look at; following its links would leave the app.
      onClickCapture={(event) => event.preventDefault()}
    />
  )
}

function SignatureView({ node, selected, deleteNode }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      className={cn(
        'compose-signature relative mt-1 mb-4 mx-0 rounded-[7px] [outline:1px_solid_transparent] outline-offset-[4px]',
        'transition-[outline-color] duration-120 ease-[ease] hover:outline-[var(--border)] [&.selected]:outline-2',
        '[&.selected]:outline-solid [&.selected]:outline-primary [&:hover_.compose-signature-remove]:opacity-100',
        '[&.selected_.compose-signature-remove]:opacity-100',
        selected && 'selected',
      )}
      contentEditable={false}
    >
      <SignaturePreview html={node.attrs.html} />
      <button
        type="button"
        className={cn(
          'compose-signature-remove absolute top-[-2px] right-[-2px] grid place-items-center w-5.5 h-5.5 border',
          'border-solid border-border-strong rounded-md bg-raised text-muted opacity-0 transition-[opacity] duration-120',
          'ease-[ease] focus-visible:opacity-100 hover:text-foreground',
        )}
        aria-label="Remove signature"
        title="Remove signature"
        onClick={deleteNode}
      >
        <X size={12} />
      </button>
    </NodeViewWrapper>
  )
}

/**
 * An HTML signature in the composer. The basic editor would flatten its tables and styling,
 * so it stays one block that's sent exactly as written and can only be removed as a whole.
 */
export const SignatureNode = Node.create({
  name: 'signature',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      html: {
        default: '',
        parseHTML: (element) => element.innerHTML,
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[' + marker + ']' }]
  },
  renderHTML({ node }) {
    // An inert document, so serializing a draft never starts loading its images.
    const element = document.implementation.createHTMLDocument('').createElement('div')
    element.setAttribute(marker, '')
    element.innerHTML = sanitizeSignature(node.attrs.html)
    return element
  },
  renderText: ({ node }) => signatureText(node.attrs.html),
  addNodeView() {
    return ReactNodeViewRenderer(SignatureView)
  },
})
