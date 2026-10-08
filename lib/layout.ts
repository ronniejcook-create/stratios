// Screens and sections: how fields and lists are arranged on the asset page.
// The Stratios standard layout (org_id null) is shared by every organization;
// an organization's own screens and sections sit beside it.

import type { Queryable, RecordType } from './records'

export type DisplayStyle = 'form' | 'tiles' | 'list'

export type Section = {
  id: string
  key: string
  name: string
  appliesTo: RecordType
  displayStyle: DisplayStyle
  /** The fields in this section, in order. Empty for a list section. */
  fieldIds: string[]
}

export type Screen = {
  id: string
  key: string
  name: string
  sections: Section[]
}

/** Every screen this organization sees, in order, each with its sections. */
export async function listScreens(client: Queryable, orgId: string): Promise<Screen[]> {
  const screens = await client.query(
    `select id::text as id, key, name from screens where org_id is null or org_id = $1 order by sort_order, name`,
    [orgId],
  )
  const sections = await client.query(
    `select id::text as id, screen_id::text as screen_id, key, name, applies_to, display_style
     from sections where org_id is null or org_id = $1 order by sort_order, name`,
    [orgId],
  )
  const allPlacements = await client.query(
    `select section_id::text as section_id, field_id::text as field_id, org_id
     from section_fields where org_id is null or org_id = $1 order by position, id`,
    [orgId],
  )
  // Where an organization has placed a field itself, that replaces the standard placement.
  const movedByOrg = new Set(allPlacements.rows.filter((row) => row.org_id !== null).map((row) => row.field_id as string))
  const placements = { rows: allPlacements.rows.filter((row) => row.org_id !== null || !movedByOrg.has(row.field_id)) }
  return screens.rows.map((screen) => ({
    id: screen.id,
    key: screen.key,
    name: screen.name,
    sections: sections.rows
      .filter((section) => section.screen_id === screen.id)
      .map((section) => ({
        id: section.id,
        key: section.key,
        name: section.name,
        appliesTo: section.applies_to,
        displayStyle: section.display_style,
        fieldIds: placements.rows.filter((placement) => placement.section_id === section.id).map((placement) => placement.field_id as string),
      })),
  }))
}
