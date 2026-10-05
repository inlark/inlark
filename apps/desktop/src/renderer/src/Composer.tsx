import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { Dialog } from '@base-ui/react/dialog'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  X,
  Send,
  Paperclip,
  Bold,
  Italic,
  BulletList,
  Link2,
  Trash2,
  Check,
  AlertCircle,
  ArrowUpRight,
  FileText,
} from '@inlark/ui/icons'
import { Modal, Button, IconButton, Select, Spinner } from '@inlark/ui'
import {
  friendlyError,
  type Address,
  type Account,
  type Draft,
  type SendResult,
} from '@inlark/core'
import { api, isDemo } from './api'
import { localSaveDraft, localDeleteDraft } from './cache'
import { RecipientField } from './RecipientField'
import { formatBytes } from './mail-date'
import { bindingText, useShortcutHandlers, useShortcutText, useShortcuts } from './shortcuts'
import { SignatureNode } from './signature'
import { linkTarget } from './link-target'

const validAddress = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
/** The editor's own formatting keys, which follow the platform (⌘ on macOS, Ctrl elsewhere). */
const boldKeys = bindingText(['Mod+B'])
const italicKeys = bindingText(['Mod+I'])

/** Plain wording for a finished send; the Drafts view offers recovery for anything left over. */
function sentMessage(result: SendResult): string {
  const copy = result.sentCopy === 'pending' ? ' Its copy in Sent isn’t saved yet.' : ''
  if (result.status === 'partial') {
    const refused = result.rejected || []
    return (
      (refused.length
        ? 'Sent, but refused by ' +
          (refused.length === 1 ? refused[0].email : refused.length + ' recipients') +
          '.'
        : 'Sent, but some recipients refused it.') +
      copy +
      ' Drafts has the details.'
    )
  }
  return copy ? 'Message sent.' + copy + ' Drafts shows its status.' : result.message
}

/** What went wrong with a draft, in terms of what the user can do next. */
function draftProblem(draft: Draft): { text: string; detail?: string } | undefined {
  if (!draft.error) return undefined
  const detail = draft.error
  switch (draft.errorKind) {
    case 'conflict':
      return {
        text: 'This draft was changed in another app. Keep both to save your version as a separate draft.',
      }
    case 'outgoingAuthentication':
      return { text: 'The outgoing server rejected your login. Nothing was sent.', detail }
    case 'connection':
      return {
        text: 'The server couldn’t be reached. Nothing was sent; your draft is saved.',
        detail,
      }
    case 'rejected':
      return {
        text: 'The server refused this message. Nothing was sent. Check the recipients and attachments, then try again.',
        detail,
      }
    default:
      return { text: detail }
  }
}

export function Composer({
  initial,
  accounts,
  suggestions,
  onClose,
  onOpenAccounts,
  notify,
  onSaved,
}: {
  initial: Draft
  suggestions: Address[]
  accounts: Account[]
  onClose: () => void
  /** Opens Settings → Accounts, e.g. to sign in to the outgoing server again. */
  onOpenAccounts: () => void
  notify: (message: string, tone?: 'error' | 'info') => void
  onSaved: () => void
}) {
  const shortcuts = useShortcuts()
  const keys = useShortcutText()
  const sendShortcut = shortcuts.bindings.send[0]
  const [draft, setDraft] = useState(initial),
    [state, setState] = useState(
      initial.status === 'uncertain'
        ? 'Delivery unconfirmed'
        : initial.status === 'error'
          ? 'Saved locally · sync failed'
          : 'Saved on this device',
    ),
    [sending, setSending] = useState(false),
    [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0),
    [expanded, setExpanded] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [linkValue, setLinkValue] = useState(''),
    [linkError, setLinkError] = useState(''),
    [editingLink, setEditingLink] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false)
  const latest = useRef(draft),
    sync = useRef<Promise<unknown>>(Promise.resolve()),
    alive = useRef(true)
  const account = accounts.find((a) => a.id === draft.accountId)!
  const identities = useQuery({
    queryKey: ['identities', draft.accountId],
    queryFn: () => api.identities(draft.accountId),
  })
  const locked = sending || draft.status === 'uncertain' || draft.status === 'sent'
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  // A failed send is kept apart from the draft, so a later autosave can't clear the explanation.
  const [sendError, setSendError] = useState<Pick<Draft, 'error' | 'errorKind'>>()
  const shown = sendError ? { ...draft, ...sendError } : draft
  const problem = draftProblem(shown)
  const update = (patch: Partial<Draft>) => {
    setSendError(undefined)
    change(patch)
  }
  const change = (patch: Partial<Draft>) =>
    setDraft((current) => {
      if (['uncertain', 'sent'].includes(current.status)) return current
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        status: 'local' as const,
        error: undefined,
        errorKind: undefined,
      }
      latest.current = next
      return next
    })
  const form = useForm({ defaultValues: { subject: initial.subject } })
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false },
      }),
      Placeholder.configure({ placeholder: 'Write your message…' }),
      SignatureNode,
    ],
    content:
      initial.html ||
      '<p>' +
        initial.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>') +
        '</p>',
    editorProps: {
      attributes: {
        class: 'compose-editor min-h-45 outline-none text-[15px] leading-[1.8] text-foreground',
        'aria-label': 'Message body',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => update({ html: editor.getHTML(), text: editor.getText() }),
  })
  const formatting = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') || false,
      italic: editor?.isActive('italic') || false,
      bulletList: editor?.isActive('bulletList') || false,
      link: editor?.isActive('link') || false,
    }),
  })
  useEffect(() => {
    // Locking for a send is not an edit, so it must not reset the draft or its error.
    editor?.setEditable(!locked, false)
  }, [editor, locked])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    latest.current = draft
    if (['uncertain', 'sent', 'sending'].includes(draft.status)) return
    setState('Saving…')
    const localTimer = setTimeout(() => {
      void localSaveDraft(latest.current)
        .then(() => api.saveDraft(latest.current))
        .then(() => {
          if (alive.current)
            setState((current) =>
              current === 'All changes saved' ? current : 'Saved on this device',
            )
          onSaved()
        })
        .catch((e) => {
          if (alive.current) setState('Could not save: ' + friendlyError(e))
        })
    }, 350)
    const serverTimer = setTimeout(() => {
      const captured = latest.current
      if (!captured.identityId || account.status !== 'connected') return
      sync.current = sync.current
        .then(() =>
          api.syncDraft({
            ...captured,
            serverId: latest.current.serverId,
            serverFingerprint: latest.current.serverFingerprint,
          }),
        )
        .then((saved) => {
          const result = saved as Draft
          if (!alive.current) return
          const current = latest.current
          const merged = {
            ...current,
            serverId: result.serverId || current.serverId,
            serverFingerprint: result.serverFingerprint || current.serverFingerprint,
            ...(current.updatedAt === captured.updatedAt
              ? { status: result.status, error: result.error }
              : {}),
          }
          latest.current = merged
          setDraft(merged)
          if (current.updatedAt === captured.updatedAt)
            setState(
              result.status === 'synced'
                ? 'All changes saved'
                : 'Saved locally · server sync failed',
            )
          void localSaveDraft(merged)
        })
        .catch(() => {
          if (alive.current) setState('Saved locally · waiting for connection')
        })
    }, 2200)
    return () => {
      clearTimeout(localTimer)
      clearTimeout(serverTimer)
    }
  }, [draft.updatedAt])
  const close = async () => {
    try {
      await sync.current
      await localSaveDraft(latest.current)
      await api.saveDraft(latest.current)
      onSaved()
      onClose()
    } catch (e) {
      notify('Your draft could not be saved. ' + friendlyError(e), 'error')
    }
  }
  const send = async () => {
    if (sending || account.status !== 'connected') return
    const fields = ['to', 'cc', 'bcc'] as const
    if (!fields.some((field) => latest.current[field].length)) {
      notify('Add a recipient before sending.', 'error')
      document.getElementById('compose-to')?.focus()
      return
    }
    // Point at the address to fix; its chip is already marked in red.
    const field = fields.find((name) => latest.current[name].some((a) => !validAddress(a.email)))
    if (field) {
      const invalid = latest.current[field].find((a) => !validAddress(a.email))!
      notify('“' + (invalid.email || invalid.name) + '” isn’t a valid email address.', 'error')
      if (field === 'to') document.getElementById('compose-to')?.focus()
      else focusRecipient(field)
      return
    }
    if (!latest.current.identityId) {
      notify('Select a sending identity.', 'error')
      return
    }
    setSending(true)
    setSendError(undefined)
    try {
      await sync.current
      await localSaveDraft(latest.current)
      const result =
        latest.current.status === 'uncertain'
          ? await api.reconcile(latest.current.id)
          : await api.send(latest.current)
      if (result.status === 'sent' || result.status === 'partial') {
        notify(sentMessage(result))
        await localDeleteDraft(latest.current.id).catch(() =>
          notify('Message sent. The local draft cache could not be cleaned up.'),
        )
        onSaved()
        onClose()
      } else {
        notify(result.message, 'error')
        const uncertain = { ...latest.current, status: 'uncertain' as const }
        latest.current = uncertain
        setDraft(uncertain)
        await localSaveDraft(uncertain)
        setState('Delivery unconfirmed')
      }
    } catch (error) {
      notify(friendlyError(error), 'error')
      setState('Not sent · draft preserved')
      const saved = await api
        .drafts()
        .then((values) => values.find((d) => d.id === latest.current.id))
        .catch(() => undefined)
      if (saved?.status === 'sent') {
        notify('Delivery confirmed.')
        onSaved()
        onClose()
        return
      }
      if (saved?.status === 'uncertain') setState('Delivery unconfirmed')
      if (saved?.status !== 'uncertain')
        setSendError({
          error: saved?.error || friendlyError(error),
          errorKind: saved?.errorKind,
        })
      if (saved) {
        latest.current = saved
        setDraft(saved)
        await localSaveDraft(saved).catch(() => {})
      }
    } finally {
      setSending(false)
    }
  }
  const attachFiles = async () => {
    try {
      const attachments = await api.stageAttachments()
      // The file picker can outlive the composer or a send. Never change a locked draft.
      if (!alive.current || lockedRef.current) return
      update({ attachments: [...latest.current.attachments, ...attachments] })
    } catch (error) {
      notify(friendlyError(error), 'error')
    }
  }
  const insertLink = () => {
    const href = linkTarget(linkValue)
    if (!href || !editor) {
      setLinkError('Enter a web address such as example.com, or an email address.')
      return
    }
    const chain = editor.chain().focus()
    // With nothing selected, the address itself becomes the link text, so the link is visible.
    if (editor.state.selection.empty && !editor.isActive('link'))
      chain.insertContent({
        type: 'text',
        text: linkValue.trim(),
        marks: [{ type: 'link', attrs: { href } }],
      })
    else chain.extendMarkRange('link').setLink({ href })
    chain.run()
    setLinkOpen(false)
  }
  const focusRecipient = (field: 'cc' | 'bcc') => {
    setShowCc(true)
    requestAnimationFrame(() => document.getElementById('compose-' + field)?.focus())
  }
  const canEdit = !linkOpen && !discardOpen && !locked
  useShortcutHandlers(shortcuts.bindings, {
    // Keep the library's input-aware defaults: modifier shortcuts work while writing,
    // but a custom letter or sequence must not send or discard a draft as someone types.
    send: { run: () => void send(), enabled: !linkOpen && !discardOpen && !sending },
    attachFiles: { run: () => void attachFiles(), enabled: canEdit },
    showCc: { run: () => focusRecipient('cc'), enabled: canEdit },
    showBcc: { run: () => focusRecipient('bcc'), enabled: canEdit },
    expandComposer: {
      run: () => setExpanded((current) => !current),
      enabled: !linkOpen && !discardOpen,
    },
    saveClose: { run: () => void close(), enabled: !linkOpen && !discardOpen && !sending },
    discardDraft: { run: () => setDiscardOpen(true), enabled: canEdit },
  })
  const addressField = (name: 'to' | 'cc' | 'bcc', label: string) => (
    <RecipientField
      id={'compose-' + name}
      label={label}
      defaultValue={initial[name]}
      suggestions={suggestions}
      disabled={locked}
      autoFocus={name === 'to' && !initial.to.length}
      placeholder={name === 'to' ? 'Name or email address' : ''}
      onChange={(addresses) => update({ [name]: addresses })}
    >
      {name === 'to' && !showCc && (
        <button
          type="button"
          className="compose-cc-toggle"
          title={keys('showCc')}
          disabled={locked}
          onClick={(event) => {
            event.stopPropagation()
            focusRecipient('cc')
          }}
        >
          Cc / Bcc
        </button>
      )}
    </RecipientField>
  )
  return (
    <Dialog.Root
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !sending) void close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="compose-backdrop" />
        <Dialog.Popup
          className={'composer ' + (expanded ? 'composer-expanded' : '')}
          initialFocus={() =>
            initial.to.length && initial.subject && !locked
              ? document.querySelector<HTMLElement>('.compose-editor')
              : document.getElementById(initial.to.length ? 'compose-subject' : 'compose-to')
          }
        >
          <Dialog.Title className="sr-only">Compose email</Dialog.Title>
          <div className="compose-heading flex items-center justify-between h-12 py-0 pr-4.25 pl-6 bg-raised border-b border-solid border-b-border shrink-0">
            <span>
              <span className="compose-dot w-1.25 h-1.25 rounded-full inline-block bg-primary mr-1.5" />{' '}
              {initial.replyThreadId
                ? 'Reply'
                : /^fwd:/i.test(initial.subject)
                  ? 'Forward'
                  : 'New message'}
            </span>
            <div>
              <span
                className="draft-state flex items-center gap-1.25 text-muted text-[11px] mr-3"
                role="status"
              >
                {sending || state === 'Saving…' ? (
                  <Spinner size={11} />
                ) : state.startsWith('Sav') || state === 'All changes saved' ? (
                  <Check size={11} />
                ) : (
                  <AlertCircle size={11} />
                )}{' '}
                {sending
                  ? draft.status === 'uncertain'
                    ? 'Checking delivery…'
                    : 'Sending…'
                  : state}
              </span>
              <IconButton
                label={expanded ? 'Restore composer size' : 'Expand composer'}
                shortcut={keys('expandComposer')}
                onClick={() => setExpanded(!expanded)}
              >
                <ArrowUpRight size={14} />
              </IconButton>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Save and close"
                    title={keys('saveClose')}
                    disabled={sending}
                  />
                }
              >
                <X size={15} />
              </Dialog.Close>
            </div>
          </div>
          <div className="compose-addresses">
            <div className="compose-field">
              <label htmlFor="compose-from">From</label>
              <Select
                id="compose-from"
                value={draft.accountId}
                disabled={locked || !!draft.serverId}
                options={accounts.map((a) => ({ value: a.id, label: a.name + ' · ' + a.email }))}
                onValueChange={async (accountId) => {
                  try {
                    const identities = await api.identities(accountId)
                    update({
                      accountId,
                      identityId: identities[0]?.id || '',
                      serverId: undefined,
                      serverFingerprint: undefined,
                    })
                  } catch (error) {
                    notify(friendlyError(error), 'error')
                  }
                }}
              />
            </div>
            {(identities.data?.length || 0) > 1 && (
              <div className="compose-field">
                <label htmlFor="compose-identity">Identity</label>
                <Select
                  disabled={locked}
                  id="compose-identity"
                  value={draft.identityId}
                  options={(identities.data || []).map((i) => ({
                    value: i.id,
                    label: i.name + ' <' + i.email + '>',
                  }))}
                  onValueChange={(identityId) => update({ identityId })}
                />
              </div>
            )}
            {addressField('to', 'To')}
            {showCc && (
              <>
                {addressField('cc', 'Cc')}
                {addressField('bcc', 'Bcc')}
              </>
            )}
            <form.Field name="subject">
              {(field) => (
                <div className="compose-field compose-subject">
                  <label htmlFor="compose-subject">Subject</label>
                  <input
                    disabled={locked}
                    id="compose-subject"
                    value={field.state.value}
                    placeholder="Subject"
                    onChange={(e) => {
                      field.handleChange(e.target.value)
                      update({ subject: e.target.value })
                    }}
                  />
                </div>
              )}
            </form.Field>
          </div>
          <div className="compose-body flex-1 overflow-auto py-5 px-6 min-h-0">
            <EditorContent editor={editor} />
            {draft.attachments.length > 0 && (
              <div className="compose-attachments flex gap-1.75 flex-wrap mt-3.75">
                {draft.attachments.map((a) => (
                  <div
                    className="compose-attachment flex gap-1.75 items-center py-1.75 px-2.25 border border-solid border-border-strong rounded-md text-[11px]"
                    key={a.id}
                  >
                    <FileText size={14} />
                    <span>{a.name}</span>
                    <small>{formatBytes(a.size)}</small>
                    <button
                      disabled={locked}
                      aria-label={'Remove ' + a.name}
                      onClick={() =>
                        update({
                          attachments: latest.current.attachments.filter(
                            (item) => item.id !== a.id,
                          ),
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {problem && draft.status !== 'uncertain' && (
            <div
              className="compose-warning flex items-center gap-2 py-2.5 px-5.5 text-[11px] text-danger bg-danger/8"
              role="status"
            >
              <AlertCircle size={15} />
              <span>
                {problem.text}
                {problem.detail && problem.detail !== problem.text && (
                  <small className="compose-warning-detail block mt-[2px] text-muted">
                    {problem.detail}
                  </small>
                )}
              </span>
              {(shown.errorKind === 'conflict' || shown.error?.includes('another client')) && (
                <Button
                  size="small"
                  onClick={() => update({ serverId: undefined, serverFingerprint: undefined })}
                >
                  Keep both versions
                </Button>
              )}
              {shown.errorKind === 'outgoingAuthentication' && (
                <Button
                  size="small"
                  onClick={async () => {
                    await close()
                    onOpenAccounts()
                  }}
                >
                  Account settings
                </Button>
              )}
            </div>
          )}
          {draft.status === 'uncertain' && (
            <div className="compose-warning flex items-center gap-2 py-2.5 px-5.5 text-[11px] text-danger bg-danger/8">
              <AlertCircle size={15} />
              The server may have accepted this message. Check delivery to avoid sending it twice.
            </div>
          )}
          <fieldset className="compose-format" disabled={locked}>
            <IconButton
              label="Bold"
              shortcut={boldKeys}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={formatting?.bold ? 'active-format' : ''}
              aria-pressed={formatting?.bold || false}
            >
              <Bold size={14} />
            </IconButton>
            <IconButton
              label="Italic"
              className={formatting?.italic ? 'active-format' : ''}
              aria-pressed={formatting?.italic || false}
              shortcut={italicKeys}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <Italic size={14} />
            </IconButton>
            <IconButton
              label="Bulleted list"
              className={formatting?.bulletList ? 'active-format' : ''}
              aria-pressed={formatting?.bulletList || false}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              <BulletList size={15} />
            </IconButton>
            <IconButton
              label={formatting?.link ? 'Edit link' : 'Add link'}
              className={formatting?.link ? 'active-format' : ''}
              aria-pressed={formatting?.link || false}
              onClick={() => {
                const href: string = editor?.getAttributes('link').href || ''
                setEditingLink(!!href)
                setLinkValue(href.replace(/^mailto:/i, ''))
                setLinkError('')
                setLinkOpen(true)
              }}
            >
              <Link2 size={15} />
            </IconButton>
            <span className="toolbar-divider" />
            <IconButton
              label="Attach files"
              shortcut={keys('attachFiles')}
              onClick={() => void attachFiles()}
            >
              <Paperclip size={15} />
            </IconButton>
          </fieldset>
          <div className="compose-footer flex items-center gap-2.5 py-3.25 px-5 border-t border-solid border-t-border">
            <Button
              variant="primary"
              onClick={() => void send()}
              disabled={sending || account.status !== 'connected'}
            >
              {sending ? <Spinner size={14} /> : <Send size={13} />}{' '}
              {sending
                ? draft.status === 'uncertain'
                  ? 'Checking delivery…'
                  : 'Sending…'
                : draft.status === 'uncertain'
                  ? 'Check delivery'
                  : isDemo
                    ? 'Simulate send'
                    : 'Send message'}
              {sendShortcut && (
                <span className="send-shortcut text-[11px] opacity-60 ml-2.5">
                  {bindingText(sendShortcut)}
                </span>
              )}
            </Button>
            <span className="compose-account">{account.email}</span>
            <IconButton
              label="Discard draft"
              shortcut={keys('discardDraft')}
              onClick={() => setDiscardOpen(true)}
              disabled={locked}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
      <Modal
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this draft?"
        description="This deletes the saved draft and its attachments."
      >
        <div className="modal-actions">
          <Button onClick={() => setDiscardOpen(false)}>Keep writing</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await sync.current
                await api.deleteDraft(draft.id)
                await localDeleteDraft(draft.id)
                onSaved()
                onClose()
              } catch (e) {
                notify(friendlyError(e), 'error')
              }
            }}
          >
            Discard draft
          </Button>
        </div>
      </Modal>
      <Modal
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={editingLink ? 'Edit link' : 'Add a link'}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            insertLink()
          }}
        >
          <label className="modal-field">
            Web or email address
            <input
              autoFocus
              value={linkValue}
              placeholder="example.com"
              spellCheck={false}
              aria-invalid={!!linkError || undefined}
              aria-describedby={linkError ? 'compose-link-error' : undefined}
              onChange={(e) => {
                setLinkValue(e.target.value)
                setLinkError('')
              }}
            />
          </label>
          {linkError && (
            <span
              className="field-error block mt-1.25 text-[11px] text-danger"
              id="compose-link-error"
              role="alert"
            >
              {linkError}
            </span>
          )}
          <div className="modal-actions">
            {editingLink && (
              <Button
                variant="ghost"
                className="modal-action-start"
                onClick={() => {
                  editor?.chain().focus().extendMarkRange('link').unsetLink().run()
                  setLinkOpen(false)
                }}
              >
                Remove link
              </Button>
            )}
            <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit">
              {editingLink ? 'Update link' : 'Insert link'}
            </Button>
          </div>
        </form>
      </Modal>
    </Dialog.Root>
  )
}
