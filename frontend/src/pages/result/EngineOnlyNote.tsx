/** Empty state for the model-driven tabs when the run fell back to engine-only (TR-13). */
export function EngineOnlyNote({ what }: { what: string }) {
  return (
    <div className="card" style={{ maxWidth: '62ch' }}>
      <div className="card-kicker">Engine-only result</div>
      <div style={{ fontSize: 14 }}>{what}: the AI step was unavailable for this input.</div>
      <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
        Every number on the other tabs still comes from the engine. Run again with a Gemini key on the server, or use the sample input, which has a golden output.
      </div>
    </div>
  )
}
