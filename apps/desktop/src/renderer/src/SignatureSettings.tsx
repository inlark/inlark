import { cn } from '@inlark/ui'
import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check } from '@inlark/ui/icons'
import { Spinner } from '@inlark/ui'
import {
  identityKey,
  identitySignature,
  type Account,
  type Identity,
  type Settings as Preferences,
} from '@inlark/core'
import { api } from './api'
import { AccountMark } from './AccountMark'
import { SegmentedControl } from './SegmentedControl'
import { SignaturePreview, signatureText } from './signature'

type Signatures = Pick<Preferences, 'signatures' | 'htmlSignatures'>
type Format = 'text' | 'html'

const formats = [
  { value: 'text', label: 'Text' },
  { value: 'html', label: 'HTML' },
] as const

const same = (a: Signatures, b: Signatures) =>
  Object.keys({ ...a.signatures, ...b.signatures, ...a.htmlSignatures, ...b.htmlSignatures }).every(
    (key) =>
      (a.signatures[key] ?? '') === (b.signatures[key] ?? '') &&
      !!a.htmlSignatures?.[key] === !!b.htmlSignatures?.[key],
  )

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A first draft of the signature in the other format, when there's nothing better to restore. */
const convert = (value: string, to: Format) =>
  to === 'html'
    ? value.trim()
      ? '<p>' + escapeHtml(value).replace(/\n/g, '<br>\n') + '</p>'
      : ''
    : signatureText(value)

/** Every account's signatures on one page, saved automatically as they're typed. */
export function SignatureSettings({
  accounts,
  signatures,
  remoteImages,
  onSave,
}: {
  accounts: Account[]
  signatures: Signatures
  /** Remote images in an HTML signature can only be previewed when these are allowed. */
  remoteImages: boolean
  onSave: (signatures: Signatures) => Promise<boolean>
}) {
  const identities = useQueries({
    queries: accounts.map((account) => ({
      queryKey: ['identities', account.id],
      queryFn: () => api.identities(account.id),
      enabled: account.status === 'connected',
    })),
  })
  const [values, setValues] = useState<Signatures>(signatures)
  const [savedKey, setSavedKey] = useState<string>()
  const latest = useRef(values)
  const saved = useRef(signatures)
  const edited = useRef<string>(undefined)
  // What each signature said in the format it was switched away from, so switching back
  // restores it rather than a lossy conversion.
  const previous = useRef(new Map<string, Record<Format, string | undefined>>())
  latest.current = values
  const save = async (next: Signatures) => {
    if (same(next, saved.current)) return
    if (await onSave(next)) {
      saved.current = next
      setSavedKey(edited.current)
    }
  }
  // Save shortly after typing stops, and flush anything pending when the page closes.
  useEffect(() => {
    const timer = setTimeout(() => void save(values), 700)
    return () => clearTimeout(timer)
  }, [values])
  useEffect(() => () => void save(latest.current), [])
  useEffect(() => {
    if (!savedKey) return
    const timer = setTimeout(() => setSavedKey(undefined), 1800)
    return () => clearTimeout(timer)
  }, [savedKey])

  const set = (key: string, value: string, format: Format) => {
    edited.current = key
    setValues((current) => {
      const { [key]: _, ...html } = current.htmlSignatures || {}
      return {
        signatures: { ...current.signatures, [key]: value },
        htmlSignatures: format === 'html' ? { ...html, [key]: true } : html,
      }
    })
  }
  const switchFormat = (identity: Identity, format: Format) => {
    const key = identityKey(identity.accountId, identity.id)
    const current = identitySignature(latest.current, identity)
    if (current.format === format) return
    const remembered = previous.current.get(key) || { text: undefined, html: undefined }
    previous.current.set(key, { ...remembered, [current.format]: current.value })
    const restored = remembered[format]
    set(key, restored?.trim() ? restored : convert(current.value, format), format)
  }

  const formatSwitch = (identity: Identity, address?: string) => (
    <SegmentedControl
      className="signature-format ml-auto [&_.segmented-option]:h-6 [&_.segmented-option]:py-0 [&_.segmented-option]:px-2.25 [&_.segmented-option]:text-[11px]"
      label={'Signature format' + (address ? ' for ' + address : '')}
      value={identitySignature(values, identity).format}
      options={formats}
      onChange={(format) => switchFormat(identity, format)}
    />
  )

  return (
    <div className="signature-accounts">
      {accounts.map((account, index) => {
        const query = identities[index]
        // A lone address is already named by the header, which then also holds its format.
        const lone =
          query.data?.length === 1 && query.data[0].email === account.email
            ? query.data[0]
            : undefined
        return (
          <section
            className={cn(
              'signature-account [&>header]:flex [&>header]:items-center [&>header]:gap-2.5 [&>header]:mb-3 [&>header]:min-w-0',
              '[&>header_strong]:text-[13px] [&>header_strong]:font-medium [&>header_strong]:text-strong',
              '[&>header_strong]:whitespace-nowrap [&>header_span]:text-[12px] [&>header_span]:text-muted',
              '[&>header_span]:overflow-hidden [&>header_span]:text-ellipsis [&>header_span]:whitespace-nowrap',
              '[&>header_.signature-format]:shrink-0 py-5 px-0 border-t border-solid border-t-border',
            )}
            key={account.id}
          >
            <header>
              <AccountMark account={account} size={20} />
              <strong>{account.name}</strong>
              <span>{account.email}</span>
              {lone && account.status === 'connected' && formatSwitch(lone)}
            </header>
            {account.status !== 'connected' ? (
              <p className="signature-note flex items-center gap-2 m-0 text-[12px] text-muted">
                Reconnect this account to edit its signatures.
              </p>
            ) : query.isPending ? (
              <p className="signature-note flex items-center gap-2 m-0 text-[12px] text-muted">
                <Spinner size={12} /> Loading addresses…
              </p>
            ) : query.isError ? (
              <p className="signature-note flex items-center gap-2 m-0 text-[12px] text-muted">
                Couldn’t load this account’s addresses.
              </p>
            ) : (
              query.data.map((identity) => {
                const key = identityKey(account.id, identity.id)
                const id = 'signature-' + key
                const signature = identitySignature(values, identity)
                const html = signature.format === 'html'
                const name = identity === lone ? account.name + ' signature' : undefined
                return (
                  <div
                    className={cn(
                      'signature-identity [&+.signature-identity]:mt-4.5 [&_textarea]:block [&_textarea]:min-h-19',
                      '[&_textarea]:text-[12px] [&_textarea]:leading-[1.6] [&_textarea]:resize-y [&_textarea.signature-code]:min-h-30',
                      '[&_textarea.signature-code]:font-mono [&_textarea.signature-code]:text-[11.5px]',
                      '[&_textarea.signature-code]:[tab-size:2] [&_textarea.signature-code]:[overflow-wrap:anywhere]',
                    )}
                    key={key}
                  >
                    {identity !== lone && (
                      <div
                        className={cn(
                          'signature-identity-heading [&_label]:flex-1 [&_label]:min-w-0 [&_label]:m-0 [&_label]:text-secondary',
                          '[&_label]:overflow-hidden [&_label]:text-ellipsis [&_label]:whitespace-nowrap flex items-center gap-3 mb-2',
                        )}
                      >
                        <label htmlFor={id}>
                          {identity.name ? identity.name + ' · ' : ''}
                          {identity.email}
                        </label>
                        {formatSwitch(identity, identity.email)}
                      </div>
                    )}
                    <div className="signature-editor relative">
                      <textarea
                        id={id}
                        rows={html ? 6 : 3}
                        className={cn(html ? 'signature-code' : undefined)}
                        aria-label={name && (html ? name + ' HTML' : name)}
                        value={signature.value}
                        placeholder={html ? 'Paste or write HTML…' : 'No signature'}
                        spellCheck={!html}
                        autoCapitalize={html ? 'off' : undefined}
                        autoCorrect={html ? 'off' : undefined}
                        onChange={(e) => set(key, e.target.value, signature.format)}
                        onBlur={() => void save(latest.current)}
                      />
                      <span
                        className={cn(
                          'signature-saved absolute right-2.5 bottom-2 inline-flex items-center gap-1 text-[11px] text-muted opacity-0',
                          'transition-[opacity] duration-160 ease-[ease] pointer-events-none [&.visible]:opacity-100',
                          savedKey === key && 'visible',
                        )}
                        aria-live="polite"
                      >
                        {savedKey === key && (
                          <>
                            <Check size={11} /> Saved
                          </>
                        )}
                      </span>
                    </div>
                    {html && signature.value.trim() && (
                      <div className="signature-preview [&>span]:block [&>span]:mb-1.5 [&>span]:text-[11px] [&>span]:text-muted [&>div]:max-h-65 [&>div]:overflow-auto [&_.signature-note]:mt-2 mt-2.5">
                        <span>Preview</span>
                        <SignaturePreview html={signature.value} />
                        {!remoteImages &&
                          /<img[^>]+src\s*=\s*["']?https?:/i.test(signature.value) && (
                            <p className="signature-note flex items-center gap-2 m-0 text-[12px] text-muted">
                              Turn on Load remote images in General to preview linked images.
                              Recipients still see them.
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </section>
        )
      })}
    </div>
  )
}
