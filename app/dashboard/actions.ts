'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createAssetWithDefaults, listPropertyTypes, matchPropertyType } from '@/lib/assets'
import { isMissingSchema, withOrg } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'

export type AddAssetState = { error: string | null }

export async function addAsset(_prev: AddAssetState, formData: FormData): Promise<AddAssetState> {
  // The organization always comes from the signed-in session, never the form.
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { error: 'You need to be signed in to an organization.' }

  const name = String(formData.get('name') ?? '').trim()
  const propertyType = String(formData.get('propertyType') ?? '')
  const city = String(formData.get('city') ?? '').trim()

  if (!name) return { error: 'Enter a name for the asset.' }
  if (name.length > 200) return { error: 'The name is too long.' }

  let assetId: string | null | 'no-type'
  try {
    assetId = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return null
      // The type has to be one the organization's Property Type list offers now.
      const type = matchPropertyType(await listPropertyTypes(client, orgId), propertyType)
      if (!type) return 'no-type' as const
      return createAssetWithDefaults(client, orgId, userId, { name, propertyType: type, city: city ? city.slice(0, 200) : null })
    })
  } catch (error) {
    console.error('addAsset failed', error)
    if (isMissingSchema(error)) return { error: 'The database needs an update before assets can be added. Run the newest file in db/migrations.' }
    return { error: 'The asset could not be saved. Try again.' }
  }
  if (assetId === 'no-type') return { error: 'Choose a property type.' }

  if (!assetId) return { error: "You don't have permission to add assets." }

  revalidatePath('/dashboard')
  // Open the new asset so its details can be filled in.
  redirect(`/dashboard/assets/${assetId}`)
}
