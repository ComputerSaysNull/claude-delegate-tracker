// Power BI–style tooltip card for the History day charts: a title, one row per series with
// a short colour stroke, and (when given) a divider and a total row.
export function ChartTooltip({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; value: string; swatch: string }[];
  total?: { label: string; value: string };
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none min-w-[11rem] rounded-lg border border-line bg-card p-2 text-[12.5px] shadow"
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span className={`h-0.5 w-2.5 rounded-full ${r.swatch}`} aria-hidden="true" />
            <span className="flex-1 text-muted">{r.label}</span>
            <span className="font-mono tabular-nums font-semibold text-text">{r.value}</span>
          </div>
        ))}
      </div>
      {total !== undefined && (
        <>
          <hr role="separator" className="my-1.5 border-line" />
          <div className="flex items-center gap-1.5">
            <span className="flex-1 text-muted">{total.label}</span>
            <span className="font-mono tabular-nums font-semibold text-text">{total.value}</span>
          </div>
        </>
      )}
    </div>
  );
}
