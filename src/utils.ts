import fs from 'fs'
import path from 'path'
import { Firestore } from 'firebase-admin/lib/firestore'

export class ConfigCache<T> {
  cacheFilePath: string

  constructor({ vendor }: { vendor: string }) {
    const cacheDir = path.join(process.cwd(), 'node_modules', '.cache', vendor)
    this.cacheFilePath = path.join(cacheDir, 'config.json')
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  get(): T | null {
    try {
      const content = fs.readFileSync(this.cacheFilePath, {
        encoding: 'utf-8',
      })

      return JSON.parse(content)
    } catch (e: unknown) {
      return null
    }
  }

  write(data: T) {
    const content = JSON.stringify(data)
    fs.writeFileSync(this.cacheFilePath, content, {
      encoding: 'utf-8',
    })
  }
}

export function requiredField(fieldName: string = 'Value') {
  return (value: string) => {
    return value ? true : `${fieldName} can not be empty.`
  }
}

export async function getCollectionOrCollectionGroup(firestore: Firestore, collectionName: string) {
  const rootCollectionRef = firestore.collection(collectionName)
  const hasRootCollection = (await rootCollectionRef.limit(1).get()).size

  if (hasRootCollection) return rootCollectionRef

  const collectionGroupRef = firestore.collectionGroup(collectionName)
  const hasCollectionGroup = (await collectionGroupRef.limit(1).get()).size

  return hasCollectionGroup ? collectionGroupRef : null
}
