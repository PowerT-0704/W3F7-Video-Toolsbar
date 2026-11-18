import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { constants, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { MediaCacheStatus } from '../src/bridge'

const marker = '.w3f7-owner'
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const sessionName = new RegExp(`^session-${uuid}$`)
const imageName = new RegExp(`^${uuid}\\.png$`)

interface CacheFile { path: string; bytes: number }
interface CacheSession { path: string; files: CacheFile[] }

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function contains(parent: string, child: string) {
  const part = relative(parent, child)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../'))
}

export class MediaCache {
  private readonly owner: string
  private root = ''
  private session?: string
  private warning = ''
  private readonly removals = new Set<Promise<void>>()

  constructor(profile: string) {
    this.owner = createHash('sha256').update(profile.toLowerCase()).digest('hex').slice(0, 24)
  }

  private pathUnder(parent: string) { return join(parent, 'W3F7-Video-Toolsbar-cache', this.owner) }

  private async owns(path: string) {
    const stamp = join(path, marker)
    const folder = await lstat(path).catch(() => null)
    const file = folder?.isDirectory() && await lstat(stamp).catch(() => null)
    return Boolean(file && file.isFile() && file.nlink === 1 && file.size === this.owner.length &&
      await readFile(stamp, 'utf8') === this.owner && await realpath(path) === path)
  }

  private async prepare(parent: string) {
    const base = await realpath(parent || tmpdir())
    const root = this.pathUnder(base)
    if (this.root && root !== this.root && (contains(this.root, root) || contains(root, this.root))) {
      throw new Error('请选择缓存目录之外的位置。')
    }
    const container = join(base, 'W3F7-Video-Toolsbar-cache')
    await mkdir(container, { recursive: true })
    if (await realpath(container) !== container) throw new Error('缓存目录不能是链接或目录联接。')
    const created = await mkdir(root).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      return false
    })
    if (created) await writeFile(join(root, marker), this.owner, { flag: 'wx' })
    if (!await this.owns(root)) throw new Error('此缓存目录的归属无法确认，请选择其他位置。')
    await rmdir(await mkdtemp(join(root, '.write-test-')))
    return root
  }

  async initialize(directory: string) {
    try { this.root = await this.prepare(directory) }
    catch {
      if (directory) this.warning = '已配置的缓存位置暂不可用，本次使用系统临时目录。'
      try { this.root = await this.prepare('') }
      catch { this.warning = '系统临时目录也无法写入。请在此选择可用的缓存位置。' }
    }
  }

  private async newSession(root: string) {
    const path = join(root, 'session-' + randomUUID())
    await mkdir(path)
    await writeFile(join(path, marker), this.owner, { flag: 'wx' })
    return path
  }

  async tempPath() {
    if (!this.root || !await this.owns(this.root)) throw new Error('媒体缓存位置不可用，请在设置中选择可写的文件夹。')
    this.session ??= await this.newSession(this.root)
    if (!await this.owns(this.session)) throw new Error('当前媒体缓存文件夹不可用。')
    return join(this.session, randomUUID() + '.png')
  }

  remove(path: string) {
    const removal = rm(path, { force: true }).catch(() => {})
    this.removals.add(removal)
    void removal.then(() => this.removals.delete(removal))
  }

  async waitForRemovals() { await Promise.all(this.removals) }

  private async files(path: string) {
    const files: CacheFile[] = []
    for (const name of await readdir(path)) {
      if (!imageName.test(name)) continue
      const file = join(path, name)
      const info = await lstat(file).catch(() => null)
      if (info?.isFile() && info.nlink === 1) files.push({ path: file, bytes: info.size })
    }
    return files
  }

  private async sessions() {
    const sessions: CacheSession[] = []
    if (!this.root) return sessions
    if (!await this.owns(this.root)) throw new Error('媒体缓存位置不可用，请在设置中选择可写的文件夹。')
    for (const name of await readdir(this.root)) {
      if (!sessionName.test(name)) continue
      const path = join(this.root, name)
      if (await this.owns(path)) sessions.push({ path, files: await this.files(path) })
    }
    return sessions
  }

  async status(active: ReadonlySet<string>): Promise<MediaCacheStatus> {
    let bytes = 0
    let activeBytes = 0
    let warning = this.warning
    try {
      for (const session of await this.sessions()) {
        for (const file of session.files) {
          bytes += file.bytes
          if (active.has(file.path)) activeBytes += file.bytes
        }
      }
    } catch (error) { warning = (error as Error).message }
    return { directory: this.root || this.pathUnder(tmpdir()), bytes, activeBytes, warning }
  }

  async openPath() {
    if (!this.root || !await this.owns(this.root)) throw new Error('媒体缓存目录当前不可用。')
    return this.root
  }

  private async removeEmptySession(path: string) {
    if (!await this.owns(path)) return
    const entries = await readdir(path)
    if (entries.length !== 1 || entries[0] !== marker) return
    await rm(join(path, marker))
    await rmdir(path)
  }

  private async removeFiles(session: CacheSession, preserve: ReadonlySet<string>) {
    let released = 0
    let incomplete = false
    if (!await this.owns(session.path)) return { released, incomplete: true }
    for (const file of session.files) {
      if (preserve.has(file.path)) continue
      try {
        await rm(file.path)
        released += file.bytes
      } catch { incomplete = true }
    }
    if (session.path !== this.session) await this.removeEmptySession(session.path).catch(() => { incomplete = true })
    return { released, incomplete }
  }

  async clear(active: ReadonlySet<string>) {
    let released = 0
    let incomplete = false
    for (const session of await this.sessions()) {
      const result = await this.removeFiles(session, active)
      released += result.released
      incomplete ||= result.incomplete
    }
    return { released, incomplete }
  }

  async migrate(directory: string, active: ReadonlySet<string>, persist: () => Promise<unknown>, rebind: (paths: ReadonlyMap<string, string>) => void) {
    const root = await this.prepare(directory)
    if (root === this.root) {
      await persist()
      this.warning = ''
      return { moved: 0, incomplete: false }
    }
    // A disconnected old location can only be abandoned when no live media references it.
    const old = this.root && await this.owns(this.root) ? await this.sessions() : []
    const copies: CacheSession[] = []
    const paths = new Map<string, string>()
    let nextSession: string | undefined
    let moved = 0
    try {
      for (const session of old) {
        if (!session.files.length) continue
        const path = await this.newSession(root)
        const copy: CacheSession = { path, files: [] }
        copies.push(copy)
        if (session.path === this.session) nextSession = path
        for (const file of session.files) {
          const destination = join(path, basename(file.path))
          copy.files.push({ path: destination, bytes: file.bytes })
          await copyFile(file.path, destination, constants.COPYFILE_EXCL)
          if (await digest(file.path) !== await digest(destination)) throw new Error('缓存复制后的校验失败。')
          paths.set(file.path, destination)
          moved += file.bytes
        }
      }
      if ([...active].some((path) => !paths.has(path))) throw new Error('当前帧或封面无法读取，无法迁移。')
      await persist()
    } catch (error) {
      await Promise.allSettled(copies.map((session) => this.removeFiles(session, new Set())))
      throw error
    }
    this.root = root
    this.session = nextSession
    this.warning = ''
    rebind(paths)
    let incomplete = false
    for (const session of old) {
      const result = await this.removeFiles(session, new Set()).catch(() => ({ incomplete: true }))
      incomplete ||= result.incomplete
    }
    return { moved, incomplete }
  }

  async dispose() {
    const path = this.session
    this.session = undefined
    if (path && await this.owns(path)) await this.removeFiles({ path, files: await this.files(path) }, new Set())
  }
}
