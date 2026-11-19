#!/usr/bin/env node
/**
 * 本地补丁：让「跨机同步」作为独立页面时有个像样的外壳
 *
 * 之前它被直接塞进主视图槽位，没有页面内边距和最大宽度，内容顶到最左边、
 * 和左栏挤在一起。这里加一层 shell：整页可滚动、左右留白、内容居中限宽，
 * 标题也从 13px 的列表字号提升到页面标题字号。
 *
 * 幂等：已打过就跳过；每个替换点必须命中且只命中一次。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '// local-patch: peer-sync main-shell v1'
const target =
  process.argv[2] ||
  path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-peer-sync/client.js')

if (!fs.existsSync(target)) {
  console.error('找不到文件：' + target)
  process.exit(2)
}

let src = fs.readFileSync(target, 'utf8')
if (src.includes(MARK)) {
  console.log('已打过补丁，跳过：' + target)
  process.exit(0)
}

const edits = [
  {
    name: '新增页面外壳样式',
    from: `      page: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 24px' },`,
    to: `      page: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 24px' },
      shell: {
        height: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '28px 36px 64px',
      },
      shellInner: { maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
      pageTitle: {
        fontSize: 17,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: 'var(--dsw-alias-label-primary)',
      },`,
  },
  {
    name: '标题提升到页面级字号',
    from: `          h('span', { style: S.name }, L('跨机同步', 'Peer Sync')),`,
    to: `          h('span', { style: S.pageTitle }, L('跨机同步', 'Peer Sync')),`,
  },
  {
    name: '加入页面外壳组件',
    from: `    return {
      inject: ['slots'],`,
    to: `    ${MARK}
    // 作为独立页面打开时的外壳：限宽、留白、整页滚动
    function MainPanel() {
      return h('div', { style: S.shell }, h('div', { style: S.shellInner }, h(Panel)))
    }

    return {
      inject: ['slots'],`,
  },
  {
    name: '主视图改用外壳组件',
    from: `            { name: 'main', key: 'peer-sync', label: L('跨机同步', 'Peer Sync') },
            Panel,`,
    to: `            { name: 'main', key: 'peer-sync', label: L('跨机同步', 'Peer Sync') },
            MainPanel,`,
  },
]

for (const edit of edits) {
  const hits = src.split(edit.from).length - 1
  if (hits !== 1) {
    console.error(`中止：替换点「${edit.name}」命中 ${hits} 次（应为 1 次），未写入。`)
    process.exit(3)
  }
  src = src.replace(edit.from, edit.to)
}

const probe = path.join(os.tmpdir(), `peer-sync-shell-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  console.error('中止：语法检查没通过，未写入。\n' + String((error && error.stderr) || error))
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = target + '.orig-shell'
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, src)
console.log('补丁已应用：' + target)
console.log('备份：' + backup)
