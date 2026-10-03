import { links, version as packagedVersion } from './links'

export type Os = 'mac' | 'windows' | 'linux'
export type BuildId =
  'mac-arm64' | 'mac-x64' | 'windows' | 'appimage' | 'deb' | 'rpm' | 'flatpak' | 'nix' | 'nixos'

export interface Build {
  id: BuildId
  os: Os
  label: string
  detail: string
  /** The asset's name for a version, following the release workflow. Absent for builds without a file. */
  file?: (version: string) => string
}

export const osNames: Record<Os, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }

export const builds: Build[] = [
  {
    id: 'mac-arm64',
    os: 'mac',
    label: 'Apple silicon',
    detail: 'Macs with an M-series chip',
    file: (v) => `Inlark-${v}-arm64.dmg`,
  },
  {
    id: 'mac-x64',
    os: 'mac',
    label: 'Intel',
    detail: 'Macs with an Intel processor',
    file: (v) => `Inlark-${v}-x64.dmg`,
  },
  {
    id: 'windows',
    os: 'windows',
    label: 'Installer',
    detail: '64-bit, installs for your account',
    file: (v) => `Inlark-${v}-x64-setup.exe`,
  },
  {
    id: 'appimage',
    os: 'linux',
    label: 'AppImage',
    detail: 'Runs on most distributions',
    file: (v) => `Inlark-${v}-x86_64.AppImage`,
  },
  {
    id: 'deb',
    os: 'linux',
    label: 'Debian · Ubuntu',
    detail: '.deb package',
    file: (v) => `Inlark-${v}-amd64.deb`,
  },
  {
    id: 'rpm',
    os: 'linux',
    label: 'Fedora',
    detail: '.rpm package',
    file: (v) => `Inlark-${v}-x86_64.rpm`,
  },
  {
    id: 'flatpak',
    os: 'linux',
    label: 'Flatpak',
    detail: 'Sandboxed package, 64-bit Intel or AMD',
    file: (v) => `Inlark-${v}-x64.flatpak`,
  },
  { id: 'nix', os: 'linux', label: 'Nix', detail: 'Any Linux with Nix, x86-64 or ARM' },
  { id: 'nixos', os: 'linux', label: 'NixOS', detail: 'Flake module' },
]

export const buildById = (id: BuildId) => builds.find((b) => b.id === id)!

export interface ReleaseAsset {
  name: string
  size: number
  url: string
  digest: string | null
}

export interface Release {
  version: string
  /** The release page, or the releases overview when GitHub hasn't been reached. */
  url: string
  publishedAt: string | null
  /** Empty until GitHub has confirmed what the release contains. */
  assets: ReleaseAsset[]
}

/** Used when GitHub can't be reached: the packaged version, without any confirmed files. */
export const unconfirmedRelease: Release = {
  version: packagedVersion,
  url: links.releases,
  publishedAt: null,
  assets: [],
}

export interface Download {
  build: Build
  file: string | null
  /** A direct download when the release confirmed the file, otherwise the release page. */
  url: string
  size: number | null
  digest: string | null
  confirmed: boolean
}

export function downloadFor(release: Release, build: Build): Download {
  const file = build.file?.(release.version) ?? null
  const asset = file ? release.assets.find((a) => a.name === file) : undefined
  return {
    build,
    file,
    url: asset?.url ?? release.url,
    size: asset?.size ?? null,
    digest: asset?.digest ?? null,
    confirmed: Boolean(asset),
  }
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  published_at: string | null
  assets: { name: string; size: number; browser_download_url: string; digest?: string | null }[]
}

/** The latest published release, or null when there is none yet. Throws when GitHub can't be reached. */
export async function fetchLatestRelease(token?: string): Promise<Release | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'inlark-marketing',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${links.repoPath}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(6000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub responded with ${response.status}`)
  const data = (await response.json()) as GitHubRelease
  return {
    version: data.tag_name.replace(/^v/, ''),
    url: data.html_url,
    publishedAt: data.published_at,
    assets: data.assets.map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      digest: a.digest?.startsWith('sha256:') ? a.digest.slice(7) : null,
    })),
  }
}
