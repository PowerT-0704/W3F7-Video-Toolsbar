import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { MusicCover, MusicCoverDraft, MusicExport, MusicFormat, MusicInfo, MusicLyric, MusicSelection, ToolStatus } from '../src/bridge'
import { decodeLrc, lyricLimit, readBytes, scanMusicTags, type EmbeddedCover } from './music-tags.cjs'
import { streamLocalMedia } from './frames.cjs'

const run = promisify(execFile)
const localAudioInput = ['-protocol_whitelist', 'file', '-format_whitelist', 'flac,mp3']
const imageTypes: Record<string, { extension: string; mime: string }> = {
  mjpeg: { extension: 'jpg', mime: 'image/jpeg' },
  png: { extension: 'png', mime: 'image/png' },
  apng: { extension: 'png', mime: 'image/png' },
  webp: { extension: 'webp', mime: 'image/webp' },
  gif: { extension: 'gif', mime: 'image/gif' },
  bmp: { extension: 'bmp', mime: 'image/bmp' },
  tiff: { extension: 'tif', mime: 'image/tiff' },
  jpeg2000: { extension: 'jp2', mime: 'image/jp2' },
}

interface Probe {
  format?: { format_name?: string }
  streams?: {
    index: number; codec_type?: string; codec_name?: string; width?: number; height?: number
    tags?: { comment?: string }; disposition?: { attached_pic?: number }
  }[]
}
interface Picture extends MusicCover { mime?: string }
interface Audio { path: string; stats: Stats; tools: ToolStatus; info: MusicInfo; covers: Picture[] }
const isFrontCover = (comment?: string) => /^cover \(front\)$/i.test(comment ?? '')

function formatOf(path: string): MusicFormat | undefined {
  const ext = extname(path).toLowerCase()
  if (ext === '.mp3') return 'mp3'
  if (ext === '.flac') return 'flac'
}

async function probeAudio(executable: string, path: string, format: MusicFormat): Promise<Probe> {
  let data: Probe
  try {
    const { stdout } = await run(executable, ['-v', 'error', ...localAudioInput, '-i', path,
      '-show_entries', 'format=format_name:stream=index,codec_type,codec_name,width,height:stream_disposition=attached_pic:stream_tags=comment',
      '-of', 'json'], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
    data = JSON.parse(stdout)
  } catch { throw new Error('无法读取音频，请检查文件是否损坏或重新检测 FFmpeg。') }
  if (data.format?.format_name !== format || !data.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === format)) {
    throw new Error('文件内容与扩展名不符，请选择有效的 FLAC 或 MP3 音频。')
  }
  return data
}

async function loadLyrics(path: string): Promise<MusicLyric> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.lrc') throw new Error('请选择 .lrc 歌词文件。')
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('歌词路径不是文件。')
    if (info.size > lyricLimit) throw new Error('歌词文件不能超过 1 MB。')
    const text = decodeLrc(await readBytes(file, info.size, 0))
    return { id: randomUUID(), name: basename(path), text }
  } finally { await file.close() }
}

function assertCurrent(original: Stats, current: Stats) {
  if (original.size !== current.size || original.mtimeMs !== current.mtimeMs
    || original.ctimeMs !== current.ctimeMs || original.ino !== current.ino || original.dev !== current.dev) {
    throw new Error('音频文件已变化，请重新导入后再试。')
  }
}

async function assertOutput(audio: Audio, target: string, extension: string) {
  if (extname(target).toLowerCase() !== '.' + extension) throw new Error('请选择扩展名为 .' + extension + ' 的文件名。')
  const previous = await stat(target).catch((reason: NodeJS.ErrnoException) => {
    if (reason.code !== 'ENOENT') throw reason
    return undefined
  })
  if (target.toLowerCase() === audio.path.toLowerCase() || (previous && previous.ino !== 0
    && previous.ino === audio.stats.ino && previous.dev === audio.stats.dev)) throw new Error('请选择另一个文件名，以便生成音频副本。')
}

async function saveOutput(target: string, write: (temporary: string) => Promise<void>) {
  const temporary = join(dirname(target), '.w3f7-music-' + randomUUID() + '.tmp')
  try {
    await write(temporary)
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

export class MusicWorkspace {
  private audio?: Audio
  private imported?: MusicLyric
  private draft?: { picture: EmbeddedCover; info: MusicCoverDraft }
  private output?: string
  private picture?: { id: string; index: number; bytes: Promise<Buffer> }

  private requireAudio(id: unknown) {
    if (!this.audio || this.audio.info.id !== id) throw new Error('请重新选取音频。')
    return this.audio
  }

  async select(paths: unknown, getTools: () => Promise<ToolStatus>): Promise<MusicSelection> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 2 || !paths.every((path) => typeof path === 'string' && isAbsolute(path))) {
      throw new Error('请选择一个 FLAC 或 MP3，也可以同时导入一个 LRC。')
    }
    const audioPaths = paths.filter(formatOf)
    const lyricPaths = paths.filter((path) => extname(path).toLowerCase() === '.lrc')
    if (audioPaths.length > 1 || lyricPaths.length > 1 || audioPaths.length + lyricPaths.length !== paths.length) {
      throw new Error('请选择一个 FLAC 或 MP3，也可以同时导入一个 LRC。')
    }
    const [path] = audioPaths
    if (!path && !this.audio) throw new Error('请先选择音频，或把音频和歌词一起拖入。')
    const imported = lyricPaths.length ? await loadLyrics(lyricPaths[0]) : undefined
    if (path) {
      const format = formatOf(path)!
      const file = await open(path, 'r')
      let next: Audio
      try {
        const stats = await file.stat()
        if (!stats.isFile() || !stats.size) throw new Error('所选音频为空或无法读取。')
        const tools = await getTools()
        const probe = await probeAudio(tools.ffprobe, path, format)
        const tags = await scanMusicTags(file, stats.size, format)
        assertCurrent(stats, await stat(path))
        const id = randomUUID()
        const covers = (probe.streams ?? []).filter((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1)
          .sort((a, b) => Number(isFrontCover(b.tags?.comment)) - Number(isFrontCover(a.tags?.comment)))
          .map((stream, order): Picture => {
            const image = imageTypes[stream.codec_name ?? '']
            const front = isFrontCover(stream.tags?.comment)
            return { index: stream.index, label: front ? '正面封面' : '封面 ' + (order + 1),
              width: stream.width, height: stream.height, extension: image?.extension, mime: image?.mime,
              preview: image ? 'w3f7-media://music-cover/' + id + '/' + stream.index : undefined }
          })
        const info: MusicInfo = { id, name: basename(path), format, covers, playback: 'w3f7-media://music-audio/' + id,
          lyrics: tags.lyrics, lyricWarning: tags.warning, writeIssue: tags.writeIssue,
          lyricWriteIssue: tags.lyricWriteIssue, coverWriteIssue: tags.coverWriteIssue }
        next = { path, stats, tools, info, covers }
      } finally { await file.close() }
      this.audio = next
      this.picture = undefined
      this.draft = undefined
    }
    const { id } = this.audio!.info
    this.imported = imported
    this.output = undefined
    return this.selection(id)
  }

  sourcePath(id: string) { return this.requireAudio(id).path }

  private selection(id: string): MusicSelection {
    return { audio: this.requireAudio(id).info, imported: this.imported, draft: this.draft?.info }
  }

  checkCoverEdit(id: string) {
    const { info } = this.requireAudio(id)
    const issue = info.writeIssue || info.coverWriteIssue
    if (issue) throw new Error(issue)
  }

  stageCover(id: string, name: string, picture: EmbeddedCover) {
    this.checkCoverEdit(id)
    this.draft = { picture, info: { id: randomUUID(), name, width: picture.size, height: picture.size,
      bytes: picture.data.length, preview: 'data:' + picture.mime + ';base64,' + picture.data.toString('base64') } }
    this.output = undefined
    return this.selection(id)
  }

  discardCover(id: string) {
    this.requireAudio(id)
    this.draft = undefined
    this.output = undefined
    return this.selection(id)
  }

  discardLyric(id: string) {
    this.requireAudio(id)
    this.imported = undefined
    this.output = undefined
    return this.selection(id)
  }

  async playback(id: string, request: Request) {
    try {
      const audio = this.requireAudio(id)
      assertCurrent(audio.stats, await stat(audio.path))
      return await streamLocalMedia(request, audio.path, audio.info.format === 'flac' ? 'audio/flac' : 'audio/mpeg')
    } catch { return new Response(null, { status: 404 }) }
  }

  cover(id: string, index: number) {
    const { covers } = this.requireAudio(id)
    const order = covers.findIndex((cover) => cover.index === index)
    const picture = covers[order]
    if (!picture?.extension || !picture.mime) throw new Error('当前无法导出这张封面的图片格式。')
    return { extension: picture.extension, mime: picture.mime, suffix: covers.length > 1 ? '_封面_' + (order + 1) : '_封面' }
  }

  private async readPicture(audio: Audio, index: number) {
    assertCurrent(audio.stats, await stat(audio.path))
    let picture: Buffer
    try {
      const { stdout } = await run(audio.tools.ffmpeg, ['-v', 'error', '-nostdin', ...localAudioInput,
        '-i', audio.path, '-map', '0:' + index, '-c', 'copy', '-frames:v', '1', '-f', 'image2pipe', 'pipe:1'],
        { windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' })
      picture = stdout
    } catch { throw new Error('无法提取封面，图片可能过大或已损坏。') }
    assertCurrent(audio.stats, await stat(audio.path))
    if (!picture.length) throw new Error('未能读取封面图像数据。')
    return picture
  }

  private coverBytes(audio: Audio, index: number) {
    if (this.picture?.id === audio.info.id && this.picture.index === index) return this.picture.bytes
    const bytes = this.readPicture(audio, index)
    this.picture = { id: audio.info.id, index, bytes }
    void bytes.catch(() => { if (this.picture?.bytes === bytes) this.picture = undefined })
    return bytes
  }

  async preview(id: string, index: number) {
    try {
      const { mime } = this.cover(id, index)
      const audio = this.requireAudio(id)
      const bytes = await this.coverBytes(audio, index)
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      })
    } catch { return new Response('Cover unavailable', { status: 404 }) }
  }

  async saveCover(id: string, index: number, path: string) {
    const { extension } = this.cover(id, index)
    const audio = this.requireAudio(id)
    await assertOutput(audio, path, extension)
    assertCurrent(audio.stats, await stat(audio.path))
    const bytes = await this.coverBytes(audio, index)
    await saveOutput(path, (temporary) => writeFile(temporary, bytes, { flag: 'wx' }))
  }

  lyric(id: string, index: number) {
    const lyric = this.requireAudio(id).info.lyrics[index]
    if (!Number.isInteger(index) || typeof lyric !== 'string') throw new Error('请选择一份可导出的歌词。')
    return lyric
  }

  async saveLyric(id: string, index: number, path: string) {
    const lyric = this.lyric(id, index)
    const audio = this.requireAudio(id)
    await assertOutput(audio, path, 'lrc')
    assertCurrent(audio.stats, await stat(audio.path))
    await saveOutput(path, (temporary) => writeFile(temporary, lyric, { encoding: 'utf8', flag: 'wx' }))
  }

  requireExport(id: string, selection: MusicExport) {
    const audio = this.requireAudio(id)
    if (!selection || typeof selection !== 'object' || (!selection.coverId && !selection.lyricId)) {
      throw new Error('请先选择封面或导入 LRC 歌词。')
    }
    if (selection.lyricId !== undefined && (!this.imported || this.imported.id !== selection.lyricId)) {
      throw new Error('请重新导入 LRC 歌词。')
    }
    if (selection.coverId !== undefined && (!this.draft || this.draft.info.id !== selection.coverId)) {
      throw new Error('请重新确认待封装封面。')
    }
    if (audio.info.writeIssue) throw new Error(audio.info.writeIssue)
    if (selection.lyricId && audio.info.lyricWriteIssue) throw new Error(audio.info.lyricWriteIssue)
    if (selection.coverId && audio.info.coverWriteIssue) throw new Error(audio.info.coverWriteIssue)
    const changes = { lyrics: selection.lyricId ? this.imported!.text : undefined,
      cover: selection.coverId ? this.draft!.picture : undefined }
    const suffix = changes.cover ? (changes.lyrics === undefined ? '_封面' : '_封面歌词') : '_歌词'
    return { audio, changes, suffix }
  }

  async export(id: string, selection: MusicExport, path: string, tools: ToolStatus) {
    const { audio, changes } = this.requireExport(id, selection)
    const { format } = audio.info
    await assertOutput(audio, path, format)
    const source = await open(audio.path, 'r')
    try {
      assertCurrent(audio.stats, await source.stat())
      const result = await scanMusicTags(source, audio.stats.size, format, changes)
      const issue = result.writeIssue || (changes.cover && result.coverWriteIssue)
        || (changes.lyrics !== undefined && result.lyricWriteIssue)
      if (issue || !result.edits.length) throw new Error(issue || '无法写入音频标签。')
      const edits = [...result.edits, { start: audio.stats.size, end: audio.stats.size, data: Buffer.alloc(0) }]
      async function* rewrittenAudio() {
        let start = 0
        for (const edit of edits) {
          while (start < edit.start) {
            const size = Math.min(edit.start - start, 1024 * 1024)
            yield await readBytes(source, size, start)
            start += size
          }
          if (edit.data.length) yield edit.data
          start = edit.end
        }
      }
      await saveOutput(path, async (temporary) => {
        await pipeline(Readable.from(rewrittenAudio()), createWriteStream(temporary, { flags: 'wx' }))
        assertCurrent(audio.stats, await stat(audio.path))
        const probe = await probeAudio(tools.ffprobe, temporary, format)
        if (changes.lyrics !== undefined) {
          const verified = await open(temporary, 'r')
          try {
            const tags = await scanMusicTags(verified, (await verified.stat()).size, format)
            if (tags.warning || tags.lyrics.length !== 1 || tags.lyrics[0] !== changes.lyrics) throw new Error('成品歌词校验失败，请重试。')
          } finally { await verified.close() }
        }
        if (changes.cover) {
          const fronts = probe.streams?.filter((stream) => stream.disposition?.attached_pic === 1 && isFrontCover(stream.tags?.comment))
          const front = fronts?.[0]
          if (fronts?.length !== 1 || front?.width !== changes.cover.size || front?.height !== changes.cover.size
            || !(await this.readPicture({ ...audio, path: temporary, tools, stats: await stat(temporary) }, front.index)).equals(changes.cover.data)) {
            throw new Error('成品封面校验失败，请重试。')
          }
        }
        await assertOutput(audio, path, format)
      })
    } finally { await source.close() }
    this.output = path
    return path
  }

  outputPath(id: string) {
    this.requireAudio(id)
    return this.output
  }
}
