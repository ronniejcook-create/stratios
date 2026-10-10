'use client'

import { useMemo, useState } from 'react'
import { DataGrid, Modal, type GridColumn, type GridRow } from '@/components/DataGrid'
import { AddAssetForm } from './AddAssetForm'

const COLUMNS: GridColumn[] = [
  { key: 'name', label: 'Name', display: 'link' },
  { key: 'properties', label: 'Properties', numeric: true },
  { key: 'type', label: 'Type' },
  { key: 'city', label: 'City' },
]

/** The Assets list as a grid, with Add Asset in a pop-up for people allowed to add. */
export function AssetsGrid({ rows, canAdd, propertyTypes, extraColumns = [] }: { rows: GridRow[]; canAdd: boolean; propertyTypes: readonly string[]; extraColumns?: { key: string; label: string }[] }) {
  const [adding, setAdding] = useState(false)
  // Location columns (flood zone, school district) follow the built-in ones when the person may see them.
  const columns = useMemo<GridColumn[]>(() => [...COLUMNS, ...extraColumns.map((column) => ({ key: column.key, label: column.label }))], [extraColumns])
  return (
    <>
      <DataGrid
        columns={columns}
        rows={rows}
        noun="assets"
        searchColumns={['name', 'city']}
        searchPlaceholder="Search by name or city"
        thumbnails={rows.some((row) => row.image)}
        emptyText={canAdd ? 'No assets yet. Use Add Asset to create the first one.' : 'No assets yet.'}
        toolbar={canAdd ? <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add Asset</button> : null}
      />
      {canAdd ? (
        <Modal open={adding} title="Add an Asset" onClose={() => setAdding(false)}>
          <AddAssetForm propertyTypes={propertyTypes} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}
    </>
  )
}
