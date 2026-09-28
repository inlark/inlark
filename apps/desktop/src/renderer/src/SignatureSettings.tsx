import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check } from '@inlark/ui/icons'
import { Spinner } from '@inlark/ui'
import { identityKey, type Account, type Settings as Preferences } from '@inlark/core'
import { api } from './api'
import { AccountMark } from './AccountMark'

type Signatures = Preferences['signatures']

const same = (a: Signatures, b: Signatures) =>
  Object.keys({ ...a, ...b }).every((key) => (a[key] ?? '') === (b[key] ?? ''))

/** Every account's signatures on one page, saved automatically as they're typed. */
export function SignatureSettings({
  accounts,
  signatures,
  onSave,
}: {
  accounts: Account[]
  signatures: Signatures
  onSave: (signatures: Signatures) => Promise<boolean>
}) {
  const identities = useQueries({
    queries: accounts.map((account) => ({
      queryKey: ['identities', account.id],
      queryFn: () => api.identities(account.id),
      enabled: account.status === 'connected',
    })),
  })
  const [values, setValues] = useState(signatures)
  const [savedKey, setSavedKey] = useState<string>()
  const latest = useRef(values)
  const saved = useRef(signatures)
  const edited = useRef<string>(undefined)
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

  return (
    <div className="signature-accounts">
      {accounts.map((account, index) => {
        const query = identities[index]
        return (
          <section className="signature-account" key={account.id}>
            <header>
              <AccountMark account={account} size={20} />
              <strong>{account.name}</strong>
              <span>{account.email}</span>
            </header>
            {account.status !== 'connected' ? (
              <p className="signature-note">Reconnect this account to edit its signatures.</p>
            ) : query.isPending ? (
              <p className="signature-note">
                <Spinner size={12} /> Loading addresses…
              </p>
            ) : query.isError ? (
              <p className="signature-note">Couldn’t load this account’s addresses.</p>
            ) : (
              query.data.map((identity) => {
                const key = identityKey(account.id, identity.id)
                const id = 'signature-' + key
                return (
                  <div className="signature-identity" key={key}>
                    {/* The address only needs naming when it isn't obvious from the header. */}
                    {(query.data.length > 1 || identity.email !== account.email) && (
                      <label htmlFor={id}>
                        {identity.name ? identity.name + ' · ' : ''}
                        {identity.email}
                      </label>
                    )}
                    <textarea
                      id={id}
                      rows={3}
                      aria-label={query.data.length > 1 ? undefined : account.name + ' signature'}
                      value={values[key] ?? identity.textSignature ?? ''}
                      placeholder="No signature"
                      onChange={(e) => {
                        edited.current = key
                        setValues((current) => ({ ...current, [key]: e.target.value }))
                      }}
                      onBlur={() => void save(latest.current)}
                    />
                    <span
                      className={'signature-saved' + (savedKey === key ? ' visible' : '')}
                      aria-live="polite"
                    >
                      {savedKey === key && (
                        <>
                          <Check size={11} /> Saved
                        </>
                      )}
                    </span>
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
