import type JSZip from 'jszip'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'

export type BackupSettings = {
  syriaEnabled: boolean
  exchangeRate: number
  darkMode: boolean
  favoritesEnabled: boolean
  retailPricesEnabled: boolean
  retailProfitPercentage: number
}

type BackupDocument = { id: string; data: Record<string, unknown> }
type CloudinaryBackup = { cloudName: string; uploadPreset: string } | null
type BackupPayload = {
  sourceDataUserId: string
  products: BackupDocument[]
  categories: BackupDocument[]
  userSettings: BackupSettings
  invoiceCounter: number | null
  localSettings: BackupSettings
  cloudinarySettings: CloudinaryBackup
}
type BackupManifest = {
  format: string
  formatVersion: number
  createdAt: string
  appVersion: string
  sourceDataUserId: string
  references: {
    products: string
    categories: string
    categoryField: string
    userSettings: string
    localSettings: string
    cloudinarySettings: string
  }
  counts: {
    products: number
    categories: number
    settings: number
  }
  integrity: { algorithm: 'SHA-256'; dataJson: string }
}

export type ValidatedBackup = { manifest: BackupManifest; payload: BackupPayload }
export type RestoreMode = 'replace' | 'merge'
type PlannedDocument = { id: string; data: Record<string, unknown> }
type PlannedCloudinaryAction = { kind: 'set'; data: Record<string, unknown> } | { kind: 'delete' } | { kind: 'skip' }
type ZipEntryInfo = {
  name: string
  compression: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  sizeLimit: number
}

export type RestorePlan = {
  mode: RestoreMode
  ownerId: string
  authUid: string
  backup: ValidatedBackup
  categoriesToWrite: PlannedDocument[]
  productsToWrite: PlannedDocument[]
  productsToDelete: string[]
  categoriesToDelete: string[]
  expectedCategories: Map<string, Record<string, unknown>>
  expectedProducts: Map<string, Record<string, unknown>>
  cloudinaryAction: PlannedCloudinaryAction
  invoiceCounter: number | null
  targetProductCount: number
  targetCategoryCount: number
  targetSettingsCount: number
  targetHasCloudinarySettings: boolean
  skippedProducts: number
  skippedCategories: number
  remappedIds: number
  settingsToRestore: BackupSettings
  localSettingsToRestore: BackupSettings
}

const backupFormat = 'asaar-user-backup'
const backupFormatVersion = 1
const maxArchiveBytes = 80 * 1024 * 1024
const maxJsonBytes = 64 * 1024 * 1024
const firestoreBatchSize = 450
const firestoreBatchByteLimit = 8 * 1024 * 1024
const settingsFields: (keyof BackupSettings)[] = [
  'syriaEnabled',
  'exchangeRate',
  'darkMode',
  'favoritesEnabled',
  'retailPricesEnabled',
  'retailProfitPercentage',
]

declare const __APP_VERSION__: string

function operationError(message: string): Error {
  return new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedSettings(value: unknown): BackupSettings {
  const data = isRecord(value) ? value : {}
  const exchangeRate = typeof data.exchangeRate === 'number' && Number.isFinite(data.exchangeRate) && data.exchangeRate > 0
    ? data.exchangeRate
    : 0
  const retailProfitPercentage = typeof data.retailProfitPercentage === 'number' && Number.isFinite(data.retailProfitPercentage)
    ? Math.min(Math.max(data.retailProfitPercentage, 0), 100)
    : 0
  return {
    syriaEnabled: data.syriaEnabled === true,
    exchangeRate,
    darkMode: data.darkMode === true,
    favoritesEnabled: data.favoritesEnabled === true,
    retailPricesEnabled: data.retailPricesEnabled !== false,
    retailProfitPercentage,
  }
}

function assertSettings(value: unknown, label: string): BackupSettings {
  if (!isRecord(value)
    || typeof value.syriaEnabled !== 'boolean'
    || typeof value.exchangeRate !== 'number'
    || !Number.isFinite(value.exchangeRate)
    || value.exchangeRate < 0
    || typeof value.darkMode !== 'boolean'
    || typeof value.favoritesEnabled !== 'boolean'
    || typeof value.retailPricesEnabled !== 'boolean'
    || typeof value.retailProfitPercentage !== 'number'
    || !Number.isFinite(value.retailProfitPercentage)
    || value.retailProfitPercentage < 0
    || value.retailProfitPercentage > 100) {
    throw operationError(`إعدادات ${label} في النسخة غير صالحة.`)
  }
  return {
    syriaEnabled: value.syriaEnabled,
    exchangeRate: value.exchangeRate,
    darkMode: value.darkMode,
    favoritesEnabled: value.favoritesEnabled,
    retailPricesEnabled: value.retailPricesEnabled,
    retailProfitPercentage: value.retailProfitPercentage,
  }
}

function assertDocumentId(id: unknown, label: string): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.includes('/') || new TextEncoder().encode(id).length > 1500) {
    throw operationError(`معرّف ${label} غير صالح في النسخة.`)
  }
}

function assertBackupDocument(value: unknown, kind: 'product' | 'category'): BackupDocument {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw operationError('بيانات أحد المستندات غير صالحة.')
  }
  assertDocumentId(value.id, kind === 'product' ? 'المنتج' : 'الفئة')
  if (typeof value.data.name !== 'string' || !value.data.name.trim()) {
    throw operationError(kind === 'product' ? 'يوجد منتج بلا اسم صالح.' : 'توجد فئة بلا اسم صالح.')
  }
  if (kind === 'product') {
    if (typeof value.data.price !== 'number' || !Number.isFinite(value.data.price) || value.data.price <= 0) {
      throw operationError('يوجد منتج بسعر غير صالح في النسخة.')
    }
    if (value.data.number !== undefined && (!Number.isSafeInteger(value.data.number) || Number(value.data.number) <= 0)) {
      throw operationError('يوجد منتج برقم تسلسلي غير صالح في النسخة.')
    }
    if (value.data.isFavorite !== undefined && typeof value.data.isFavorite !== 'boolean') {
      throw operationError('قيمة المفضلة لأحد المنتجات غير صالحة.')
    }
    if (value.data.categoryId !== undefined && value.data.categoryId !== null && typeof value.data.categoryId !== 'string') {
      throw operationError('علاقة تصنيف أحد المنتجات غير صالحة.')
    }
    if (value.data.imageUrl !== undefined && typeof value.data.imageUrl !== 'string') {
      throw operationError('رابط صورة أحد المنتجات غير صالح.')
    }
  }
  return { id: value.id, data: value.data }
}

function assertPayload(value: unknown, expectedOwnerId?: string): BackupPayload {
  if (!isRecord(value)
    || typeof value.sourceDataUserId !== 'string'
    || !Array.isArray(value.products)
    || !Array.isArray(value.categories)
    || !isRecord(value.userSettings)
    || !isRecord(value.localSettings)) {
    throw operationError('بنية بيانات النسخة غير صالحة.')
  }
  if (expectedOwnerId && value.sourceDataUserId !== expectedOwnerId) {
    throw operationError('معرّف مساحة البيانات في النسخة غير صالح.')
  }
  assertDocumentId(value.sourceDataUserId, 'مساحة البيانات')
  const products = value.products.map((item) => assertBackupDocument(item, 'product'))
  const categories = value.categories.map((item) => assertBackupDocument(item, 'category'))
  const productIds = new Set<string>()
  const categoryIds = new Set<string>()
  products.forEach(({ id }) => {
    if (productIds.has(id)) throw operationError('تحتوي النسخة على معرّفات منتجات مكررة.')
    productIds.add(id)
  })
  categories.forEach(({ id }) => {
    if (categoryIds.has(id)) throw operationError('تحتوي النسخة على معرّفات فئات مكررة.')
    categoryIds.add(id)
  })
  products.forEach(({ data }) => {
    if (typeof data.categoryId === 'string' && !categoryIds.has(data.categoryId)) {
      throw operationError('تحتوي النسخة على منتج مرتبط بفئة غير موجودة.')
    }
  })
  const invoiceCounter = value.invoiceCounter
  if (invoiceCounter !== null
    && (typeof invoiceCounter !== 'number' || !Number.isSafeInteger(invoiceCounter) || invoiceCounter < 0)) {
    throw operationError('عداد الفواتير في النسخة غير صالح.')
  }
  let cloudinarySettings: CloudinaryBackup = null
  if (value.cloudinarySettings !== null) {
    if (!isRecord(value.cloudinarySettings)
      || typeof value.cloudinarySettings.cloudName !== 'string'
      || typeof value.cloudinarySettings.uploadPreset !== 'string') {
      throw operationError('إعدادات Cloudinary في النسخة غير صالحة.')
    }
    cloudinarySettings = {
      cloudName: value.cloudinarySettings.cloudName,
      uploadPreset: value.cloudinarySettings.uploadPreset,
    }
  }
  return {
    sourceDataUserId: value.sourceDataUserId,
    products,
    categories,
    userSettings: assertSettings(value.userSettings, 'المستخدم'),
    invoiceCounter,
    localSettings: assertSettings(value.localSettings, 'الجهاز'),
    cloudinarySettings,
  }
}

function isBackupManifest(value: unknown): value is BackupManifest {
  return isRecord(value)
    && value.format === backupFormat
    && value.formatVersion === backupFormatVersion
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.appVersion === 'string'
    && typeof value.sourceDataUserId === 'string'
    && isRecord(value.references)
    && typeof value.references.products === 'string'
    && typeof value.references.categories === 'string'
    && typeof value.references.categoryField === 'string'
    && typeof value.references.userSettings === 'string'
    && typeof value.references.localSettings === 'string'
    && typeof value.references.cloudinarySettings === 'string'
    && isRecord(value.counts)
    && Number.isSafeInteger(value.counts.products)
    && Number.isSafeInteger(value.counts.categories)
    && Number.isSafeInteger(value.counts.settings)
    && isRecord(value.integrity)
    && value.integrity.algorithm === 'SHA-256'
    && typeof value.integrity.dataJson === 'string'
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function serializedBytes(value: unknown): Uint8Array {
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint' || typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol') {
      throw operationError('تحتوي البيانات على قيمة لا يمكن تضمينها في ملف النسخة.')
    }
    return item
  })
  return new TextEncoder().encode(serialized)
}

function appSettingsFromUserDocument(value: Record<string, unknown>): BackupSettings {
  const settings: Record<string, unknown> = {}
  settingsFields.forEach((field) => {
    if (value[field] !== undefined) settings[field] = value[field]
  })
  return normalizedSettings(settings)
}

function makeManifest(payload: BackupPayload, createdAt: string, digest: string): BackupManifest {
  const settingsCount = settingsFields.length * 2
    + (payload.invoiceCounter === null ? 0 : 1)
    + (payload.cloudinarySettings ? 2 : 0)
  return {
    format: backupFormat,
    formatVersion: backupFormatVersion,
    createdAt,
    appVersion: __APP_VERSION__,
    sourceDataUserId: payload.sourceDataUserId,
    references: {
      products: 'users/{dataUserId}/products/{productId}',
      categories: 'users/{dataUserId}/categories/{categoryId}',
      categoryField: 'products.categoryId -> categories.documentId',
      userSettings: 'users/{dataUserId}',
      localSettings: 'localStorage[asaar-settings-{dataUserId}]',
      cloudinarySettings: 'users/{dataUserId}/cloudinarySettings/{authUid}',
    },
    counts: {
      products: payload.products.length,
      categories: payload.categories.length,
      settings: settingsCount,
    },
    integrity: { algorithm: 'SHA-256', dataJson: digest },
  }
}

async function assertActualZipEntrySize(bytes: Uint8Array, entry: ZipEntryInfo, directoryOffset: number): Promise<void> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const localOffset = entry.localOffset
  if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
    throw operationError('رأس ملف داخل ZIP تالف.')
  }
  const localFlags = view.getUint16(localOffset + 6, true)
  const localCompression = view.getUint16(localOffset + 8, true)
  const localNameLength = view.getUint16(localOffset + 26, true)
  const localExtraLength = view.getUint16(localOffset + 28, true)
  const dataOffset = localOffset + 30 + localNameLength + localExtraLength
  const dataEnd = dataOffset + entry.compressedSize
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
  if (localName !== entry.name
    || (localFlags & 1) !== 0
    || localCompression !== entry.compression
    || dataEnd > directoryOffset) {
    throw operationError('بيانات ملف داخل ZIP لا تطابق الفهرس.')
  }
  if (entry.compression === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw operationError('حجم ملف غير مضغوط داخل ZIP غير متطابق.')
    }
    return
  }
  let decompressor: DecompressionStream
  try {
    decompressor = new DecompressionStream('deflate-raw')
  } catch {
    throw operationError('هذا المتصفح لا يدعم التحقق الآمن من ملفات ZIP المضغوطة.')
  }
  const reader = decompressor.readable.getReader()
  const writer = decompressor.writable.getWriter()
  const writePromise = writer.write(bytes.slice(dataOffset, dataEnd))
    .then(() => writer.close())
    .then(() => undefined, () => undefined)
  let actualSize = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    actualSize += value.byteLength
    if (actualSize > entry.sizeLimit || actualSize > entry.uncompressedSize) {
      await reader.cancel()
      await writePromise
      throw operationError('محتوى ZIP بعد فك الضغط يتجاوز الحد المسموح.')
    }
  }
  await writePromise
  if (actualSize !== entry.uncompressedSize) {
    throw operationError('الحجم الفعلي لملف ZIP لا يطابق الفهرس.')
  }
}

async function readBoundedZipBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumEndOffset = Math.max(0, bytes.length - 22 - 0xffff)
  let endOffset = -1
  for (let offset = bytes.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.length) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0
    || view.getUint16(endOffset + 4, true) !== 0
    || view.getUint16(endOffset + 6, true) !== 0) {
    throw operationError('الملف ليس ZIP صالحًا أو يستخدم صيغة ZIP متعددة الأقراص.')
  }
  const entries = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  if (entries !== 2 || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || directoryOffset + directorySize > endOffset) {
    throw operationError('حاوية ZIP غير صالحة أو تحتوي عددًا غير مسموح من الملفات.')
  }
  const allowedNames = new Set(['manifest.json', 'data.json'])
  const foundNames = new Set<string>()
  const zipEntries: ZipEntryInfo[] = []
  let offset = directoryOffset
  let totalUncompressedSize = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw operationError('فهرس ملفات ZIP تالف.')
    }
    const flags = view.getUint16(offset + 8, true)
    const compression = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const localOffset = view.getUint32(offset + 42, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const endOfEntry = offset + 46 + nameLength + extraLength + commentLength
    if (endOfEntry > directoryOffset + directorySize || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw operationError('حجم ملف داخل ZIP غير صالح أو غير مدعوم.')
    }
    if ((flags & 1) !== 0 || (compression !== 0 && compression !== 8)) {
      throw operationError('النسخة مشفرة أو تستخدم ضغطًا غير مدعوم.')
    }
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (!allowedNames.has(name) || foundNames.has(name)) throw operationError('تحتوي ZIP على أسماء ملفات غير مسموح بها.')
    foundNames.add(name)
    const entryLimit = name === 'manifest.json' ? 1024 * 1024 : maxJsonBytes
    if (uncompressedSize > entryLimit) throw operationError('حجم ملف داخلي يتجاوز الحد المسموح.')
    totalUncompressedSize += uncompressedSize
    zipEntries.push({ name, compression, compressedSize, uncompressedSize, localOffset, sizeLimit: entryLimit })
    offset = endOfEntry
  }
  if (offset !== directoryOffset + directorySize
    || foundNames.size !== 2
    || totalUncompressedSize > maxJsonBytes + 1024 * 1024) {
    throw operationError('أحجام ملفات ZIP لا تطابق بيانات الفهرس.')
  }
  for (const entry of zipEntries) await assertActualZipEntrySize(bytes, entry, directoryOffset)
  return bytes
}

export async function createBackupArchive(
  db: Firestore,
  ownerId: string,
  authUid: string,
  localSettings: BackupSettings,
): Promise<Blob> {
  const [productsSnapshot, categoriesSnapshot, ownerSnapshot, cloudinarySnapshot] = await Promise.all([
    getDocsFromServer(collection(db, 'users', ownerId, 'products')),
    getDocsFromServer(collection(db, 'users', ownerId, 'categories')),
    getDocFromServer(doc(db, 'users', ownerId)),
    getDocFromServer(doc(db, 'users', ownerId, 'cloudinarySettings', authUid)),
  ])
  const ownerData = ownerSnapshot.exists() ? ownerSnapshot.data() : {}
  const cloudinaryData = cloudinarySnapshot.exists() ? cloudinarySnapshot.data() : null
  const payload = assertPayload({
    sourceDataUserId: ownerId,
    products: productsSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    categories: categoriesSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    userSettings: appSettingsFromUserDocument(ownerData),
    invoiceCounter: ownerData.invoiceCounter === undefined ? null : ownerData.invoiceCounter,
    localSettings: normalizedSettings(localSettings),
    cloudinarySettings: cloudinaryData
      ? {
          cloudName: typeof cloudinaryData.cloudName === 'string' ? cloudinaryData.cloudName : '',
          uploadPreset: typeof cloudinaryData.uploadPreset === 'string' ? cloudinaryData.uploadPreset : '',
        }
      : null,
  }, ownerId)
  const dataBytes = serializedBytes(payload)
  if (dataBytes.length > maxJsonBytes) throw operationError('حجم بيانات النسخة أكبر من الحد المسموح.')
  const manifest = makeManifest(payload, new Date().toISOString(), await sha256(dataBytes))
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('data.json', dataBytes)
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

export async function readBackupArchive(file: File): Promise<ValidatedBackup> {
  if (file.size === 0 || file.size > maxArchiveBytes) {
    throw operationError('حجم ملف النسخة غير صالح أو يتجاوز الحد المسموح.')
  }
  const zipBytes = await readBoundedZipBytes(file)
  let zip: JSZip
  try {
    const { default: JSZipConstructor } = await import('jszip')
    zip = await JSZipConstructor.loadAsync(zipBytes, { checkCRC32: true })
  } catch {
    throw operationError('الملف تالف أو ليس ملف ZIP صالحًا.')
  }
  const names = Object.keys(zip.files).sort()
  if (names.length !== 2 || names[0] !== 'data.json' || names[1] !== 'manifest.json') {
    throw operationError('يجب أن يحتوي ZIP على ملفي manifest.json وdata.json فقط.')
  }
  const manifestFile = zip.file('manifest.json')
  const dataFile = zip.file('data.json')
  if (!manifestFile || !dataFile) throw operationError('ملفات النسخة المطلوبة غير موجودة.')
  const [manifestBytes, dataBytes] = await Promise.all([
    manifestFile.async('uint8array'),
    dataFile.async('uint8array'),
  ])
  if (manifestBytes.length > 1024 * 1024 || dataBytes.length > maxJsonBytes) {
    throw operationError('حجم أحد ملفات النسخة الداخلية يتجاوز الحد المسموح.')
  }
  let manifestValue: unknown
  let payloadValue: unknown
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    manifestValue = JSON.parse(decoder.decode(manifestBytes))
    payloadValue = JSON.parse(decoder.decode(dataBytes))
  } catch {
    throw operationError('تعذر قراءة JSON في ملف النسخة؛ قد يكون الملف تالفًا.')
  }
  if (!isBackupManifest(manifestValue)) {
    throw operationError('تنسيق النسخة غير متوافق مع هذا الإصدار من التطبيق.')
  }
  if (await sha256(dataBytes) !== manifestValue.integrity.dataJson) {
    throw operationError('فشل التحقق من سلامة بيانات النسخة.')
  }
  const payload = assertPayload(payloadValue, manifestValue.sourceDataUserId)
  const expectedSettingsCount = settingsFields.length * 2
    + (payload.invoiceCounter === null ? 0 : 1)
    + (payload.cloudinarySettings ? 2 : 0)
  if (manifestValue.references.products !== 'users/{dataUserId}/products/{productId}'
    || manifestValue.references.categories !== 'users/{dataUserId}/categories/{categoryId}'
    || manifestValue.references.categoryField !== 'products.categoryId -> categories.documentId'
    || manifestValue.references.userSettings !== 'users/{dataUserId}'
    || manifestValue.references.localSettings !== 'localStorage[asaar-settings-{dataUserId}]'
    || manifestValue.references.cloudinarySettings !== 'users/{dataUserId}/cloudinarySettings/{authUid}'
    || manifestValue.counts.products !== payload.products.length
    || manifestValue.counts.categories !== payload.categories.length
    || manifestValue.counts.settings !== expectedSettingsCount
    || typeof manifestValue.appVersion !== 'string') {
    throw operationError('ملخص النسخة لا يطابق البيانات الموجودة داخلها.')
  }
  return { manifest: manifestValue as unknown as BackupManifest, payload }
}

async function allocateRestoreId(
  sourceDataUserId: string,
  collectionName: 'products' | 'categories',
  sourceId: string,
  data: Record<string, unknown>,
  existingDocuments: Map<string, Record<string, unknown>>,
  usedIds: Set<string>,
): Promise<{ id: string; alreadyPresent: boolean }> {
  const hash = await sha256(new TextEncoder().encode(`${sourceDataUserId}\u0000${collectionName}\u0000${sourceId}`))
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const id = `asaar-${hash}${suffix ? `-${suffix}` : ''}`
    const existing = existingDocuments.get(id)
    if (existing && canonicalJson(existing) === canonicalJson(data)) {
      usedIds.add(id)
      return { id, alreadyPresent: true }
    }
    if (!usedIds.has(id)) {
      usedIds.add(id)
      return { id, alreadyPresent: false }
    }
  }
  throw operationError('تعذر إنشاء معرّف بديل فريد لعنصر متعارض.')
}

function makeDocumentBatches(entries: PlannedDocument[]): PlannedDocument[][] {
  const batches: PlannedDocument[][] = []
  let batch: PlannedDocument[] = []
  let estimatedBytes = 0
  for (const entry of entries) {
    const entryBytes = serializedBytes(entry.data).length + new TextEncoder().encode(entry.id).length + 1024
    if (entryBytes > firestoreBatchByteLimit) {
      throw operationError('يوجد مستند أكبر من الحد الآمن لكتابته في Firestore.')
    }
    if (batch.length && (batch.length >= firestoreBatchSize || estimatedBytes + entryBytes > firestoreBatchByteLimit)) {
      batches.push(batch)
      batch = []
      estimatedBytes = 0
    }
    batch.push(entry)
    estimatedBytes += entryBytes
  }
  if (batch.length) batches.push(batch)
  return batches
}

export async function prepareRestorePlan(
  db: Firestore,
  backup: ValidatedBackup,
  ownerId: string,
  authUid: string,
  mode: RestoreMode,
): Promise<RestorePlan> {
  const [targetProductsSnapshot, targetCategoriesSnapshot, targetOwnerSnapshot, targetCloudinarySnapshot] = await Promise.all([
    getDocsFromServer(collection(db, 'users', ownerId, 'products')),
    getDocsFromServer(collection(db, 'users', ownerId, 'categories')),
    getDocFromServer(doc(db, 'users', ownerId)),
    getDocFromServer(doc(db, 'users', ownerId, 'cloudinarySettings', authUid)),
  ])
  const targetProducts = new Map(targetProductsSnapshot.docs.map((item) => [item.id, item.data()]))
  const targetCategories = new Map(targetCategoriesSnapshot.docs.map((item) => [item.id, item.data()]))
  const expectedProducts = new Map(targetProducts)
  const expectedCategories = new Map(targetCategories)
  const categoriesToWrite: PlannedDocument[] = []
  const productsToWrite: PlannedDocument[] = []
  const categoryIdMap = new Map<string, string>()
  let skippedCategories = 0
  let skippedProducts = 0
  let remappedIds = 0
  const usedCategoryIds = new Set(targetCategories.keys())
  const usedProductIds = new Set(targetProducts.keys())
  backup.payload.categories.forEach(({ id }) => usedCategoryIds.add(id))
  backup.payload.products.forEach(({ id }) => usedProductIds.add(id))

  if (mode === 'replace') {
    expectedProducts.clear()
    expectedCategories.clear()
  }

  for (const category of backup.payload.categories) {
    let id = category.id
    const existing = mode === 'merge' ? targetCategories.get(id) : undefined
    if (existing && canonicalJson(existing) === canonicalJson(category.data)) {
      categoryIdMap.set(category.id, id)
      skippedCategories += 1
      continue
    }
    if (existing) {
      const allocated = await allocateRestoreId(
        backup.payload.sourceDataUserId,
        'categories',
        category.id,
        category.data,
        targetCategories,
        usedCategoryIds,
      )
      id = allocated.id
      remappedIds += 1
      if (allocated.alreadyPresent) {
        categoryIdMap.set(category.id, id)
        skippedCategories += 1
        continue
      }
    } else {
      usedCategoryIds.add(id)
    }
    categoryIdMap.set(category.id, id)
    const entry = { id, data: category.data }
    categoriesToWrite.push(entry)
    expectedCategories.set(id, category.data)
  }

  for (const product of backup.payload.products) {
    const categoryId = typeof product.data.categoryId === 'string'
      ? categoryIdMap.get(product.data.categoryId)
      : product.data.categoryId
    if (typeof product.data.categoryId === 'string' && !categoryId) {
      throw operationError('لم يتمكن النظام من إعادة ربط أحد المنتجات بفئته.')
    }
    const data = { ...product.data, ...(product.data.categoryId !== undefined ? { categoryId } : {}) }
    let id = product.id
    const existing = mode === 'merge' ? targetProducts.get(id) : undefined
    if (existing && canonicalJson(existing) === canonicalJson(data)) {
      skippedProducts += 1
      continue
    }
    if (existing) {
      const allocated = await allocateRestoreId(
        backup.payload.sourceDataUserId,
        'products',
        product.id,
        data,
        targetProducts,
        usedProductIds,
      )
      id = allocated.id
      remappedIds += 1
      if (allocated.alreadyPresent) {
        skippedProducts += 1
        continue
      }
    } else {
      usedProductIds.add(id)
    }
    const entry = { id, data }
    productsToWrite.push(entry)
    expectedProducts.set(id, data)
  }

  const productsToDelete = mode === 'replace'
    ? targetProductsSnapshot.docs.map((item) => item.id).filter((id) => !expectedProducts.has(id))
    : []
  const categoriesToDelete = mode === 'replace'
    ? targetCategoriesSnapshot.docs.map((item) => item.id).filter((id) => !expectedCategories.has(id))
    : []
  const targetCloudinary = targetCloudinarySnapshot.exists() ? targetCloudinarySnapshot.data() : null
  let cloudinaryAction: PlannedCloudinaryAction = { kind: 'skip' }
  if (backup.payload.cloudinarySettings) {
    cloudinaryAction = { kind: 'set', data: backup.payload.cloudinarySettings }
  } else if (mode === 'replace' && targetCloudinary) {
    cloudinaryAction = { kind: 'delete' }
  }
  const currentOwnerData = targetOwnerSnapshot.exists() ? targetOwnerSnapshot.data() : {}
  const currentCounter = typeof currentOwnerData.invoiceCounter === 'number' ? currentOwnerData.invoiceCounter : null
  const invoiceCounter = mode === 'merge'
    ? backup.payload.invoiceCounter === null
      ? currentCounter
      : Math.max(currentCounter ?? 0, backup.payload.invoiceCounter)
    : backup.payload.invoiceCounter
  return {
    mode,
    ownerId,
    authUid,
    backup,
    categoriesToWrite,
    productsToWrite,
    productsToDelete,
    categoriesToDelete,
    expectedCategories,
    expectedProducts,
    cloudinaryAction,
    invoiceCounter,
    targetProductCount: targetProducts.size,
    targetCategoryCount: targetCategories.size,
    targetSettingsCount: settingsFields.filter((field) => currentOwnerData[field] !== undefined).length,
    targetHasCloudinarySettings: targetCloudinary !== null,
    skippedProducts,
    skippedCategories,
    remappedIds,
    settingsToRestore: backup.payload.userSettings,
    localSettingsToRestore: backup.payload.localSettings,
  }
}

async function writeDocuments(
  db: Firestore,
  ownerId: string,
  collectionName: 'products' | 'categories',
  batches: PlannedDocument[][],
  startPercent: number,
  span: number,
  isCurrent: () => boolean,
  onProgress: (percent: number) => void,
): Promise<void> {
  for (let index = 0; index < batches.length; index += 1) {
    if (!isCurrent()) throw operationError('تغيّر الحساب أثناء الاستعادة؛ أُوقفت العملية لحماية البيانات.')
    const batch = writeBatch(db)
    batches[index].forEach(({ id, data }) => batch.set(doc(db, 'users', ownerId, collectionName, id), data))
    await batch.commit()
    onProgress(startPercent + Math.round((index + 1) / batches.length * span))
  }
}

async function deleteDocuments(
  db: Firestore,
  ownerId: string,
  collectionName: 'products' | 'categories',
  ids: string[],
  startPercent: number,
  span: number,
  isCurrent: () => boolean,
  onProgress: (percent: number) => void,
): Promise<void> {
  const batchCount = Math.ceil(ids.length / firestoreBatchSize)
  for (let offset = 0; offset < ids.length; offset += firestoreBatchSize) {
    if (!isCurrent()) throw operationError('تغيّر الحساب أثناء الاستعادة؛ أُوقفت العملية لحماية البيانات.')
    const chunk = ids.slice(offset, offset + firestoreBatchSize)
    const batch = writeBatch(db)
    chunk.forEach((id) => batch.delete(doc(db, 'users', ownerId, collectionName, id)))
    await batch.commit()
    onProgress(startPercent + Math.round((offset / firestoreBatchSize + 1) / batchCount * span))
  }
}

function assertSnapshotMatches(
  actual: Map<string, Record<string, unknown>>,
  expected: Map<string, Record<string, unknown>>,
  label: string,
) {
  if (actual.size !== expected.size) throw operationError(`تعذر التحقق من عدد ${label} بعد الاستعادة.`)
  for (const [id, data] of expected) {
    if (!actual.has(id) || canonicalJson(actual.get(id)) !== canonicalJson(data)) {
      throw operationError(`تعذر التحقق من بيانات ${label} بعد الاستعادة.`)
    }
  }
}

export async function executeRestorePlan(
  db: Firestore,
  plan: RestorePlan,
  isCurrent: () => boolean,
  onProgress: (percent: number) => void,
): Promise<{ products: number; categories: number }> {
  const allDocuments = [...plan.categoriesToWrite, ...plan.productsToWrite]
  allDocuments.forEach(({ data }) => {
    if (serializedBytes(data).length > 900 * 1024) {
      throw operationError('يوجد مستند أكبر من الحد الآمن لكتابته في Firestore.')
    }
  })
  const categoryBatches = makeDocumentBatches(plan.categoriesToWrite)
  const productBatches = makeDocumentBatches(plan.productsToWrite)
  onProgress(1)
  await writeDocuments(db, plan.ownerId, 'categories', categoryBatches, 2, 20, isCurrent, onProgress)
  await writeDocuments(db, plan.ownerId, 'products', productBatches, 22, 38, isCurrent, onProgress)
  await deleteDocuments(db, plan.ownerId, 'products', plan.productsToDelete, 60, 14, isCurrent, onProgress)
  await deleteDocuments(db, plan.ownerId, 'categories', plan.categoriesToDelete, 74, 12, isCurrent, onProgress)
  if (!isCurrent()) throw operationError('تغيّر الحساب أثناء الاستعادة؛ أُوقفت العملية لحماية البيانات.')

  const userRef = doc(db, 'users', plan.ownerId)
  const settingsUpdate: Record<string, unknown> = { ...plan.settingsToRestore }
  if (plan.mode === 'replace' && plan.backup.payload.invoiceCounter === null) {
    settingsUpdate.invoiceCounter = deleteField()
  } else if (plan.invoiceCounter !== null) {
    settingsUpdate.invoiceCounter = plan.invoiceCounter
  }
  await setDoc(userRef, settingsUpdate, { merge: true })
  if (plan.cloudinaryAction.kind === 'set') {
    await setDoc(doc(db, 'users', plan.ownerId, 'cloudinarySettings', plan.authUid), plan.cloudinaryAction.data, {
      merge: plan.mode === 'merge',
    })
  } else if (plan.cloudinaryAction.kind === 'delete') {
    await deleteDoc(doc(db, 'users', plan.ownerId, 'cloudinarySettings', plan.authUid))
  }
  onProgress(90)

  const [productsSnapshot, categoriesSnapshot, ownerSnapshot, cloudinarySnapshot] = await Promise.all([
    getDocsFromServer(collection(db, 'users', plan.ownerId, 'products')),
    getDocsFromServer(collection(db, 'users', plan.ownerId, 'categories')),
    getDocFromServer(userRef),
    getDocFromServer(doc(db, 'users', plan.ownerId, 'cloudinarySettings', plan.authUid)),
  ])
  assertSnapshotMatches(
    new Map(productsSnapshot.docs.map((item) => [item.id, item.data()])),
    plan.expectedProducts,
    'المنتجات',
  )
  assertSnapshotMatches(
    new Map(categoriesSnapshot.docs.map((item) => [item.id, item.data()])),
    plan.expectedCategories,
    'الفئات',
  )
  const actualOwner = ownerSnapshot.exists() ? ownerSnapshot.data() : {}
  for (const field of settingsFields) {
    if (canonicalJson(actualOwner[field]) !== canonicalJson(plan.settingsToRestore[field])) {
      throw operationError('لم يتم التحقق من استعادة إعدادات المستخدم.')
    }
  }
  if (plan.mode === 'replace' && plan.backup.payload.invoiceCounter === null) {
    if (actualOwner.invoiceCounter !== undefined) throw operationError('لم يتم التحقق من استعادة عداد الفواتير.')
  } else if (plan.invoiceCounter !== null && actualOwner.invoiceCounter !== plan.invoiceCounter) {
    throw operationError('لم يتم التحقق من استعادة عداد الفواتير.')
  }
  const actualCloudinary = cloudinarySnapshot.exists() ? cloudinarySnapshot.data() : null
  if (plan.cloudinaryAction.kind === 'delete' && actualCloudinary) {
    throw operationError('لم يتم التحقق من إزالة إعدادات الرفع القديمة.')
  }
  if (plan.cloudinaryAction.kind === 'set') {
    for (const [key, value] of Object.entries(plan.cloudinaryAction.data)) {
      if (!actualCloudinary || actualCloudinary[key] !== value) {
        throw operationError('لم يتم التحقق من استعادة إعدادات رفع الصور.')
      }
    }
  }
  if (!isCurrent()) throw operationError('تغيّر الحساب أثناء التحقق من الاستعادة.')

  try {
    const localSettingsJson = JSON.stringify(plan.localSettingsToRestore)
    localStorage.setItem(`asaar-settings-${plan.ownerId}`, localSettingsJson)
    const savedSettings = localStorage.getItem(`asaar-settings-${plan.ownerId}`)
    if (savedSettings !== localSettingsJson) throw operationError('تعذر التحقق من حفظ تفضيلات الجهاز.')
  } catch (error) {
    if (error instanceof Error && error.message === 'تعذر التحقق من حفظ تفضيلات الجهاز.') throw error
    throw operationError('تمت كتابة بيانات Firestore لكن تعذر حفظ تفضيلات الجهاز محليًا.')
  }
  onProgress(100)
  return { products: productsSnapshot.size, categories: categoriesSnapshot.size }
}
