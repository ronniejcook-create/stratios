'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { PROPERTY_TYPES, createAssetWithDefaults } from '@/lib/assets'
import { isMissingSchema, withOrg } from '@/lib/db'

export type AddAssetState = { error: string | null }

export async function addAsset(_prev: AddAssetState, formData: FormData): Promise<AddAssetState> {
  // The organization always comes from the signed-in session, never the form.
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { error: 'You need to be signed in to an organization.' }

  const name = String(formData.get('name') ?? '').trim()
  const propertyType = String(formData.get('propertyType') ?? '')
  const city = String(formData.get('city') ?? '').trim()

  if (!name) return { error: 'Enter a name for the asset.' }
  if (name.length > 200) return { error: 'The name is too long.' }
  if (!(PROPERTY_TYPES as readonly string[]).includes(propertyType)) return { error: 'Choose a property type.' }

  let assetId: string
  try {
    assetId = await withOrg(orgId, (client) =>
      createAssetWithDefaults(client, orgId, userId, { name, propertyType, city: city ? city.slice(0, 200) : null }),
    )
  } catch (error) {
    console.error('addAsset failed', error)
    if (isMissingSchema(error)) return { error: 'The database needs an update before assets can be added. Run db/migrations/003_fields.sql.' }
    return { error: 'The asset could not be saved. Try again.' }
  }

  revalidatePath('/dashboard')
  // Open the new asset so its details can be filled in.
  redirect(`/dashboard/assets/${assetId}`)
}
