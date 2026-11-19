#!/usr/bin/env node
/**
 * 本地补丁：把「跨机同步」放进左侧边栏
 *
 * 原来它只注册在 settings.plugins.tab，要三层点进去。这里补两处：
 *   main            —— 把同一份 Panel 作为可切换的主视图
 *   sidebar.panellist —— 左栏图标，点它就切到上面那个视图
 * 两个槽位用同一个 key/id 关联，这是 device-mesh 的写法。
 *
 * 幂等：已打过就跳过；替换点必须命中且只命中一次。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '// local-patch: peer-sync sidebar entry v1'
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
    name: '加入侧栏图标组件',
    from: `    return {
      inject: ['slots'],
      apply(ctx) {`,
    to: `    ${MARK}
    // 左栏图标：两条反向箭头，表示双向同步
    function PeerSyncGlyph(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M2.5 5.5h10M9.8 3.2l2.4 2.3-2.4 2.3',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M13.5 10.5h-10M6.2 8.2l-2.4 2.3 2.4 2.3',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {`,
  },
  {
    name: '注册主视图与侧栏入口',
    from: `            Panel,
          ),
        )

        // Which sessions have their files on the other machine.`,
    to: `            Panel,
          ),
        )

        // 左栏入口：同一份 Panel 既作主视图，也作侧栏按钮的落点。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'peer-sync', label: L('跨机同步', 'Peer Sync') },
            Panel,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'peer-sync', order: 45, label: L('跨机同步', 'Peer Sync') },
            PeerSyncGlyph,
          ),
        )

        // Which sessions have their files on the other machine.`,
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

const probe = path.join(os.tmpdir(), `peer-sync-sidebar-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  console.error('中止：语法检查没通过，未写入。\n' + String((error && error.stderr) || error))
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = target + '.orig-sidebar'
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, src)
console.log('补丁已应用：' + target)
console.log('备份：' + backup)
