import { OrganizationProfile } from '@clerk/nextjs'

// Owners and admins invite colleagues, change roles and remove members here.
export default function MembersPage() {
  return (
    <>
      <h1>Members</h1>
      <p className="lede">People join your organization by email invitation only.</p>
      <div style={{ marginTop: 32 }}>
        <OrganizationProfile routing="hash" />
      </div>
    </>
  )
}
