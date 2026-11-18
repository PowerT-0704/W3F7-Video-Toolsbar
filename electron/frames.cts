import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { Asset, VideoDetails, VideoFrame } from '../src/bridge'

interface StoredFrame extends VideoFrame {
  videoId: string
  path: string
}

function decode(executable: string, args: string[], signal: AbortSignal, onFrame: (seconds: number) => void) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-nostats', '-loglevel', 'info', '-nostdin', ...args], {
      windowsHide: true, signal, stdio: ['ignore', 'ignore', 'pipe'],
    })
    const lines = createInterface({ input: child.stderr })
    let failure: Error | undefined
    let diagnostic = ''
    let tick = 0
    lines.on('line', (line) => {
      if (line.startsWith('[Parsed_showinfo')) {
        const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(line)
        if (base) tick = Number(base[1]) / Number(base[2])
        const stamp = /\bn:\s*\d+\s+pts:\s*(-?\d+)/.exec(line)
        if (stamp && tick) onFrame(Number(stamp[1]) * tick)
      } else if (line.trim()) {
        diagnostic = line.trim().slice(0, 350)
      }
    })
    child.once('error', (error) => { failure = error })
    child.once('close', (code) => {
      lines.close()
      if (signal.aborted) reject(signal.reason)
      else if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`无法解码视频帧。${diagnostic ? ' ' + diagnostic : ''}`))
      else resolve()
    })
  })
}

async function readFrame(executable: string, video: Asset, details: VideoDetails, time: number, presented: boolean, path: string, signal: AbortSignal) {
  const tick = Math.max(details.timeBase, 0.000001)
  const read = (seek: number, output: string[], onFrame: (seconds: number) => void) => decode(executable, [
    '-ss', seek.toFixed(6), '-copyts', '-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-i', video.path,
    '-map', '0:V:0', '-an', '-sn', '-dn', '-filter_threads', '1', '-vf', 'showinfo', '-fps_mode', 'passthrough', ...output,
  ], signal, (stamp) => onFrame(stamp - details.startTime))

  async function png(seek: number) {
    let actual: number | undefined
    await read(seek, ['-frames:v', '1', '-c:v', 'png', '-update', '1', '-f', 'image2', path], (stamp) => { actual ??= stamp })
    if (actual === undefined || !(await stat(path).catch(() => null))?.size) return undefined
    return Math.max(0, actual)
  }

  const requested = Math.max(0, Math.min(details.duration, time))
  if (requested < details.duration) {
    const actual = await png(Math.max(0, requested - (presented ? tick / 2 : 0)))
    if (actual !== undefined) return actual
  }

  // Audio can extend beyond the last video frame. Decode only the tail when possible.
  const end = Math.min(details.videoEnd || details.duration, details.duration)
  let last: number | undefined
  for (const seek of new Set([Math.max(0, end - 1), Math.max(0, end - 10), 0])) {
    await read(seek, ['-f', 'null', '-'], (stamp) => { last = stamp })
    if (last !== undefined) break
  }
  if (last !== undefined) {
    await rm(path, { force: true })
    const actual = await png(Math.max(0, last - tick / 2))
    if (actual !== undefined) return actual
  }
  throw new Error('在此视频中找不到可用的帧。')
}

export class FrameStore {
  private directory?: Promise<string>
  private current?: StoredFrame
  private job?: { controller: AbortController; promise: Promise<VideoFrame> }

  async tempPath() {
    this.directory ??= mkdtemp(join(tmpdir(), 'w3f7-video-frames-')).catch((error) => {
      this.directory = undefined
      throw error
    })
    return join(await this.directory, randomUUID() + '.png')
  }

  get(id: string) { return this.current?.id === id ? this.current : undefined }

  cancelPending() { this.job?.controller.abort() }

  reset() {
    this.cancelPending()
    if (this.current) void rm(this.current.path, { force: true }).catch(() => {})
    this.current = undefined
  }

  extract(executable: string, video: Asset, details: VideoDetails, time: number, presented: boolean) {
    const previous = this.job
    previous?.controller.abort()
    const controller = new AbortController()
    const promise = (async () => {
      await previous?.promise.catch(() => {})
      controller.signal.throwIfAborted()
      const path = await this.tempPath()
      try {
        const actual = await readFrame(executable, video, details, time, presented, path, controller.signal)
        controller.signal.throwIfAborted()
        const id = randomUUID()
        const frame = { id, time: actual, preview: 'w3f7-media://frame/' + id }
        if (this.current) void rm(this.current.path, { force: true }).catch(() => {})
        this.current = { ...frame, path, videoId: video.id }
        return frame
      } catch (error) {
        await rm(path, { force: true }).catch(() => {})
        if (controller.signal.aborted) throw new Error('已取消旧的取帧请求。')
        throw error
      }
    })()
    this.job = { controller, promise }
    return promise
  }

  async dispose() {
    this.reset()
    await this.job?.promise.catch(() => {})
    if (this.directory) await rm(await this.directory, { recursive: true, force: true, maxRetries: 3 })
  }
}

export async function streamVideo(request: Request, path: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || !info.size) return new Response(null, { status: 404 })
  const size = info.size
  let start = 0
  let end = size - 1
  const range = request.headers.get('range')
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' })
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!parts || (!parts[1] && !parts[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    if (parts[1]) {
      start = Number(parts[1])
      if (parts[2]) end = Math.min(end, Number(parts[2]))
    } else {
      start = Math.max(0, size - Number(parts[2]))
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path, { start, end })) as unknown as BodyInit
  return new Response(body, { status: range ? 206 : 200, headers })
}
