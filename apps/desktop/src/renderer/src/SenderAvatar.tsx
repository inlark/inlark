import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@inlark/ui'
import { api } from './api'

export function SenderAvatar({
  name,
  email,
  color,
  size,
  remoteImages,
}: {
  name: string
  email?: string
  color?: string
  size: number
  remoteImages: boolean
}) {
  const address = email?.trim().toLowerCase() || ''
  const { data } = useQuery({
    queryKey: ['sender-avatar', address],
    queryFn: () => api.senderAvatar(address),
    enabled: !!address && remoteImages,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  })
  return <Avatar name={name} color={color} size={size} image={remoteImages ? data : null} />
}
