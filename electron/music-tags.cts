import type { FileHandle } from 'node:fs/promises'
import type { MusicFormat } from '../src/bridge'

export const lyricLimit = 1024 * 1024
const lyricKeys = new Set(['LYRICS', 'UNSYNCEDLYRICS', 'SYNCEDLYRICS'])
const maxId3Size = 64 * 1024 * 1024

interface TagEdit { start: number; end: number; data: Buffer }
export interface EmbeddedCover {
  data: Buffer
  mime: 'image/png' | 'image/jpeg'
  size: number
  depth: number
}
interface TagChanges { lyrics?: string; cover?: EmbeddedCover }
interface TagResult {
  lyrics: string[]
  warning?: string
  writeIssue?: string
  lyricWriteIssue?: string
  coverWriteIssue?: string
  edits: TagEdit[]
}

export async function readBytes(file: FileHandle, size: number, position: number) {
  const buffer = Buffer.alloc(size)
  let received = 0
  while (received < size) {
    const { bytesRead } = await file.read(buffer, received, size - received, position + received)
    if (!bytesRead) throw new Error('音频标签或文件内容不完整。')
    received += bytesRead
  }
  return buffer
}

function decode(data: Buffer, encoding: string) {
  return new TextDecoder(encoding, { fatal: true }).decode(data)
}

export function decodeLrc(data: Buffer) {
  if (data.length > lyricLimit) throw new Error('歌词文件不能超过 1 MB。')
  let text: string
  try {
    if (data[0] === 0xff && data[1] === 0xfe) text = decode(data, 'utf-16le')
    else if (data[0] === 0xfe && data[1] === 0xff) text = decode(data, 'utf-16be')
    else {
      try { text = decode(data, 'utf-8') }
      catch {
        if (data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error()
        text = decode(data, 'gb18030')
      }
    }
  } catch { throw new Error('无法读取歌词编码，请保存为 UTF-8、带 BOM 的 UTF-16 或 GB18030 后重试。') }
  if (text.includes('\0')) throw new Error('歌词文件包含无效字符，请选择纯文本 LRC。')
  if (!text.trim()) throw new Error('歌词文件为空。')
  if (Buffer.byteLength(text) > lyricLimit) throw new Error('歌词转为 UTF-8 后不能超过 1 MB。')
  return text
}

function addLyric(result: TagResult, text: string) {
  if (!text.trim() || result.lyrics.includes(text)) return
  if (text.includes('\0') || Buffer.byteLength(text) > lyricLimit) {
    result.warning = '检测到内嵌歌词，但内容过长或包含无效字符。'
  } else result.lyrics.push(text)
}

function flacComment(data: Buffer, result: TagResult, replacement?: string) {
  let offset = 0
  function readLength() {
    if (offset + 4 > data.length) throw new Error('FLAC 注释标签不完整。')
    const length = data.readUInt32LE(offset)
    offset += 4
    return length
  }
  function readField() {
    const length = readLength()
    if (length > data.length - offset) throw new Error('FLAC 注释标签的长度无效。')
    const field = data.subarray(offset, offset + length)
    offset += length
    return field
  }

  readField() // Preserve the original vendor bytes and their length.
  const vendor = data.subarray(0, offset)
  const count = readLength()
  if (count > (data.length - offset) / 4) throw new Error('FLAC 注释字段数无效。')
  const retained: Buffer[] = []
  for (let i = 0; i < count; i++) {
    const start = offset
    const field = readField()
    const equals = field.indexOf(0x3d)
    if (equals >= 0 && lyricKeys.has(field.toString('latin1', 0, equals).toUpperCase())) {
      try { addLyric(result, decode(field.subarray(equals + 1), 'utf-8')) }
      catch { result.warning = '检测到内嵌歌词，但 FLAC 歌词编码无效。' }
    } else if (replacement !== undefined) retained.push(data.subarray(start, offset))
  }
  if (offset !== data.length) throw new Error('FLAC 注释标签含有意外数据。')
  if (replacement !== undefined) return makeFlacComment(vendor, retained, replacement)
}

function makeFlacComment(vendor: Buffer, retained: Buffer[], text: string) {
  const count = Buffer.alloc(4)
  count.writeUInt32LE(retained.length + 1)
  const field = Buffer.from('LYRICS=' + text, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(field.length)
  return Buffer.concat([vendor, count, ...retained, length, field])
}

function flacBlock(type: number, data: Buffer, last: boolean) {
  if (data.length > 0xffffff) throw new Error('封装后的 FLAC 元数据块超出格式大小限制。')
  const header = Buffer.alloc(4)
  header[0] = type | (last ? 0x80 : 0)
  header.writeUIntBE(data.length, 1, 3)
  return Buffer.concat([header, data])
}

function flacPicture(cover: EmbeddedCover) {
  const mime = Buffer.from(cover.mime, 'ascii')
  const head = Buffer.alloc(8)
  head.writeUInt32BE(3)
  head.writeUInt32BE(mime.length, 4)
  const info = Buffer.alloc(24)
  info.writeUInt32BE(cover.size, 4)
  info.writeUInt32BE(cover.size, 8)
  info.writeUInt32BE(cover.depth, 12)
  info.writeUInt32BE(cover.data.length, 20)
  return Buffer.concat([head, mime, info, cover.data])
}

async function scanFlac(file: FileHandle, size: number, result: TagResult, changes?: TagChanges) {
  if ((await readBytes(file, 4, 0)).toString('latin1') !== 'fLaC') {
    throw new Error('该文件存在非标准 FLAC 前缀，当前无法处理其标签。')
  }
  const blocks: { start: number; end: number; type: number; last: boolean; remove: boolean; data?: Buffer }[] = []
  let offset = 4
  let foundComment = false
  for (;;) {
    const header = await readBytes(file, 4, offset)
    const type = header[0] & 0x7f
    const last = Boolean(header[0] & 0x80)
    const length = header.readUIntBE(1, 3)
    const end = offset + 4 + length
    if (end >= size || (offset === 4 ? type !== 0 || length !== 34 : type === 0) || type === 127) {
      throw new Error('FLAC 元数据块结构无效。')
    }
    let data: Buffer | undefined
    let remove = false
    if (type === 4) {
      if (foundComment) throw new Error('FLAC 包含重复的注释块，无法安全封装。')
      foundComment = true
      data = flacComment(await readBytes(file, length, offset + 4), result, changes?.lyrics)
    } else if (type === 6 && changes?.cover) {
      if (length < 4) throw new Error('FLAC 图片标签不完整，无法安全替换封面。')
      remove = (await readBytes(file, 4, offset + 4)).readUInt32BE() === 3
    }
    if (changes) blocks.push({ start: offset, end, type, last, remove, data })
    offset = end
    if (last) break
  }
  if (!changes) return

  const additional: { type: number; data: Buffer }[] = []
  if (!foundComment && changes.lyrics !== undefined) {
    const vendor = Buffer.from('\0\0\0\0W3F7 Video_Toolsbar', 'utf8')
    vendor.writeUInt32LE(vendor.length - 4)
    additional.push({ type: 4, data: makeFlacComment(vendor, [], changes.lyrics) })
  }
  if (changes.cover) additional.push({ type: 6, data: flacPicture(changes.cover) })
  const lastBlock = additional.length ? undefined : blocks.findLast((block) => !block.remove)
  for (const block of blocks) {
    const last = block === lastBlock
    if (block.remove) result.edits.push({ start: block.start, end: block.end, data: Buffer.alloc(0) })
    else if (block.data) result.edits.push({ start: block.start, end: block.end, data: flacBlock(block.type, block.data, last) })
    else if (last !== block.last) {
      result.edits.push({ start: block.start, end: block.start + 1, data: Buffer.from([block.type | (last ? 0x80 : 0)]) })
    }
  }
  if (additional.length) {
    const data = Buffer.concat(additional.map((block, index) => flacBlock(block.type, block.data, index === additional.length - 1)))
    result.edits.push({ start: offset, end: offset, data })
  }
}

function syncSafe(data: Buffer, offset: number) {
  if (offset + 4 > data.length) throw new Error('ID3 标签长度不完整。')
  let value = 0
  for (let i = offset; i < offset + 4; i++) {
    if (data[i] >= 0x80) throw new Error('ID3 标签长度无效。')
    value = value * 128 + data[i]
  }
  return value
}

function writeSyncSafe(data: Buffer, offset: number, size: number) {
  for (let i = offset + 3; i >= offset; i--) {
    data[i] = size & 0x7f
    size >>>= 7
  }
}

function deUnsync(data: Buffer) {
  const output = Buffer.alloc(data.length)
  let length = 0
  for (let i = 0; i < data.length; i++) {
    output[length++] = data[i]
    if (data[i] === 0xff && data[i + 1] === 0) i++
  }
  return output.subarray(0, length)
}

function id3TextReader(encoding: number) {
  if (encoding > 3) throw new Error('ID3 歌词文本编码无效。')
  const step = encoding === 1 || encoding === 2 ? 2 : 1
  let charset = encoding === 2 ? 'utf-16be' : 'utf-8'
  let hasByteOrder = false
  return (body: Buffer, start: number, terminated: boolean) => {
    let end = start
    while (end + step <= body.length && !(body[end] === 0 && (step === 1 || body[end + 1] === 0))) end += step
    const atTerminator = end + step <= body.length
    if ((terminated && !atTerminator) || (!atTerminator && end !== body.length)) throw new Error('ID3 歌词字符串不完整。')
    const bytes = body.subarray(start, end)
    if (encoding === 1 && bytes.length) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { charset = 'utf-16le'; hasByteOrder = true }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) { charset = 'utf-16be'; hasByteOrder = true }
      if (!hasByteOrder) throw new Error('ID3 UTF-16 歌词没有字节顺序标记。')
    }
    const text = encoding === 0 ? bytes.toString('latin1') : decode(bytes, charset)
    return { text, next: atTerminator ? end + step : end }
  }
}

function lrcTimestamp(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000).toString().padStart(2, '0')
  const seconds = Math.floor(milliseconds / 1000 % 60).toString().padStart(2, '0')
  return '[' + minutes + ':' + seconds + '.' + (milliseconds % 1000).toString().padStart(3, '0') + ']'
}

function readId3Lyric(id: string, body: Buffer, result: TagResult) {
  if (!body.length) throw new Error('ID3 歌词帧为空。')
  const read = id3TextReader(body[0])
  if (id === 'TXXX' || id === 'TXX') {
    const descriptor = read(body, 1, true)
    const name = descriptor.text.toUpperCase()
    if (!lyricKeys.has(name) && name !== 'USLT') return false
    const values: string[] = []
    for (let offset = descriptor.next; offset < body.length;) {
      const value = read(body, offset, false)
      values.push(value.text)
      offset = value.next
    }
    addLyric(result, values.join('\n'))
    return true
  }
  if (id === 'USLT' || id === 'ULT') {
    if (body.length < 5) throw new Error('USLT 歌词帧不完整。')
    const descriptor = read(body, 4, true)
    const value = read(body, descriptor.next, false)
    if (value.next !== body.length) throw new Error('USLT 歌词含有无效字符。')
    addLyric(result, value.text)
    return true
  }

  if (body.length < 7) throw new Error('SYLT 歌词帧不完整。')
  if (body[5] !== 1) return false
  if (body[4] !== 2) {
    result.warning = '检测到内嵌歌词，但当前仅支持导出以毫秒计时的 SYLT 歌词。'
    return true
  }
  const lines: string[] = []
  for (let offset = read(body, 6, true).next; offset < body.length;) {
    const item = read(body, offset, true)
    if (item.next + 4 > body.length) throw new Error('SYLT 歌词时间戳不完整。')
    const timestamp = lrcTimestamp(body.readUInt32BE(item.next))
    lines.push(...item.text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.length > 0).map((line) => timestamp + line))
    offset = item.next + 4
  }
  addLyric(result, lines.join('\n'))
  return true
}

function makeUslt(text: string, version: number) {
  const body = version === 4
    ? Buffer.concat([Buffer.from([3, 0x75, 0x6e, 0x64, 0]), Buffer.from(text, 'utf8')])
    : Buffer.concat([Buffer.from([1, 0x75, 0x6e, 0x64, 0xff, 0xfe, 0, 0, 0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  return id3Frame('USLT', body, version)
}

function id3Frame(id: string, body: Buffer, version: number) {
  const header = Buffer.alloc(10)
  header.write(id, 'ascii')
  if (version === 4) writeSyncSafe(header, 4, body.length)
  else header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

function id3Edit(end: number, version: number, retained: Buffer[], changes: TagChanges, descriptions?: Set<string>): TagEdit {
  if (changes.lyrics !== undefined) retained.push(makeUslt(changes.lyrics, version))
  if (changes.cover) {
    let description = 'Front cover'
    for (let index = 2; descriptions?.has(description); index++) description = 'Front cover ' + index
    const body = Buffer.concat([Buffer.from('\0' + changes.cover.mime + '\0\x03' + description + '\0', 'ascii'), changes.cover.data])
    retained.push(id3Frame('APIC', body, version))
  }
  const header = Buffer.from([0x49, 0x44, 0x33, version, 0, 0, 0, 0, 0, 0])
  const body = Buffer.concat(retained)
  if (body.length > maxId3Size) throw new Error('封装后的 ID3 标签过大。')
  writeSyncSafe(header, 6, body.length)
  return { start: 0, end, data: Buffer.concat([header, body]) }
}

const id3LyricFrames = new Set(['USLT', 'ULT', 'SYLT', 'SLT', 'TXXX', 'TXX'])

async function scanMp3(file: FileHandle, size: number, result: TagResult, changes?: TagChanges) {
  const header = await readBytes(file, Math.min(10, size), 0)
  if (header.toString('latin1', 0, 3) !== 'ID3') {
    if (changes) result.edits.push(id3Edit(0, 3, [], changes))
    return
  }
  const version = header[3]
  const flags = header[5]
  const length = syncSafe(header, 6)
  const end = 10 + length + (version === 4 && flags & 0x10 ? 10 : 0)
  if (![2, 3, 4].includes(version) || (version === 2 && flags & 0x40)) throw new Error('该 MP3 使用当前无法解析的 ID3 标签结构。')
  if (length > maxId3Size || end >= size) throw new Error('ID3 标签过大或不完整。')
  if (version === 2 || header[4] !== 0 || flags !== 0) result.writeIssue = '该 MP3 使用旧版或带扩展标志的 ID3 标签，当前无法安全封装。'
  if (size >= end + 3 && (await readBytes(file, 3, end)).toString('latin1') === 'ID3') {
    result.writeIssue = result.warning = '该 MP3 含有多段 ID3 标签，歌词可能只解析到一部分，当前无法封装。'
  }
  let data = await readBytes(file, length, 10)
  const unsynced = Boolean(flags & 0x80)
  if (version < 4 && unsynced) data = deUnsync(data)
  const retained: Buffer[] = []
  const descriptions = new Set<string>()
  let offset = 0
  if (version > 2 && flags & 0x40) {
    offset = version === 4 ? syncSafe(data, 0) : 4 + data.readUInt32BE(0)
    if (offset < 6 || offset > data.length) throw new Error('ID3 扩展标签的长度无效。')
  }
  const headerLength = version === 2 ? 6 : 10
  const idLength = version === 2 ? 3 : 4
  while (offset < data.length) {
    if (data[offset] === 0) {
      if (data.subarray(offset).some(Boolean)) throw new Error('ID3 标签填充区域无效。')
      break
    }
    if (offset + headerLength > data.length) throw new Error('ID3 标签帧头不完整。')
    const id = data.toString('latin1', offset, offset + idLength)
    const lengthAt = offset + idLength
    const frameSize = version === 2 ? data.readUIntBE(lengthAt, 3)
      : version === 3 ? data.readUInt32BE(lengthAt) : syncSafe(data, lengthAt)
    const start = offset + headerLength
    const next = start + frameSize
    if (!/^[A-Z0-9]+$/.test(id) || next > data.length) throw new Error('ID3 标签帧结构无效。')
    let remove = false
    const frameFlags = version === 2 ? 0 : data[offset + 9]
    const protectedFrame = version === 3 ? frameFlags & 0xe0 : frameFlags & 0x4d
    const readOnly = version === 3 ? data[offset + 8] & 0x20 : version === 4 && data[offset + 8] & 0x10
    if (id3LyricFrames.has(id)) {
      try {
        if (protectedFrame) throw new Error('ID3 歌词帧含有额外标志。')
        let body = data.subarray(start, next)
        if (version === 4 && (unsynced || frameFlags & 2)) body = deUnsync(body)
        const lyric = readId3Lyric(id, body, result)
        if (lyric && readOnly) result.lyricWriteIssue = '该 MP3 的歌词标签标记为只读，当前无法替换。'
        remove = lyric && changes?.lyrics !== undefined
      } catch {
        result.lyricWriteIssue = '该 MP3 含有无法识别的歌词或自定义标签，当前无法安全替换歌词。'
        if (id !== 'TXXX' && id !== 'TXX') result.warning = '检测到内嵌歌词，但部分 ID3 歌词帧无法解码。'
      }
    }
    if (id === 'APIC') {
      const raw = data.subarray(start, next)
      const body = version === 4 && (unsynced || frameFlags & 2) ? deUnsync(raw) : raw
      const typeAt = body.indexOf(0, 1) + 1
      try {
        if (protectedFrame || typeAt < 3 || typeAt >= body.length) throw new Error()
        const description = id3TextReader(body[0])(body, typeAt + 1, true)
        if (description.next >= body.length) throw new Error()
        if (body[typeAt] === 3) {
          if (readOnly) result.coverWriteIssue = '该 MP3 的正面封面标记为只读，当前无法替换。'
          remove = Boolean(changes?.cover)
        } else if (changes?.cover) descriptions.add(description.text)
      } catch {
        result.coverWriteIssue = '该 MP3 含有受保护或不完整的图片标签，当前无法安全替换封面。'
      }
    }
    if (id === 'ASPI' || id === 'CHAP' || id === 'SEEK') {
      result.writeIssue = '该 MP3 使用依赖文件偏移的索引或章节标签，当前无法安全封装。'
    }
    if (!remove && changes) retained.push(data.subarray(offset, next))
    offset = next
  }
  if (changes && !result.writeIssue && !(changes.cover && result.coverWriteIssue)
    && !(changes.lyrics !== undefined && result.lyricWriteIssue)) result.edits.push(id3Edit(end, version, retained, changes, descriptions))
}

export async function scanMusicTags(file: FileHandle, size: number, format: MusicFormat, changes?: TagChanges): Promise<TagResult> {
  const result: TagResult = { lyrics: [], edits: [] }
  try {
    if (format === 'flac') await scanFlac(file, size, result, changes)
    else await scanMp3(file, size, result, changes)
  } catch (reason) {
    result.warning = reason instanceof Error && !(reason instanceof RangeError) ? reason.message : '音频标签结构不完整。'
    result.writeIssue = result.warning
  }
  return result
}
