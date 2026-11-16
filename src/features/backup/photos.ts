import { animalPhotoSchema } from '../../db/models'
import { BackupError, type BackupData } from './format'

type EncodedPhoto = BackupData['animalPhotos'][number]

export async function encodePhoto(photo: unknown): Promise<EncodedPhoto> {
  const { image, animalId } = animalPhotoSchema.parse(photo)
  const bytes = new Uint8Array(await image.arrayBuffer())
  const mimeType = image.type as EncodedPhoto['mimeType']
  verifySignature(bytes, mimeType)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
  }
  return { animalId, mimeType, size: bytes.length, base64: btoa(binary) }
}

const signatures: Record<EncodedPhoto['mimeType'], number[]> = {
  'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
  'image/jpeg': [255, 216, 255],
  'image/webp': [82, 73, 70, 70],
}

function verifySignature(bytes: Uint8Array, mimeType: EncodedPhoto['mimeType']) {
  if (!signatures[mimeType].every((byte, index) => bytes[index] === byte) ||
      (mimeType === 'image/webp' && String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP')) throw new BackupError('photos')
}

export async function decodePhoto({ animalId, mimeType, size, base64 }: EncodedPhoto) {
  try {
    if (base64.length !== 4 * Math.ceil(size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error()
    const binary = atob(base64)
    if (binary.length !== size) throw new Error()
    const bytes = new Uint8Array(size)
    for (let index = 0; index < size; index++) bytes[index] = binary.charCodeAt(index)
    verifySignature(bytes, mimeType)
    const image = new Blob([bytes], { type: mimeType })
    if (typeof Image !== 'undefined') {
      const url = URL.createObjectURL(image)
      try {
        const decoded = new Image()
        decoded.src = url
        await decoded.decode()
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    return animalPhotoSchema.parse({ animalId, image })
  } catch {
    throw new BackupError('photos')
  }
}
