import { useEffect, useState } from 'react'
import { Select, Switch } from '@inlark/ui'
import { friendlyError, type StartupPreferences, type StartupStatus } from '@inlark/core'
import { api } from './api'

export function StartupSettings({
  notify,
}: {
  notify: (message: string, tone?: 'error' | 'info') => void
}) {
  const [status, setStatus] = useState<StartupStatus>()
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () => {
      void api
        .startupStatus()
        .then((next) => {
          if (active) {
            setStatus(next)
            setLoadError(false)
          }
        })
        .catch(() => {
          if (active) setLoadError(true)
        })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const change = async (preferences: StartupPreferences) => {
    setSaving(true)
    try {
      setStatus(await api.setStartup(preferences))
    } catch (error) {
      notify(friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }
  const row =
    'setting-row flex items-center justify-between my-3.5 gap-6 [&_strong]:font-normal [&_strong]:text-[13px] [&_p]:text-muted [&_p]:my-[3px] [&_p]:text-[12px] [&_p]:leading-[1.6] max-[700px]:gap-3.5'
  return (
    <>
      <div className={row}>
        <div>
          <strong>Launch on system startup</strong>
          <p>
            {loadError
              ? 'Could not check startup settings. Reopen Settings to try again.'
              : status && !status.supported
                ? 'Available in the installed desktop app.'
                : 'Open inlark automatically when you sign in to your computer.'}
          </p>
          {status?.requiresApproval && (
            <p role="status">Allow inlark in System Settings → General → Login Items.</p>
          )}
          {status?.error && <p role="status">{status.error}</p>}
        </div>
        <Switch
          aria-label="Launch on system startup"
          checked={status?.enabled ?? false}
          disabled={!status?.supported || saving}
          onCheckedChange={(enabled) => void change({ enabled })}
        />
      </div>
      <div className={row}>
        <div>
          <strong>Startup behavior</strong>
          <p>Applies to automatic launches. Opening inlark yourself shows the window.</p>
        </div>
        <Select
          aria-label="Startup behavior"
          className="setting-select w-auto min-w-48 shrink-0"
          value={status?.startMinimized === false ? 'window' : 'tray'}
          options={[
            { value: 'tray', label: 'Start in the tray' },
            { value: 'window', label: 'Open window' },
          ]}
          disabled={!status?.supported || saving}
          onValueChange={(value) => void change({ startMinimized: value === 'tray' })}
        />
      </div>
    </>
  )
}
