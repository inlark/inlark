// Adapted from AuthFill's apps/extension/src/utils/detection.ts (GPL-3.0).
// https://github.com/authfill/authfill/blob/7462d616bc781f07945d5ea87345c316ef2583fa/apps/extension/src/utils/detection.ts
// Modified for inlark on 2026-10-24: bounded input, German context, stricter
// confidence/ambiguity rules, grouped-code normalization and robust URL handling.
// Modified for inlark on 2026-11-16: excerpts cut off at the end, and link action labels.
// See resources/authfill-GPL-3.0.txt and resources/THIRD_PARTY_NOTICES.md.
import { convert } from 'html-to-text'
import type { AuthDetector, AuthLinkAction } from '@inlark/core'

export interface AuthCandidate {
  type: 'link' | 'code'
  value: string
  score: number
  action?: AuthLinkAction
}

// AuthFill's supported formats, longest first so a grouped value stays intact.
const codePatterns = [
  '????',
  '?????',
  '??????',
  '???????',
  '???-???',
  '?-?-?-?',
  '????????',
  '??-??-??',
  '?-?-?-?-?',
  '????-????',
  '?????????',
  '??????????',
  '???-???-???',
  '?-?-?-?-?-?',
  '?????-?????',
  '??????-??????',
  '?-?-?-?-?-?-?',
  '????-????-????',
  '???-???-???-???',
  '???????-???????',
  '?????-?????-?????',
  '????-????-????-????',
  '?????-?????-?????-?????',
].sort((a, b) => b.length - a.length)
const codeSeparator = '[ \\t]{0,3}[-*_ .][ \\t]{0,3}'
const codeBodyRegex = codePatterns
  .map((pattern) =>
    pattern
      .split('-')
      .map((part) => `[A-Za-z0-9]{${part.length}}`)
      .join(codeSeparator),
  )
  .join('|')
const wholeCode = new RegExp(`^(?:${codeBodyRegex})$`)
const codeGroups = new RegExp(`(${codeSeparator})`)
/**
 * Ordinary prose, not a code group: “731904. Thanks” is a code followed by a word. Only a space
 * sets prose apart, so a bare hyphen still groups a code such as “1234-abcd”.
 */
const isProse = (groups: string[], i: number) =>
  /^[A-Za-z]+$/.test(groups[i]) && /[a-z]/.test(groups[i]) && /\s/.test(groups[i === 0 ? 1 : i - 1])

const authKeywords = [
  { regex: /\bverif(?:y|ies|ied|ying|ication)\b/gi, weight: 12 },
  { regex: /\bconfirm(?:s?|ed|ing|ation)\b/gi, weight: 8 },
  { regex: /\bactivat(?:e|es|ed|ing|ion)\b/gi, weight: 8 },
  { regex: /\bauthenticat(?:e|es|ed|ing|ion)\b/gi, weight: 12 },
  { regex: /\bsecurit(?:y|ies)\b/gi, weight: 12 },
  { regex: /\blog[-\s]?in\b|\bsign[-\s]?in\b/gi, weight: 8 },
  { regex: /\botp\b|\b2fa\b|\btwo[-\s]?(?:step|factor)\b/gi, weight: 12 },
  { regex: /\bone[-\s]?time\b|\bpin\b|\bpass[-\s]?code\b/gi, weight: 8 },
  { regex: /\bpassword\b|\bcode\b|\btoken\b/gi, weight: 8 },
  { regex: /\bmagic[-\s_]?link\b/gi, weight: 12 },
  {
    regex: /\b(?:bestätig|bestaetig|verifizier|sicherheits|anmelde|einmal)[a-zäöüß]*\b/gi,
    weight: 12,
  },
  { regex: /\bpasswort\b|\bzurücksetzen\b|\bzuruecksetzen\b/gi, weight: 8 },
]
const contextPhrases = [
  /(?:verify|confirm)\s+your\s+(?:email|account)/i,
  /(?:click|tap)\s+(?:here\s+)?to\s+(?:verify|confirm|sign\s*in|log\s*in)/i,
  /activate\s+your\s+account|email\s+verification|complete\s+your\s+registration/i,
  /reset\s+(?:your\s+)?password|password\s+reset|forgot\s+your\s+password/i,
  /your\s+(?:\w+\s+){0,2}code\s+is|enter\s+(?:the|this|your)\s+code|use\s+this\s+code/i,
  /(?:verification|security|authentication|login|sign[- ]?in|one[- ]?time|reset|confirmation)\s+(?:code|link)/i,
  /\bmagic[- ]link\b|\bsign[- ]?in\b|\blog[- ]?in\b/i,
  /(?:bestätigungs|bestaetigungs|verifizierungs|sicherheits|anmelde|einmal)(?:code|link)/i,
  /(?:dein|ihr)(?:e|en)?\s+(?:code|passwort)|passwort\s+zur(?:ü|ue)cksetzen/i,
  /(?:e-?mail|konto)\s+bestätigen|bestätigen\s+sie\s+(?:ihre|die)\s+e-?mail/i,
]
// A code needs a nearby label or a strong authentication context, not just a
// number with a high score elsewhere in a long email.
const codeLabel =
  /(?:\b(?:code|otp|pin|passcode|token)|(?:bestätigungs|bestaetigungs|verifizierungs|sicherheits|anmelde|einmal)code)\s*(?:(?:is|ist|lautet)\s*)?[:=\-]?\s*$/i
const unrelatedLabel =
  /\b(?:order|invoice|phone|tel|zip|postal|tracking|ticket|reference|discount|promo|coupon|voucher|gift|product|booking|reservation|bestellung|rechnung|telefon|postleitzahl|gutschein|rabatt|aktionscode|buchung|ip|date|datum|time|zeit|expires?\s+in|valid\s+for|g[üu]ltig)\b[^\n:]{0,25}:?\s*$/i
const hasContext = (value: string) => contextPhrases.some((regex) => regex.test(value))
const maxInput = 200_000

// What a link does, most specific first. Each phrase stands for a button label or the sentence
// introducing the link; each target pattern for a URL path segment or parameter.
const linkActions: {
  action: 'resetPassword' | 'verify' | 'signIn'
  text: RegExp
  target: RegExp
}[] = [
  {
    action: 'resetPassword',
    text: /\b(?:reset|recover|change)\s+(?:your\s+|my\s+|the\s+)?password\b|\b(?:choose|create|set)\s+(?:up\s+)?(?:a\s+)?new\s+password\b|\bpassword\s+(?:reset|recovery)\b|\bforgot(?:ten)?\s+(?:your\s+)?password\b|passwort\s+(?:zur(?:ü|ue)cksetzen|(?:ä|ae)ndern|vergessen|festlegen)|neues\s+passwort/i,
    target:
      /(?:^|[/#?&=_.-])(?:reset|reset-?password|password|passwort|recover|recovery)(?:[/#?&=_.-]|$)/i,
  },
  {
    action: 'verify',
    text: /\bverif(?:y|ies|ication)\b|\bconfirm(?:ation)?\b|\bactivat(?:e|ion)\b|\bvalidate\b|complete\s+(?:your\s+)?registration|best(?:ä|ae)tig|verifizier|aktivier/i,
    target:
      /(?:^|[/#?&=_.-])(?:verify|verification|confirm|confirmation|activate|activation|validate|bestaetigen|bestätigen)(?:[/#?&=_.-]|$)/i,
  },
  {
    action: 'signIn',
    text: /\bmagic[\s-]?link\b|\bsign[\s-]?in\b|\blog[\s-]?in\b|\banmelde(?:n|link)\b|\beinloggen\b/i,
    target:
      /(?:^|[/#?&=_.-])(?:login|log-in|signin|sign-in|sign_in|magic|magic-?link|magiclink)(?:[/#?&=_.-]|$)/i,
  },
]
const mentionsEmail = /\be-?mail\b|\b(?:email\s+)?address\b|\badresse\b/i

/**
 * Names a link's action from the closest evidence first: the line introducing it (usually the
 * button label), then the URL, then the surrounding text, then the subject.
 */
function linkAction(before: string, target: string, subject: string): AuthLinkAction | undefined {
  const lines = before.split('\n').map((line) => line.trim())
  const label = (lines.reverse().find(Boolean) || '').slice(-120)
  const sources: [text: string, isTarget: boolean][] = [
    [label, false],
    [target, true],
    [before, false],
    [subject, false],
  ]
  for (const [source, isTarget] of sources) {
    const match = linkActions.find((action) =>
      (isTarget ? action.target : action.text).test(source),
    )
    if (!match) continue
    if (match.action !== 'verify') return match.action
    return !isTarget && mentionsEmail.test(source) ? 'verifyEmail' : 'verify'
  }
  return undefined
}

/** Pure, local extraction. HTML is parsed as text; no links or images are fetched. */
export function extractAuthCandidates({
  html,
  text,
  subject,
  partial,
}: {
  html?: string
  text?: string
  subject?: string
  /** The text is an excerpt cut off at the end: a value reaching the end may be incomplete. */
  partial?: boolean
}): AuthCandidate[] {
  // Keep both MIME alternatives: either may carry the usable value. Repeated
  // values are deduplicated below and never gain confidence through repetition.
  const htmlText = html
    ? convert(html.slice(0, maxInput), {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'blockquote', format: 'skip' },
          { selector: '.gmail_quote', format: 'skip' },
          { selector: 'a', options: { linkBrackets: false, hideLinkHrefIfSameAsText: true } },
        ],
      })
    : ''
  const candidates = new Map<string, AuthCandidate>()
  const add = (candidate: AuthCandidate) => {
    const key = candidate.type + ':' + candidate.value
    if (candidate.score > (candidates.get(key)?.score ?? -Infinity)) candidates.set(key, candidate)
  }
  const heading = (subject || '').slice(0, 1000)
  for (const body of [text || '', htmlText]) {
    // Ignore quoted plaintext replies and forwards, where a previous code may live.
    const content = body
      .slice(0, maxInput)
      .split(
        /\n(?:On .+wrote:|Am .+schrieb .+:|[- ]*Original Message[- ]*|[- ]*Forwarded message[- ]*)\s*\n/i,
      )[0]
      .replace(/^>.*$/gm, '')
    const emailBody = `${heading}\n\n${content}`.replace(/[\u00a0\u202f]/g, ' ')
    // Trailing punctuation or an ellipsis may follow a cut-off value.
    const end = partial && content.trim() ? emailBody.replace(/[\s.…]+$/, '').length : Infinity
    const linkRegex = /https?:\/\/[^\s<>"']+/gi
    for (const match of emailBody.matchAll(linkRegex)) {
      const link = match[0].replace(/[.,;:)\]}]+$/g, '')
      if (match.index + match[0].length >= end) continue
      let url: URL
      try {
        url = new URL(link)
      } catch {
        continue
      }
      if (url.username || url.password || link.length > 8192) continue
      if (url.pathname === '/' && !url.search && !url.hash) continue
      if (/\.(?:png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico)$/i.test(url.pathname)) continue
      if (
        /(?:unsubscribe|opt[-_]?out|privacy|terms|support|help)(?:[/?#=&_-]|$)/i.test(
          url.pathname + url.search,
        )
      )
        continue

      const index = match.index
      const before = emailBody.slice(Math.max(0, index - 100), index)
      // URL hostnames do not constitute evidence (e.g. security.example.com).
      const target = url.pathname + url.search + url.hash
      const targetContext =
        /(?:^|[/#?&=_-])(?:verify|verification|confirm|confirmation|activate|activation|auth|authenticate|magic|reset|login|signin|sign[-_]in|bestätigen|bestaetigen)(?:[/#?&=_-]|$)/i.test(
          target,
        )
      if (!targetContext && !hasContext(before)) continue
      let score = 20
      for (const { regex, weight } of authKeywords) {
        regex.lastIndex = 0
        if (regex.test(target)) score += weight * 2
      }
      for (const phrase of contextPhrases) if (phrase.test(before)) score += 15
      if (targetContext) score += 30
      // Opaque button links still qualify when the button clearly names the action.
      if (hasContext(before)) score += 20
      const action = linkAction(emailBody.slice(Math.max(0, index - 300), index), target, heading)
      add({ type: 'link', value: link, score, ...(action ? { action } : {}) })
    }

    // Preserve positions when removing URLs; their tokens must not become codes.
    const withoutLinks = emailBody.replace(linkRegex, (link) => ' '.repeat(link.length))
    const codeRegex = new RegExp(`(?<![A-Za-z0-9@/])(?:${codeBodyRegex})(?![A-Za-z0-9@/])`, 'g')
    for (let match: RegExpExecArray | null; (match = codeRegex.exec(withoutLinks));) {
      let raw = match[0]
      const index = match.index
      // Collapsed whitespace (as in a preview) can join a code and the next word into one
      // grouped match. Keep the code, or retry after a leading word.
      const groups = raw.split(codeGroups)
      const word =
        groups.length > 1 ? groups.findIndex((_, i) => i % 2 === 0 && isProse(groups, i)) : -1
      if (word === 0) {
        codeRegex.lastIndex = index + groups[0].length + groups[1].length
        continue
      }
      if (word > 0) {
        raw = groups.slice(0, word - 1).join('')
        if (!wholeCode.test(raw)) continue
      }
      if (index + raw.length >= end) continue
      const value = raw.replace(/[\s*_\-.]/g, '')
      const before = withoutLinks.slice(Math.max(0, index - 80), index)
      const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
      const after = withoutLinks.slice(index + raw.length, index + raw.length + 40)
      const labeled = codeLabel.test(before)
      const ownLine = !lineBefore.trim() && /^\s*(?:\n|$)/.test(after)
      const inlineSubject = index < heading.length && hasContext(heading)
      if (!labeled && !(ownLine && hasContext(before)) && !inlineSubject) continue
      // Pure words such as "Verify" or "Account" are not codes unless explicitly
      // labelled, uppercase, and separate from ordinary prose.
      if (!/\d/.test(value) && !(labeled && /^[A-Z]{4,10}$/.test(value))) continue
      if (unrelatedLabel.test(before)) continue
      if (/^(?:19|20)\d{2}$/.test(value) && !labeled) continue
      if (/^\d{4}[-.]\d{2}[-.]\d{2}$|^\d{2}[-.]\d{2}[-.]\d{4}$|^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw))
        continue
      if (/\d:$/.test(before) || /^:\d/.test(after)) continue
      if (/[+\d][\d ().-]{2,}$/.test(lineBefore) || /^[ .-]*\d/.test(after)) continue

      // AuthFill's base/length/proximity scoring, capped per keyword so repeated
      // footer text cannot manufacture confidence.
      let score = 20 + (value.length === 6 ? 15 : value.length <= 8 ? 12 : 10)
      for (const { regex, weight } of authKeywords) {
        regex.lastIndex = 0
        const context = withoutLinks.slice(Math.max(0, index - 200), index + raw.length + 80)
        if (regex.test(context)) score += weight
      }
      if (labeled) score += 30
      for (const phrase of contextPhrases) if (phrase.test(before)) score += 25
      if (inlineSubject) score += 25
      add({ type: 'code', value, score })
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score)
}

/** A close runner-up means the email does not identify a unique value to copy. */
export function selectAuthCandidate(
  input: Parameters<typeof extractAuthCandidates>[0],
): AuthCandidate | undefined {
  const candidates = extractAuthCandidates(input).filter((candidate) => candidate.score >= 60)
  const [best, second] = candidates
  if (!best || (second && best.score - second.score < 15)) return undefined
  return best
}

/** The value shown and copied in inlark. Never reads encrypted text. */
export const detectAuth: AuthDetector = (input) => {
  if (/-----BEGIN PGP MESSAGE-----/.test((input.text || '') + (input.html || ''))) return undefined
  const candidate = selectAuthCandidate(input)
  if (!candidate) return undefined
  const { type, value, action } = candidate
  return { type, value, ...(action ? { action } : {}) }
}
