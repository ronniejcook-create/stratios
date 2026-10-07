import { OrganizationList } from '@clerk/nextjs'

// Shown when a signed-in user has no active organization. They can accept a
// pending invitation, pick an organization they belong to, or create one.
export default function Page() {
  return (
    <main className="auth-page">
      <OrganizationList
        hidePersonal
        afterCreateOrganizationUrl="/dashboard"
        afterSelectOrganizationUrl="/dashboard"
      />
    </main>
  )
}
