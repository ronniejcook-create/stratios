'use client'

import { useState } from 'react'
import { DataGrid, Modal, type GridColumn, type GridRow } from '@/components/DataGrid'
import { AddAssetForm } from './AddAssetForm'

const COLUMNS: GridColumn[] = [
  { key: 'name', label: 'Name', display: 'link' },
  { key: 'properties', label: 'Properties', numeric: true },
  { key: 'type', label: 'Type' },
  { key: 'city', label: 'City' },
]

/** The Assets list as a grid, with Add Asset in a pop-up for people allowed to add. */
export function AssetsGrid({ rows, canAdd, propertyTypes }: { rows: GridRow[]; canAdd: boolean; propertyTypes: readonly string[] }) {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <DataGrid
        columns={COLUMNS}
        rows={rows}
        noun="assets"
        searchColumns={['name', 'city']}
        searchPlaceholder="Search by name or city"
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
