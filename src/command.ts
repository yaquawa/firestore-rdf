import { Fzf } from 'fzf'
import inquirer from 'inquirer'
import { initializeApp } from 'firebase-admin/app'
import { ConfigCache, getCollectionOrCollectionGroup, requiredField } from './utils'
import inquirerAutocompletePrompt from 'inquirer-autocomplete-prompt'
import { getFirestore, FieldValue, Firestore, QueryDocumentSnapshot, Query } from 'firebase-admin/firestore'

inquirer.registerPrompt('autocomplete', inquirerAutocompletePrompt)

export default async function runCommand() {
  const { firestore } = setupApp(await getInputForSetupApp())
  const { collectionName, oldFieldName, newFieldName } = await getInputForRenaming(firestore)

  await main({
    collectionName,
    oldFieldName,
    newFieldName,
    firestore,
  })
}

async function getInputForSetupApp() {
  const configCache = new ConfigCache<{
    projectId: string
    privateKeyFilePath: string
  }>({ vendor: 'firestore-rdf' })

  const cache = configCache.get()

  const input = await inquirer.prompt<{
    useEmulator: boolean
    emulatorHost: string
    projectId: string
    privateKeyFilePath: string
  }>([
    {
      type: 'confirm',
      name: 'useEmulator',
      message: 'Do you want to use emulator?',
      default: true,
    },

    {
      type: 'input',
      name: 'emulatorHost',
      message: 'Input your firestore emulator host.',
      default: 'localhost:8080',
      validate: requiredField(),
      when(answers) {
        return answers.useEmulator
      },
    },

    {
      type: 'input',
      name: 'projectId',
      message: 'Input your project-id.',
      validate: requiredField(),
      default: () => {
        return cache?.projectId
      },
      when(answers) {
        return answers.useEmulator
      },
    },

    {
      type: 'input',
      name: 'privateKeyFilePath',
      message: 'Input the path of your private key file.',
      default: () => {
        return cache?.privateKeyFilePath
      },
      when(answers) {
        return !answers.useEmulator
      },
      validate: requiredField(),
    },
  ])

  configCache.write({
    privateKeyFilePath: input.privateKeyFilePath,
    projectId: input.projectId,
  })

  return input
}

async function getInputForRenaming(firestore: Firestore) {
  const collectionName = await getCollectionName(firestore)

  async function getFieldNames({ samplingNumber }: { samplingNumber: number }) {
    const query = await getCollectionOrCollectionGroup(firestore, collectionName)

    const docs = await query!.limit(samplingNumber).get()
    const fieldNames = new Set<string>()

    docs.forEach((doc) => {
      Object.keys(doc.data()).forEach((fieldName) => {
        fieldNames.add(fieldName)
      })
    })

    return Array.from(fieldNames)
  }

  const fieldNames = await getFieldNames({ samplingNumber: 10 })
  const fzf = new Fzf(fieldNames)

  const { oldFieldName, newFieldName } = await inquirer.prompt<{
    oldFieldName: string
    newFieldName: string
  }>([
    {
      type: 'autocomplete',
      name: 'oldFieldName',
      message: 'Input the field name.',
      emptyText: '...',
      suggestOnly: true,
      validate: requiredField(),
      async source(_: any, input: string = '') {
        return fzf.find(input).map((entry) => entry.item)
      },
    },

    {
      type: 'input',
      name: 'newFieldName',
      message: 'Input the new field name.',
      validate: requiredField(),
    },
  ])

  return { collectionName, oldFieldName, newFieldName }
}

async function getCollectionName(firestore: Firestore) {
  const collectionNames = (await firestore.listCollections()).map(({ id }) => id)
  const fzf = new Fzf(collectionNames)

  const { collectionName } = await inquirer.prompt<{
    collectionName: string
  }>([
    {
      type: 'autocomplete',
      name: 'collectionName',
      message: 'Input the collection name.',
      emptyText: 'No root collections found, assuming this is a collection-group name.',
      suggestOnly: true,
      async validate(input: string) {
        if (!input) return requiredField()(input)

        const inRootCollections = collectionNames.includes(input)
        if (inRootCollections) return true

        const hasCollectionGroup = (await firestore.collectionGroup(input).limit(1).get()).size

        return hasCollectionGroup ? true : `Couldn't find a collection-group with name '${input}'.`
      },
      async source(_: any, input: string = '') {
        return fzf.find(input).map((entry) => entry.item)
      },
    },
  ])

  return collectionName
}

function setupApp({
  useEmulator,
  emulatorHost,
  projectId,
  privateKeyFilePath,
}: {
  useEmulator: boolean
  emulatorHost: string
  projectId: string
  privateKeyFilePath: string
}) {
  if (useEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost
    process.env.GOOGLE_CLOUD_PROJECT = projectId
  } else {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = privateKeyFilePath
  }

  const app = initializeApp()
  const firestore = getFirestore(app)

  return { app, firestore }
}

async function main({
  collectionName,
  oldFieldName,
  newFieldName,
  firestore,
}: {
  collectionName: string
  oldFieldName: string
  newFieldName: string
  firestore: Firestore
}) {
  const collectionOrCollectionGroup = await getCollectionOrCollectionGroup(firestore, collectionName)

  if (!collectionOrCollectionGroup) {
    throw new Error(`The collection named '${collectionName}' was not found.`)
  }

  await renameFieldName(collectionOrCollectionGroup, oldFieldName, newFieldName)
}

async function renameFieldName(query: Query, oldFieldName: string, newFieldName: string) {
  for await (const chunk of query.stream()) {
    const documentSnapshot = chunk as unknown as QueryDocumentSnapshot
    const docData = documentSnapshot.data()
    const docRef = documentSnapshot.ref
    const docId = documentSnapshot.id

    for (const [key, value] of Object.entries(docData)) {
      if (key !== oldFieldName) continue

      console.log(`Rename field '${oldFieldName}' -> '${newFieldName}' of document '${docId}'`)

      await docRef.update({
        [oldFieldName]: FieldValue.delete(),
        [newFieldName]: value,
      })
    }
  }

  console.log('✨ Done!')
}
