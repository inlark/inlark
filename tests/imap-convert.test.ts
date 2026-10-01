import { describe, expect, it } from 'vitest'
import { previewText } from '../packages/imap/src/convert'

describe('IMAP previews', () => {
  it('normalizes whitespace and leaves quoted reply lines out', () => {
    expect(previewText(' Hello\tthere\r\n  > Old reply\n\nNew text ')).toBe('Hello there New text')
    expect(previewText('x'.repeat(300))).toHaveLength(256)
  })

  it('removes HTML tags and hidden blocks and decodes supported entities', () => {
    expect(
      previewText(
        '<HEAD><title>Hidden</title><style>CSS</style></HEAD>' +
          '<p>Hello&nbsp;<b>there</b> &amp; &lt;world&gt; &#39; &apos; &quot;</p>' +
          '<script type="text/javascript">hidden()</script><style>more CSS</style><p>Bye</p>',
        true,
      ),
    ).toBe("Hello there & <world> ' ' \" Bye")
  })

  it.each(['style', 'script', 'head'])('omits an unterminated %s block', (tag) => {
    expect(previewText(`<p>Visible</p><${tag}>Hidden<${tag}>Still hidden`, true)).toBe('Visible')
  })

  it('keeps visible text between separate hidden blocks', () => {
    expect(previewText('Before<style>CSS</style>Between<script>JS</script>After', true)).toBe(
      'Before Between After',
    )
  })

  it('preserves Unicode around mixed-case hidden tags', () => {
    expect(previewText('İstanbul<StYlE>CSS</sTyLe>世界', true)).toBe('İstanbul 世界')
  })

  it('requires an actual hidden tag name', () => {
    expect(previewText('<header>Heading</header><stylesheet>Text</stylesheet>', true)).toBe(
      'Heading Text',
    )
  })

  it.each([false, true])('bounds the input before processing (HTML: %s)', (html) => {
    expect(previewText(' '.repeat(4096) + 'Outside the preview sample', html)).toBe('')
    expect(previewText(' '.repeat(4095) + 'AB', html)).toBe('A')
  })

  it('omits a hidden block whose closing tag falls outside the sample', () => {
    expect(previewText('Before<style>' + ' '.repeat(4096) + '</style>After', true)).toBe('Before')
  })

  it('strips complete tags after malformed angle brackets', () => {
    expect(previewText('Hello <<b>world</b>', true)).toBe('Hello < world')
  })
})
