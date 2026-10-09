'use client'

import { useState } from 'react'
import { DataGrid, Modal, type GridColumn, type GridRow } from '@/components/DataGrid'
import { AddFieldForm, type FormAction, type LevelOption, type PlaceOption } from './Forms'

/**
 * The Fields Library grid, shared by the organization's page and the Stratios
 * one: the columns, and Add Field in a pop-up. Each page builds the rows on
 * the server with cells `name`, `belongsTo`, `fieldKey`, `type`, `shownIn`
 * and `status`, in the standard order (level, then where shown).
 */
export function FieldsGrid({
  rows,
  statusHeading,
  addTitle,
  addAction,
  levels,
  types,
  places,
}: {
  rows: GridRow[]
  /** The last column: "Status", or "Customized By" on the Stratios page. */
  statusHeading: string
  addTitle: string
  addAction?: FormAction
  levels: LevelOption[]
  types: LevelOption[]
  places: PlaceOption[]
}) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const columns: GridColumn[] = [
    { key: 'name', label: 'Name', display: 'link' },
    { key: 'belongsTo', label: 'Belongs To' },
    { key: 'fieldKey', label: 'Key', display: 'code' },
    { key: 'type', label: 'Type' },
    { key: 'shownIn', label: 'Shown In' },
    { key: 'status', label: statusHeading, display: 'chip' },
  ]

  return (
    <>
      <DataGrid
        columns={columns}
        rows={rows}
        noun="fields"
        searchColumns={['name', 'fieldKey']}
        searchPlaceholder="Search by name or key"
        toolbar={<button type="button" className="btn btn-primary btn-small" onClick={() => { setAdded(null); setAdding(true) }}>Add Field</button>}
        notice={added ? (
          <p className="review-notice" role="status">
            <span>{added}</span>
            <button type="button" className="review-notice-close" aria-label="Dismiss message" onClick={() => setAdded(null)}>×</button>
          </p>
        ) : null}
      />
      <Modal open={adding} title={addTitle} onClose={() => setAdding(false)}>
        <AddFieldForm
          action={addAction}
          levels={levels}
          types={types}
          places={places}
          onCancel={() => setAdding(false)}
          onDone={(message) => {
            setAdded(message)
            setAdding(false)
          }}
        />
      </Modal>
    </>
  )
}
