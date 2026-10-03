#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [version, archiveArgument, outputArgument = 'apps/desktop/release/flatpak'] =
  process.argv.slice(2)
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error('Supply a release version, for example 0.3.0.')
if (!archiveArgument) throw new Error('Supply the packaged Linux x64 archive.')
const archive = resolve(archiveArgument)
const filename = `Inlark-${version}-x64.tar.gz`
if (basename(archive) !== filename) throw new Error(`Expected archive named ${filename}.`)
const date = process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date)
  throw new Error('RELEASE_DATE must be a valid ISO date.')
const hash = createHash('sha256')
for await (const chunk of createReadStream(archive)) hash.update(chunk)
const sha256 = hash.digest('hex')
const template = join(root, 'apps/desktop/packaging/flatpak')
const output = resolve(outputArgument)

// The published manifest uses immutable release URLs. The CI/local variant uses
// the same archive before GitHub has published it, with the same checksum.
for (const variant of ['flathub', 'local']) {
  const directory = join(output, variant)
  await mkdir(directory, { recursive: true })
  const manifest = JSON.parse(
    await readFile(join(template, 'com.inlark.Inlark.template.json'), 'utf8'),
  )
  const source = {
    type: 'archive',
    ...(variant === 'flathub'
      ? { url: `https://github.com/inlark/inlark/releases/download/v${version}/${filename}` }
      : { path: relative(directory, archive) }),
    sha256,
    dest: 'inlark',
    'only-arches': ['x86_64'],
  }
  manifest.modules[0].sources.unshift(source)
  await writeFile(
    join(directory, 'com.inlark.Inlark.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  const metadata = (await readFile(join(template, 'com.inlark.Inlark.metainfo.xml'), 'utf8'))
    .replaceAll('@VERSION@', version)
    .replaceAll('@DATE@', date)
  await writeFile(join(directory, 'com.inlark.Inlark.metainfo.xml'), metadata)
  for (const name of ['com.inlark.Inlark.desktop', 'inlark.sh', 'flathub.json'])
    await copyFile(join(template, name), join(directory, name))
  await copyFile(
    join(root, 'apps/desktop/resources/icon.png'),
    join(directory, 'com.inlark.Inlark.png'),
  )
}
console.log(`Prepared Flatpak manifests for ${version} (${sha256}).`)
