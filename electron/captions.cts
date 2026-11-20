import type { CaptionCue, CaptionFormat, CaptionLayout, CaptionOptions, SubtitleStyle } from '../src/transcription'

export const defaultStyle: SubtitleStyle = {
  font: 'Microsoft YaHei', size: 42, outline: 2, bottom: 42, color: '#ffffff',
  background: '#151515', opacity: 78, radius: 12, padding: 14, spacing: 6,
}

export function cue(start: number, end: number, text: string, timing: CaptionCue['timing'] = 'segment'): CaptionCue {
  return { id: '', start: Math.round(start), end: Math.round(end), text, original: text, translation: '', timing }
}

export function cleanCues(cues: CaptionCue[], duration = Number.MAX_SAFE_INTEGER) {
  return cues.filter((line) => Number.isFinite(line.start) && Number.isFinite(line.end) && line.text.trim())
    .map((line) => ({ ...line, start: Math.round(Math.max(0, line.start)), end: Math.round(Math.min(duration, line.end)) }))
    .filter((line) => line.end > line.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((line, index) => ({ ...line, id: String(index + 1) }))
}

export function timestampMs(value: string) {
  const parts = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim())
  if (!parts || Number(parts[2]) > 59 || Number(parts[3]) > 59) return NaN
  return ((Number(parts[1] || 0) * 60 + Number(parts[2])) * 60 + Number(parts[3])) * 1000 + Number(parts[4].padEnd(3, '0'))
}

export function captionTime(ms: number, delimiter = '.') {
  const time = Math.max(0, Math.round(ms))
  const pad = (n: number, digits = 2) => String(n).padStart(digits, '0')
  return [pad(Math.floor(time / 3600000)), pad(Math.floor(time / 60000) % 60), pad(Math.floor(time / 1000) % 60)].join(':') +
    delimiter + pad(time % 1000, 3)
}

export function decodeSubtitle(buffer: Uint8Array) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { return new TextDecoder('gb18030').decode(buffer) }
}

function stripMarkup(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity] ?? '')
}

export function parseCaptions(content: string, format: string): CaptionCue[] {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues: CaptionCue[] = []
  if (format === 'json') {
    const rows = JSON.parse(text)
    if (!rows || typeof rows !== 'object') throw new Error('字幕 JSON 格式无效。')
    for (const row of Object.values(rows) as Array<Record<string, unknown> | null>) {
      if (!row || typeof row.original_subtitle !== 'string') continue
      const line = cue(Number(row.start_time), Number(row.end_time), row.original_subtitle)
      line.original = typeof row.recognized_subtitle === 'string' ? row.recognized_subtitle : line.text
      line.translation = typeof row.translated_subtitle === 'string' ? row.translated_subtitle : ''
      if (row.timing === 'word' || row.timing === 'estimated') line.timing = row.timing
      cues.push(line)
    }
  } else if (format === 'ass') {
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
    let events = false
    for (const row of text.split('\n')) {
      if (row.startsWith('[')) events = row.trim().toLowerCase() === '[events]'
      if (!events) continue
      if (/^Format:/i.test(row)) fields = row.slice(7).split(',').map((value) => value.trim().toLowerCase())
      if (!/^Dialogue:/i.test(row)) continue
      const values = row.slice(9).trimStart().split(',')
      const body = values.slice(fields.indexOf('text')).join(',').replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
      cues.push(cue(timestampMs(values[fields.indexOf('start')] || ''), timestampMs(values[fields.indexOf('end')] || ''), body))
    }
  } else if (format === 'srt' || format === 'vtt') {
    for (const block of text.trim().split(/\n[ \t]*\n/)) {
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue
      const rows = block.split('\n')
      const timeLine = rows.findIndex((row) => /^\s*[\d:. ,]+\s+-->\s+[\d:. ,]+/.test(row))
      if (timeLine < 0) continue
      const [startValue, endValue] = rows[timeLine].trim().split(/\s+-->\s+/)
      const start = timestampMs(startValue)
      const end = timestampMs(endValue.split(/\s+/)[0])
      const body = rows.slice(timeLine + 1).join('\n')
      // WebVTT may use embedded word times and duplicate roll-up cues.
      const embedded = format === 'vtt' ? [...body.matchAll(/<(\d[\d:.]+)>/g)] : []
      if (!embedded.length) {
        cues.push(cue(start, end, stripMarkup(body)))
        continue
      }
      let previousTime = start
      let previousIndex = 0
      for (const event of embedded) {
        const nextTime = timestampMs(event[1])
        cues.push(cue(previousTime, nextTime, stripMarkup(body.slice(previousIndex, event.index)), 'word'))
        previousTime = nextTime
        previousIndex = event.index + event[0].length
      }
      cues.push(cue(previousTime, end, stripMarkup(body.slice(previousIndex)), 'word'))
    }
  } else throw new Error('请选择 SRT、ASS、VTT 或字幕 JSON。')
  const seen = new Set<string>()
  return cleanCues(cues).filter((line) => {
    const key = [line.start, line.end, line.text].join('\0')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function displayedText(line: CaptionCue, layout: CaptionLayout) {
  if (!line.translation || layout === 'source') return line.text
  if (layout === 'translation') return line.translation
  return layout === 'source-first' ? line.text + '\n' + line.translation : line.translation + '\n' + line.text
}

export function assColor(color: string, opacity = 100) {
  const [r, g, b] = color.slice(1).match(/../g) ?? ['ff', 'ff', 'ff']
  return '&H' + Math.round(255 * (100 - opacity) / 100).toString(16).padStart(2, '0') + b + g + r
}

export function assTime(time: number) {
  return captionTime(Math.floor(time / 10) * 10).slice(0, -1)
}

export function assText(text: string) {
  return text.replace(/[{}\\]/g, (character) => ({ '{': '｛', '}': '｝', '\\': '＼' })[character] || character)
    .replace(/\r?\n/g, '\\N')
}

export function assHeader(style: SubtitleStyle, width = 1920, height = 1080) {
  const safeFont = style.font.replace(/[,{}\r\n]/g, '').trim() || defaultStyle.font
  const primary = assColor(style.color)
  const back = assColor(style.background, style.opacity)
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + width, 'PlayResY: ' + height, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,' + [safeFont, style.size, primary, primary, '&H00000000', back, 0, 0, 0, 0, 100, 100,
      0, 0, 1, style.outline, 0, 2, 24, 24, style.bottom, 1].join(','),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n') + '\n'
}

export function serializeCaptions(
  cues: CaptionCue[], format: CaptionFormat, layout: CaptionLayout, style = defaultStyle,
  size = { width: 1920, height: 1080 },
) {
  if (format === 'json') {
    return JSON.stringify(Object.fromEntries(cues.map((line, index) => [String(index + 1), {
      start_time: line.start, end_time: line.end, original_subtitle: line.text, translated_subtitle: line.translation,
      recognized_subtitle: line.original, timing: line.timing,
    }])), null, 2) + '\n'
  }
  if (format === 'txt') return cues.map((line) => displayedText(line, layout)).join('\n') + '\n'
  if (format === 'ass') {
    return assHeader(style, size.width, size.height) + cues.map((line) => {
      let body = assText(displayedText(line, layout))
      if (line.translation && (layout === 'source-first' || layout === 'translation-first')) {
        const lines = layout === 'source-first' ? [line.text, line.translation] : [line.translation, line.text]
        body = assText(lines[0]) + '\\N{\\fs' + Math.round(style.size * 0.78) + '}' + assText(lines[1])
      }
      return 'Dialogue: 0,' + assTime(line.start) + ',' + assTime(Math.max(line.start + 10, line.end)) +
        ',Default,,0,0,0,,' + body
    }).join('\n') + '\n'
  }
  const delimiter = format === 'srt' ? ',' : '.'
  const header = format === 'vtt' ? 'WEBVTT\n\n' : ''
  return header + cues.map((line, index) => {
    const body = displayedText(line, layout).replace(/\n{2,}/g, '\n')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return (index + 1) + '\n' + captionTime(line.start, delimiter) + ' --> ' + captionTime(line.end, delimiter) + '\n' + body
  }).join('\n\n') + '\n'
}

const tokensPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\s]/gu
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const lexical = /[\p{L}\p{N}]/u
const strong = /[。！？.!?;；]$/u
const connectors = /^(?:and|but|because|when|however|so|而且|但是|所以|因为)$/iu

function tokenStrings(text: string) {
  return text.match(tokensPattern) || []
}

export function joinWords(texts: string[]) {
  let result = ''
  for (const text of texts) {
    const previous = result.at(-1) || ''
    const next = text[0] || ''
    if (previous && next && /[\p{L}\p{N},.!?;:%)\]]/u.test(previous) && lexical.test(next) && !cjk.test(previous + next)) result += ' '
    result += text
  }
  return result.trim()
}

export function wordCues(cues: CaptionCue[]) {
  return cues.flatMap((line) => {
    if (line.timing === 'word' || tokenStrings(line.text).length < 2) return [line]
    const tokens = tokenStrings(line.text)
    const weights = tokens.map((part) => Math.ceil(Array.from(part).length / 4))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    let offset = 0
    return tokens.map((part, index) => {
      const start = line.start + (line.end - line.start) * offset / total
      offset += weights[index]
      const end = line.start + (line.end - line.start) * offset / total
      return cue(start, end, part, 'estimated')
    })
  })
}

function makeLine(words: CaptionCue[]) {
  const line = cue(words[0].start, Math.max(...words.map((word) => word.end)), joinWords(words.map((word) => word.text)),
    words.some((word) => word.timing === 'estimated') ? 'estimated' : 'segment')
  return line
}

export function splitWithRules(words: CaptionCue[], limits: Pick<CaptionOptions, 'cjk' | 'words'>) {
  const groups: CaptionCue[][] = []
  let group: CaptionCue[] = []
  let count = 0
  let hasCjk = false
  for (const item of words) {
    const previous = group.at(-1)
    const itemCount = tokenStrings(item.text).filter((part) => lexical.test(part)).length
    const limit = hasCjk || cjk.test(item.text) ? limits.cjk : limits.words
    const gap = previous ? item.start - previous.end : 0
    if (previous && (gap >= 1500 || count >= 4 && (gap >= 500 || strong.test(previous.text) ||
        connectors.test(item.text) && count >= limit * 0.6) || itemCount > 0 && count + itemCount > limit)) {
      groups.push(group)
      group = []
      count = 0
      hasCjk = false
    }
    group.push(item)
    count += itemCount
    hasCjk ||= cjk.test(item.text)
  }
  if (group.length) groups.push(group)
  for (let index = 1; index < groups.length; index++) {
    const left = groups[index - 1]
    const right = groups[index]
    const leftText = joinWords(left.map((line) => line.text))
    const rightText = joinWords(right.map((line) => line.text))
    const length = (value: string) => tokenStrings(value).filter((word) => lexical.test(word)).length
    if (length(rightText) < 4 && right[0].start - left.at(-1)!.end <= 200 &&
        !strong.test(leftText) && length(leftText + ' ' + rightText) <= (cjk.test(leftText + rightText) ? limits.cjk : limits.words)) {
      left.push(...right)
      groups.splice(index--, 1)
    }
  }
  return cleanCues(groups.map(makeLine))
}

export function splitBatches(words: CaptionCue[]) {
  const result: CaptionCue[][] = []
  let start = 0
  while (words.length - start > 530) {
    let end = start + 500
    let longest = -Infinity
    for (let index = end - 30; index <= start + 530; index++) {
      const gap = words[index].start - words[index - 1].end
      if (gap > longest) { end = index; longest = gap }
    }
    result.push(words.slice(start, end))
    start = end
  }
  if (start < words.length) result.push(words.slice(start))
  return result
}

function normalized(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function similarity(left: string, right: string) {
  const a = normalized(left).slice(0, 3000)
  const b = normalized(right).slice(0, 3000)
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const costs = new Uint16Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) costs[j] = j
  for (let i = 1; i <= a.length; i++) {
    let previous = costs[0]
    costs[0] = i
    for (let j = 1; j <= b.length; j++) {
      const saved = costs[j]
      costs[j] = Math.min(costs[j] + 1, costs[j - 1] + 1, previous + Number(a[i - 1] !== b[j - 1]))
      previous = saved
    }
  }
  return 1 - costs[b.length] / Math.max(a.length, b.length)
}

export function alignSentences(words: CaptionCue[], sentences: string[], limits: Pick<CaptionOptions, 'cjk' | 'words'>) {
  if (!sentences.length || similarity(joinWords(words.map((word) => word.text)), sentences.join(' ')) < 0.96) return null
  let start = 0
  const results: CaptionCue[] = []
  for (const sentence of sentences) {
    const wordCount = tokenStrings(sentence).filter((word) => lexical.test(word)).length
    if (!wordCount || wordCount > (cjk.test(sentence) ? limits.cjk : limits.words)) return null
    const target = normalized(sentence).length
    let length = 0
    let end = start
    while (end < words.length && (length < target || !normalized(words[end].text))) {
      length += normalized(words[end++].text).length
    }
    const selected = words.slice(start, end)
    if (!selected.length || similarity(joinWords(selected.map((word) => word.text)), sentence) < 0.85) return null
    const line = makeLine(selected)
    results.push(line)
    start = end
  }
  return start === words.length ? results : null
}

export function joinChunks(parts: Array<{ start: number; cues: CaptionCue[] }>, overlap: number) {
  let result: CaptionCue[] = []
  let fallback = 0
  for (const part of parts) {
    const right = part.cues.map((line) => ({ ...line, start: line.start + part.start, end: line.end + part.start }))
    if (!right.length) continue
    const leftStart = result.findIndex((line) => line.end >= part.start)
    if (leftStart < 0) { result.push(...right); continue }
    const left = result.slice(leftStart)
    const early = right.filter((line) => line.start < part.start + overlap)
    let best: { left: number; right: number; count: number; distance: number } | undefined
    for (let i = 0; i < left.length; i++) {
      for (let j = 0; j < early.length; j++) {
        const distance = Math.abs(left[i].start - early[j].start)
        if (distance > 2500 || !normalized(left[i].text)) continue
        let count = 0
        while (i + count < left.length && j + count < early.length &&
          Math.abs(left[i + count].start - early[j + count].start) <= 2500 &&
          similarity(left[i + count].text, early[j + count].text) >= 0.7) count++
        if (count >= 2 && (!best || count > best.count || count === best.count && distance < best.distance)) {
          best = { left: i, right: j, count, distance }
        }
      }
    }
    if (best) {
      const middle = Math.floor(best.count / 2)
      result = result.slice(0, leftStart + best.left + middle).concat(right.slice(best.right + middle))
    } else {
      const rightStart = right[0].start
      const boundary = result.findLastIndex((line) => line.end <= rightStart)
      const leftOnly = result.slice(0, boundary + 1)
      if (left.length && early.length) fallback++
      result = leftOnly.concat(right)
    }
  }
  return { cues: cleanCues(result), fallback }
}

export function smoothCues(cues: CaptionCue[]) {
  const result = cues.map((line) => ({ ...line }))
  for (let index = 1; index < result.length; index++) {
    const previous = result[index - 1]
    const next = result[index]
    const gap = next.start - previous.end
    if (gap >= 1000) continue
    const boundary = Math.floor((previous.end + next.start) / 2) + Math.floor(gap / 4)
    if (boundary > previous.start && boundary < next.end) previous.end = next.start = boundary
  }
  return result
}
