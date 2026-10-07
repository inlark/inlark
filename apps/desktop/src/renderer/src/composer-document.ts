import { Extension, type Command, type JSONContent } from '@tiptap/react'
import type { Draft, Signature } from '@inlark/core'

export const textSignatureMarker = 'data-inlark-signature-text'

/** Plain signatures stay editable, but can be distinguished from the user's message. */
export const SignatureParagraph = Extension.create({
  name: 'signatureParagraph',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          signature: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute(textSignatureMarker),
            renderHTML: (attributes) => (attributes.signature ? { [textSignatureMarker]: '' } : {}),
          },
        },
      },
    ]
  },
})

export function signatureContent(signature: Signature): JSONContent | undefined {
  if (!signature.value.trim()) return undefined
  if (signature.format === 'html') return { type: 'signature', attrs: { html: signature.value } }
  const content: JSONContent[] = [{ type: 'hardBreak' }]
  signature.value.split('\n').forEach((text, index) => {
    if (index) content.push({ type: 'hardBreak' })
    if (text) content.push({ type: 'text', text })
  })
  return { type: 'paragraph', attrs: { signature: true }, content }
}

/** Replace only the marked signature, retaining the rest of the document and its formatting. */
export const replaceSignature =
  (signature: Signature): Command =>
  ({ tr, dispatch }) => {
    const content = signatureContent(signature)
    let from = tr.doc.content.size
    let to = from
    let found = false
    tr.doc.forEach((node, position) => {
      if (
        !found &&
        (node.type.name === 'signature' || (node.type.name === 'paragraph' && node.attrs.signature))
      ) {
        from = position
        to = position + node.nodeSize
        found = true
      }
    })
    if (dispatch) {
      if (content) tr.replaceWith(from, to, tr.doc.type.schema.nodeFromJSON(content))
      else if (found) tr.delete(from, to)
    }
    return true
  }

/** A sender choice or its automatic signature alone doesn't make a message worth saving. */
export function hasDraftContent(
  draft: Draft,
  document: JSONContent,
  signature?: Signature,
): boolean {
  if (draft.to.length || draft.cc.length || draft.bcc.length || draft.subject.trim()) return true
  if (draft.attachments.length || draft.inReplyTo?.length) return true
  const text = (node: JSONContent): string =>
    node.type === 'hardBreak' ? '\n' : node.text || (node.content || []).map(text).join('')
  const meaningful = (node: JSONContent): boolean => {
    if (node.type === 'signature') return false
    if (node.type === 'paragraph' && node.attrs?.signature) {
      // Editing an otherwise automatic plain signature is still work that must be saved.
      return !!signature && text(node).trim() !== signature.value.trim()
    }
    return !!node.text?.trim() || (node.content || []).some(meaningful)
  }
  return meaningful(document)
}
