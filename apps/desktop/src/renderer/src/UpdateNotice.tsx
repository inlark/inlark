import { ArrowUpRight, Download, RefreshCw } from '@inlark/ui/icons'
import type { UpdateStatus } from '@inlark/core'
import { api } from './api'

export function UpdateNotice({ status }: { status: UpdateStatus }) {
  if (status.phase === 'idle') return null
  const manual = status.phase === 'manual'
  return (
    <section className={'update-notice' + (manual ? ' update-notice-manual' : '')}>
      <span className="update-notice-icon" aria-hidden="true">
        {manual ? <Download size={17} /> : <RefreshCw size={17} />}
      </span>
      <div className="update-notice-copy">
        <strong>
          {manual
            ? `Inlark ${status.version} is available`
            : status.phase === 'ready'
              ? `Inlark ${status.version} is ready`
              : `Downloading Inlark ${status.version}`}
        </strong>
        <span>
          {manual
            ? 'The automatic update could not finish. You can download the new version.'
            : status.phase === 'ready'
              ? 'The update will install when you quit Inlark. Open it again to use the new version.'
              : 'The update will install after you quit Inlark. You can keep working.'}
        </span>
        {status.phase === 'downloading' && (
          <div
            className="update-notice-progress"
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.percent}
          >
            <span style={{ width: status.percent + '%' }} />
          </div>
        )}
      </div>
      {manual && (
        <button
          type="button"
          className="update-notice-action"
          onClick={() => void api.openExternal('https://inlark.com/download').catch(() => {})}
        >
          Download update <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  )
}
