# dsh-mesh-toolkit

Once two Macs are paired through DeepSeek Harness, the hard part is no longer pairing — it is everything after it: is it actually connected, how do I get a file over there, will it still work once I leave the house, and where do I look when it breaks.

This package turns those into tools a model can call, plus one workflow skill. It does **not** contain the code of [dsh-device-mesh](https://github.com/kfxhjz/dsh-device-mesh) or [dsh-peer-sync](https://github.com/yc5991/dsh-peer-sync); those are the transport, this is the operations layer on top.

## Four tools

| Tool | What it does |
|---|---|
| `mesh_status` | One report: identity, listen address, per-peer reachability and last sync, revoked trust, mesh pairing in both directions, Tailscale state |
| `mesh_setup` | Aligns configuration and re-applies the bundled patches. Read-only by default; `apply: true` writes the peer-sync config and runs the patches |
| `mesh_network` | Cross-network diagnosis: listener bound to one NIC, peer URL is LAN-only, pairing credential without a tailnet endpoint |
| `mesh_send_file` | Single-file transfer: temporary read-only HTTP exposing only that file, through the peer channel, with sha256 on both ends |

## One skill

`mesh-workflow`: which machine executes (and therefore where files land), the boundary of each channel, output conventions, a dispatch checklist, cross-network notes, a failure table, and the permission trade-offs.

## Seven optional patches

Scripts under `patches/` modify the two paired plugins' installed files when you run them, fixing defects and rough edges. Notably:

- **`patch-peer-sync-utf8-name`** — a non-ASCII machine name makes the `x-peer-name` header invalid, so every outbound request throws a ByteString error and the UI reports "peer unreachable". That is an encoding bug, not a network problem.
- `patch-peer-sync-host` — waits for the turn to finish instead of returning a preamble as the answer.

All of them are idempotent, keep an `.orig` backup, and refuse to write if the syntax check fails.

## Install

Two steps. The second is required: `dsh-peer-sync` is published only on GitHub, and pnpm's `blockExoticSubdeps` policy forbids nesting a git dependency, so it cannot ride along.

```bash
# 1. this package (the tunnel installs as a regular dependency)
dsh plugin --profile desktop add github:leo-tqw/dsh-mesh-toolkit

# 2. peer sync (GitHub-only, cannot be nested)
dsh plugin --profile desktop add github:yc5991/dsh-peer-sync
```

Restart DSH after both. A new session should list the four tools and the `mesh-workflow` skill.

Step 1 alone is usable: `mesh_send_file` and `mesh_network` still work, while `mesh_status` / `mesh_setup` tell you exactly what is missing.

## Why not AirDrop

Apple requires both devices within 30 feet (10 m) with a manual Accept, and macOS ships no AirDrop CLI — unusable across cities or unattended. This package serves exactly one file from a temporary HTTP listener, lets the peer fetch it over the existing channel, and verifies the hash.

## Safety

- All four tools only read local state; the one side effect is the transfer itself
- `mesh_setup` writes nothing unless `apply: true`, and reports what it would change first
- Patch scripts only run when you invoke them

## Limitations

- Single file at a time; archive directories first
- Requires peer-sync for the peer channel
- Cross-network access needs an address both sides can reach (typically a `100.x` tailnet address with listeners bound to `0.0.0.0`)

## License

MIT. The two companion plugins are not bundled; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
