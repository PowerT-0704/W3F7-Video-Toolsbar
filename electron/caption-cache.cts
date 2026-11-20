import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { CaptionCacheStatus } from '../src/transcription'
import { writeCaptionData } from './caption-settings.cjs'

const sessionName = /^session-[a-z\d]{6}$/i
const resultName = /^[a-f\d]{64}\.json(?:\.[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.tmp)?$/
const ownerFile = '.w3f7-owner'
const day = 86_400_000

function inside(parent: string, path: string) {
  const difference = relative(parent, path)
  return !isAbsolute(difference) && difference !== '..' && !difference.startsWith('..' + sep)
}

async function physicalDirectory(path: string) {
  const info = await lstat(path)
  if (!info.isDirectory() || relative(path, await realpath(path)) !== '') {
    throw new Error('转录缓存目录不能是链接或目录联接。')
  }
  return path
}

export class CaptionCache {
  private readonly owner: string
  private readonly stateFile: string
  private readonly sessions = new Map<string, Promise<string>>()
  private readonly history = new Set<string>()
  private selected = ''
  private root = ''
  private warning = ''
  private loaded?: Promise<void>

  constructor(private readonly profile: string) {
    this.owner = createHash('sha256').update(profile.toLowerCase()).digest('hex').slice(0, 24)
    this.stateFile = join(profile, 'transcription', 'cache-location.json')
  }

  private async prepare(parent: string, create: boolean) {
    await mkdir(this.profile, { recursive: true })
    const base = await realpath(parent || this.profile)
    const container = join(base, parent ? 'W3F7-Video-Toolsbar-transcription' : 'transcription')
    if (create) await mkdir(container, { recursive: true })
    await physicalDirectory(container)
    if (!parent) return container

    const root = join(container, this.owner)
    const marker = join(root, ownerFile)
    if (create) {
      const created = await mkdir(root).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        return false
      })
      if (created) await writeFile(marker, this.owner, { flag: 'wx' })
    }
    await physicalDirectory(root)
    const stamp = await lstat(marker)
    if (!stamp.isFile() || stamp.nlink !== 1 || stamp.size !== this.owner.length || await readFile(marker, 'utf8') !== this.owner) {
      throw new Error('此转录缓存目录的归属无法确认。')
    }
    return root
  }

  private async writable(parent: string) {
    const root = await this.prepare(parent, true)
    const test = await mkdtemp(join(root, '.write-test-'))
    await rmdir(test)
    return root
  }

  load() {
    return this.loaded ??= (async () => {
      try {
        const saved = JSON.parse(await readFile(this.stateFile, 'utf8'))
        this.selected = typeof saved.directory === 'string' && isAbsolute(saved.directory) ? saved.directory : ''
        if (Array.isArray(saved.history)) {
          for (const path of saved.history) if (typeof path === 'string' && isAbsolute(path)) this.history.add(path)
        }
      } catch { /* Default cache location for older profiles. */ }
      try { this.root = await this.writable(this.selected) }
      catch {
        this.warning = '已选的转录缓存位置暂不可用，本次使用默认位置。'
        try { this.root = await this.writable('') }
        catch { this.warning = '默认转录缓存不可写，请选择可用的文件夹。' }
      }
    })()
  }

  async change(parent: string) {
    await this.load()
    const selected = parent ? await realpath(parent) : ''
    if (selected) {
      const known = new Set(['', this.selected, ...this.history])
      for (const location of known) {
        const root = await this.prepare(location, false).catch(() => '')
        if (root && inside(root, selected)) throw new Error('请选择转录缓存目录之外的位置。')
      }
    }
    const root = await this.writable(selected)
    const previous = new Set(this.history)
    if (this.selected && this.selected !== selected) previous.add(this.selected)
    previous.delete(selected)
    await this.prepare('', true)
    await writeCaptionData(this.stateFile, { directory: selected, history: [...previous] })
    this.history.clear()
    for (const path of previous) this.history.add(path)
    this.selected = selected
    this.root = root
    this.warning = ''
  }

  private async activeRoot() {
    await this.load()
    if (!this.root) throw new Error('转录缓存不可写，请在设置里选择可用的文件夹。')
    const parent = this.warning ? '' : this.selected
    return this.prepare(parent, false)
  }

  async recognitionDirectory() {
    const directory = join(await this.activeRoot(), 'asr')
    await mkdir(directory, { recursive: true })
    return physicalDirectory(directory)
  }

  async session() {
    const root = await this.activeRoot()
    let session = this.sessions.get(root)
    if (!session) {
      session = (async () => {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) {
          const path = join(root, entry.name)
          if (!entry.isDirectory() || !sessionName.test(entry.name)) continue
          const info = await lstat(path).catch(() => undefined)
          if (info && Date.now() - info.mtimeMs >= day) await this.scanFolder(path, () => false, true, true).catch(() => undefined)
        }
        return mkdtemp(join(root, 'session-'))
      })()
      this.sessions.set(root, session)
      void session.catch(() => { if (this.sessions.get(root) === session) this.sessions.delete(root) })
    }
    return session
  }

  async removeScratch(path: string, parent: string, prefix: string) {
    const target = await realpath(path).catch(() => '')
    const root = await realpath(parent).catch(() => '')
    if (target && root && relative(path, target) === '' && relative(parent, root) === '' &&
        dirname(target) === root && basename(target).startsWith(prefix)) {
      await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 60 }).catch(() => undefined)
    }
  }

  async dispose() {
    const sessions = await Promise.allSettled(this.sessions.values())
    for (const result of sessions) {
      if (result.status === 'fulfilled') await this.removeScratch(result.value, dirname(result.value), 'session-')
    }
    this.sessions.clear()
  }

  private async scanFolder(path: string, keep: (file: string) => boolean, remove: boolean, recurse: boolean) {
    await physicalDirectory(path)
    const result = { bytes: 0, activeBytes: 0, released: 0, incomplete: false }
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      try {
        const info = await lstat(file)
        if (recurse && info.isDirectory()) {
          const child = await this.scanFolder(file, keep, remove, true)
          result.bytes += child.bytes
          result.activeBytes += child.activeBytes
          result.released += child.released
          result.incomplete ||= child.incomplete
        } else if (info.isFile() && info.nlink === 1 && (recurse || resultName.test(entry.name))) {
          result.bytes += info.size
          if (keep(file)) result.activeBytes += info.size
          else if (remove) {
            await rm(file)
            result.released += info.size
          }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.incomplete = true }
    }
    if (remove && recurse) await rmdir(path).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOTEMPTY', 'ENOENT'].includes(error.code || '')) result.incomplete = true
    })
    return result
  }

  private async scan(proxies: Set<string>, working: boolean, remove: boolean) {
    await this.load()
    const result = { bytes: 0, activeBytes: 0, released: 0, incomplete: false }
    const seen = new Set<string>()
    const active = new Set((await Promise.allSettled(this.sessions.values())).flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []))
    for (const parent of new Set(['', this.selected, ...this.history])) {
      try {
        const root = await this.prepare(parent, false)
        if (seen.has(root)) continue
        seen.add(root)
        for (const entry of await readdir(root, { withFileTypes: true })) {
          const session = sessionName.test(entry.name)
          if (!entry.isDirectory() || !session && entry.name !== 'asr') continue
          const path = join(root, entry.name)
          const inUse = working && (entry.name === 'asr' || active.has(path))
          const detail = await this.scanFolder(path, (file) => inUse || proxies.has(file), remove, session)
          result.bytes += detail.bytes
          result.activeBytes += detail.activeBytes
          result.released += detail.released
          result.incomplete ||= detail.incomplete
          // An empty current session may have been removed. Recreate it on demand.
          if (remove && session && active.has(path) && !await lstat(path).catch(() => undefined)) this.sessions.delete(root)
        }
      } catch (error) {
        if (parent || (error as NodeJS.ErrnoException).code !== 'ENOENT') result.incomplete = true
      }
    }
    return result
  }

  async status(proxies: Set<string>, working: boolean): Promise<CaptionCacheStatus> {
    const { bytes, activeBytes } = await this.scan(proxies, working, false)
    return { directory: this.root || join(this.profile, 'transcription'), custom: Boolean(this.selected),
      bytes, activeBytes, warning: this.warning || undefined }
  }

  async clear(proxies: Set<string>) {
    const { released, incomplete } = await this.scan(proxies, false, true)
    return { released, incomplete }
  }
}
