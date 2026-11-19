#!/usr/bin/env node
/**
 * 本地补丁：允许机器名使用中文（非 ASCII）
 *
 * 问题：peer-sync 把本机名塞进 HTTP 头 `x-peer-name`。HTTP 头按规范只能是
 * Latin-1，名字里一旦有中文，发出的每个请求都会抛
 *   TypeError: Cannot convert argument to a ByteString ...
 * 表现是「对端不可达」，而且同步、派活、取结果全都断——不是网络问题。
 *
 * 改法：发送端 encodeURIComponent，接收端 decodeURIComponent（解码失败就
 * 用原值，不因为一个坏头把整个请求打回）。
 *
 * 幂等：已打过就跳过。两个文件都要在。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '// local-patch: peer-sync utf8 peer name v1'
const base =
  process.argv[2] || path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-peer-sync')

const syncFile = path.join(base, 'lib', 'sync.js')
const httpFile = path.join(base, 'lib', 'http.js')

for (const file of [syncFile, httpFile]) {
  if (!fs.existsSync(file)) {
    console.error('找不到文件：' + file)
    process.exit(2)
  }
}

const edits = [
  {
    file: syncFile,
    name: '发送端：名字进 header 前编码',
    from: `          'x-peer-name': this.config.self,`,
    to: `          // ${MARK}
          'x-peer-name': encodeURIComponent(this.config.self || ''),`,
  },
  {
    file: httpFile,
    name: '接收端：解码，失败时回退原值',
    from: `        const peer = typeof req.headers['x-peer-name'] === 'string' ? req.headers['x-peer-name'] : undefined`,
    to: `        // ${MARK}
        const rawPeerName = typeof req.headers['x-peer-name'] === 'string' ? req.headers['x-peer-name'] : undefined
        let peer = rawPeerName
        if (typeof rawPeerName === 'string' && rawPeerName.length > 0) {
          try {
            peer = decodeURIComponent(rawPeerName)
          } catch {
            peer = rawPeerName
          }
        }`,
  },
]

for (const edit of edits) {
  const src = fs.readFileSync(edit.file, 'utf8')
  if (src.includes(MARK)) {
    console.log(`已打过补丁，跳过：${path.basename(edit.file)}`)
    continue
  }
  const hits = src.split(edit.from).length - 1
  if (hits !== 1) {
    console.error(`中止：${edit.name} 命中 ${hits} 次（应为 1 次），未写入 ${edit.file}`)
    process.exit(3)
  }
  const next = src.replace(edit.from, edit.to)

  const probe = path.join(os.tmpdir(), `peer-sync-utf8-${process.pid}.mjs`)
  fs.writeFileSync(probe, next)
  try {
    execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
  } catch (error) {
    fs.rmSync(probe, { force: true })
    console.error('中止：语法检查未通过，未写入。\n' + String((error && error.stderr) || error))
    process.exit(4)
  }
  fs.rmSync(probe, { force: true })

  const backup = edit.file + '.orig-utf8name'
  if (!fs.existsSync(backup)) fs.copyFileSync(edit.file, backup)
  fs.writeFileSync(edit.file, next)
  console.log(`✓ ${edit.name} → ${path.basename(edit.file)}`)
}

console.log('完成。需要重启 DSH 才生效。')
