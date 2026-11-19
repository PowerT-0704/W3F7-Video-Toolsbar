export interface TimedLyric { time: number; text: string }

export function parseTimedLyrics(source: string): TimedLyric[] {
  const offset = Number(source.match(/^\[offset:\s*([+-]?\d+)\]\s*$/im)?.[1] ?? 0)
  const shift = Number.isSafeInteger(offset) ? offset : 0
  const rows: TimedLyric[] = []
  for (const line of source.split(/\r\n?|\n/)) {
    const prefix = line.match(/^(?:\[\d+:[0-5]\d(?:\.\d{1,3})?\])+/)?.[0]
    if (!prefix) continue
    const text = line.slice(prefix.length).trim()
    for (const [, minutes, seconds, fraction = '0'] of prefix.matchAll(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g)) {
      const time = Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'))
      if (Number.isSafeInteger(time)) rows.push({ time: Math.max(0, time - shift), text })
    }
  }
  const grouped: TimedLyric[] = []
  for (const row of rows.sort((a, b) => a.time - b.time)) {
    const previous = grouped.at(-1)
    if (previous?.time === row.time) previous.text += '\n' + row.text
    else grouped.push(row)
  }
  return grouped
}

export function lyricAt(rows: TimedLyric[], milliseconds: number) {
  let left = 0
  let right = rows.length
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (rows[middle].time <= milliseconds) left = middle + 1
    else right = middle
  }
  return left - 1
}
