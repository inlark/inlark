import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder } from '@inlark/ui/icons'
import { Modal } from '@inlark/ui'
import type { Bootstrap, MutationTarget } from '@inlark/core'
import { api } from './api'
import { actionLimit } from './account-limits'

export function MoveDialog({
  targets,
  accounts,
  onClose,
  onMove,
}: {
  targets?: MutationTarget[]
  accounts: Bootstrap['accounts']
  onClose: () => void
  onMove: (id: string) => void
}) {
  const ids = new Set(targets?.map((t) => t.accountId))
  const accountId = targets?.[0]?.accountId || ''
  const limit = actionLimit(
    accounts.find((a) => a.id === accountId),
    'move',
  )
  const boxes = useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: () => api.mailboxes(accountId),
    enabled: !!targets && ids.size === 1,
  })
  return (
    <Modal
      open={!!targets}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Move to folder"
      description={
        ids.size > 1
          ? 'Select conversations within one account to move them to a folder.'
          : accounts.find((a) => a.id === accountId)?.email
      }
    >
      {limit && <p className="modal-body-text">{limit}</p>}
      <div className="folder-picker">
        {ids.size === 1 &&
          !limit &&
          boxes.data
            ?.filter((b) => b.rights.mayAddItems && b.role !== 'drafts' && b.role !== 'sent')
            .map((b) => (
              <button key={b.id} onClick={() => onMove(b.id)}>
                <Folder size={15} />
                {b.name}
                <ChevronRight size={13} />
              </button>
            ))}
      </div>
    </Modal>
  )
}
