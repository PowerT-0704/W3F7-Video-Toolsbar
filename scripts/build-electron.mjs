import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

await mkdir('dist-electron', { recursive: true })
for (const entry of ['main', 'preload']) {
  const source = await readFile('electron/' + entry + '.ts', 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  })
  await writeFile('dist-electron/' + entry + '.cjs', result.outputText)
}
