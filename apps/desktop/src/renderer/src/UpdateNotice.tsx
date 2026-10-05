import { ArrowUpRight, Download, RefreshCw } from '@inlark/ui/icons'
import type { UpdateStatus } from '@inlark/core'
import { api } from './api'

export function UpdateNotice({ status }: { status: UpdateStatus }) {
  if (status.phase === 'idle') return null
  const manual = status.phase === 'manual'
  return (
    <section
      className={
        'update-notice flex items-center gap-3 py-3 px-5.5 border-b border-solid border-b-border shrink-0' +
        (manual
          ? ' update-notice-manual bg-[color-mix(in_srgb,_var(--raised)_75%,_var(--bg))]'
          : ' bg-[color-mix(in_srgb,_var(--accent)_7%,_var(--bg))]')
      }
    >
      <span
        className="update-notice-icon w-7.5 h-7.5 rounded-lg grid place-items-center text-primary bg-primary-tint shrink-0"
        aria-hidden="true"
      >
        {manual ? <Download size={17} /> : <RefreshCw size={17} />}
      </span>
      <div className="update-notice-copy min-w-0 flex-1 flex flex-col gap-[2px] text-[12px] leading-[1.4]">
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
            className="update-notice-progress mt-1.75 w-[min(280px,_100%)] h-[3px] rounded-xs bg-border-strong overflow-hidden"
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
