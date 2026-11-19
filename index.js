/**
 * dsh-mesh-toolkit —— 双机互联工具箱
 *
 * 这台机器上真正难用的不是"配对"，而是配对之后的三件事：
 *   1. 现在到底通没通（配对、同步、隧道、监听，四个层面各说各话）
 *   2. 怎么把文件从这台送到那台（没有共享盘、没有 AirDrop）
 *   3. 派过去的活儿到底在哪台机上跑、产物落在哪个盘
 *
 * 这个包把 1 和 2 做成模型能直接调用的工具，把 3 写进随包发布的技能。
 *
 * 设计约束：
 *   - 只读为主。除了主动调用 mesh_send_file，不改任何配置、不动这两个插件的文件。
 *   - 没有依赖别人的插件才能工作：工具读的是 ~/.dsh/peer-sync/config.json 和
 *     ~/.dsh/device-mesh/peers.json，这两个文件不存在时就明确说"没装/没配对"。
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// 随 dsh 安装的包：静态导入才能被 loader 解析到（动态 import() 走 Node 解析会失败）
import { apply as applyFilesystemProvider } from '@deepseek-ai/dsh-skill-filesystem'

const SKILLS_ROOT = fileURLToPath(new URL('./skills/', import.meta.url))

export const name = 'dsh-mesh-toolkit'
export const inject = ['tools', 'skills']

// ---------------------------------------------------------------- 读本地状态

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function peerConfig() {
  return readJson(path.join(dshHome(), 'peer-sync', 'config.json'))
}

function meshPeers() {
  return readJson(path.join(dshHome(), 'device-mesh', 'peers.json'))
}

function tailscaleIpv4() {
  const found = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal && entry.address.startsWith('100.')) {
        found.push(entry.address)
      }
    }
  }
  return found[0] || null
}

function pickPeer(config, wanted) {
  const peers = Array.isArray(config?.peers) ? config.peers.filter((p) => p && typeof p.url === 'string') : []
  if (peers.length === 0) return { peer: null, reason: '没有配置对端（peer-sync 未配对）' }
  if (wanted) {
    const hit = peers.find((p) => p.name === wanted)
    return hit ? { peer: hit, reason: null } : { peer: null, reason: `没有名为「${wanted}」的对端` }
  }
  return peers.length === 1
    ? { peer: peers[0], reason: null }
    : { peer: null, reason: `有 ${peers.length} 个对端，请用 peer 指定其中一个：${peers.map((p) => p.name).join('、')}` }
}

// ---------------------------------------------------------------- 工具一：体检

const statusTool = {
  name: 'mesh_status',
  description:
    '体检两台机器之间的互联状态：本机标识与监听地址、每个对端是否可达与最近同步时间、device-mesh 的配对关系。' +
    '在"对面好像没反应""同步停了""文件该落到哪台机"这类问题出现时先调它，比猜快。' +
    '只读，不修改任何配置。',
  parameters: { type: 'object', properties: {}, required: [] },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute() {
    const config = peerConfig()
    const mesh = meshPeers()
    const lines = []

    if (!config) {
      lines.push('peer-sync：没有配置文件（插件未安装或未运行）')
    } else {
      const status = readJson(path.join(dshHome(), 'peer-sync', 'status.json'))
      lines.push(`本机：${config.self || '?'}`)
      const listen = config.listen || {}
      lines.push(`监听：${listen.host || '?'}:${listen.port ?? '?'}`)
      lines.push(`发现：udp:${config.pairing?.port ?? '?'} · 配对模式 ${config.pairing?.mode ?? '?'} · 远程投递 ${config.remotePrompts || 'off'}`)
      const peers = Array.isArray(status?.peers) && status.peers.length > 0 ? status.peers : config.peers || []
      if (peers.length === 0) {
        lines.push('对端：无')
      } else {
        for (const peer of peers) {
          const bits = [`${peer.name || '?'} ${peer.url || ''}`.trim()]
          if (peer.reachable !== undefined) bits.push(peer.reachable ? '可达' : '不可达')
          if (peer.lastSyncAt) bits.push(`最近同步 ${peer.lastSyncAt}`)
          if (peer.lastError) bits.push(`错误 ${peer.lastError}`)
          lines.push(`对端：${bits.join(' · ')}`)
        }
        const revoked = (config.peers || []).filter((p) => p.trust === 'revoked')
        if (revoked.length > 0) lines.push(`注意：${revoked.map((p) => p.name).join('、')} 已被撤销信任，同步与派活都会被拒`)
      }
    }

    if (!mesh) {
      lines.push('device-mesh：没有设备记录（未配对）')
    } else {
      const controllers = (mesh.controllers || []).map((p) => p.name).filter(Boolean)
      const daemons = (mesh.daemons || []).map((p) => p.name).filter(Boolean)
      lines.push(`device-mesh 可控制我：${controllers.join('、') || '无'}`)
      lines.push(`device-mesh 我可控制：${daemons.join('、') || '无'}`)
      const endpoints = []
      for (const p of mesh.daemons || []) for (const e of p.endpoints || []) endpoints.push(e.url)
      if (endpoints.length > 0) {
        const onTailnet = endpoints.some((u) => /\/\/(100\.|\[fd)/.test(u))
        lines.push(`对端可达地址：${endpoints.length} 条，${onTailnet ? '含 tailnet 地址（跨网可用）' : '只有局域网地址（出门会失效）'}`)
      }
    }

    const ts = tailscaleIpv4()
    lines.push(`Tailscale：${ts || '未连接（跨网访问会失败）'}`)

    return { text: lines.join('\n') }
  },
}

// ---------------------------------------------------------------- 工具二：传文件

const sendFileTool = {
  name: 'mesh_send_file',
  description:
    '把一个文件直接送到配对的那台机器上，并核对两边哈希。' +
    '走本机临时起的只读 HTTP 服务（只暴露这一个文件，传完立即关闭）+ 对端 peer-sync 通道，' +
    '不需要 AirDrop（它要求两台在 10 米内且要人工点接受），也不依赖共享盘。' +
    '只接受单个文件；要传目录请先在调用前自己打包。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要发送的文件的绝对路径（或 ~/ 开头）。',
      },
      peer: {
        type: 'string',
        description: '目标机器的名字，取自 mesh_status 列出的对端。只有一个对端时可以省略。',
      },
      destDir: {
        type: 'string',
        description: '在目标机器上的落点目录，默认 ~/Downloads。不存在会自动创建。',
      },
    },
    required: ['path'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        remotePath: { type: 'string' },
        verified: { type: 'boolean' },
      },
      required: ['text', 'verified'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args) {
    const raw = String(args?.path || '').trim()
    if (!raw) throw new Error('缺少 path')
    const abs = path.resolve(raw.replace(/^~(?=\/)/, os.homedir()))
    if (!fs.existsSync(abs)) throw new Error(`找不到文件：${abs}`)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) throw new Error(`只支持单个文件；目录请先打包：${abs}`)

    const config = peerConfig()
    if (!config) throw new Error('peer-sync 未安装或无配置，无法传输')
    const { peer, reason } = pickPeer(config, args?.peer)
    if (!peer) throw new Error(reason)
    if (peer.trust === 'revoked') throw new Error(`对端「${peer.name}」已被撤销信任，先在跨机同步面板恢复信任`)

    const base = path.basename(abs)
    const sha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')

    // 只暴露这一个文件的临时服务
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://x')
      if (url.pathname !== `/${encodeURIComponent(base)}`) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': stat.size })
      fs.createReadStream(abs).pipe(res)
    })
    await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve))
    const port = server.address().port

    const host = tailscaleIpv4() || Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address
    if (!host) {
      server.close()
      throw new Error('找不到可用的本机地址')
    }
    const url = `http://${host}:${port}/${encodeURIComponent(base)}`
    const destDir = String(args?.destDir || '~/Downloads').trim() || '~/Downloads'

    const call = async (pathname, body) => {
      const res = await fetch(`${peer.url.replace(/\/$/, '')}${pathname}`, {
        method: 'POST',
        headers: { 'x-peer-token': peer.token, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(340000),
      })
      return res.json().catch(() => null)
    }

    try {
      const created = await call('/v1/remote/session', { peer: config.self || 'mesh-toolkit', request: { title: `收文件：${base}` } })
      if (!created?.ok) throw new Error(`对方拒绝建会话：${created?.reason || '未知原因'}`)

      const prompt = [
        '只做这一件事，不要改动其他文件：',
        `1) mkdir -p ${destDir}`,
        `2) curl -fsSL "${url}" -o "${destDir}/${base}"`,
        `3) shasum -a 256 "${destDir}/${base}"`,
        '把第 3 步输出的哈希原样回复，不要多说别的。',
      ].join('\n')

      const answer = await call('/v1/remote/prompt', { sessionId: created.sessionId, text: prompt, wait: true, waitSeconds: 300 })
      const reply = String(answer?.reply || '')
      const got = (reply.match(/[a-f0-9]{64}/i) || [])[0] || ''
      const verified = got.toLowerCase() === sha
      const remotePath = `${destDir}/${base}`

      if (verified) {
        return {
          verified: true,
          remotePath,
          text: `已送达并校验一致\n文件：${base}（${(stat.size / 1024 / 1024).toFixed(2)} MB）\n对端：${peer.name}\n路径：${remotePath}\nsha256：${sha}`,
        }
      }
      return {
        verified: false,
        remotePath,
        text: `未能确认校验值，文件可能没到\n本机 sha256：${sha}\n对方回复：${reply.slice(0, 300) || '(空)'}`,
      }
    } finally {
      server.close()
    }
  },
}


// ---------------------------------------------------------------- 工具三：一键配置

function profileDir() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR
  const profile = process.env.DSH_PROFILE || 'desktop'
  return path.join(dshHome(), 'profiles', profile)
}

function companionVersion(profile, name) {
  const pkg = readJson(path.join(profile, 'node_modules', name, 'package.json'))
  return pkg?.version || null
}

function packageRoot() {
  return path.dirname(fileURLToPath(new URL('./index.js', import.meta.url)))
}

const setupTool = {
  name: 'mesh_setup',
  description:
    '把双机互联需要的配置一次配好，并重新应用随包携带的本地补丁（补丁会被插件升级覆盖，重装后调它恢复）。' +
    '不带 apply 时只体检：报告两个伴生插件在不在、当前配置是什么、补丁打过没有。' +
    '带 apply=true 才真的写文件——会改 peer-sync 的 config.json（监听 0.0.0.0、允许远程投递、通告会话）并执行补丁脚本。' +
    '这些改动都要重启 DSH 才生效。',
  parameters: {
    type: 'object',
    properties: {
      apply: {
        type: 'boolean',
        description: 'true 才实际写入配置和打补丁；默认 false 仅体检，不改任何文件。',
      },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, needsRestart: { type: 'boolean' } },
      required: ['text', 'needsRestart'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args) {
    const apply = args?.apply === true
    const profile = profileDir()
    const lines = []
    let needsRestart = false

    // 伴生插件
    const mesh = companionVersion(profile, 'dsh-device-mesh')
    const peer = companionVersion(profile, 'dsh-peer-sync')
    lines.push(`设备隧道 dsh-device-mesh：${mesh ? mesh : '未安装（本包依赖它，重装本包会带上）'}`)
    lines.push(`跨机同步 dsh-peer-sync：${peer ? peer : '未安装（本包依赖它，重装本包会带上）'}`)
    if (!mesh || !peer) lines.push('提示：缺哪个就先 `dsh plugin --profile <名字> add dsh-mesh-toolkit` 重装一次，依赖会一起装好。')

    // 配置
    const cfgPath = path.join(dshHome(), 'peer-sync', 'config.json')
    const cfg = readJson(cfgPath)
    if (!cfg) {
      lines.push('peer-sync 配置：不存在（插件还没跑过）')
    } else {
      const listenHost = cfg.listen?.host ?? '?'
      lines.push(`当前配置：listen=${listenHost}:${cfg.listen?.port ?? '?'} · remotePrompts=${cfg.remotePrompts} · share.sessions=${cfg.share?.sessions}`)
      const wanted = { listenHost: '0.0.0.0', remotePrompts: 'allow', share: true }
      const drift = []
      if (listenHost !== wanted.listenHost) drift.push('listen.host → 0.0.0.0（只绑内网 IP 的话，出门在 tailnet 上连不进来）')
      if (cfg.remotePrompts !== wanted.remotePrompts) drift.push('remotePrompts → allow（否则对端派不了活；介意暴露面就保持 off）')
      if (cfg.share?.sessions !== wanted.share) drift.push('share.sessions → true（对端面板才能列出这里的会话）')
      if (drift.length === 0) {
        lines.push('配置已符合建议值。')
      } else if (!apply) {
        lines.push('建议改动：')
        for (const d of drift) lines.push(`  · ${d}`)
        lines.push('（加 apply=true 才会写入）')
      } else {
        cfg.listen = { ...(cfg.listen || {}), host: wanted.listenHost }
        cfg.remotePrompts = wanted.remotePrompts
        cfg.share = { ...(cfg.share || {}), sessions: wanted.share }
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
        fs.chmodSync(cfgPath, 0o600)
        lines.push('已写入配置：')
        for (const d of drift) lines.push(`  · ${d}`)
        needsRestart = true
      }
    }

    // 补丁
    const patchDir = path.join(packageRoot(), 'patches')
    const scripts = fs.existsSync(patchDir)
      ? fs.readdirSync(patchDir).filter((f) => f.endsWith('.mjs')).sort()
      : []
    if (scripts.length === 0) {
      lines.push('随包补丁：没有')
    } else if (!apply) {
      lines.push(`随包补丁：${scripts.length} 个（加 apply=true 才会执行）`)
    } else {
      lines.push('补丁执行结果：')
      for (const script of scripts) {
        try {
          const out = execFileSync(process.execPath, [path.join(patchDir, script)], {
            encoding: 'utf8',
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          const last = out.trim().split('\n').filter(Boolean).pop() || 'ok'
          lines.push(`  · ${script} → ${last}`)
          if (!/已打过|跳过/.test(out)) needsRestart = true
        } catch (error) {
          const detail = String(error?.stderr || error?.message || error).split('\n').filter(Boolean).pop()
          lines.push(`  · ${script} → 失败：${detail}`)
        }
      }
    }

    if (needsRestart) lines.push('\n改动需要重启 DSH 才生效（配置只在启动时读一次）。')
    return { needsRestart, text: lines.join('\n') }
  },
}

// ---------------------------------------------------------------- 工具四：跨网体检

const networkTool = {
  name: 'mesh_network',
  description:
    '检查"出门还能不能用"这件事：本机有没有 tailnet 地址、peer-sync 是否监听在所有网卡、对端地址是内网还是 tailnet、' +
    'device-mesh 记的端点是否含 tailnet。出门前跑一次，比到了学校再发现连不上好。只读。',
  parameters: { type: 'object', properties: {}, required: [] },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute() {
    const lines = []
    const tailnet = []
    const lan = []
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list || []) {
        if (!entry || entry.family !== 'IPv4' || entry.internal) continue
        if (entry.address.startsWith('100.')) tailnet.push(entry.address)
        else lan.push(entry.address)
      }
    }
    lines.push(`本机 tailnet：${tailnet.join(', ') || '无'}`)
    lines.push(`本机内网：${lan.join(', ') || '无'}`)

    const cfg = peerConfig()
    if (!cfg) {
      lines.push('peer-sync：无配置')
    } else {
      const listen = cfg.listen || {}
      const host = listen.host || '?'
      const okBind = host === '0.0.0.0' || host === '::' || /^100\./.test(host) || host === 'auto'
      lines.push(`监听：${host}:${listen.port ?? '?'} ${okBind ? '' : '← 只绑了某一个网卡，tailnet 上可能连不进来'}`)
      for (const peer of cfg.peers || []) {
        let label = peer.url || ''
        try {
          const hostPart = new URL(peer.url).hostname
          label += /^100\./.test(hostPart) || hostPart.endsWith('.ts.net') ? ' · tailnet 地址（跨网可用）' : ' · 内网地址（出门失效）'
        } catch {
          label += ' · 地址无法解析'
        }
        lines.push(`对端 ${peer.name || '?'}：${label}`)
      }
    }

    const mesh = meshPeers()
    if (mesh) {
      const eps = []
      for (const p of mesh.daemons || []) for (const e of p.endpoints || []) eps.push(e.url)
      const onTail = eps.filter((u) => /\/\/(100\.|\[fd)/.test(u))
      lines.push(`device-mesh 端点：${eps.length} 条，其中 tailnet ${onTail.length} 条`)
      if (eps.length > 0 && onTail.length === 0) lines.push('  ← 端点里没有 tailnet 地址；配对发生在 Tailscale 连上之前的话会这样，需要重新配对一次')
    }

    const verdict = tailnet.length > 0 ? '本机已在 tailnet 上，出门前提是对端也在' : '本机没有 tailnet 地址，出门后对端找不到这台机器'
    lines.push(`\n结论：${verdict}`)
    return { text: lines.join('\n') }
  },
}


// ---------------------------------------------------------------- 挂载

export function apply(ctx) {
  ctx.tools.register(statusTool)
  ctx.tools.register(sendFileTool)
  ctx.tools.register(setupTool)
  ctx.tools.register(networkTool)
  mountSkill(ctx)
}

/**
 * 随包发布的工作流技能。技能提供者随 dsh 一起安装，静态导入即可解析；
 * 万一某个版本缺这个包，退化成"只有工具、没有技能"，不拖垮整个插件。
 */
function mountSkill(ctx) {
  if (typeof applyFilesystemProvider !== 'function') return
  try {
    applyFilesystemProvider(ctx, {
      providerName: 'dsh-mesh-toolkit',
      includeDefaultRoots: true,
      bundledSkillDir: SKILLS_ROOT,
      watch: false,
    })
  } catch (error) {
    ctx.logger?.warn?.(`dsh-mesh-toolkit: 技能未挂载（${error?.message ?? error}）`)
  }
}
