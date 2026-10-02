import { memo, useMemo, type CSSProperties } from 'react'
import {
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import type { GraphEdge, GraphNode, Scenario } from '../api/types'
import { usd } from '../lib/format'

/* Fixed-position attack graph (TR-8). Node coordinates come from scenario data —
   no auto-layout. Edge geometry reproduces the design guide exactly: horizontal
   cubic béziers between node sides (±77px), straight verticals (±28px). */

type EdgeKind = 'path' | 'allowed' | 'denied' | 'cut'

interface FapiNodeData extends Record<string, unknown> {
  node: GraphNode
  reached: boolean
  onPath: boolean
  cutOff: boolean
}

interface FapiEdgeData extends Record<string, unknown> {
  d: string
  arrow: string
  kind: EdgeKind
  animate: boolean
  mid: { x: number; y: number }
}

type FapiNode = Node<FapiNodeData, 'fapi'>
type FapiEdge = Edge<FapiEdgeData, 'fapi'>

const FapiNodeView = memo(function FapiNodeView({ data }: NodeProps<FapiNode>) {
  const n = data.node
  const name = n.plain_name ? n.plain_name : n.name
  const techId = n.plain_name ? n.name : ''
  const meta = n.exposed_capacity_24h_usd ? usd(n.exposed_capacity_24h_usd) + ' / day' : n.criticality + ' impact'
  return (
    <div
      className="fapi-node"
      data-reached={data.reached}
      data-onpath={data.onPath}
      data-cutoff={data.cutOff}
      title={n.entry ? 'Entry point' : undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {n.entry && <span className="fapi-entry-flag">Entry</span>}
      <div style={{ fontSize: 12, fontFamily: 'var(--font-heading)', letterSpacing: '-0.005em', lineHeight: 1.15 }}>{name}</div>
      {techId && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--color-accent-300)', marginTop: 1 }}>
          {techId}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--color-neutral-500)', display: 'flex', gap: 6, marginTop: 2 }}>
        <span>{n.type}</span>
        <span>{meta}</span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})

const EDGE_STYLE: Record<EdgeKind, CSSProperties> = {
  path: { stroke: '#9184d9', strokeWidth: 2, filter: 'drop-shadow(0 0 5px rgba(145,132,217,0.5))' },
  allowed: { stroke: '#3f424d', strokeWidth: 1 },
  denied: { stroke: '#3f424d', strokeWidth: 1, strokeDasharray: '3 6' },
  cut: { stroke: 'var(--color-danger)', strokeWidth: 2, strokeDasharray: '6 5' },
}
const ARROW_FILL: Record<EdgeKind, string> = { path: '#9184d9', allowed: '#3f424d', denied: '#3f424d', cut: 'var(--color-danger)' }

const FapiEdgeView = memo(function FapiEdgeView({ data }: EdgeProps<FapiEdge>) {
  if (!data) return null
  const { d, arrow, kind, animate, mid } = data
  return (
    <g>
      <path d={d} fill="none" style={EDGE_STYLE[kind]} />
      {kind === 'path' && animate && (
        <path
          d={d}
          fill="none"
          className="fapi-flow"
          style={{ stroke: '#e7e5fe', strokeWidth: 2, strokeDasharray: '2 14', strokeLinecap: 'round', opacity: 0.85 }}
        />
      )}
      <polygon points={arrow} style={{ fill: ARROW_FILL[kind] }} />
      {kind === 'cut' && (
        <g transform={`translate(${mid.x} ${mid.y})`}>
          <circle r={9} fill="#161826" stroke="var(--color-danger)" strokeWidth={1.5} />
          <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="var(--color-danger)" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      )}
    </g>
  )
})

const nodeTypes = { fapi: FapiNodeView }
const edgeTypes = { fapi: FapiEdgeView }

function geometry(a: GraphNode, b: GraphNode) {
  if (a.x === b.x) {
    const dir = b.y > a.y ? 1 : -1
    const sy = a.y + 28 * dir
    const ey = b.y - 28 * dir
    return {
      d: `M ${a.x} ${sy} L ${b.x} ${ey}`,
      arrow: `${b.x},${ey} ${b.x - 5},${ey - 9 * dir} ${b.x + 5},${ey - 9 * dir}`,
      mid: { x: a.x, y: (sy + ey) / 2 },
    }
  }
  const sx = a.x + 77
  const ex = b.x - 77
  const c = (ex - sx) / 2
  return {
    d: `M ${sx} ${a.y} C ${sx + c} ${a.y}, ${ex - c} ${b.y}, ${ex} ${b.y}`,
    arrow: `${ex},${b.y} ${ex - 9},${b.y - 5} ${ex - 9},${b.y + 5}`,
    mid: { x: (sx + ex) / 2, y: (a.y + b.y) / 2 },
  }
}

interface Props {
  scenario: Scenario
  reached: string[]
  /** Nodes still reachable after the applied fixes (null when no fix is applied). */
  reachedAfter: string[] | null
  onPath: string[]
  pathEdgeIds: string[]
  removedEdges: string[]
  showDenied: boolean
  animate: boolean
}

export function AttackGraph({ scenario, reached, reachedAfter, onPath, pathEdgeIds, removedEdges, showDenied, animate }: Props) {
  const { nodes, edges, height } = useMemo(() => {
    const byId: Record<string, GraphNode> = {}
    scenario.nodes.forEach((n) => (byId[n.id] = n))
    const reachedSet = new Set(reached)
    const afterSet = reachedAfter ? new Set(reachedAfter) : null
    const onPathSet = new Set(onPath)
    const pathSet = new Set(pathEdgeIds)
    const removedSet = new Set(removedEdges)

    const rfNodes: FapiNode[] = scenario.nodes.map((n) => {
      const isReached = reachedSet.has(n.id)
      return {
        id: n.id,
        type: 'fapi',
        position: { x: n.x, y: n.y },
        data: {
          node: n,
          reached: isReached,
          onPath: onPathSet.has(n.id),
          // After a fix: a node the attacker reached before but no longer can.
          cutOff: !!afterSet && isReached && !afterSet.has(n.id) && n.id !== scenario.entry,
        },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
      }
    })

    const rfEdges: FapiEdge[] = scenario.edges
      .filter((e: GraphEdge) => e.allowed || showDenied)
      .filter((e) => byId[e.source] && byId[e.destination])
      .map((e) => {
        const g = geometry(byId[e.source], byId[e.destination])
        const kind: EdgeKind = removedSet.has(e.edge_id)
          ? 'cut'
          : !e.allowed
            ? 'denied'
            : pathSet.has(e.edge_id)
              ? 'path'
              : 'allowed'
        return {
          id: e.edge_id,
          source: e.source,
          target: e.destination,
          type: 'fapi',
          data: { ...g, kind, animate },
          selectable: false,
          focusable: false,
          zIndex: kind === 'path' || kind === 'cut' ? 1 : 0,
        }
      })

    const maxY = Math.max(...scenario.nodes.map((n) => n.y))
    return { nodes: rfNodes, edges: rfEdges, height: Math.max(520, maxY + 90) }
  }, [scenario, reached, reachedAfter, onPath, pathEdgeIds, removedEdges, showDenied, animate])

  return (
    <div className="fapi-graph" style={{ height }}>
      <ReactFlow
        key={scenario.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
        minZoom={0.4}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        nodesFocusable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        aria-label="Attack path graph"
      />
    </div>
  )
}
