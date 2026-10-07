import type { BuildId, Os } from '../data/release'

export interface Platform {
  os: Os | 'chromeos' | 'unknown'
  arm: boolean
  /** Whether the processor could be told apart. On a Mac it decides between two builds. */
  archKnown: boolean
}

interface UserAgentData {
  platform: string
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
}

/** Phones and tablets, matching the check the page runs before it first paints. */
export const isMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

export async function detectPlatform(): Promise<Platform> {
  const ua = navigator.userAgent
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  const name = data?.platform || navigator.platform || ''

  const os: Platform['os'] = /CrOS|Chrome OS/.test(ua + name)
    ? 'chromeos'
    : /Win/.test(name) || /Windows/.test(ua)
      ? 'windows'
      : /Mac/.test(name) || /Macintosh/.test(ua)
        ? 'mac'
        : /Linux|X11/.test(name + ua)
          ? 'linux'
          : 'unknown'

  // Chromium reports the processor on request. Other browsers only hint at it.
  const reported = await data
    ?.getHighEntropyValues(['architecture'])
    .then((values) => values.architecture)
    .catch(() => undefined)
  if (reported) return { os, arm: reported === 'arm', archKnown: true }

  if (os === 'mac') {
    const gpu = macGpu()
    // Safari and Firefox always claim an Intel Mac, but only Apple's own GPUs decode ASTC textures.
    // Almost every Mac in use has Apple silicon, so that's the guess when the GPU says nothing.
    return { os, arm: gpu !== 'intel', archKnown: gpu !== null }
  }
  return { os, arm: /aarch64|arm64|armv\d/i.test(ua), archKnown: true }
}

function macGpu(): 'apple' | 'intel' | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    if (/Apple M\d/.test(renderer)) return 'apple'
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return 'intel'
    return gl.getSupportedExtensions()?.includes('WEBGL_compressed_texture_astc') ? 'apple' : null
  } catch {
    return null
  }
}

export interface Recommendation {
  build: BuildId
  /** Start the download right away. Off where the right file is a guess. */
  auto: boolean
  note?: string
}

export function recommend(platform: Platform): Recommendation | null {
  const ua = navigator.userAgent
  switch (platform.os) {
    case 'mac':
      return { build: platform.arm ? 'mac-arm64' : 'mac-x64', auto: true }
    case 'windows':
      return {
        build: 'windows',
        auto: true,
        note: platform.arm ? 'Runs on Windows on Arm through emulation.' : undefined,
      }
    case 'linux':
      if (platform.arm)
        return {
          build: 'nix',
          auto: false,
          note: 'There are no ARM packages yet, but Nix builds inlark for your processor.',
        }
      if (/Ubuntu|Debian|Mint|Pop!_OS|elementary/i.test(ua)) return { build: 'deb', auto: true }
      if (/Fedora|Red Hat|CentOS|Rocky|Alma/i.test(ua)) return { build: 'rpm', auto: true }
      return { build: 'appimage', auto: true }
    case 'chromeos':
      return {
        build: 'deb',
        auto: false,
        note: 'On a Chromebook, turn on the Linux development environment in Settings first.',
      }
    default:
      return null
  }
}
