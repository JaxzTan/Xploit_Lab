import type { InputEdge, InputNode } from '../api/types'

export const NODE_W = 152
const COL_W = 250
const ROW_H = 120
const PAD_X = 95
const PAD_Y = 60

export interface Layout {
  pos: Record<string, { x: number; y: number }>
  width: number
  height: number
}

/**
 * Node centres for the attack-path SVG. Uses `x`/`y` from the input when every node has them;
 * otherwise columns by BFS depth from the entry (TRD_V2 §4.1), then from any remaining roots.
 */
export function layout(nodes: InputNode[], edges: InputEdge[], entry: string): Layout {
  if (nodes.length && nodes.every((n) => n.x != null && n.y != null)) {
    const pos = Object.fromEntries(nodes.map((n) => [n.id, { x: n.x!, y: n.y! }]))
    return {
      pos,
      width: Math.max(...nodes.map((n) => n.x!)) + NODE_W / 2 + 40,
      height: Math.max(...nodes.map((n) => n.y!)) + 60,
    }
  }
  const out: Record<string, string[]> = {}
  const indeg: Record<string, number> = {}
  edges.forEach((e) => {
    ;(out[e.source] ??= []).push(e.destination)
    indeg[e.destination] = (indeg[e.destination] ?? 0) + 1
  })
  const depth: Record<string, number> = {}
  const bfs = (root: string, d0: number) => {
    if (depth[root] != null) return
    depth[root] = d0
    const q = [root]
    while (q.length) {
      const n = q.shift()!
      for (const m of out[n] ?? []) {
        if (depth[m] == null) {
          depth[m] = depth[n] + 1
          q.push(m)
        }
      }
    }
  }
  bfs(entry, 0)
  nodes.filter((n) => !indeg[n.id]).forEach((n) => bfs(n.id, 0))
  nodes.forEach((n) => bfs(n.id, 0)) // cycles with no root

  const cols: string[][] = []
  nodes.forEach((n) => (cols[depth[n.id]] ??= []).push(n.id))
  const pos: Layout['pos'] = {}
  cols.forEach((ids, c) => ids?.forEach((id, r) => (pos[id] = { x: PAD_X + c * COL_W, y: PAD_Y + r * ROW_H })))
  const rows = Math.max(1, ...cols.map((c) => c?.length ?? 0))
  return { pos, width: PAD_X * 2 + (cols.length - 1) * COL_W, height: PAD_Y * 2 + (rows - 1) * ROW_H }
}

/** Edge path between two node centres: bezier between card sides, straight when stacked. */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): { d: string; arrow: string } {
  const half = NODE_W / 2
  if (a.x === b.x) {
    const dir = b.y > a.y ? 1 : -1
    const sy = a.y + 28 * dir
    const ey = b.y - 28 * dir
    return {
      d: `M ${a.x} ${sy} L ${b.x} ${ey}`,
      arrow: `${b.x},${ey} ${b.x - 5},${ey - 9 * dir} ${b.x + 5},${ey - 9 * dir}`,
    }
  }
  const dir = b.x > a.x ? 1 : -1
  const sx = a.x + half * dir
  const ex = b.x - half * dir
  const c = (ex - sx) / 2
  return {
    d: `M ${sx} ${a.y} C ${sx + c} ${a.y}, ${ex - c} ${b.y}, ${ex} ${b.y}`,
    arrow: `${ex},${b.y} ${ex - 9 * dir},${b.y - 5} ${ex - 9 * dir},${b.y + 5}`,
  }
}
