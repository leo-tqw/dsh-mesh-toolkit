#!/usr/bin/env node
/**
 * 本地补丁：dsh-peer-sync 的服务端等待逻辑
 *
 * 问题：remotePrompt 的轮询循环只要看到任意一条 assistant 文本就立刻返回，
 * 于是「我先确认一下磁盘」这种开场白会被当成最终答案。
 *
 * 改法：拿到文本后继续等，直到这一轮真正结束（turn/end）才收工；
 * 循环里原有的 endedAfter 判断会在轮次结束后再兜底退出。
 *
 * 幂等：已打过就跳过；替换点必须命中且只命中一次。
 * 备份：首次打补丁时把原文件存成 sync.js.orig
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '/* local-patch: peer-sync wait-for-turn-end v1 */'
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

const from = `        if (window.reply) {
          reply = window.reply
          break
        }`
const to = `        if (window.reply) {
          // Keep the newest text, but only finish when the turn did: a preamble
          // ("I'll check the disk first") is not the answer the caller waits for.
          reply = window.reply
          if (window.sawEnd) break
        }`

const hits = src.split(from).length - 1
if (hits !== 1) {
  console.error(`中止：替换点命中 ${hits} 次（应为 1 次），未写入。`)
  process.exit(3)
}
src = src.replace(from, to)

const firstLineEnd = src.indexOf('\n')
// 在文件头加标记行（第一行通常是注释，安全）
src = MARK + '\n' + src

const probe = path.join(os.tmpdir(), `peer-sync-lib-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  console.error('中止：语法检查未通过，未写入。\n' + String((error && error.stderr) || error))
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = target + '.orig'
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, src)
console.log('补丁已应用：' + target)
console.log('备份：' + backup)
console.log('需要重启 DSH 才生效。')
