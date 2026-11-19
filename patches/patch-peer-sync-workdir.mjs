#!/usr/bin/env node
/**
 * 本地补丁：让远程派活建出来的会话默认开在主工作区（外置盘）
 *
 * 背景：peer-sync 建会话时传的是空对象，DSH 于是回落到 profile 目录
 * (~/.dsh/profiles/desktop)，产物会写进系统盘。这里在没指定目录时补上
 * 主工作区路径，并且**先确认目录存在**——外置盘没挂载时宁可不动，
 * 让会话照常建在默认位置，也不要因为路径不存在而建不出会话。
 *
 * 幂等：已打过就跳过。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '// local-patch: peer-sync default-workdir v1'
const target =
  process.argv[2] ||
  path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-peer-sync/lib/sync.js')

if (!fs.existsSync(target)) {
  console.error('找不到文件：' + target)
  process.exit(2)
}

let src = fs.readFileSync(target, 'utf8')
if (src.includes(MARK)) {
  console.log('已打过补丁，跳过：' + target)
  process.exit(0)
}

const from = `    const wanted = request && typeof request === 'object' ? { ...request } : {}`
const to = `    const wanted = request && typeof request === 'object' ? { ...request } : {}
    ${MARK}
    // 没指定目录时落到主工作区（外置盘）；目录不在就别硬塞，免得建不出会话。
    if (typeof wanted.cwd !== 'string' || wanted.cwd.trim() === '') {
      const workdir = process.env.DSH_MESH_WORKDIR || '/Volumes/SSD-1t/DSH工作地址'
      if (fs.existsSync(workdir)) wanted.cwd = workdir
    }`

const hits = src.split(from).length - 1
if (hits !== 1) {
  console.error(`中止：替换点命中 ${hits} 次（应为 1 次），未写入。`)
  process.exit(3)
}
src = src.replace(from, to)

const probe = path.join(os.tmpdir(), `peer-sync-workdir-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  console.error('中止：语法检查没通过，未写入。\n' + String((error && error.stderr) || error))
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = target + '.orig-workdir'
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, src)
console.log('补丁已应用：' + target)
console.log('备份：' + backup)
console.log('需要重启 DSH 才生效。')
