import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { ToolStatus } from '../src/bridge'
import type { CaptionCue, CaptionOptions, ExternalWhisper, SubtitleStyle, WhisperProgram } from '../src/transcription'
import { decodeSubtitle, displayedText, parseCaptions, serializeCaptions } from './captions.cjs'

export const mediaExtensions = ['aac', 'ac3', 'aiff', 'amr', 'ape', 'au', 'flac', 'm4a', 'mp2', 'mp3', 'mka',
  'oga', 'ogg', 'opus', 'ra', 'wav', 'wma', 'mp4', 'webm', 'ogm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'm4v',
  'ts', 'mpg', 'mpeg', 'vob', 'asf', 'rm', 'rmvb', 'm2ts', 'mts', 'dv', 'gxf', 'tod', 'mxf', 'f4v']
export const subtitleExtensions = ['srt', 'ass', 'vtt', 'json']
const ffInput = ['-protocol_whitelist', 'file,pipe,crypto,data']
const ffStart = ['-hide_banner', '-nostdin', '-v', 'error']

function launch(executable: string, args: string[], signal: AbortSignal, onOutput?: (value: string) => void, cwd?: string) {
  return new Promise<string>((resolveRun, reject) => {
    signal.throwIfAborted()
    const child = spawn(executable, args, { windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'], signal })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (value: string) => {
      if (onOutput) onOutput(value)
      else stdout = (stdout + value).slice(-16_000_000)
    })
    child.stderr.setEncoding('utf8').on('data', (value: string) => {
      stderr = (stderr + value).slice(-32_000)
    })
    let launchError: Error | undefined
    child.on('error', (error) => { launchError = error })
    child.on('close', (code) => {
      if (signal.aborted) { reject(signal.reason); return }
      if (launchError) { reject(launchError); return }
      if (code !== 0) { reject(new Error(basename(executable) + ' 执行失败。' + stderr.trim().split('\n').slice(-3).join(' ').slice(0, 450))); return }
      resolveRun(stdout || stderr)
    })
  })
}

interface ProbeStream {
  index: number
  codec_type: string
  codec_name: string
  start_time?: string
  duration?: string
  width?: number
  height?: number
  channels?: number
  color_transfer?: string
  tags?: { language?: string; rotate?: string }
  disposition?: { attached_pic?: number; default?: number }
  side_data_list?: Array<{ rotation?: number }>
}

export async function probeMedia(tools: ToolStatus, path: string, signal: AbortSignal) {
  const data = JSON.parse(await launch(tools.ffprobe, ['-v', 'error', ...ffInput, '-show_streams', '-show_format', '-of', 'json', '-i', path],
    AbortSignal.any([signal, AbortSignal.timeout(30_000)]))) as {
      streams?: ProbeStream[]
      format?: { duration?: string; start_time?: string }
    }
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic && stream.width && stream.height)
  const audio = streams.filter((stream) => stream.codec_type === 'audio')
  if (!video && !audio.length) throw new Error('该文件没有可用的音视频轨。')
  const durations = [data.format?.duration, ...streams.map((stream) => stream.duration)].map(Number).filter(Number.isFinite)
  const duration = Math.round(1000 * Math.max(0, ...durations))
  const origin = Math.round(1000 * (Number(data.format?.start_time) || 0))
  const rotate = video?.side_data_list?.find((value) => Number.isFinite(value.rotation))?.rotation ?? Number(video?.tags?.rotate || 0)
  const rotated = Math.abs(Math.round(rotate)) % 180 === 90
  const width = (rotated ? video?.height : video?.width) ?? 1920
  const height = (rotated ? video?.width : video?.height) ?? 1080
  return { duration, origin, width, height, video, audio, streams }
}

export type MediaInfo = Awaited<ReturnType<typeof probeMedia>>

export async function readSubtitle(path: string) {
  const file = await stat(path)
  if (file.size > 48 * 1024 ** 2) throw new Error('字幕文件超过 48 MiB。')
  const cues = parseCaptions(decodeSubtitle(await readFile(path)), extname(path).slice(1).toLowerCase())
  if (!cues.length) throw new Error('字幕文件中没有可读取的时间片段。')
  return cues
}

function ffProgress(executable: string, args: string[], duration: number, signal: AbortSignal,
  progress?: (percent: number) => void, cwd?: string) {
  let tail = ''
  return launch(executable, [...ffStart, '-progress', 'pipe:1', '-y', ...args], signal, (value) => {
    tail += value
    const lines = tail.split(/\r?\n/)
    tail = lines.pop() || ''
    for (const line of lines) {
      const time = /^out_time_us=(\d+)$/.exec(line)
      if (time && duration) progress?.(Math.min(99, Math.floor(Number(time[1]) / (duration * 10))))
    }
  }, cwd)
}

export function extractAudio(tools: ToolStatus, source: string, track: number, output: string,
  duration: number, signal: AbortSignal, progress: (value: number) => void) {
  return ffProgress(tools.ffmpeg, [...ffInput, '-i', source, '-map', '0:' + track, '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'pcm_s16le', '-rf64', 'auto', output], duration, signal, progress)
}

export function chunkPlan(duration: number, minutes: number, overlap = 10_000) {
  const span = minutes * 60_000
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(span) || span <= overlap || overlap < 0) {
    throw new Error('无法确定音频时长或分块范围。')
  }
  const chunks: Array<{ start: number; end: number }> = []
  for (let start = 0; start < duration; start += span - overlap) {
    const end = Math.min(duration, start + span)
    chunks.push({ start, end })
    if (end === duration) break
  }
  return chunks
}

export function renderAudioChunk(tools: ToolStatus, input: string, output: string, start: number, end: number,
  local: boolean, signal: AbortSignal) {
  const format = local ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '48k']
  return launch(tools.ffmpeg, [...ffStart, '-y', '-ss', (start / 1000).toFixed(3), ...ffInput, '-i', input,
    '-t', ((end - start) / 1000).toFixed(3), '-map', '0:a:0', ...format, output], signal)
}

async function programHelp(program: WhisperProgram, signal: AbortSignal) {
  const executable = await stat(program.executable).catch(() => null)
  if (!executable?.isFile() || extname(program.executable).toLowerCase() !== '.exe') throw new Error('请选择可用的 Whisper EXE。')
  const model = await stat(program.model).catch(() => null)
  if (!model?.isFile() && !model?.isDirectory()) throw new Error('请选择已下载的 Whisper 模型。')
  return launch(program.executable, ['--help'], AbortSignal.any([signal, AbortSignal.timeout(15_000)]), undefined, dirname(program.executable))
}

export function whisperArguments(engine: ExternalWhisper, help: string, program: WhisperProgram, input: string,
  directory: string, language: string, wantsWords: boolean) {
  if (engine === 'whisper-cpp') {
    if (!help.includes('--output-srt') || !help.includes('--output-file')) throw new Error('该 whisper.cpp 缺少 SRT 和输出路径参数。')
    const args = ['-m', program.model, '-f', input, '-l', language, '--output-srt', '--output-file', join(directory, 'result')]
    if (program.device === 'cpu' && help.includes('--no-gpu')) args.push('--no-gpu')
    if (program.prompt && help.includes('--prompt')) args.push('--prompt', program.prompt)
    if (program.vad && help.includes('--vad-model') && program.vadModel) {
      args.push('--vad', '--vad-model', program.vadModel)
      if (help.includes('--vad-threshold')) args.push('--vad-threshold', String(program.vadThreshold))
    }
    return { args, words: false }
  }
  if (!help.includes('--output_format') || !help.includes('--model')) throw new Error('该 Faster Whisper CLI 缺少模型或 SRT 输出参数。')
  const args = [input, '-m', program.model, '-o', directory, '--output_format', 'srt']
  if (help.includes('--device')) args.push('--device', program.device)
  if (language !== 'auto') args.push('-l', language)
  if (help.includes('--vad_filter')) args.push('--vad_filter', String(program.vad))
  if (program.vad && help.includes('--vad_threshold')) args.push('--vad_threshold', String(program.vadThreshold))
  if (program.vad && program.vadMethod && help.includes('--vad_method')) args.push('--vad_method', program.vadMethod)
  if (program.prompt && help.includes('--initial_prompt')) args.push('--initial_prompt', program.prompt)
  if (program.separateVoice && help.includes('--ff_mdx_kim2')) args.push('--ff_mdx_kim2')
  const words = wantsWords && help.includes('--one_word')
  if (words) args.push('--one_word', '1')
  if (help.includes('--beep_off')) args.push('--beep_off')
  return { args, words }
}

export async function inspectWhisper(engine: ExternalWhisper, program: WhisperProgram, signal: AbortSignal) {
  if (engine === 'whisper-cpp' && !(await stat(program.model).catch(() => null))?.isFile()) throw new Error('请选择已下载的 whisper.cpp 模型文件。')
  const help = await programHelp(program, signal)
  const { words } = whisperArguments(engine, help, program, 'sample.wav', '.', 'auto', true)
  const vad = engine === 'whisper-cpp' ? help.includes('--vad-model') : help.includes('--vad_filter')
  return { help, words, vad, prompt: /--(?:initial_)?prompt/.test(help), device: /--device|--no-gpu/.test(help),
    separateVoice: help.includes('--ff_mdx_kim2'), vadMethod: help.includes('--vad_method') }
}

export async function localWhisper(engine: ExternalWhisper, program: WhisperProgram, help: string, input: string,
  directory: string, language: string, words: boolean, signal: AbortSignal) {
  const argumentsForProgram = whisperArguments(engine, help, program, input, directory, language, words)
  await launch(program.executable, argumentsForProgram.args, signal, undefined, dirname(program.executable))
  const filename = (await readdir(directory)).find((name) => name.toLowerCase().endsWith('.srt'))
  if (!filename) throw new Error('Whisper 未生成 SRT，请检查程序和模型的兼容性。')
  const raw = decodeSubtitle(await readFile(join(directory, filename)))
  const captions = parseCaptions(raw, 'srt').filter((line) => !/^[[(（【][^\])）】]*[\])）】]$/u.test(line.text.trim()))
  return argumentsForProgram.words ? captions.map((line) => ({ ...line, timing: 'word' as const })) : captions
}

export function makePreview(tools: ToolStatus, source: string, media: MediaInfo, output: string, signal: AbortSignal) {
  const mapping = media.video
    ? ['-map', '0:' + media.video.index, '-map', '0:a:0?', '-vf', 'scale=-2:min(480\\,ih)', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
    : ['-map', '0:a:0', '-vn']
  return launch(tools.ffmpeg, [...ffStart, '-y', ...ffInput, '-i', source, ...mapping, '-c:a', 'aac', '-movflags', '+faststart', output], signal)
}

export interface OverlayInput {
  states: string[][]
  width: number
  height: number
  style: SubtitleStyle
}
export type RenderOverlay = (input: OverlayInput, emit: (index: number, png: Uint8Array) => Promise<void>, signal: AbortSignal) => Promise<void>

async function prepareOverlay(cues: CaptionCue[], media: MediaInfo, options: CaptionOptions, directory: string,
  render: RenderOverlay, signal: AbortSignal) {
  const events = new Map<number, { enter: number[]; leave: number[] }>()
  const event = (time: number) => {
    if (!events.has(time)) events.set(time, { enter: [], leave: [] })
    return events.get(time)!
  }
  event(0)
  event(media.duration)
  for (const [index, line] of cues.entries()) {
    if (line.start >= media.duration || line.end <= 0) continue
    event(Math.max(0, line.start)).enter.push(index)
    event(Math.min(media.duration, line.end)).leave.push(index)
  }
  const times = [...events.keys()].sort((a, b) => a - b)
  const texts: string[][] = [[]]
  const states = new Map<string, number>([['[]', 0]])
  const active = new Set<number>()
  const frames: { state: number; duration: number }[] = []
  for (let index = 0; index < times.length - 1; index++) {
    const change = events.get(times[index])!
    for (const line of change.leave) active.delete(line)
    for (const line of change.enter) active.add(line)
    const lines = [...active].sort((a, b) => a - b).flatMap((line) => displayedText(cues[line], options.layout).split('\n'))
    const key = JSON.stringify(lines)
    if (!states.has(key)) { states.set(key, texts.length); texts.push(lines) }
    const state = states.get(key)!
    const duration = times[index + 1] - times[index]
    if (frames.at(-1)?.state === state) frames.at(-1)!.duration += duration
    else frames.push({ state, duration })
  }
  if (!frames.length) throw new Error('无可合成的字幕时段。')
  const width = Math.max(2, Math.floor(media.width / 2) * 2)
  const height = Math.max(2, Math.floor(media.height / 2) * 2)
  await render({ states: texts, width, height, style: options.style }, (index, bytes) =>
    writeFile(join(directory, 'overlay-' + index + '.png'), bytes), signal)
  const concat = ['ffconcat version 1.0', ...frames.flatMap(({ state, duration }) =>
    ['file overlay-' + state + '.png', 'option framerate 1000', 'duration ' + (duration / 1000).toFixed(3)]),
  'file overlay-0.png', 'option framerate 1000'].join('\n') + '\n'
  await writeFile(join(directory, 'overlay.ffconcat'), concat)
}

export async function synthesize(tools: ToolStatus, source: string, media: MediaInfo, cues: CaptionCue[],
  options: CaptionOptions, directory: string, output: string, render: RenderOverlay, signal: AbortSignal,
  progress: (percent: number) => void) {
  if (!media.video || !media.duration) throw new Error('需要可用的视频轨和时长才能合成。')
  const timed = cues.filter((line) => line.start < media.duration).map((line) => ({ ...line, end: Math.min(media.duration, line.end) }))
  if (!timed.length) throw new Error('视频时长范围内没有可以合成的字幕。')
  const args = [...ffInput, '-i', source]
  const soft = options.synthesis === 'soft'
  if (soft) {
    await writeFile(join(directory, 'captions.srt'), serializeCaptions(timed, 'srt', options.layout))
    const subtitleCount = media.streams.filter((stream) => stream.codec_type === 'subtitle').length
    args.push('-i', 'captions.srt', '-map', '0', '-map', '1:s:0', '-map_metadata', '0', '-map_chapters', '0',
      '-c', 'copy', '-c:s:' + subtitleCount, options.container === 'mp4' ? 'mov_text' : 'srt',
      '-metadata:s:s:' + subtitleCount, 'title=W3F7 字幕')
  } else {
    if (['smpte2084', 'arib-std-b67'].includes(media.video.color_transfer || '')) throw new Error('HDR 视频请使用软字幕，以保留原画面的 HDR 信息。')
    if (options.synthesis === 'rounded') {
      await prepareOverlay(timed, media, options, directory, render, signal)
      args.push('-f', 'concat', '-safe', '0', '-i', 'overlay.ffconcat', '-filter_complex_threads', '1',
        '-filter_complex', '[0:' + media.video.index + '][1:v]overlay=eof_action=pass:repeatlast=0[captioned]', '-map', '[captioned]')
    } else {
      await writeFile(join(directory, 'captions.ass'), serializeCaptions(timed, 'ass', options.layout, options.style, media))
      let filter = 'ass=captions.ass'
      if (options.style.fontFile) {
        const suffix = extname(options.style.fontFile).toLowerCase()
        const fonts = join(directory, 'fonts')
        await mkdir(fonts, { recursive: true })
        await copyFile(options.style.fontFile, join(fonts, 'font' + suffix))
        filter += ':fontsdir=fonts'
      }
      args.push('-map', '0:' + media.video.index, '-vf', filter)
    }
    args.push('-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0', '-fps_mode', 'passthrough',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(options.quality),
      '-preset', options.quality === 18 ? 'slow' : options.quality === 32 ? 'fast' : 'medium', '-c:a', 'copy')
  }
  if (options.container === 'mp4') args.push('-movflags', '+faststart')
  try { await ffProgress(tools.ffmpeg, [...args, output], media.duration, signal, progress, directory) }
  catch (error) {
    signal.throwIfAborted()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error('视频合成失败。请检查轨道兼容性、FFmpeg 编码器或改用 MKV。' + message)
  }
  const saved = await probeMedia(tools, output, signal)
  const tracks = saved.streams.filter((stream) => stream.codec_type === 'subtitle')
  if (!saved.video || saved.audio.length !== media.audio.length ||
      (soft && tracks.length !== 1 + media.streams.filter((stream) => stream.codec_type === 'subtitle').length) ||
      Math.abs(saved.duration - media.duration) > Math.max(350, media.duration * 0.005)) throw new Error('成品视频的轨道或时长校验失败。')
}

export async function allocateOutput(directory: string, name: string, extension: string) {
  const targetDirectory = resolve(directory)
  const info = await stat(targetDirectory).catch(() => null)
  if (!info?.isDirectory()) throw new Error('输出目录不存在或无法访问。')
  const temporary = join(targetDirectory, '.w3f7-' + randomUUID() + '.partial.' + extension)
  return {
    temporary,
    async commit(signal?: AbortSignal) {
      signal?.throwIfAborted()
      for (let index = 1; index < 10000; index++) {
        const output = join(targetDirectory, name + (index === 1 ? '' : '_' + index) + '.' + extension)
        try {
          try { await link(temporary, output) }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (!code || !['EXDEV', 'EPERM', 'ENOTSUP', 'ENOSYS', 'EINVAL', 'UNKNOWN'].includes(code)) throw error
            await copyFile(temporary, output, constants.COPYFILE_EXCL)
          }
          return output
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      throw new Error('同名成品过多，请选择其他输出目录。')
    },
    cleanup: () => rm(temporary, { force: true }),
  }
}
