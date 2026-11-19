#!/usr/bin/env node
/**
 * 本地补丁：给 dsh-peer-sync 的「跨机同步」面板补三件事
 *
 *   v1  发送前明确标出"这条发到哪台机器的哪个会话"
 *   v1  等待上限 120s -> 300s，轮询 3x4s -> 6x10s，超时文案改成"不是失败"
 *   v2  「本机」那几行不再提供跨机按钮（没有对端，点了只会报"没有这个对端"）
 *
 * 分阶段幂等：已打过的阶段跳过；每个替换点都要求命中且只命中一次，否则整体放弃。
 * 备份：首次打补丁时把原文件存成 <client.js>.orig
 *
 * 用法：
 *   <node> patch-peer-sync-client.mjs                 # 默认路径
 *   <node> patch-peer-sync-client.mjs /path/client.js # 指定文件
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK_V1 = '/* local-patch: peer-sync target+wait v1 */'
const MARK_V2 = '/* local-patch: peer-sync local-row v2 */'

const target =
  process.argv[2] ||
  path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-peer-sync/client.js')

if (!fs.existsSync(target)) {
  console.error(`找不到文件：${target}`)
  process.exit(2)
}

let src = fs.readFileSync(target, 'utf8')
const applied = []

function applyEdits(edits) {
  for (const edit of edits) {
    const hits = src.split(edit.from).length - 1
    if (hits !== 1) {
      console.error(`中止：替换点「${edit.name}」命中 ${hits} 次（应为 1 次）。文件可能已被改过，未写入任何内容。`)
      process.exit(3)
    }
    src = src.replace(edit.from, edit.to)
    applied.push(edit.name)
  }
}

function addMarker(mark) {
  const firstLineEnd = src.indexOf('\n')
  src = src.slice(0, firstLineEnd + 1) + mark + '\n' + src.slice(firstLineEnd + 1)
}

// ---------- v1：发送目标 + 等待预算 ----------
if (!src.includes(MARK_V1)) {
  applyEdits([
    {
      name: '发送前显示目标机器和会话',
      from: `                L('在这一行按发送：消息传到对端，由对端消耗额度、按对端权限执行。', 'Send: the peer runs it, with its quota and its permissions.'),`,
      to: `                L('发往 ' + (item.peer || '对端') + ' 的「' + (item.title || '无标题会话') + '」——不是你正在看的这个对话。消息由对端消耗额度、按对端权限执行。', 'Sending to "' + (item.title || 'untitled') + '" on ' + (item.peer || 'the peer') + ' — not your current conversation.'),`,
    },
    {
      name: '等待预算 120s -> 300s',
      from: `text, wait: true, waitSeconds: 120 }),`,
      to: `text, wait: true, waitSeconds: 300 }),`,
    },
    {
      name: '轮询次数 3 -> 6',
      from: `for (let attempt = 0; attempt < 3 && value && !value.replied && value.reason === 'turn-in-progress'; attempt += 1) {`,
      to: `for (let attempt = 0; attempt < 6 && value && !value.replied && value.reason === 'turn-in-progress'; attempt += 1) {`,
    },
    {
      name: '轮询间隔 4s -> 10s',
      from: `            await new Promise((resolve) => setTimeout(resolve, 4000))`,
      to: `            await new Promise((resolve) => setTimeout(resolve, 10000))`,
    },
    {
      name: '超时结论改成"不是失败"',
      from: `      'turn-in-progress': ['对端还在跑，等待上限到了', 'still running when the wait budget expired'],`,
      to: `      'turn-in-progress': ['还在跑，不是失败 —— 任务在对端继续执行，稍后点「看最近结果」取回', 'still running, not failed — the turn continues there; fetch the answer later'],`,
    },
    {
      name: '等待中的提示改成"超时不是失败"',
      from: `                pending ? h('span', { style: S.dim }, L('对端在跑，最多等 120 秒', 'peer is running it, up to 120s')) : null,`,
      to: `                pending ? h('span', { style: S.dim }, L('已发出，最多等 5 分钟；超时不是失败，任务仍在跑', 'sent; waiting up to 5 min — a timeout is not a failure')) : null,`,
    },
  ])
  addMarker(MARK_V1)
}

// ---------- v2：本机会话不再给跨机按钮 ----------
if (!src.includes(MARK_V2)) {
  applyEdits([
    {
      name: '本机会话只读展示，去掉会失败的跨机按钮',
      from: `      const [stopping, setStopping] = useState(false)

      const stop = async () => {`,
      to: `      const [stopping, setStopping] = useState(false)

      // A local row has no peer: the cross-machine buttons could only answer
      // "no such peer", which reads like a bug rather than a boundary.
      if (item.where === 'local') {
        return h(
          'li',
          { style: S.card },
          h(
            'div',
            { style: S.row },
            h(Where, { item }),
            h('span', { style: S.name }, item.title || L('(无标题)', '(untitled)')),
            item.archived ? h('span', { style: S.tag }, L('已归档', 'archived')) : null,
          ),
          h(
            'span',
            { style: S.dim },
            L('本机会话 —— 直接在这个对话里说话就行；跨机投递只发往对端。', 'local session — talk to it directly; cross-machine delivery only goes to the peer.'),
          ),
        )
      }

      const stop = async () => {`,
    },
  ])
  addMarker(MARK_V2)
}

if (applied.length === 0) {
  console.log(`已是最新，无需改动：${target}`)
  process.exit(0)
}

// 先做语法检查再落盘
const probe = path.join(os.tmpdir(), `peer-sync-client-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  const detail = error && error.stderr ? String(error.stderr) : String((error && error.message) || error)
  console.error('中止：改完的文件语法检查没通过，未写入。\n' + detail)
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = `${target}.orig`
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)

fs.writeFileSync(target, src)
console.log(`补丁已应用：${target}`)
console.log(`原文件备份：${backup}`)
for (const name of applied) console.log(`  ✓ ${name}`)
console.log('\n改动需要重新加载面板才生效：先刷新页面；若文案没变，⌘Q 重开 DSH。')
