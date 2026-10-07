'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { ASSET_TYPES, createAsset } from '@/lib/assets'

export type AddAssetState = { error: string | null }

export async function addAsset(_prev: AddAssetState, formData: FormData): Promise<AddAssetState> {
  // The organization always comes from the signed-in session, never the form.
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { error: 'You need to be signed in to an organization.' }

  const name = String(formData.get('name') ?? '').trim()
  const assetType = String(formData.get('assetType') ?? '')
  const city = String(formData.get('city') ?? '').trim()

  if (!name) return { error: 'Enter a name for the asset.' }
  if (name.length > 200) return { error: 'The name is too long.' }
  if (!(ASSET_TYPES as readonly string[]).includes(assetType)) return { error: 'Choose an asset type.' }

  try {
    await createAsset(orgId, userId, { name, assetType, city: city ? city.slice(0, 200) : null })
  } catch (error) {
    console.error('addAsset failed', error)
    return { error: 'The asset could not be saved. Try again.' }
  }

  revalidatePath('/dashboard')
  return { error: null }
}
