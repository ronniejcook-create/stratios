'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeRole, saveRole, saveRolePeople, saveRoleRules, type RoleResult } from '../actions'

type Level = 'hidden' | 'view' | 'edit'
const LABELS: Record<Level, string> = { hidden: 'Hidden', view: 'View', edit: 'Edit' }
const CHOICES: Level[] = ['edit', 'view', 'hidden']

type LayoutScreen = {
  id: string
  name: string
  sections: { id: string; name: string; level: string; isList: boolean; fields: { id: string; name: string }[] }[]
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null
  return <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p>
}

/** One role: its name and default, the people who hold it, and its access to sections and fields. */
export function RoleEditor({
  role,
  rules,
  memberIds,
  people,
  layout,
}: {
  role: { id: string; name: string; defaultLevel: Level; isMember: boolean }
  rules: { sections: Record<string, Level>; fields: Record<string, Level> }
  memberIds: string[]
  people: { userId: string; name: string; email: string; admin: boolean }[]
  layout: LayoutScreen[]
}) {
  const router = useRouter()
  const [name, setName] = useState(role.name)
  const [defaultLevel, setDefaultLevel] = useState<Level>(role.defaultLevel)
  const [chosen, setChosen] = useState(() => new Set(memberIds))
  const [sectionRules, setSectionRules] = useState<Record<string, string>>(rules.sections)
  const [fieldRules, setFieldRules] = useState<Record<string, string>>(rules.fields)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [messages, setMessages] = useState<Record<string, { text: string; error: boolean } | null>>({})
  const [busy, startBusy] = useTransition()

  const run = (area: string, work: () => Promise<RoleResult>, after?: () => void) => {
    setMessages((current) => ({ ...current, [area]: null }))
    startBusy(async () => {
      const result = await work()
      setMessages((current) => ({ ...current, [area]: result.ok ? { text: result.message, error: false } : { text: result.error, error: true } }))
      if (!result.ok) return
      if (after) after()
      else router.refresh()
    })
  }

  const setRule = (kind: 'section' | 'field', id: string, level: string) => {
    const update = (current: Record<string, string>) => {
      const next = { ...current }
      if (level) next[id] = level
      else delete next[id]
      return next
    }
    if (kind === 'section') setSectionRules(update)
    else setFieldRules(update)
  }

  return (
    <>
      <section className="panel">
        <h2>Role</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            run('role', () => saveRole({ roleId: role.id, name, defaultLevel }))
          }}
        >
          <div className="form-row">
            <div className="field">
              <label htmlFor="role-name">Name</label>
              <input id="role-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required disabled={role.isMember} />
            </div>
            <div className="field">
              <label htmlFor="role-default">Default Access</label>
              <select id="role-default" value={defaultLevel} onChange={(e) => setDefaultLevel(e.target.value as Level)}>
                <option value="edit">Edit: See and Change Fields</option>
                <option value="view">View: See Fields Only</option>
                <option value="hidden">Hidden: See Nothing Unless Allowed</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>Save Role</button>
            {role.isMember ? null : confirmRemove ? (
              <>
                <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => run('role', () => removeRole({ roleId: role.id }), () => router.push('/dashboard/roles'))}>
                  Confirm Remove
                </button>
                <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove Role</button>
            )}
          </div>
          <p className="note">
            The default applies to every section and field without a rule below. A role whose default is Edit can also add assets, properties,
            buildings, floors, units and addresses.
            {confirmRemove ? ' Removing the role also removes its people and its rules.' : ''}
          </p>
          <Message message={messages.role ?? null} />
        </form>
      </section>

      {role.isMember ? null : (
        <section className="panel">
          <h2>People</h2>
          {people.length === 0 ? (
            <p className="empty">The organization&apos;s people could not be loaded.</p>
          ) : (
            <ul className="check-list">
              {people.map((person) => (
                <li key={person.userId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.has(person.userId)}
                      onChange={(e) =>
                        setChosen((current) => {
                          const next = new Set(current)
                          if (e.target.checked) next.add(person.userId)
                          else next.delete(person.userId)
                          return next
                        })
                      }
                    />
                    <span>{person.name || person.email}</span>
                    {person.name ? <span className="field-meta">{person.email}</span> : null}
                    {person.admin ? <span className="chip">Administrator</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => run('people', () => saveRolePeople({ roleId: role.id, userIds: [...chosen] }))}>
              Save People
            </button>
          </div>
          <p className="note">Administrators always have full access, so giving them a role changes nothing for them.</p>
          <Message message={messages.people ?? null} />
        </section>
      )}

      <section className="panel">
        <h2>Access to Sections and Fields</h2>
        <p className="note">
          Leave a section on Default to follow this role&apos;s default ({LABELS[defaultLevel]}). A field follows its section unless you give it its
          own level under Field Exceptions.
        </p>
        {layout.map((screen) => (
          <div key={screen.id} className="record-group">
            <h3>{screen.name}</h3>
            {screen.sections.length === 0 ? <p className="note">No sections on this screen.</p> : null}
            <ul className="rule-list">
              {screen.sections.map((section) => {
                const sectionLevel = sectionRules[section.id] ?? ''
                const effective = (sectionLevel || defaultLevel) as Level
                const exceptions = section.fields.filter((field) => fieldRules[field.id]).length
                return (
                  <li key={section.id}>
                    <div className="rule-line">
                      <span className="rule-name">
                        {section.name}
                        <span className="field-meta">{section.level}{section.isList ? ', List' : ''}</span>
                      </span>
                      <select aria-label={`Access to ${section.name} (${section.level})`} value={sectionLevel} onChange={(e) => setRule('section', section.id, e.target.value)}>
                        <option value="">Default ({LABELS[defaultLevel]})</option>
                        {CHOICES.map((level) => (
                          <option key={level} value={level}>{LABELS[level]}</option>
                        ))}
                      </select>
                    </div>
                    {section.fields.length > 0 ? (
                      <details className="rule-fields" open={exceptions > 0}>
                        <summary>Field Exceptions{exceptions > 0 ? ` (${exceptions})` : ''}</summary>
                        <ul>
                          {section.fields.map((field) => (
                            <li key={field.id} className="rule-line">
                              <span className="rule-name">{field.name}</span>
                              <select aria-label={`Access to ${field.name}`} value={fieldRules[field.id] ?? ''} onChange={(e) => setRule('field', field.id, e.target.value)}>
                                <option value="">Same as Section ({LABELS[effective]})</option>
                                {CHOICES.map((level) => (
                                  <option key={level} value={level}>{LABELS[level]}</option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="button-row">
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => run('rules', () => saveRoleRules({ roleId: role.id, sections: sectionRules, fields: fieldRules }))}>
            Save Access
          </button>
        </div>
        <Message message={messages.rules ?? null} />
      </section>
    </>
  )
}
