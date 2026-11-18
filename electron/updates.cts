import type { UpdateResult } from '../src/bridge'

const repository = 'PowerT-0704/W3F7-Video-Toolsbar'
const endpoint = `https://api.github.com/repos/${repository}/releases/latest`
const tagPattern = /^v(\d+)\.(\d+)\.(\d+)$/
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?$/

export function compareLatest(current: string, release: unknown): UpdateResult {
  if (!release || typeof release !== 'object' || !('tag_name' in release) ||
      typeof release.tag_name !== 'string' || !('draft' in release) || release.draft !== false ||
      !('prerelease' in release) || release.prerelease !== false) throw new Error('无效的正式版本信息')
  const latest = tagPattern.exec(release.tag_name)
  const local = versionPattern.exec(current)
  if (!latest || !local) throw new Error('无法识别版本号')
  for (let index = 1; index <= 3; index++) {
    const difference = Number(latest[index]) - Number(local[index])
    if (difference > 0) return { kind: 'available', version: release.tag_name }
    if (difference < 0) return { kind: 'current' }
  }
  return local[4] ? { kind: 'available', version: release.tag_name } : { kind: 'current' }
}

export function releasePage(tag: string) {
  if (!tagPattern.test(tag)) throw new Error('无效的正式版本号')
  return `https://github.com/${repository}/releases/tag/${tag}`
}

export function createUpdateChecker(current: string, request: (url: string, options: RequestInit) => Promise<Response>) {
  let pending: Promise<UpdateResult> | undefined
  let available: string | undefined
  async function check(): Promise<UpdateResult> {
    const response = await request(endpoint, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      credentials: 'omit',
    })
    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        return { kind: 'error', message: 'GitHub 暂时限制了检查请求，请稍后重试。' }
      }
      throw new Error('无法读取 GitHub 正式版本')
    }
    const result = compareLatest(current, await response.json())
    available = result.kind === 'available' ? result.version : undefined
    return result
  }
  return {
    check() {
      pending ??= check().catch((): UpdateResult => ({
        kind: 'error', message: '暂时无法检查更新，请检查网络后重试。',
      })).finally(() => { pending = undefined })
      return pending
    },
    page() { return available ? releasePage(available) : undefined },
  }
}
