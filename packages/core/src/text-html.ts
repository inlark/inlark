const linkPattern = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Plain email text keeps its line breaks and spacing, with clickable web addresses. */
export function plainTextHtml(value: string): string {
  let html = '',
    end = 0
  for (const match of value.matchAll(linkPattern)) {
    const url = escapeHtml(match[0])
    html += escapeHtml(value.slice(end, match.index)) + '<a href="' + url + '">' + url + '</a>'
    end = match.index + match[0].length
  }
  return '<div style="white-space:pre-wrap">' + html + escapeHtml(value.slice(end)) + '</div>'
}
