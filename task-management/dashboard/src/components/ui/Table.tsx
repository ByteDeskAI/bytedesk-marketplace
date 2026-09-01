import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  num?: boolean;
  width?: string;
}

/** Semantic table; rows stack under 720 px with the header repeated per cell via data-label. */
export function Table<T>({ columns, rows, rowKey, onRow, empty, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRow?: (row: T) => void; empty?: ReactNode; caption?: string }) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="tm-table-wrap">
      <table className="tm-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-num={c.num || undefined} style={c.width ? { width: c.width } : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} data-interactive={onRow ? true : undefined} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
              {columns.map((c) => (
                <td key={c.key} data-label={typeof c.header === "string" ? c.header : c.key} data-num={c.num || undefined}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
