#!/usr/bin/env node
/**
 * 本地补丁：device-mesh 的两处体验问题
 *
 * 1) 侧栏图标上的绿点难看：原来是个带数字的实心圆角徽标。
 *    改成一颗 7px 的状态圆点（在线设备数移到 title，悬停可见），
 *    待批准的数仍然保留数字（那个是要处理的，得看见）。
 *
 * 2) 远程面板打开后，点左侧本机会话只高亮、内容不切：
 *    因为远程 iframe 还占着中间栏。这里加一个捕获阶段的点击监听——
 *    点到本机会话行、且不是远程树里的行时，直接把远程面板收起来，
 *    于是会话正常显示。远程树里的行（带 data-dm-remote-session）不受影响。
 *
 * 幂等：已打过就跳过；每个替换点必须命中且只命中一次。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MARK = '// local-patch: device-mesh ui-tweaks v1'
const target =
  process.argv[2] ||
  path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-device-mesh/client.js')

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
    name: '待批准徽标：改细描边圆角',
    from: `.dm-panel-badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base));
  font-size: 9px;
  line-height: 1;
  font-weight: 700;
}`,
    to: `/* ${MARK} */
.dm-panel-badge {
  position: absolute;
  top: -4px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base));
  font-size: 9px;
  line-height: 1;
  font-weight: 600;
  box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base, transparent);
}`,
  },
  {
    name: '在线徽标：改成 7px 圆点',
    from: `.dm-panel-badge-online {
  background: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary));
}`,
    to: `.dm-panel-badge-online {
  top: 0;
  right: -2px;
  min-width: 7px;
  width: 7px;
  height: 7px;
  padding: 0;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary));
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base, transparent);
}`,
  },
  {
    name: '在线圆点不再显示数字，改成悬停提示',
    from: `  return el("span", { className: \`\${className} \${className}-online\`, "aria-hidden": "true" }, online > 9 ? "9+" : String(online));`,
    to: `  return el("span", {
    className: \`\${className} \${className}-online\`,
    title: \`\${online} \${"台设备在线"}\`,
    "aria-label": \`\${online} \${"台设备在线"}\`
  });`,
  },
  {
    name: '点本机会话时收起远程面板',
    from: `function apply(ctx) {
  installStyles(ctx);`,
    to: `function apply(ctx) {
  installStyles(ctx);
  // 远程面板占着中间栏时，点本机会话不会切换内容。捕获阶段拦一下：
  // 点到的是 shell 自己的会话行（不是远程树里的行），就把面板收起来。
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (target === null || typeof target.closest !== "function") return;
        if (target.closest("[data-dm-remote-session]")) return;
        if (target.closest(".dm-remote-pane")) return;
        if (target.closest('[class*="_sessionRow"]') === null) return;
        try {
          hideRemotePane();
        } catch {
        }
      },
      true
    );
  }`,
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

const probe = path.join(os.tmpdir(), `device-mesh-check-${process.pid}.mjs`)
fs.writeFileSync(probe, src)
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })
} catch (error) {
  fs.rmSync(probe, { force: true })
  console.error('中止：语法检查没通过，未写入。\n' + String((error && error.stderr) || error))
  process.exit(4)
}
fs.rmSync(probe, { force: true })

const backup = target + '.orig-ui'
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, src)
console.log('补丁已应用：' + target)
console.log('备份：' + backup)
