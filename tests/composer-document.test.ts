import { describe, expect, it, vi } from 'vitest'
import { Editor, type Command, type JSONContent } from '../apps/desktop/node_modules/@tiptap/react'
import StarterKit from '../apps/desktop/node_modules/@tiptap/starter-kit'
import type { Draft, Signature } from '../packages/core/src'
import {
  SignatureParagraph,
  hasDraftContent,
  replaceSignature,
  signatureContent,
} from '../apps/desktop/src/renderer/src/composer-document'
import { SignatureNode } from '../apps/desktop/src/renderer/src/signature'

vi.mock('../apps/desktop/src/renderer/src/api', () => ({ api: {} }))

const plain: Signature = { format: 'text', value: 'Personal\npersonal@example.com' }
const rich: Signature = { format: 'html', value: '<table><tr><td>Studio</td></tr></table>' }
const empty: Signature = { format: 'text', value: '' }
const paragraph = (text = ''): JSONContent => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})
const document = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const draft: Draft = {
  id: 'draft',
  accountId: 'personal',
  identityId: 'identity',
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  html: '',
  text: plain.value,
  attachments: [],
  updatedAt: '2026-10-07T10:00:00Z',
  status: 'local',
}

/** Run the actual replacement transaction against the editor's schema without mounting a view. */
function replace(content: JSONContent, signature: Signature): JSONContent {
  const editor = new Editor({
    element: null,
    extensions: [StarterKit, SignatureNode, SignatureParagraph],
    content,
  })
  try {
    const tr = editor.state.tr
    replaceSignature(signature)({ tr, dispatch: () => {} } as Parameters<Command>[0])
    return tr.doc.toJSON()
  } finally {
    editor.destroy()
  }
}

describe('composer signature switching', () => {
  it('replaces plain with HTML without changing written text, formatting, or quoted signatures', () => {
    const body: JSONContent = {
      type: 'paragraph',
      attrs: { signature: false },
      content: [{ type: 'text', text: 'Keep my message.', marks: [{ type: 'bold' }] }],
    }
    const quote: JSONContent = {
      type: 'blockquote',
      content: [signatureContent(rich)!],
    }
    const result = replace(document(body, signatureContent(plain)!, quote), rich)
    expect(result.content).toEqual([body, signatureContent(rich), quote])
  })

  it('switches HTML back to editable plain text with its line breaks intact', () => {
    const result = replace(document(paragraph('Body'), signatureContent(rich)!), plain)
    expect(result.content?.[1]).toEqual(signatureContent(plain))
    expect(result.content?.[0].content).toEqual(paragraph('Body').content)
  })

  it('adds a signature for an account that previously had none, without duplicating it on later switches', () => {
    const added = replace(document(paragraph()), plain)
    const switched = replace(added, rich)
    expect(switched.content).toHaveLength(2)
    expect(switched.content?.[1]).toEqual(signatureContent(rich))
  })

  it('removes the previous signature when the selected identity has no signature', () => {
    const result = replace(document(paragraph('Body'), signatureContent(plain)!), empty)
    expect(result.content).toHaveLength(1)
    expect(result.content?.[0].content).toEqual(paragraph('Body').content)
  })
})

describe('empty composer drafts', () => {
  it('does not save empty paragraphs, whitespace, or automatic plain and HTML signatures', () => {
    expect(hasDraftContent(draft, document(paragraph()))).toBe(false)
    expect(hasDraftContent(draft, document(paragraph(' \n ')))).toBe(false)
    expect(hasDraftContent(draft, document(paragraph(), signatureContent(plain)!), plain)).toBe(
      false,
    )
    expect(hasDraftContent(draft, document(paragraph(), signatureContent(rich)!), rich)).toBe(false)
  })

  it('saves written body text, quoted mail, and edits to an automatic plain signature', () => {
    expect(
      hasDraftContent(draft, document(paragraph('Hello'), signatureContent(plain)!), plain),
    ).toBe(true)
    expect(
      hasDraftContent(draft, document({ type: 'blockquote', content: [paragraph('Quote')] })),
    ).toBe(true)
    expect(
      hasDraftContent(
        draft,
        document(signatureContent({ ...plain, value: 'Edited signature' })!),
        plain,
      ),
    ).toBe(true)
  })

  it.each<Partial<Draft>>([
    { to: [{ email: 'to@example.com' }] },
    { cc: [{ email: 'cc@example.com' }] },
    { bcc: [{ email: 'bcc@example.com' }] },
    { subject: 'Subject' },
    { attachments: [{ id: 'file', name: 'file.txt', type: 'text/plain', size: 10 }] },
    { inReplyTo: ['message@example.com'] },
  ])('preserves a draft with populated message fields: %j', (fields) => {
    expect(hasDraftContent({ ...draft, ...fields }, document(paragraph()))).toBe(true)
  })
})
