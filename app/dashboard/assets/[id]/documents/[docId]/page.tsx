import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { getDocument, listFindings, listProposals, type Finding, type Outcome } from '@/lib/documents'
import { sectionByField } from '@/lib/extraction'
import { formatPeriod, formatValue, isEmptyValue } from '@/lib/fieldFormat'
import { listFields, listSourceTypes, type FieldDefinition } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { loadAccess } from '@/lib/permissions'
import { getAssetTree, isUuid, RECORD_LABELS } from '@/lib/records'
import { DecisionButtons, ProposalButtons, ReadButton, RemoveButton, ReviewNotices, ReviewSection } from './ReviewControls'

export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<string, string> = { text: 'Text', number: 'Number', money: 'Money', percent: 'Percent', date: 'Date', boolean: 'Yes / No' }
const CONFIDENCE_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

const GROUPS: { outcome: Outcome; title: string; note: string }[] = [
  { outcome: 'filled', title: 'Filled In', note: 'These fields were empty, so the document\'s value was filled in.' },
  { outcome: 'replaced', title: 'Replaced', note: 'These fields are set to replace automatically, so the document\'s value took the place of the earlier one. The change is in each field\'s history.' },
  { outcome: 'confirmed', title: 'Confirmed', note: 'The document agrees with what was already recorded. Nothing changed.' },
  { outcome: 'kept', title: 'Different, but Kept', note: 'These fields are set to never replace, so the recorded value was kept. The difference is shown for your information.' },
]

function when(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function DocumentReviewPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  const { id: assetId, docId } = await params
  if (!isDatabaseConfigured() || !isUuid(assetId) || !isUuid(docId)) notFound()
  const isAdmin = orgRole === 'org:admin'

  let loaded
  try {
    loaded = await withOrg(orgId, async (client) => {
      const document = await getDocument(client, orgId, docId)
      if (!document || document.assetId !== assetId || document.status === 'uploading') return null
      const tree = await getAssetTree(client, orgId, assetId)
      if (!tree) return null
      return {
        document,
        tree,
        findings: await listFindings(client, orgId, docId),
        proposals: await listProposals(client, orgId, docId),
        fields: await listFields(client, orgId),
        sections: sectionByField(await listScreens(client, orgId)),
        sources: await listSourceTypes(client),
        access: await loadAccess(client, orgId, userId, isAdmin),
      }
    })
  } catch (error) {
    console.error('DocumentReviewPage failed', error)
    return (
      <>
        <h1>Document</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'This Document Could Not Be Loaded'}</h2>
          <p>{isMissingSchema(error) ? 'Run db/migrations/008_documents.sql against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }
  if (!loaded) notFound()
  const { document, tree, findings, proposals, fields, sections, sources, access } = loaded

  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const sourceName = (key: string | null) => (key ? sources.find((source) => source.key === key)?.name ?? key : '')
  const recordNames = new Map<string, string>([[tree.id, tree.name]])
  for (const property of tree.properties) {
    recordNames.set(property.id, property.name)
    for (const building of property.buildings) recordNames.set(building.id, `${property.name} / ${building.name}`)
  }
  const backHref = `/dashboard/assets/${tree.id}?screen=_documents`
  // The file, the agent's summary and its proposed fields can mention anything in the document,
  // so they are shown only to people who may add documents (administrators and roles that can edit).
  const canOpenFile = access.canAddRecords
  const fileHref = `/api/documents/${document.id}/file`

  // A person sees only the findings for fields they may see; the rest never reach the browser.
  type Row = { finding: Finding; field: FieldDefinition; canEdit: boolean }
  const rows: Row[] = findings.flatMap((finding) => {
    const field = fieldById.get(finding.fieldId)
    if (!field) return []
    const level = access.fieldLevel(field.id, sections.get(field.id) ?? null)
    return level === 'hidden' ? [] : [{ finding, field, canEdit: level === 'edit' }]
  })
  const hiddenCount = findings.length - rows.length
  const waiting = rows.filter((row) => row.finding.outcome === 'decision' && row.finding.decision === null)
  const decided = rows.filter((row) => row.finding.outcome === 'decision' && row.finding.decision !== null)
  const openProposals = canOpenFile ? proposals.filter((proposal) => proposal.status === 'proposed') : []
  const settledProposals = canOpenFile ? proposals.filter((proposal) => proposal.status !== 'proposed') : []

  const pageLink = (page: number | null) =>
    page === null ? null : canOpenFile ? (
      <a href={`${fileHref}#page=${page}`} target="_blank" rel="noreferrer">p. {page}</a>
    ) : (
      <span>p. {page}</span>
    )

  const fieldCell = ({ finding, field }: Row) => (
    <td>
      <span className="review-field">{field.name}</span>
      <div className="doc-sub">
        {RECORD_LABELS[finding.recordType]}: {recordNames.get(finding.recordId) ?? 'Removed'}
        {finding.period ? ` · ${formatPeriod(finding.period)}` : ''}
      </div>
    </td>
  )
  const foundCell = ({ finding, field }: Row) => (
    <td>
      <span className="review-value">{formatValue(field, finding.value)}</span>
      {finding.quote ? <div className="doc-sub review-quote">“{finding.quote}”</div> : null}
    </td>
  )
  const currentCell = ({ finding, field }: Row) => (
    <td>
      {isEmptyValue(finding.current) ? <span className="muted">Empty</span> : <span className="review-value">{formatValue(field, finding.current)}</span>}
      {finding.currentSource && !isEmptyValue(finding.current) ? <div className="doc-sub">{sourceName(finding.currentSource)}</div> : null}
    </td>
  )
  const whereCell = ({ finding }: Row) => (
    <td className="review-where">
      {pageLink(finding.page)}
      {finding.confidence ? <span className={`chip chip-${finding.confidence}`}>{CONFIDENCE_LABELS[finding.confidence]} Confidence</span> : null}
    </td>
  )
  const reasonText = (finding: Finding) =>
    finding.reason === 'empty' ? 'This field asks before it is filled in.' :
    finding.reason === 'manual' ? 'The current value was entered by hand, and this field keeps hand-entered values until someone changes them.' :
    'The document differs from the current value, and this field asks which to keep.'

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard">Assets</Link>
        <span aria-hidden="true"> / </span>
        <Link href={backHref}>{tree.name}</Link>
        <span aria-hidden="true"> / </span>
        <span>{document.name}</span>
      </p>
      <h1>{document.name}</h1>
      <p className="lede">
        {[document.documentType, `Uploaded ${when(document.uploadedAt)}`, document.readAt ? `Read ${when(document.readAt)}` : null].filter(Boolean).join(' · ')}
      </p>

      <section className="panel">
        <h2>Summary</h2>
        {document.status === 'read' ? (
          <>
            {document.summary && canOpenFile ? <p>{document.summary}</p> : null}
            <p className="note">
              {rows.length === 0 && openProposals.length === 0
                ? 'The agent found no values for your fields in this document.'
                : `The agent found ${rows.length} ${rows.length === 1 ? 'value' : 'values'}: ${[
                    `${rows.filter((row) => row.finding.outcome === 'filled').length} filled in`,
                    `${rows.filter((row) => row.finding.outcome === 'confirmed').length} confirmed`,
                    `${rows.filter((row) => row.finding.outcome === 'replaced').length} replaced`,
                    `${waiting.length} waiting for a decision`,
                    `${rows.filter((row) => row.finding.outcome === 'kept').length} kept as they were`,
                  ].join(', ')}.`}
              {hiddenCount > 0 ? ` ${hiddenCount} more ${hiddenCount === 1 ? 'is for a field' : 'are for fields'} your role cannot see.` : ''}
            </p>
          </>
        ) : document.status === 'reading' && !document.stalled ? (
          <p className="note">The agent is reading this document. Reload this page in a minute or two.</p>
        ) : (
          <>
            {document.status === 'failed' && document.error ? <p className="form-error" role="alert">The document could not be read: {document.error}</p> : null}
            {document.status === 'uploaded' ? <p className="note">This document has been uploaded but not read yet.</p> : null}
            {document.stalled ? <p className="note">Reading this document stopped before it finished.</p> : null}
            {access.canAddRecords ? <ReadButton documentId={document.id} label={document.status === 'uploaded' ? 'Read Document' : 'Try Again'} /> : null}
          </>
        )}
        <div className="button-row">
          {canOpenFile ? <a className="btn btn-ghost btn-small" href={fileHref} target="_blank" rel="noreferrer">Open Document</a> : null}
          {isAdmin || document.uploadedBy === userId ? <RemoveButton documentId={document.id} backHref={backHref} /> : null}
        </div>
      </section>

      <ReviewNotices>
      <ReviewSection area="decisions" title="Needs a Decision" empty={waiting.length === 0}>
          <p className="note">Nothing here has changed yet. Choose which value to keep for each one.</p>
          <div className="table-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Field</th><th>Current Value</th><th>Document Says</th><th>Where</th><th>Your Choice</th></tr>
              </thead>
              <tbody>
                {waiting.map((row) => (
                  <tr key={row.finding.id}>
                    {fieldCell(row)}
                    {currentCell(row)}
                    {foundCell(row)}
                    {whereCell(row)}
                    <td>
                      <div className="doc-sub">{reasonText(row.finding)}</div>
                      {row.canEdit ? (
                        <DecisionButtons findingId={row.finding.id} keepLabel={isEmptyValue(row.finding.current) ? 'Leave Empty' : 'Keep Current'} />
                      ) : (
                        <span className="note">Your role can view this field but not change it.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </ReviewSection>

      <ReviewSection area="proposals" title="Proposed New Fields" empty={openProposals.length === 0}>
          <p className="note">
            The agent found these in the document, and they match none of your fields.
            {isAdmin ? ' Adding one creates the field for your organization and fills in the value.' : ' An administrator can add them.'}
          </p>
          <div className="table-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Suggested Field</th><th>Value Found</th><th>Where</th>{isAdmin ? <th>Your Choice</th> : null}</tr>
              </thead>
              <tbody>
                {openProposals.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>
                      <span className="review-field">{proposal.name}</span>
                      <div className="doc-sub">{TYPE_LABELS[proposal.dataType]} · {RECORD_LABELS[proposal.recordType]}: {recordNames.get(proposal.recordId) ?? 'Removed'}</div>
                      {proposal.reason ? <div className="doc-sub">{proposal.reason}</div> : null}
                    </td>
                    <td><span className="review-value">{proposal.value}</span></td>
                    <td className="review-where">{pageLink(proposal.page)}</td>
                    {isAdmin ? <td><ProposalButtons proposalId={proposal.id} /></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </ReviewSection>
      </ReviewNotices>

      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.finding.outcome === group.outcome)
        if (groupRows.length === 0) return null
        const showCurrent = group.outcome === 'replaced' || group.outcome === 'kept'
        return (
          <section key={group.outcome} className="panel">
            <h2>{group.title}</h2>
            <p className="note">{group.note}</p>
            <div className="table-scroll">
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    {showCurrent ? <th>{group.outcome === 'replaced' ? 'Was' : 'Recorded Value'}</th> : null}
                    <th>Document Says</th>
                    <th>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <tr key={row.finding.id}>
                      {fieldCell(row)}
                      {showCurrent ? currentCell(row) : null}
                      {foundCell(row)}
                      {whereCell(row)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {decided.length > 0 || settledProposals.length > 0 ? (
        <section className="panel">
          <h2>Already Decided</h2>
          <div className="table-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Field</th><th>Document Says</th><th>Decision</th></tr>
              </thead>
              <tbody>
                {decided.map((row) => (
                  <tr key={row.finding.id}>
                    {fieldCell(row)}
                    {foundCell(row)}
                    <td>{row.finding.decision === 'accepted' ? 'Document\'s value used' : isEmptyValue(row.finding.current) ? 'Left empty' : 'Current value kept'}</td>
                  </tr>
                ))}
                {settledProposals.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>
                      <span className="review-field">{proposal.name}</span>
                      <div className="doc-sub">Proposed field</div>
                    </td>
                    <td><span className="review-value">{proposal.value}</span></td>
                    <td>{proposal.status === 'added' ? 'Field added' : 'Dismissed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
