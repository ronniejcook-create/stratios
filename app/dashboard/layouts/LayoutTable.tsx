import type { FieldDefinition } from '@/lib/fields'
import type { Screen } from '@/lib/layout'
import type { ListDefinition } from '@/lib/lists'
import { RECORD_LABELS } from '@/lib/records'
import { DownloadButton } from '@/components/DownloadButton'

const STYLE_LABELS: Record<string, string> = { form: 'Form', tiles: 'Tiles', list: 'List' }

/** Every screen with its sections, and what each section holds. Shared by Layouts and the Stratios Master Layouts. */
export function LayoutTable({ screens, lists, fields }: { screens: Screen[]; lists: ListDefinition[]; fields: FieldDefinition[] }) {
  if (screens.length === 0) return <p className="empty">No screens yet.</p>
  const contains = (section: Screen['sections'][number]) => {
    const sectionLists = lists.filter((list) => list.sectionId === section.id)
    const columns = fields.filter((field) => sectionLists.some((list) => list.id === field.listId)).length
    return section.displayStyle === 'list' ? `${columns} ${columns === 1 ? 'column' : 'columns'}` : `${section.fieldIds.length} ${section.fieldIds.length === 1 ? 'field' : 'fields'}`
  }
  // In the download every row names its screen, so the rows can be sorted and filtered.
  const exported = screens.flatMap((screen) =>
    screen.sections.length === 0 ? [[screen.name, '', '', '', '']] : screen.sections.map((section) => [screen.name, section.name, RECORD_LABELS[section.appliesTo], STYLE_LABELS[section.displayStyle], contains(section)]),
  )
  return (
    <>
    <div className="table-tools">
      <DownloadButton name="Layout" header={['Screen', 'Section', 'Belongs To', 'Shown As', 'Contains']} rows={exported} />
    </div>
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Screen</th>
            <th scope="col">Section</th>
            <th scope="col">Belongs To</th>
            <th scope="col">Shown As</th>
            <th scope="col">Contains</th>
          </tr>
        </thead>
        <tbody>
          {screens.flatMap((screen) =>
            screen.sections.length === 0
              ? [
                  <tr key={screen.id}>
                    <td>{screen.name}</td>
                    <td colSpan={4} className="muted">No sections yet</td>
                  </tr>,
                ]
              : screen.sections.map((section, index) => {
                  const sectionLists = lists.filter((list) => list.sectionId === section.id)
                  const columns = fields.filter((field) => sectionLists.some((list) => list.id === field.listId)).length
                  return (
                    <tr key={section.id}>
                      <td>{index === 0 ? screen.name : ''}</td>
                      <td>{section.name}</td>
                      <td>{RECORD_LABELS[section.appliesTo]}</td>
                      <td>{STYLE_LABELS[section.displayStyle]}</td>
                      <td>{section.displayStyle === 'list' ? `${columns} ${columns === 1 ? 'column' : 'columns'}` : `${section.fieldIds.length} ${section.fieldIds.length === 1 ? 'field' : 'fields'}`}</td>
                    </tr>
                  )
                }),
          )}
        </tbody>
      </table>
    </div>
    </>
  )
}
