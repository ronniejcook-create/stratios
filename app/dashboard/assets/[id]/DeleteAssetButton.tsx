'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/DataGrid'
import type { AssetContents } from '@/lib/assets'
import { deleteAssetForever } from './actions'

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/**
 * Administrators only: deletes the asset after a warning that spells out
 * what goes with it. `contents` is null when the counts couldn't be read;
 * the warning then lists the same things without numbers.
 */
export function DeleteAssetButton({ assetId, name, contents }: { assetId: string; name: string; contents: AssetContents | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const remove = () => {
    setError(null)
    start(async () => {
      const result = await deleteAssetForever({ assetId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/dashboard')
      router.refresh()
    })
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-small danger" onClick={() => { setError(null); setOpen(true) }}>Delete Asset</button>
      <Modal open={open} title="Delete This Asset?" onClose={() => { if (!busy) setOpen(false) }}>
        <p className="modal-text">
          <strong>{name}</strong> and everything recorded for it will be permanently deleted:
        </p>
        <ul className="modal-list">
          <li>
            {contents
              ? `${count(contents.properties, 'property', 'properties')} and ${count(contents.buildings, 'building', 'buildings')}, with their floors, units and addresses`
              : 'Its properties, buildings, floors, units and addresses'}
          </li>
          <li>{contents ? `All data: ${count(contents.values, 'field value', 'field values')} and the full history of changes` : 'All data: every field value and the full history of changes'}</li>
          <li>{contents ? `Commentary and critical dates (${count(contents.listRows, 'row', 'rows')})` : 'Commentary and critical dates'}</li>
          <li>{contents ? `${count(contents.documents, 'uploaded document', 'uploaded documents')}, with the files and review lists` : 'Uploaded documents, with their files and review lists'}</li>
        </ul>
        <p className="modal-text modal-warning">This cannot be undone. Are you sure?</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="button-row modal-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} autoFocus onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, Delete Asset'}</button>
        </div>
      </Modal>
    </>
  )
}
