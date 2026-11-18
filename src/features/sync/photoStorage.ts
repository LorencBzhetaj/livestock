import { z } from 'zod'
import { animalPhotoSchema, maxPhotoBytes, photoTypes } from '../../db/models'
import { sha256 } from '../../lib/sha256'

export const photoMetadata = z.strictObject({
  id: z.uuid(), animalId: z.uuid(), mime: z.enum(photoTypes),
  size: z.number().int().positive().max(maxPhotoBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export type PhotoMetadata = z.infer<typeof photoMetadata>

// Implementations must upload and download through a farm-authorized, private server boundary.
export interface PrivatePhotoStorage {
  upload(metadata: PhotoMetadata, image: Blob): Promise<void>
  download(metadata: PhotoMetadata): Promise<Blob>
}

export async function verifiedPhoto(storage: PrivatePhotoStorage, metadata: PhotoMetadata, cached?: Blob) {
  const expected = photoMetadata.parse(metadata)
  const matches = async (image: Blob) => image.size === expected.size && image.type === expected.mime
    && await sha256(new Uint8Array(await image.arrayBuffer())) === expected.sha256
  if (cached && await matches(cached)) return cached
  const image = await storage.download(expected)
  if (!await matches(image)) throw new Error('Photograph integrity check failed')
  return animalPhotoSchema.parse({ animalId: expected.animalId, image }).image
}
