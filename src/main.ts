import './style.css'
import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, getFirestore, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'

const firebaseConfig = { apiKey: 'AIzaSyAnaTxPXhxMI3A-U4IucbEDfQ8hOTbix_w', authDomain: 'msalma-1d983.firebaseapp.com', projectId: 'msalma-1d983', storageBucket: 'msalma-1d983.firebasestorage.app', messagingSenderId: '1029462661783', appId: '1:1029462661783:web:61a7c2fd8336326fab27d2' }
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const appRoot = document.querySelector<HTMLDivElement>('#app')!

type Product = { id: string; name: string; price: number; number: number; storedNumber: boolean; categoryId: string | null; isFavorite: boolean; imageUrl?: string }
type Category = { id: string; name: string }
type Settings = {
  syriaEnabled: boolean
  exchangeRate: number
  darkMode: boolean
  favoritesEnabled: boolean
  retailPricesEnabled: boolean
  retailProfitPercentage: number
}
type CloudinarySettings = { cloudName: string; uploadPreset: string }
type ActiveImageUpload = {
  authUid: string
  dataUserId: string
  authSessionId: number
  form: HTMLFormElement
  fileInput: HTMLInputElement
  uploadButton: HTMLButtonElement
  status: HTMLElement
  cancelled: boolean
  abortRequest?: () => void
  observer?: MutationObserver
}
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const defaultSettings: Settings = { syriaEnabled: false, exchangeRate: 0, darkMode: false, favoritesEnabled: false, retailPricesEnabled: true, retailProfitPercentage: 0 }
const emptyCloudinarySettings: CloudinarySettings = { cloudName: '', uploadPreset: '' }
const maxProductImageSize = 10 * 1024 * 1024
const allowedProductImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const sharedDataUserId = '8zgVSfgflNStj4rlBblTUKE7zi42'
const sharedDataEmails = new Set(['mothanamsa@gmail.com', 'msalma@gmail.com'])
let currentUser: User | null = null
let dataUserId = ''
let authSessionId = 0
const activeImageUploads = new Set<ActiveImageUpload>()
let products: Product[] = []
let categories: Category[] = []
const productPageSize = 50
let productDisplayLimit = productPageSize
let selectedCategoryId = 'all'
let favoritesFilterActive = false
let settings: Settings = defaultSettings
let unsubscribeProducts: () => void = () => undefined
let unsubscribeCategories: () => void = () => undefined
let deferredInstall: BeforeInstallPromptEvent | null = null
let quickNavTimer: ReturnType<typeof setTimeout> | undefined

const icon = (name: string) => ({ plus: '<path d="M12 5v14M5 12h14"/>', settings: '<path d="M12 3.5a2 2 0 0 1 2 2v.2a6.8 6.8 0 0 1 1.8 1l.2-.1a2 2 0 1 1 2 3.5l-.2.1a6.8 6.8 0 0 1 0 2.1l.2.1a2 2 0 1 1-2 3.5l-.2-.1a6.8 6.8 0 0 1-1.8 1v.2a2 2 0 1 1-4 0v-.2a6.8 6.8 0 0 1-1.8-1l-.2.1a2 2 0 1 1-2-3.5l.2-.1a6.8 6.8 0 0 1 0-2.1l-.2-.1a2 2 0 1 1 2-3.5l.2.1a6.8 6.8 0 0 1 1.8-1v-.2a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="2.5"/>', edit: '<path d="M4 20l4.5-1 9.4-9.4a2.1 2.1 0 0 0-3-3L5.5 16l-1.5 4Z"/><path d="m13.5 6.5 4 4"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>', download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/>', arrowUp: '<path d="M12 19V5m0 0-5 5m5-5 5 5"/>', arrowDown: '<path d="M12 5v14m0 0-5-5m5 5 5-5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>' }[name] || '')
const svg = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(name)}</svg>`
const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—'
const syp = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true }).format(Math.round(value)) : '—'
type NamedEntity = { id: string; name: string }
const naturalSort = <T extends NamedEntity>(a: T, b: T) => {
  const tokenize = (value: string) => value.match(/[\d٠-٩۰-۹]+|[^\d٠-٩۰-۹]+/gu) ?? []
  const normalizeDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  const left = tokenize(a.name)
  const right = tokenize(b.name)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftIsNumber = /^[\d٠-٩۰-۹]/u.test(leftPart)
    const rightIsNumber = /^[\d٠-٩۰-۹]/u.test(rightPart)
    if (leftIsNumber && rightIsNumber) {
      const difference = Number(normalizeDigits(leftPart)) - Number(normalizeDigits(rightPart))
      if (difference) return difference
    } else {
      const difference = leftPart.localeCompare(rightPart, 'ar', { sensitivity: 'base' })
      if (difference) return difference
    }
  }
  return a.id.localeCompare(b.id)
}
const arabicSort = naturalSort
const sortedCategories = () => categories.sort(naturalSort)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
const settingsKey = (dataUserId: string) => `asaar-settings-${dataUserId}`

function resolveDataUserId(user: User): string {
  const email = user.email?.trim().toLowerCase() ?? ''
  return sharedDataEmails.has(email) ? sharedDataUserId : user.uid
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character)) }
function normalizeProductImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
function optimizedProductImageUrl(value: string): string {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname !== 'res.cloudinary.com') return value
    const uploadPath = url.pathname.match(/^\/[^/]+\/image\/upload\//)
    if (!uploadPath) return value

    const pathAfterUpload = url.pathname.slice(uploadPath[0].length)
    const transformParameters: string[] = []
    for (const segment of pathAfterUpload.split('/')) {
      if (!segment || /^v\d+$/i.test(segment)) break
      const parameters = segment.split(',')
      if (!parameters.every((parameter) => /^[a-z][a-z0-9]{0,2}_[^,]+$/i.test(parameter))) break
      transformParameters.push(...parameters)
    }
    const existingParameters = new Set(transformParameters.map((parameter) => parameter.split(':', 1)[0].toLowerCase()))
    const additions = ['f_auto', 'q_auto'].filter((parameter) => !existingParameters.has(parameter))
    if (!additions.length) return value

    const insertionIndex = uploadPath[0].length
    url.pathname = `${url.pathname.slice(0, insertionIndex)}${additions.join(',')}/${url.pathname.slice(insertionIndex)}`
    return url.href
  } catch {
    return value
  }
}
function normalizeName(value: string) { return value.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('ar') }
const developerFooter = () => '<footer class="developer-footer"><span class="developer-mark">R</span><span>تم التطوير بواسطة إبراهيم المقداد</span><a href="tel:0937708649" dir="ltr">0937708649</a></footer>'
function highlightProductName(value: string, search: string) {
  const term = search.trim()
  if (!term) return escapeHtml(value)
  const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu')
  return value.split(pattern).map((part) => part.toLocaleLowerCase('ar') === term.toLocaleLowerCase('ar' ) ? `<mark class="search-highlight">${escapeHtml(part)}</mark>` : escapeHtml(part)).join('')
}
function safeSettings(value: unknown): Settings {
  const data = value as Partial<Settings> | null
  const retailProfitPercentage = typeof data?.retailProfitPercentage === 'number' && Number.isFinite(data.retailProfitPercentage)
    ? Math.min(Math.max(data.retailProfitPercentage, 0), 100)
    : 0
  return {
    syriaEnabled: data?.syriaEnabled === true,
    exchangeRate: typeof data?.exchangeRate === 'number' && Number.isFinite(data.exchangeRate) && data.exchangeRate > 0 ? data.exchangeRate : 0,
    darkMode: data?.darkMode === true,
    favoritesEnabled: data?.favoritesEnabled === true,
    retailPricesEnabled: data?.retailPricesEnabled !== false,
    retailProfitPercentage,
  }
}
function normalizeRetailProfit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 100)
}
function getRetailPrice(basePrice: number): number {
  if (!Number.isFinite(basePrice)) return 0
  return Number((basePrice * (1 + normalizeRetailProfit(settings.retailProfitPercentage) / 100)).toFixed(2))
}
function getRetailSypPrice(basePrice: number): number {
  return Number((getRetailPrice(basePrice) * settings.exchangeRate).toFixed(2))
}
function applyTheme(value: boolean) { document.body.classList.toggle('dark-mode', value) }
function applyStoredTheme() { for (const key of Object.keys(localStorage)) { if (!key.startsWith('asaar-settings-')) continue; try { const cached = JSON.parse(localStorage.getItem(key) || 'null') as Partial<Settings> | null; if (cached?.darkMode === true) { applyTheme(true); return } } catch { /* Ignore malformed cached settings. */ } } }
function loadCachedSettings(uid: string): Settings { try { return safeSettings(JSON.parse(localStorage.getItem(settingsKey(uid)) || 'null')) } catch { return defaultSettings } }
function saveCachedSettings(uid: string, value: Settings) { localStorage.setItem(settingsKey(uid), JSON.stringify(value)) }
function stableNumber(id: string) { let hash = 0; for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0; return (hash % 900000) + 100000 }
function parseProduct(id: string, data: Record<string, unknown>): Product | null { const name = typeof data.name === 'string' ? data.name.trim() : ''; const price = typeof data.price === 'number' && Number.isFinite(data.price) && data.price > 0 ? data.price : Number.NaN; if (!name) return null; const storedNumber = typeof data.number === 'number' && Number.isInteger(data.number) && data.number > 0; const categoryId = typeof data.categoryId === 'string' && data.categoryId.trim() ? data.categoryId : null; const imageUrl = normalizeProductImageUrl(data.imageUrl); return { id, name, price, number: storedNumber ? data.number as number : stableNumber(id), storedNumber, categoryId, isFavorite: data.isFavorite === true, ...(imageUrl ? { imageUrl } : {}) } }
function parseCategory(id: string, data: Record<string, unknown>): Category | null { const name = typeof data.name === 'string' ? data.name.trim() : ''; return name ? { id, name } : null }
function friendlyError(error: unknown) { const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : ''; return code.includes('network') || code.includes('unavailable') ? 'لا يوجد اتصال حاليًا. تحقق من الإنترنت وحاول مجددًا.' : 'تعذر حفظ التغيير. حاول مجددًا.' }
function firestoreErrorMessage(error: unknown) { const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : ''; if (code.includes('permission-denied')) return 'لا تملك صلاحية قراءة هذه المنتجات.'; if (code.includes('unauthenticated')) return 'انتهت جلسة تسجيل الدخول. سجّل الدخول مجددًا.'; if (code.includes('unavailable') || code.includes('network') || code.includes('deadline-exceeded')) return 'تعذر الاتصال حاليًا. تحقق من الإنترنت وحاول مجددًا.'; return 'تعذر تحميل المنتجات حاليًا. حاول مجددًا.' }
function authErrorMessage(error: unknown) { const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : ''; console.error('Firebase Authentication error:', code || error); switch (code) { case 'auth/operation-not-allowed': return 'إنشاء الحساب بالبريد وكلمة المرور غير مفعّل في Firebase. فعّل مزود Email/Password من Authentication ثم Sign-in method.'; case 'auth/email-already-in-use': return 'هذا البريد مستخدم من قبل. جرّب تسجيل الدخول بدل إنشاء حساب جديد.'; case 'auth/invalid-email': return 'أدخل بريدًا إلكترونيًا صحيحًا.'; case 'auth/weak-password': return 'كلمة المرور ضعيفة. استخدم 6 أحرف أو أكثر.'; case 'auth/network-request-failed': return 'تعذر الاتصال بـ Firebase. تحقق من الإنترنت وحاول مجددًا.'; case 'auth/too-many-requests': return 'تمت محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.'; default: return 'تعذر إنشاء الحساب. تحقق من البريد وكلمة المرور وإعدادات Firebase.' } }

function renderBootstrap(message = 'جارٍ استعادة جلستك...') { appRoot.innerHTML = `<main class="bootstrap"><div class="brand-mark">أسعار</div><p>${message}</p></main>` }
function attachPasswordToggle(button: HTMLButtonElement) {
  const targets = button.dataset.targets ? button.dataset.targets.split(',') : button.dataset.target ? [button.dataset.target] : []
  const inputs = targets.map((name) => document.querySelector<HTMLInputElement>(`input[name="${name.trim()}"]`)).filter((input): input is HTMLInputElement => Boolean(input))
  if (!inputs.length) return
  button.addEventListener('click', () => {
    const shouldShow = inputs.some((input) => input.type === 'password')
    inputs.forEach((input) => { input.type = shouldShow ? 'text' : 'password' })
    button.textContent = shouldShow ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
    button.setAttribute('aria-pressed', String(shouldShow))
  })
}
function renderAuth(error = '', signUp = false) {
  const title = signUp ? 'قم بإنشاء حساب جديد' : 'قم بتسجيل الدخول إلى حسابك'
  appRoot.innerHTML = `<main class="auth-page"><div class="brand-header"><div class="brand-mark">أسعار</div><div class="brand-copy"><p class="eyebrow">قائمة أسعارك، ببساطة</p><p class="auth-copy">كل أسعار منتجاتك في مكان واحد، جاهزة عندما تحتاجها.</p></div></div><div class="auth-header" aria-live="polite"><h2>${title}</h2></div><form id="auth-form" class="auth-form"><label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label>${signUp ? `
      <label class="auth-field">
        <div class="field-header-row">
          <span class="field-label">كلمة المرور</span>
          <button class="password-visibility-toggle" type="button" data-targets="password,confirmPassword" aria-pressed="false">إظهار كلمة المرور</button>
        </div>
        <input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="••••••••" required>
      </label>
      <label class="auth-field">
        <span class="field-label">تأكيد كلمة المرور</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" placeholder="••••••••" required>
      </label>` : `
      <label class="auth-field">
        <div class="field-header-row">
          <span class="field-label">كلمة المرور</span>
          <button class="password-visibility-toggle" type="button" data-target="password" aria-pressed="false">إظهار كلمة المرور</button>
        </div>
        <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="••••••••" required>
      </label>`}<p class="form-error">${escapeHtml(error)}</p><button class="primary-button" type="submit" id="auth-submit">${signUp ? 'إنشاء الحساب' : 'تسجيل الدخول'}</button><button class="text-button" type="button" id="toggle-auth">${signUp ? 'لديك حساب؟ تسجيل الدخول' : 'إنشاء حساب جديد'}</button></form></main>`
  document.querySelector('.auth-page')?.insertAdjacentHTML('beforeend', developerFooter())
  document.querySelector('#toggle-auth')!.addEventListener('click', () => renderAuth('', !signUp))
  document.querySelectorAll<HTMLButtonElement>('.password-visibility-toggle').forEach(attachPasswordToggle)
  document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const button = document.querySelector<HTMLButtonElement>('#auth-submit')!; button.disabled = true; button.textContent = 'جارٍ المتابعة...'; try { const email = String(form.get('email')); if (signUp) {
      const password = String(form.get('password'))
      const confirmPassword = String(form.get('confirmPassword'))
      if (password !== confirmPassword) {
        renderAuth('كلمتا المرور غير متطابقتين', true)
        return
      }
      await createUserWithEmailAndPassword(auth, email, password)
    } else {
      const password = String(form.get('password'))
      await signInWithEmailAndPassword(auth, email, password)
    }
  } catch (submitError) { renderAuth(authErrorMessage(submitError), signUp) } })
  updateInstallButton()
}

function renderProductsShell() {
  applyTheme(settings.darkMode)
  appRoot.innerHTML = `<main class="products-page"><header class="topbar"><div class="search-box">${svg('search')}<input id="search" type="search" placeholder="ابحث عن منتج..." autocomplete="off"></div><button class="icon-button topbar-install hidden" id="install-app-app" type="button" aria-label="تثبيت التطبيق" title="تثبيت التطبيق">${svg('download')}</button><button class="icon-button add-button" id="add-product" aria-label="إضافة منتج">${svg('plus')}</button><button class="icon-button" id="open-settings" aria-label="الإعدادات">${svg('settings')}</button></header><nav class="category-bar" id="category-bar" aria-label="الفئات"></nav><section class="products-list" id="products-list"></section><button class="load-more-products hidden" id="load-more-products" type="button"></button><div class="quick-nav" id="quick-nav"><button id="scroll-top" aria-label="إلى الأعلى">${svg('arrowUp')}</button><button id="scroll-bottom" aria-label="إلى الأسفل">${svg('arrowDown')}</button></div></main>`
  document.querySelector('.products-page')?.insertAdjacentHTML('beforeend', developerFooter())
  document.querySelector<HTMLInputElement>('#search')!.addEventListener('input', () => { productDisplayLimit = productPageSize; updateProductList() })
  document.querySelector('#add-product')!.addEventListener('click', renderAddModal)
  document.querySelector('#open-settings')!.addEventListener('click', renderSettingsNew)
  document.querySelector('#install-app-app')!.addEventListener('click', installPwa)
  document.querySelector('#scroll-top')!.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  document.querySelector('#scroll-bottom')!.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
  document.querySelector('#load-more-products')!.addEventListener('click', () => { productDisplayLimit += productPageSize; updateProductList() })
  window.onscroll = handleScroll
  updateInstallButton()
  updateCategoryBar()
  updateProductList()
  updateNavigation()
}
function updateProductList() {
  if (!settings.favoritesEnabled) favoritesFilterActive = false
  const list = document.querySelector<HTMLElement>('#products-list')
  const count = document.querySelector('#product-count')
  const search = document.querySelector<HTMLInputElement>('#search')?.value.trim().toLocaleLowerCase('ar') || ''
  if (!list) return
  const visible = products.filter((product) => (!favoritesFilterActive || product.isFavorite) && (selectedCategoryId === 'all' || product.categoryId === selectedCategoryId) && product.name.toLocaleLowerCase('ar').includes(search)).sort(naturalSort)
  const displayed = visible.slice(0, productDisplayLimit)
  if (count) count.textContent = String(products.length)
  list.innerHTML = visible.length ? displayed.map((product, index) => {
    const isExactSearchMatch = Boolean(search) && product.name.trim().toLocaleLowerCase('ar') === search
    const retailDollarPrice = getRetailPrice(product.price)
    const retailSypPrice = getRetailSypPrice(product.price)
    const renderSypValue = (value: number) => settings.syriaEnabled ? `<span class="currency-word">ليرة</span><span class="price-number">${syp(value)}</span>` : '<span class="syria-box-hint">«فعّل الليرة من الإعدادات»</span>'
    const retailRow = settings.retailPricesEnabled ? `
      <div class="price-row retail-price-row">
        <div class="price-box usd-price retail-price">
          <span class="price-label"><span>السعر بالدولار (</span><span class="tag tag--retail">مفرق</span><span>)</span></span>
          <div class="price-value"><span class="currency-symbol">$</span><span class="price-number">${money(retailDollarPrice)}</span></div>
        </div>
        <div class="price-box syp-price ${settings.syriaEnabled ? '' : 'is-disabled'} retail-price">
          <span class="price-label"><span>السعر بالليرة (</span><span class="tag tag--retail">مفرق</span><span>)</span></span>
          <div class="price-value">${renderSypValue(retailSypPrice)}</div>
        </div>
      </div>
    ` : ''
    return `
    <article class="product-card ${isExactSearchMatch ? 'is-exact-search-match' : ''}" data-edit="${product.id}" tabindex="0" role="button" aria-label="تعديل ${escapeHtml(product.name)}">
      <div class="product-top">
        ${product.imageUrl ? `<button class="product-image-trigger" type="button" data-image-url="${escapeHtml(product.imageUrl)}" data-product-name="${escapeHtml(product.name)}" aria-label="تكبير صورة ${escapeHtml(product.name)}"><img src="${escapeHtml(optimizedProductImageUrl(product.imageUrl))}" alt="" loading="lazy"></button>` : ''}
        <div class="product-info">
          <h2 class="product-name">${highlightProductName(product.name, search)}</h2>
          <span class="product-category">${escapeHtml(categories.find((category) => category.id === product.categoryId)?.name || 'بدون فئة')}</span>
        </div>
        ${settings.favoritesEnabled ? `<button class="favorite-button ${product.isFavorite ? 'is-favorite' : ''}" data-favorite="${product.id}" type="button" aria-label="${product.isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}" aria-pressed="${product.isFavorite}">${product.isFavorite ? '★' : '☆'}</button>` : ''}
      </div>
      <span class="product-number">${index + 1}</span>
      <div class="price-row wholesale-price-row">
        <div class="price-box usd-price">
          <span class="price-label"><span>السعر بالدولار (</span><span class="tag tag--wholesale">جملة</span><span>)</span></span>
          <div class="price-value"><span class="currency-symbol">$</span><span class="price-number">${money(product.price)}</span></div>
        </div>
        <div class="price-box syp-price ${settings.syriaEnabled ? '' : 'is-disabled'}">
          <span class="price-label"><span>السعر بالليرة (</span><span class="tag tag--wholesale">جملة</span><span>)</span></span>
          <div class="price-value">${renderSypValue(product.price * settings.exchangeRate)}</div>
        </div>
      </div>
      ${retailRow}
    </article>
  `
  }).join('') : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>${products.length ? 'لا توجد نتائج' : 'ابدأ بإضافة أول منتج'}</h2><p>${products.length ? 'جرّب كلمة بحث أو فئة مختلفة.' : 'احتفظ بأسعارك اليومية في قائمة واحدة واضحة.'}</p></div>`
  list.querySelectorAll<HTMLElement>('.product-card[data-edit]').forEach((card) => {
    const openEdit = () => renderEditModal(card.dataset.edit!)
    card.addEventListener('click', openEdit)
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit() } })
  })
  list.querySelectorAll<HTMLButtonElement>('.product-image-trigger').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      showProductImage(button.dataset.imageUrl!, button.dataset.productName!, button)
    })
    button.addEventListener('keydown', (event) => { event.stopPropagation() })
    button.querySelector('img')!.addEventListener('error', () => button.remove(), { once: true })
  })
  list.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); void toggleFavorite(button.dataset.favorite!) }))
  const loadMore = document.querySelector<HTMLButtonElement>('#load-more-products')
  if (loadMore) { const remaining = visible.length - displayed.length; loadMore.classList.toggle('hidden', remaining <= 0); loadMore.textContent = remaining > 0 ? `عرض المزيد (${remaining})` : '' }
}
function showProductImage(imageUrl: string, productName: string, returnFocus?: HTMLElement) {
  const backdrop = document.createElement('div')
  backdrop.className = 'image-viewer-backdrop'
  backdrop.innerHTML = `<section class="image-viewer" role="dialog" aria-modal="true" aria-label="صورة ${escapeHtml(productName)}"><button class="image-viewer-close" type="button" aria-label="إغلاق">${svg('close')}</button><img src="${escapeHtml(optimizedProductImageUrl(imageUrl))}" alt="${escapeHtml(productName)}"><p class="image-viewer-error" hidden>تعذر تحميل الصورة.</p></section>`
  const close = () => {
    backdrop.remove()
    document.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('asaar:session-invalidated', close)
    if (returnFocus?.isConnected) returnFocus.focus()
  }
  const handleKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
  backdrop.addEventListener('click', close)
  backdrop.querySelector('.image-viewer-close')!.addEventListener('click', (event) => { event.stopPropagation(); close() })
  const image = backdrop.querySelector<HTMLImageElement>('.image-viewer img')!
  image.addEventListener('click', (event) => event.stopPropagation())
  image.addEventListener('error', () => {
    image.hidden = true
    backdrop.querySelector<HTMLElement>('.image-viewer-error')!.hidden = false
  }, { once: true })
  window.addEventListener('asaar:session-invalidated', close, { once: true })
  document.addEventListener('keydown', handleKeydown)
  document.body.append(backdrop)
  backdrop.querySelector<HTMLButtonElement>('.image-viewer-close')!.focus()
}
async function toggleFavorite(id: string) {
  if (!currentUser || !settings.favoritesEnabled) return
  const product = products.find((item) => item.id === id)
  if (!product) return
  const isFavorite = !product.isFavorite
  product.isFavorite = isFavorite
  updateCategoryBar()
  updateProductList()
  try {
    await updateDoc(doc(db, 'users', dataUserId, 'products', id), { isFavorite })
  } catch (favoriteError) {
    product.isFavorite = !isFavorite
    updateCategoryBar()
    updateProductList()
    console.error('Failed to update favorite:', favoriteError)
  }
}
function updateCategoryBar() { const bar = document.querySelector<HTMLElement>('#category-bar'); if (!bar) return; const favoritesChip = settings.favoritesEnabled ? `<button class="category-chip ${favoritesFilterActive ? 'active' : ''}" data-favorites-filter="true"><span>المفضلة</span><span class="category-count">${products.filter((product) => product.isFavorite).length}</span></button>` : ''; bar.innerHTML = `${favoritesChip}<button class="category-chip ${selectedCategoryId === 'all' && !favoritesFilterActive ? 'active' : ''}" data-category="all"><span>الكل</span><span class="category-count" id="product-count">${products.length}</span></button>${sortedCategories().map((category) => { const count = categoryProductCount(category.id); return `<button class="category-chip ${selectedCategoryId === category.id && !favoritesFilterActive ? 'active' : ''}" data-category="${category.id}"><span>${escapeHtml(category.name)}</span><span class="category-count">${count}</span></button>` }).join('')}`; bar.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((button) => button.addEventListener('click', () => { selectedCategoryId = button.dataset.category!; favoritesFilterActive = false; productDisplayLimit = productPageSize; updateCategoryBar(); updateProductList() })); bar.querySelector<HTMLButtonElement>('[data-favorites-filter]')?.addEventListener('click', () => { favoritesFilterActive = !favoritesFilterActive; productDisplayLimit = productPageSize; updateCategoryBar(); updateProductList() }) }
function renderProductsError(error: unknown) { const list = document.querySelector<HTMLElement>('#products-list'); if (!list) return; list.innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h2>تعذر تحميل المنتجات</h2><p>${firestoreErrorMessage(error)}</p></div>` }
function renderInstallButton() {
  if (document.querySelector('#install-app')) return
  const button = document.createElement('button')
  button.id = 'install-app-login'
  button.className = 'install-button floating-install hidden'
  button.type = 'button'
  button.setAttribute('aria-label', 'تثبيت التطبيق')
  button.innerHTML = `${svg('download')}<span>تثبيت التطبيق</span>`
  button.addEventListener('click', installPwa)
  document.body.append(button)
}
function updateInstallButton() {
  const available = Boolean(deferredInstall) && !isStandalone()
  const loginButton = document.querySelector<HTMLButtonElement>('#install-app-login')
  const appButton = document.querySelector<HTMLButtonElement>('#install-app-app')
  loginButton?.classList.toggle('hidden', !available || Boolean(currentUser))
  appButton?.classList.toggle('hidden', !available || !currentUser)
  document.querySelector<HTMLElement>('.topbar')?.classList.toggle('with-install', available && Boolean(currentUser))
}
function updateNavigation() { const nav = document.querySelector<HTMLElement>('#quick-nav'); const top = document.querySelector<HTMLButtonElement>('#scroll-top'); const bottom = document.querySelector<HTMLButtonElement>('#scroll-bottom'); if (!nav || !top || !bottom) return; const atTop = window.scrollY < 80; const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80; top.classList.toggle('hidden', atTop); bottom.classList.toggle('hidden', atBottom); nav.classList.toggle('has-actions', !atTop || !atBottom) }
function handleScroll() { updateNavigation(); const nav = document.querySelector<HTMLElement>('#quick-nav'); if (!nav) return; nav.classList.add('visible'); if (quickNavTimer) clearTimeout(quickNavTimer); quickNavTimer = setTimeout(() => nav.classList.remove('visible'), 3000) }

function isUploadSessionCurrent(upload: ActiveImageUpload) {
  return !upload.cancelled
    && currentUser?.uid === upload.authUid
    && dataUserId === upload.dataUserId
    && authSessionId === upload.authSessionId
    && upload.form.isConnected
}
function cancelImageUpload(upload: ActiveImageUpload) {
  if (upload.cancelled) return
  const canUpdateUi = isUploadSessionCurrent(upload)
  upload.cancelled = true
  upload.observer?.disconnect()
  upload.abortRequest?.()
  activeImageUploads.delete(upload)
  upload.fileInput.value = ''
  if (canUpdateUi) {
    upload.uploadButton.disabled = false
    upload.status.textContent = ''
  }
}
function cancelSessionImageUploads() {
  for (const upload of activeImageUploads) cancelImageUpload(upload)
}
function closeSessionInterfaces() {
  cancelSessionImageUploads()
  window.dispatchEvent(new Event('asaar:session-invalidated'))
  document.querySelectorAll<HTMLElement>('.modal-backdrop, .image-help-backdrop, .image-viewer-backdrop, #app-toast').forEach((element) => element.remove())
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = undefined
}

const modal = (content: string) => {
  const isCategoryFlow = content.includes('id="rename-category"') || content.includes('id="confirm-category-delete"')
  if (!isCategoryFlow) document.querySelectorAll<HTMLDivElement>('.modal-backdrop').forEach((existing) => existing.remove())
  const element = document.createElement('div')
  element.className = 'modal-backdrop'
  element.innerHTML = `<section class="modal">${content}</section>`
  element.addEventListener('click', (event) => { if (event.target === element) element.remove() })
  document.body.append(element)
  element.querySelector<HTMLElement>('.rate-field small')?.replaceChildren(document.createTextNode('كل 1 دولار أمريكي كم ليرة سورية يساوي؟'))
  const applyCategoryPlaceholder = () => {
    const input = element.querySelector<HTMLInputElement>('#category-form input[name="name"]')
    if (!input) return false
    input.setAttribute('placeholder', 'اسم الفئة مثال: دواليب')
    return true
  }
  if (!applyCategoryPlaceholder()) {
    const observer = new MutationObserver(() => {
      if (applyCategoryPlaceholder()) observer.disconnect()
    })
    observer.observe(element, { childList: true, subtree: true })
  }
  return element
}
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string) {
  let toast = document.querySelector<HTMLElement>('#app-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'app-toast'
    toast.className = 'app-toast'
    toast.setAttribute('role', 'alert')
    document.body.append(toast)
  }
  toast.textContent = message
  toast.classList.add('is-visible')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast?.classList.remove('is-visible'), 3000)
}
document.addEventListener('invalid', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.form?.id !== 'category-form') return
  event.preventDefault()
  showToast('يجب إدخال اسم الفئة.')
}, true)
document.addEventListener('input', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.form?.id !== 'category-form') return
  const error = input.form.querySelector<HTMLElement>('#category-error')
  if (error) error.textContent = ''
})
function renderCategoryField(selected: string | null = null, fieldClass = '') {
  const selectedCategory = selected ? categories.find((category) => category.id === selected) ?? null : null;
  const selectedCategoryId = selectedCategory?.id ?? '';
  const selectedCategoryName = selectedCategory ? escapeHtml(selectedCategory.name) : 'بدون فئة';

  return `
    <div class="custom-select-field ${fieldClass}" data-category-select>
      <button type="button" class="custom-select-trigger" data-role="trigger" aria-label="اختيار الفئة" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-label">${selectedCategoryName}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="custom-select-menu hidden" role="listbox" aria-label="الفئات">
        <button type="button" class="custom-select-option ${!selectedCategoryId ? 'is-selected' : ''}" data-category-id="" role="option" aria-selected="${!selectedCategoryId}">بدون فئة</button>
        ${sortedCategories().map((category) => `<button type="button" class="custom-select-option ${selectedCategoryId === category.id ? 'is-selected' : ''}" data-category-id="${category.id}" role="option" aria-selected="${selectedCategoryId === category.id}">${escapeHtml(category.name)}</button>`).join('')}
      </div>
      <input type="hidden" name="categoryId" value="${selectedCategoryId}">
    </div>
  `;
}
function bindCategoryField(field: HTMLElement) {
  const trigger = field.querySelector<HTMLButtonElement>('[data-role="trigger"]')!;
  const menu = field.querySelector<HTMLElement>('.custom-select-menu')!;
  const hiddenInput = field.querySelector<HTMLInputElement>('input[name="categoryId"]')!;

  const setSelected = (categoryId: string, label: string) => {
    hiddenInput.value = categoryId;
    const labelNode = trigger.querySelector<HTMLElement>('.custom-select-label')!;
    labelNode.textContent = label;
    field.querySelectorAll<HTMLButtonElement>('.custom-select-option').forEach((button) => {
      const active = button.dataset.categoryId === categoryId;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-selected', String(active));
    });
    field.classList.remove('open');
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = field.classList.toggle('open');
    menu.classList.toggle('hidden', !isOpen);
    if (isOpen && field.classList.contains('bulk-category-select')) {
      const triggerRect = trigger.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const top = triggerRect.bottom + menuHeight + 8 <= window.innerHeight - 8
        ? triggerRect.bottom + 8
        : Math.max(8, triggerRect.top - menuHeight - 8);
      const left = Math.min(Math.max(8, triggerRect.left), window.innerWidth - triggerRect.width - 8);
      Object.assign(menu.style, { position: 'fixed', top: `${top}px`, left: `${left}px`, right: 'auto', width: `${triggerRect.width}px` });
    }
    trigger.setAttribute('aria-expanded', String(isOpen));
  });

  field.querySelectorAll<HTMLButtonElement>('.custom-select-option').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const categoryId = button.dataset.categoryId ?? '';
      const label = button.textContent?.trim() || 'بدون فئة';
      setSelected(categoryId, label);
    });
  });

  document.addEventListener('click', (event) => {
    if (!field.contains(event.target as Node)) {
      field.classList.remove('open');
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  if (field.classList.contains('bulk-category-select')) {
    field.closest('.bulk-table-scroll')?.addEventListener('scroll', () => {
      if (!field.classList.contains('open')) return;
      field.classList.remove('open');
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }, { passive: true });
  }
}
function productDocumentData(name: string, priceInput: string, number: number, categoryId: string | null, imageUrl: string | null = null) {
  const price = priceInput ? Number(priceInput) : Number.NaN
  return { name, price: Number.isFinite(price) ? price : null, number, categoryId, ...(imageUrl ? { imageUrl } : {}) }
}
function productImageField(imageUrl = '') {
  return `<div class="product-image-field"><div class="image-url-field-header"><label for="product-image-url">رابط صورة المنتج</label><button class="image-help-trigger" type="button" aria-label="مساعدة حول رابط صورة المنتج" title="كيف أرفع صورة وأحصل على رابطها؟">!</button></div><input id="product-image-url" name="imageUrl" type="url" maxlength="2048" value="${escapeHtml(imageUrl)}" placeholder="https://..." autocomplete="url"><div class="product-image-upload"><button class="secondary-button product-image-upload-button" type="button">اختيار صورة ورفعها</button><input class="product-image-upload-input" type="file" accept="image/jpeg,image/png,image/webp" hidden><p class="product-image-upload-status" role="status" aria-live="polite"></p></div></div><div class="product-image-preview" hidden><img alt="معاينة صورة المنتج"><p aria-live="polite"></p></div><p class="modal-error image-url-error" hidden></p>`
}
function userCloudinarySettingsRef(user: User, ownerId: string) {
  return doc(db, 'users', ownerId, 'cloudinarySettings', user.uid)
}
async function readUserCloudinarySettings(user: User, ownerId: string): Promise<CloudinarySettings> {
  const snapshot = await getDocFromServer(userCloudinarySettingsRef(user, ownerId))
  if (!snapshot.exists()) return { ...emptyCloudinarySettings }
  const data = snapshot.data()
  return {
    cloudName: typeof data.cloudName === 'string' ? data.cloudName.trim() : '',
    uploadPreset: typeof data.uploadPreset === 'string' ? data.uploadPreset.trim() : '',
  }
}
function validCloudinarySettings(value: CloudinarySettings) {
  return /^[a-z0-9][a-z0-9-]*$/i.test(value.cloudName) && /^[a-z0-9_-]+$/i.test(value.uploadPreset)
}
function uploadProductImage(file: File, config: CloudinarySettings, onProgress: (percent: number) => void): { promise: Promise<string>; abort: () => void } {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', config.uploadPreset)
  const request = new XMLHttpRequest()
  request.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`)
  request.timeout = 120000
  let settled = false
  let rejectPromise: (error: Error) => void = () => undefined
  const cleanup = () => {
    request.upload.removeEventListener('progress', handleProgress)
    request.removeEventListener('load', handleLoad)
    request.removeEventListener('error', handleError)
    request.removeEventListener('abort', handleAbort)
    request.removeEventListener('timeout', handleTimeout)
  }
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    cleanup()
    rejectPromise(error)
  }
  const handleProgress = (event: ProgressEvent) => {
    if (!settled && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
  }
  const handleLoad = () => {
    if (settled) return
    let response: { secure_url?: unknown; error?: { message?: unknown } }
    try {
      response = JSON.parse(request.responseText) as typeof response
    } catch (error) {
      fail(new Error('استجابة Cloudinary غير صالحة.', { cause: error }))
      return
    }
    if (request.status < 200 || request.status >= 300) {
      fail(new Error(typeof response.error?.message === 'string' ? response.error.message : 'رفض Cloudinary عملية رفع الصورة.'))
      return
    }
    if (typeof response.secure_url !== 'string') {
      fail(new Error('لم يُرجع Cloudinary رابطًا آمنًا للصورة.'))
      return
    }
    try {
      const secureUrl = new URL(response.secure_url)
      if (secureUrl.protocol !== 'https:') throw new Error('Cloudinary returned a non-HTTPS URL')
      settled = true
      cleanup()
      resolvePromise(secureUrl.href)
    } catch (error) {
      fail(new Error('رابط الصورة الناتج من Cloudinary غير صالح.', { cause: error }))
    }
  }
  const handleError = () => fail(new Error('تعذر الاتصال بخدمة Cloudinary.'))
  const handleAbort = () => fail(new Error('تم إلغاء رفع الصورة.'))
  const handleTimeout = () => fail(new Error('انتهت مهلة رفع الصورة. تحقق من الاتصال وحاول مجددًا.'))
  let resolvePromise: (url: string) => void = () => undefined
  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  request.upload.addEventListener('progress', handleProgress)
  request.addEventListener('load', handleLoad)
  request.addEventListener('error', handleError)
  request.addEventListener('abort', handleAbort)
  request.addEventListener('timeout', handleTimeout)
  try {
    request.send(formData)
  } catch (error) {
    fail(new Error('تعذر بدء رفع الصورة.', { cause: error }))
  }
  return {
    promise,
    abort: () => {
      if (settled) return
      try {
        request.abort()
      } finally {
        fail(new Error('تم إلغاء رفع الصورة.'))
      }
    },
  }
}
function uploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message) console.error('Product image upload failed:', error)
  if (/^[\u0600-\u06FF]/.test(message)) return message
  if (message.includes('permission-denied') || message.includes('unauthenticated')) return 'تعذر قراءة إعدادات الرفع لهذا المستخدم.'
  return 'تعذر رفع الصورة إلى Cloudinary. تحقق من الإعدادات وقيود Upload Preset والاتصال، ثم حاول مجددًا.'
}
function showProductImageHelp(trigger: HTMLButtonElement) {
  if (document.querySelector('.image-help-backdrop')) return
  const isAndroidPwa = isStandalone() && /Android/i.test(navigator.userAgent)
  const cloudinaryUrl = isAndroidPwa
    ? 'intent://cloudinary.com/#Intent;scheme=https;package=com.android.chrome;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end'
    : 'https://cloudinary.com/'
  const cloudinaryTarget = isAndroidPwa ? '_self' : '_blank'
  const backdrop = document.createElement('div')
  backdrop.className = 'image-help-backdrop'
  backdrop.innerHTML = `
    <section class="image-help-dialog" role="dialog" aria-modal="true" aria-labelledby="image-help-title" dir="rtl">
      <button class="modal-close image-help-close" type="button" aria-label="إغلاق">${svg('close')}</button>
      <p class="eyebrow">دليل الصور</p>
      <h2 id="image-help-title">إضافة صورة من <a class="image-help-link" href="${cloudinaryUrl}" target="${cloudinaryTarget}" rel="noopener noreferrer">Cloudinary</a></h2>
      <ol class="image-help-steps">
        <li><span class="image-help-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M16 3h5v5"/></svg></span><span><strong>ادخل إلى حسابك</strong><span>سجّل الدخول إلى حسابك في <a class="image-help-link" href="${cloudinaryUrl}" target="${cloudinaryTarget}" rel="noopener noreferrer">Cloudinary</a>.</span></span></li>
        <li><span class="image-help-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 16V9m0 0-3 3m3-3 3 3"/></svg></span><span><strong>ارفع صورة المنتج</strong><span>افتح Media Library، واختر رفع صورة من جهازك، ثم انتظر اكتمال الرفع.</span></span></li>
        <li><span class="image-help-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 12.5 5.5 15a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5"/><path d="m16 11.5 2.5-2.5a3.5 3.5 0 0 0-5-5l-4 4a3.5 3.5 0 0 0 0 5"/><path d="m9 15 6-6"/></svg></span><span><strong>انسخ رابط الصورة المباشر</strong><span>افتح تفاصيل الصورة وانسخ <bdi dir="ltr">Secure URL</bdi>. لا تنسخ رابط صفحة لوحة التحكم.</span></span></li>
        <li><span class="image-help-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m4 7 8 6 8-6"/><path d="m8 16 2 2 5-5"/></svg></span><span><strong>الصق الرابط في المنتج</strong><span>عد إلى الموقع والصق الرابط في الحقل، وانتظر ظهور معاينة الصورة، ثم احفظ المنتج.</span></span></li>
      </ol>
      <p class="image-help-note">يبدأ الرابط عادةً بـ <code dir="ltr">https://res.cloudinary.com/</code> ويتضمن <code dir="ltr">/image/upload/</code>. يجب أن تظهر المعاينة قبل الحفظ؛ إذا فشلت، راجع الرابط وتأكد أنك نسخت رابط الصورة المباشر.</p>
    </section>
  `
  const close = () => {
    backdrop.remove()
    document.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('asaar:session-invalidated', close)
    if (trigger.isConnected) trigger.focus()
  }
  const handleKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close() })
  backdrop.querySelector<HTMLButtonElement>('.image-help-close')!.addEventListener('click', close)
  window.addEventListener('asaar:session-invalidated', close, { once: true })
  document.addEventListener('keydown', handleKeydown)
  document.body.append(backdrop)
  backdrop.querySelector<HTMLButtonElement>('.image-help-close')!.focus()
}
function bindProductImageField(container: ParentNode) {
  const input = container.querySelector<HTMLInputElement>('input[name="imageUrl"]')!
  const fileInput = container.querySelector<HTMLInputElement>('.product-image-upload-input')!
  const uploadButton = container.querySelector<HTMLButtonElement>('.product-image-upload-button')!
  const uploadStatus = container.querySelector<HTMLElement>('.product-image-upload-status')!
  const preview = container.querySelector<HTMLElement>('.product-image-preview')!
  const image = preview.querySelector<HTMLImageElement>('img')!
  const status = preview.querySelector<HTMLElement>('p')!
  const error = container.querySelector<HTMLElement>('.image-url-error')!
  container.querySelector<HTMLButtonElement>('.image-help-trigger')!.addEventListener('click', (event) => {
    event.preventDefault()
    showProductImageHelp(event.currentTarget as HTMLButtonElement)
  })
  const updatePreview = () => {
    const value = input.value.trim()
    const imageUrl = normalizeProductImageUrl(value)
    error.hidden = true
    error.textContent = ''
    if (!value) {
      preview.hidden = true
      image.removeAttribute('src')
      return
    }
    if (!imageUrl) {
      preview.hidden = true
      image.removeAttribute('src')
      error.textContent = 'أدخل رابط صورة صحيحًا يبدأ بـ http:// أو https://.'
      error.hidden = false
      return
    }
    preview.hidden = false
    image.hidden = false
    status.textContent = 'جارٍ تحميل المعاينة...'
    image.onload = () => { status.textContent = '' }
    image.onerror = () => { image.hidden = true; status.textContent = 'تعذر تحميل الصورة من هذا الرابط.' }
    image.src = optimizedProductImageUrl(imageUrl)
  }
  input.addEventListener('input', updatePreview)
  uploadButton.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    if (!allowedProductImageTypes.has(file.type)) {
      uploadStatus.textContent = 'الصيغ المسموحة هي JPEG وPNG وWebP فقط.'
      fileInput.value = ''
      return
    }
    if (file.size > maxProductImageSize) {
      uploadStatus.textContent = 'يجب ألا يتجاوز حجم الصورة 10 MiB.'
      fileInput.value = ''
      return
    }
    if (!currentUser) {
      uploadStatus.textContent = 'يجب تسجيل الدخول قبل رفع الصورة.'
      fileInput.value = ''
      return
    }
    const user = currentUser
    const upload: ActiveImageUpload = {
      authUid: user.uid,
      dataUserId,
      authSessionId,
      form: input.form!,
      fileInput,
      uploadButton,
      status: uploadStatus,
      cancelled: false,
    }
    activeImageUploads.add(upload)
    upload.observer = new MutationObserver(() => {
      if (!upload.form.isConnected) cancelImageUpload(upload)
    })
    upload.observer.observe(document.body, { childList: true, subtree: true })
    uploadButton.disabled = true
    uploadStatus.textContent = 'جارٍ تحميل إعدادات Cloudinary...'
    try {
      const config = await readUserCloudinarySettings(user, upload.dataUserId)
      if (!isUploadSessionCurrent(upload)) return
      if (!validCloudinarySettings(config)) throw new Error('أدخل Cloud name وUpload Preset واحفظهما في إعدادات رفع الصور أولًا.')
      uploadStatus.textContent = 'جارٍ رفع الصورة...'
      const request = uploadProductImage(file, config, (percent) => {
        if (isUploadSessionCurrent(upload)) uploadStatus.textContent = `جارٍ رفع الصورة... ${percent}%`
      })
      upload.abortRequest = request.abort
      if (!isUploadSessionCurrent(upload)) {
        request.abort()
        return
      }
      const secureUrl = await request.promise
      if (!isUploadSessionCurrent(upload)) return
      input.value = secureUrl
      input.dispatchEvent(new Event('input', { bubbles: true }))
      uploadStatus.textContent = 'تم رفع الصورة وإضافتها إلى المعاينة. احفظ المنتج لإتمام التغيير.'
    } catch (error) {
      if (isUploadSessionCurrent(upload)) uploadStatus.textContent = uploadErrorMessage(error)
    } finally {
      upload.observer?.disconnect()
      activeImageUploads.delete(upload)
      fileInput.value = ''
      if (isUploadSessionCurrent(upload)) uploadButton.disabled = false
    }
  })
  updatePreview()
}
function isProductNameTaken(name: string) {
  const normalizedName = normalizeName(name)
  return products.some((product) => normalizeName(product.name) === normalizedName)
}
function isValidProductPrice(priceInput: string) {
  if (!priceInput) return true
  const price = Number(priceInput)
  return Number.isFinite(price) && price > 0
}
function renderAddModal() {
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">منتج جديد</p>
    <div class="add-mode-tabs" role="group" aria-label="وضع إضافة المنتجات">
      <button class="active" type="button" data-add-mode="single" aria-pressed="true">إضافة منتج</button>
      <button type="button" data-add-mode="bulk" aria-pressed="false">إضافة منتجات</button>
    </div>
    <div id="add-product-content"></div>
  `)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const content = element.querySelector<HTMLElement>('#add-product-content')!
  const renderMode = (mode: 'single' | 'bulk') => {
    element.querySelectorAll<HTMLButtonElement>('[data-add-mode]').forEach((button) => {
      const active = button.dataset.addMode === mode
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    if (mode === 'single') renderSingleProductForm(content, element)
    else renderBulkProductForm(content, element)
  }
  element.querySelectorAll<HTMLButtonElement>('[data-add-mode]').forEach((button) => {
    button.addEventListener('click', () => renderMode(button.dataset.addMode === 'bulk' ? 'bulk' : 'single'))
  })
  renderMode('single')
}
function renderSingleProductForm(content: HTMLElement, element: HTMLElement) {
  content.innerHTML = `<h2>إضافة منتج واحد</h2><form id="product-form"><label>اسم المنتج<input name="name" required autofocus maxlength="100" placeholder="مثال: دولاب داخلي صيني"></label><label>السعر بالدولار<input name="price" type="number" min="0.01" step="0.01" placeholder="0.00"></label>${productImageField()}<label>الفئة${renderCategoryField()}</label><p class="modal-error" id="modal-error"></p><button class="primary-button" type="submit">حفظ المنتج</button></form>`
  bindProductImageField(content)
  const field = content.querySelector<HTMLElement>('[data-category-select]')
  if (field) bindCategoryField(field)
  content.querySelector('form')!.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const name = String(form.get('name')).trim()
    const priceInput = String(form.get('price') || '').trim()
    const imageUrlInput = String(form.get('imageUrl') || '').trim()
    const imageUrl = normalizeProductImageUrl(imageUrlInput)
    const categoryId = String(form.get('categoryId') || '') || null
    const error = content.querySelector('#modal-error')!
    if (imageUrlInput && !imageUrl) {
      error.textContent = 'أدخل رابط صورة صحيحًا يبدأ بـ http:// أو https://.'
      return
    }
    if (!name || !isValidProductPrice(priceInput) || !currentUser) {
      error.textContent = priceInput ? 'أدخل سعرًا صالحًا.' : 'أدخل اسمًا صالحًا.'
      return
    }
    if (isProductNameTaken(name)) {
      showToast('هذا المنتج موجود بالفعل.')
      return
    }
    const button = content.querySelector<HTMLButtonElement>('button[type="submit"]')!
    button.disabled = true
    try {
      await addDoc(collection(db, 'users', dataUserId, 'products'), productDocumentData(name, priceInput, nextProductNumber(), categoryId, imageUrl))
      updateProductList()
      element.remove()
    } catch (addError) {
      button.disabled = false
      error.textContent = friendlyError(addError)
    }
  })
}
function renderBulkProductForm(content: HTMLElement, element: HTMLElement) {
  const rows = Array.from({ length: 25 }, (_, index) => `
    <tr class="bulk-product-row" data-bulk-row="${index}">
      <th class="bulk-row-number" scope="row">${index + 1}</th>
      <td><input class="bulk-product-name" type="text" maxlength="100" autocomplete="off" placeholder="اسم المنتج" aria-label="اسم المنتج، الصف ${index + 1}"></td>
      <td><input class="bulk-product-price" type="number" min="0.01" step="0.01" placeholder="السعر" aria-label="السعر بالدولار، الصف ${index + 1}"><span class="bulk-price-error"></span></td>
      <td>${renderCategoryField(null, 'bulk-category-select')}</td>
    </tr>
  `).join('')
  content.innerHTML = `
    <form id="bulk-product-form" class="bulk-product-form" novalidate>
      <h2>أضف منتجات متعددة حتى 25 منتج دفعة واحدة</h2>
      <div class="bulk-table-scroll" role="region" aria-label="جدول إضافة المنتجات" tabindex="0">
        <table class="bulk-product-table">
          <colgroup><col class="bulk-number-column"><col class="bulk-name-column"><col class="bulk-price-column"><col class="bulk-category-column"></colgroup>
          <thead><tr><th scope="col">الرقم</th><th scope="col">اسم المنتج</th><th scope="col">السعر بالدولار</th><th scope="col">الفئة</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="bulk-form-error" id="bulk-form-error" role="status"></p>
      <div class="bulk-form-footer"><button class="primary-button" type="submit">حفظ المنتجات</button></div>
    </form>
  `
  const form = content.querySelector<HTMLFormElement>('#bulk-product-form')!
  const formError = content.querySelector<HTMLElement>('#bulk-form-error')!
  content.querySelectorAll<HTMLElement>('.bulk-category-select').forEach((field) => bindCategoryField(field))
  const nameInputs = [...content.querySelectorAll<HTMLInputElement>('.bulk-product-name')]
  const revalidateNames = () => {
    const normalizedNames = nameInputs.map((input) => normalizeName(input.value))
    const invalidInputs: HTMLInputElement[] = []
    nameInputs.forEach((input, index) => {
      const name = input.value.trim()
      const normalizedName = normalizedNames[index]
      const existsInProducts = Boolean(name) && isProductNameTaken(name)
      const existsInTable = Boolean(name) && normalizedNames.some((otherName, otherIndex) => otherIndex !== index && otherName === normalizedName)
      const duplicate = existsInProducts || existsInTable
      const message = existsInProducts
        ? 'هذا المنتج موجود بالفعل ولا يمكن إضافته مرة أخرى.'
        : 'تم إدخال اسم هذا المنتج داخل هذا الجدول بالفعل ولا يمكن إدخاله مرة أخرى.'
      const row = input.closest<HTMLTableRowElement>('.bulk-product-row')!
      let errorRow = content.querySelector<HTMLTableRowElement>(`[data-bulk-error-row="${index}"]`)
      if (duplicate && !errorRow) {
        errorRow = document.createElement('tr')
        errorRow.className = 'bulk-name-error-row'
        errorRow.dataset.bulkErrorRow = String(index)
        errorRow.innerHTML = '<td colspan="4"><span class="bulk-name-error" role="status"></span></td>'
        row.after(errorRow)
      }
      const error = errorRow?.querySelector<HTMLElement>('.bulk-name-error')
      if (error) {
        error.textContent = message
        error.classList.toggle('is-saved-duplicate', existsInProducts)
        error.classList.toggle('is-table-duplicate', !existsInProducts && existsInTable)
      }
      if (!duplicate) errorRow?.remove()
      input.setAttribute('aria-invalid', String(duplicate))
      row.classList.toggle('is-invalid', duplicate)
      row.classList.toggle('is-saved-duplicate', existsInProducts)
      row.classList.toggle('is-table-duplicate', !existsInProducts && existsInTable)
      if (duplicate) invalidInputs.push(input)
    })
    return invalidInputs[0] ?? null
  }
  nameInputs.forEach((input) => input.addEventListener('input', () => {
    formError.textContent = ''
    revalidateNames()
  }))
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!currentUser) {
      formError.textContent = 'يجب تسجيل الدخول أولًا.'
      return
    }
    const duplicateInput = revalidateNames()
    if (duplicateInput) {
      formError.textContent = 'صحح أسماء المنتجات المكررة قبل الحفظ.'
      showToast('لا يمكن حفظ المنتجات بسبب وجود اسم مكرر.')
      duplicateInput.focus()
      return
    }
    const populatedRows = [...form.querySelectorAll<HTMLTableRowElement>('tbody tr.bulk-product-row')].filter((row) => row.querySelector<HTMLInputElement>('.bulk-product-name')!.value.trim())
    if (!populatedRows.length) {
      formError.textContent = 'أدخل اسم منتج واحدًا على الأقل.'
      return
    }
    const invalidPriceRow = populatedRows.find((row) => !isValidProductPrice(row.querySelector<HTMLInputElement>('.bulk-product-price')!.value.trim()))
    if (invalidPriceRow) {
      const rowNumber = invalidPriceRow.querySelector('.bulk-row-number')!.textContent
      invalidPriceRow.querySelector<HTMLElement>('.bulk-price-error')!.textContent = 'أدخل سعرًا صالحًا.'
      formError.textContent = `السعر في الصف ${rowNumber} غير صالح.`
      invalidPriceRow.querySelector<HTMLInputElement>('.bulk-product-price')!.focus()
      return
    }
    populatedRows.forEach((row) => { row.querySelector<HTMLElement>('.bulk-price-error')!.textContent = '' })
    const saveButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    saveButton.disabled = true
    formError.textContent = ''
    const batch = writeBatch(db)
    let productNumber = nextProductNumber()
    populatedRows.forEach((row) => {
      const name = row.querySelector<HTMLInputElement>('.bulk-product-name')!.value.trim()
      const priceInput = row.querySelector<HTMLInputElement>('.bulk-product-price')!.value.trim()
      const categoryId = row.querySelector<HTMLInputElement>('input[name="categoryId"]')!.value || null
      batch.set(doc(collection(db, 'users', dataUserId, 'products')), productDocumentData(name, priceInput, productNumber, categoryId))
      productNumber += 1
    })
    try {
      await batch.commit()
      updateProductList()
      element.remove()
    } catch (saveError) {
      saveButton.disabled = false
      formError.textContent = friendlyError(saveError)
      showToast('تعذر حفظ المنتجات. حاول مجددًا.')
    }
  })
}
function renderEditModal(id: string) {
  const product = products.find((item) => item.id === id)
  if (!product || !currentUser) return
  const element = modal(`<button class="modal-close" aria-label="إغلاق">${svg('close')}</button><p class="eyebrow">تعديل المنتج</p><h2>${escapeHtml(product.name)}</h2><form id="edit-form"><label>اسم المنتج<input name="name" required maxlength="100" value="${escapeHtml(product.name)}"></label><label>السعر بالدولار<input name="price" type="number" min="0.01" step="0.01" value="${Number.isFinite(product.price) ? product.price : ''}"></label>${productImageField(product.imageUrl || '')}<label>الفئة${renderCategoryField(product.categoryId)}</label><p class="modal-error" id="modal-error"></p><div class="modal-actions"><button class="danger-button" id="delete-product" type="button">حذف المنتج</button><button class="primary-button" type="submit">حفظ التعديل</button></div></form>`)
  bindProductImageField(element)
  const field = element.querySelector<HTMLElement>('[data-category-select]')
  if (field) bindCategoryField(field)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  element.querySelector('#delete-product')!.addEventListener('click', () => { element.remove(); renderDeleteModal(id) })
  element.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const name = String(form.get('name')).trim()
    const priceInput = String(form.get('price') || '').trim()
    const price = priceInput ? Number(priceInput) : Number.NaN
    const imageUrlInput = String(form.get('imageUrl') || '').trim()
    const imageUrl = normalizeProductImageUrl(imageUrlInput)
    const categoryId = String(form.get('categoryId') || '') || null
    const error = element.querySelector('#modal-error')!
    if (imageUrlInput && !imageUrl) {
      error.textContent = 'أدخل رابط صورة صحيحًا يبدأ بـ http:// أو https://.'
      return
    }
    if (!name || (priceInput && (!Number.isFinite(price) || price <= 0))) {
      error.textContent = priceInput ? 'أدخل سعرًا صالحًا.' : 'أدخل اسمًا صالحًا.'
      return
    }
    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!
    button.disabled = true
    try {
      await updateDoc(doc(db, 'users', dataUserId, 'products', id), {
        name,
        price: Number.isFinite(price) ? price : null,
        categoryId,
        imageUrl: imageUrl || deleteField(),
      })
      element.remove()
    } catch (updateError) {
      button.disabled = false
      error.textContent = friendlyError(updateError)
    }
  })
}
function nextProductNumber() { const numbers = products.filter((product) => product.storedNumber).map((product) => product.number); return (numbers.length ? Math.max(...numbers) : 0) + 1 }
function renderDeleteModal(id: string) { const product = products.find((item) => item.id === id); if (!product || !currentUser) return; const element = modal(`<p class="eyebrow">تأكيد الحذف</p><h2>حذف ${escapeHtml(product.name)}؟</h2><p class="modal-copy">سيتم إزالة هذا المنتج من قائمتك.</p><p class="modal-error" id="modal-error"></p><div class="modal-actions"><button class="secondary-button" id="cancel-delete">إلغاء</button><button class="danger-button" id="confirm-delete">حذف المنتج</button></div>`); element.querySelector('#cancel-delete')!.addEventListener('click', () => element.remove()); element.querySelector('#confirm-delete')!.addEventListener('click', async () => { const button = element.querySelector<HTMLButtonElement>('#confirm-delete')!; button.disabled = true; try { await deleteDoc(doc(db, 'users', dataUserId, 'products', id)); products = products.filter((item) => item.id !== id); updateProductList(); element.remove() } catch (deleteError) { button.disabled = false; element.querySelector('#modal-error')!.textContent = friendlyError(deleteError) } }) }
function renderSettingsNew() {
  if (!currentUser) return
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">تفضيلاتك</p>
    <div class="settings-tabs">
      <button class="active" data-settings-tab="currency">العملة</button>
      <button data-settings-tab="categories">الفئات</button>
      <button data-settings-tab="system">النظام</button>
    </div>
    <div id="settings-content"></div>
  `)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const content = element.querySelector<HTMLElement>('#settings-content')!
  const renderTab = (tab: string) => {
    element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === tab))
    if (tab === 'currency') {
      content.innerHTML = `
        <h2>العملة</h2>
        <label class="switch-row"><span>تفعيل الليرة السورية</span><input id="syria-toggle" type="checkbox" ${settings.syriaEnabled ? 'checked' : ''}><i></i></label>
        <div id="rate-field" class="rate-field ${settings.syriaEnabled ? '' : 'hidden'}"><label>سعر الصرف<input id="exchange-rate" type="number" min="1" step="1" value="${settings.exchangeRate || ''}" placeholder="15000"><small>1 USD = ليرة سورية</small></label></div>
        <label class="switch-row"><span>تفعيل أسعار المفرق</span><input id="retail-toggle" type="checkbox" ${settings.retailPricesEnabled ? 'checked' : ''}><i></i></label>
        <div id="retail-profit-field" class="rate-field ${settings.retailPricesEnabled ? '' : 'hidden'}"><label><span class="percentage-label-row"><span>نسبة الربح المئوية للمفرق <span class="percentage-label-unit">%</span></span><small class="percentage-example"><span class="percentage-example-unit">%</span><span class="percentage-example-range" dir="ltr">0-100</span></small></span><span class="percentage-input-wrap"><input id="retail-profit-percentage" type="number" min="0" max="100" step="0.01" value="${settings.retailProfitPercentage || ''}" placeholder="10"><span class="percentage-input-unit" aria-hidden="true">%</span></span></label></div>
        <p class="modal-error" id="modal-error"></p>
        <button class="primary-button" id="save-settings">حفظ الإعدادات</button>
      `
      const toggle = content.querySelector<HTMLInputElement>('#syria-toggle')!
      const retailToggle = content.querySelector<HTMLInputElement>('#retail-toggle')!
      toggle.addEventListener('change', () => content.querySelector('#rate-field')!.classList.toggle('hidden', !toggle.checked))
      retailToggle.addEventListener('change', () => content.querySelector('#retail-profit-field')!.classList.toggle('hidden', !retailToggle.checked))
      content.querySelector('#save-settings')!.addEventListener('click', async () => {
        if (!currentUser) {
          content.querySelector('#modal-error')!.textContent = 'يجب تسجيل الدخول أولًا.'
          return
        }
        const exchangeRate = Number(content.querySelector<HTMLInputElement>('#exchange-rate')!.value)
        const retailProfitPercentage = Number(content.querySelector<HTMLInputElement>('#retail-profit-percentage')!.value)
        const error = content.querySelector('#modal-error')!
        if (toggle.checked && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
          error.textContent = 'أدخل سعر صرف صالحًا.'
          return
        }
        if (retailToggle.checked && (!Number.isFinite(retailProfitPercentage) || retailProfitPercentage < 0 || retailProfitPercentage > 100)) {
          error.textContent = 'نسبة الربح المئوية للمفرق يجب أن تكون بين 0 و 100.'
          return
        }
        const next = {
          ...settings,
          syriaEnabled: toggle.checked,
          exchangeRate: toggle.checked ? exchangeRate : settings.exchangeRate,
          retailPricesEnabled: retailToggle.checked,
          retailProfitPercentage: retailToggle.checked ? normalizeRetailProfit(retailProfitPercentage) : settings.retailProfitPercentage,
        }
        settings = next
        saveCachedSettings(dataUserId, settings)
        try { await setDoc(doc(db, 'users', dataUserId), next, { merge: true }) } catch { /* Keep local settings. */ }
        updateProductList()
        element.remove()
      })
      return
    }
    if (tab === 'categories') {
      renderCategoriesTab(content)
      return
    }
    content.innerHTML = `
      <h2>النظام</h2>
      <label class="switch-row"><span>الوضع الليلي</span><input id="dark-mode-toggle" type="checkbox" ${settings.darkMode ? 'checked' : ''}><i></i></label>
      <label class="switch-row"><span>تفعيل المفضلة</span><input id="favorites-toggle" type="checkbox" ${settings.favoritesEnabled ? 'checked' : ''}><i></i></label>
      <section class="cloudinary-settings">
        <h3>إعدادات رفع الصور</h3>
        <label>Cloud name<input id="cloudinary-cloud-name" type="text" dir="ltr" autocomplete="off" spellcheck="false"></label>
        <label>Upload Preset<input id="cloudinary-upload-preset" type="text" dir="ltr" autocomplete="off" spellcheck="false"></label>
        <p id="cloudinary-settings-status" role="status" aria-live="polite">جارٍ تحميل الإعدادات...</p>
        <button class="primary-button" id="save-cloudinary-settings" type="button" disabled>حفظ إعدادات الرفع</button>
      </section>
      <div class="account">
        <span>${escapeHtml(currentUser?.email || '')}</span>
        <div class="account-actions">
          <button class="text-button" id="export-products" type="button">تنزيل بياناتك</button>
          <button class="text-button" id="logout" type="button">تسجيل الخروج</button>
        </div>
      </div>
    `
    const darkModeToggle = content.querySelector<HTMLInputElement>('#dark-mode-toggle')!
    const favoritesToggle = content.querySelector<HTMLInputElement>('#favorites-toggle')!
    bindCloudinarySettingsPanel(content)
    content.querySelector<HTMLButtonElement>('#export-products')!.addEventListener('click', (event) => {
      void exportProductsToExcel(event.currentTarget as HTMLButtonElement)
    })
    darkModeToggle.addEventListener('change', async () => {
      settings = { ...settings, darkMode: darkModeToggle.checked }
      applyTheme(settings.darkMode)
      saveCachedSettings(dataUserId, settings)
      try { await setDoc(doc(db, 'users', dataUserId), settings, { merge: true }) } catch { /* Keep local state. */ }
    })
    favoritesToggle.addEventListener('change', async () => {
      settings = { ...settings, favoritesEnabled: favoritesToggle.checked }
      if (!settings.favoritesEnabled) favoritesFilterActive = false
      saveCachedSettings(dataUserId, settings)
      try { await setDoc(doc(db, 'users', dataUserId), settings, { merge: true }) } catch { /* Keep local state. */ }
      updateCategoryBar()
      updateProductList()
    })
    content.querySelector<HTMLElement>('#logout')?.addEventListener('click', async () => {
      try {
        await signOut(auth)
        element.remove()
      } catch (error) {
        console.error('Failed to sign out:', error)
      }
    })
  }
  element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => renderTab(button.dataset.settingsTab || 'currency'))
  })
  renderTab('currency')
}
function bindCloudinarySettingsPanel(content: HTMLElement) {
  const user = currentUser
  const ownerId = dataUserId
  const sessionId = authSessionId
  const cloudNameInput = content.querySelector<HTMLInputElement>('#cloudinary-cloud-name')!
  const uploadPresetInput = content.querySelector<HTMLInputElement>('#cloudinary-upload-preset')!
  const status = content.querySelector<HTMLElement>('#cloudinary-settings-status')!
  const saveButton = content.querySelector<HTMLButtonElement>('#save-cloudinary-settings')!
  const isCurrentPanel = () => content.isConnected && cloudNameInput.isConnected && currentUser?.uid === user?.uid && dataUserId === ownerId && authSessionId === sessionId
  const load = async () => {
    if (!user) {
      status.textContent = 'يجب تسجيل الدخول أولًا.'
      return
    }
    try {
      const config = await readUserCloudinarySettings(user, ownerId)
      if (!isCurrentPanel()) return
      cloudNameInput.value = config.cloudName
      uploadPresetInput.value = config.uploadPreset
      status.textContent = validCloudinarySettings(config) ? 'الإعدادات المحفوظة جاهزة للاستخدام.' : 'أدخل Cloud name وUpload Preset ثم احفظهما لتفعيل الرفع.'
      saveButton.disabled = false
    } catch (error) {
      console.error('Failed to load Cloudinary settings:', error)
      if (!isCurrentPanel()) return
      status.textContent = 'تعذر تحميل الإعدادات من قاعدة البيانات. تحقق من الاتصال والصلاحيات.'
    }
  }
  saveButton.addEventListener('click', async () => {
    if (!user || !isCurrentPanel()) {
      status.textContent = 'يجب تسجيل الدخول قبل حفظ الإعدادات.'
      return
    }
    const config = {
      cloudName: cloudNameInput.value.trim(),
      uploadPreset: uploadPresetInput.value.trim(),
    }
    if (!validCloudinarySettings(config)) {
      status.textContent = 'أدخل Cloud name وUpload Preset صالحين.'
      return
    }
    saveButton.disabled = true
    status.textContent = 'جارٍ حفظ إعدادات الرفع...'
    try {
      await setDoc(userCloudinarySettingsRef(user, ownerId), config, { merge: true })
      if (!isCurrentPanel()) return
      status.textContent = 'تم حفظ إعدادات الرفع لهذا المستخدم.'
    } catch (error) {
      console.error('Failed to save Cloudinary settings:', error)
      if (isCurrentPanel()) status.textContent = 'تعذر حفظ الإعدادات. تحقق من الاتصال وصلاحيات قاعدة البيانات.'
    } finally {
      if (isCurrentPanel()) saveButton.disabled = false
    }
  })
  void load()
}
async function exportProductsToExcel(button: HTMLButtonElement) {
  if (!currentUser) {
    showToast('يجب تسجيل الدخول أولًا.')
    return
  }
  button.disabled = true
  try {
    const snapshot = await getDocsFromServer(query(collection(db, 'users', dataUserId, 'products')))
    const exportProducts = snapshot.docs
      .map((item) => parseProduct(item.id, item.data()))
      .filter((product): product is Product => product !== null)
      .sort(arabicSort)
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('المنتجات', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    })
    worksheet.columns = [
      { header: 'اسم المنتج', key: 'name', width: 36 },
      { header: 'السعر بالدولار (جملة)', key: 'price', width: 24 },
    ]
    worksheet.addRows(exportProducts.map((product) => ({
      name: product.name,
      price: Number.isFinite(product.price) ? product.price : null,
    })))
    worksheet.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 26 : 22
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        cell.font = { name: 'Arial', size: rowNumber === 1 ? 12 : 11, bold: rowNumber === 1, color: { argb: rowNumber === 1 ? 'FFFFFFFF' : 'FF203044' } }
        if (rowNumber === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007D79' } }
      })
    })
    worksheet.getColumn('price').numFmt = '$#,##0.00'
    worksheet.autoFilter = { from: 'A1', to: 'B1' }
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `بيانات-المنتجات-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('تم تنزيل بيانات المنتجات بنجاح.')
  } catch (error) {
    console.error('Failed to export products:', error)
    showToast('تعذر تصدير بيانات المنتجات. حاول مجددًا.')
  } finally {
    button.disabled = false
  }
}
function renderCategoriesTab(content: HTMLElement) {
  content.innerHTML = `<h2>الفئات</h2><form id="category-form" class="inline-form"><input name="name" maxlength="50" required placeholder="اسم الفئة"><button class="primary-button" type="submit">إنشاء فئة</button></form><p class="modal-error" id="category-error"></p><div class="category-list">${categories.length ? categories.map((category) => `<div class="category-row" data-manage="${category.id}"><button class="category-name" data-manage="${category.id}">${escapeHtml(category.name)} <span>${categoryProductCount(category.id)} ${categoryProductCount(category.id) === 1 ? 'منتج' : 'منتج'}</span></button><button class="secondary-button" data-bulk="${category.id}">إضافة منتجات</button></div>`).join('') : '<p class="empty-copy">لا توجد فئات بعد.</p>'}</div>`;
  content.querySelector<HTMLFormElement>('#category-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const name = String(new FormData(event.currentTarget as HTMLFormElement).get('name')).trim();
    const error = content.querySelector('#category-error')!;
    if (!name) {
      error.textContent = 'أدخل اسم الفئة.';
      return;
    }
    const normalizedName = normalizeName(name);
    if (categories.some((category) => normalizeName(category.name) === normalizedName)) {
      error.textContent = 'هذه الفئة موجودة بالفعل.';
      showToast('هذه الفئة موجودة بالفعل.');
      return;
    }
    const button = content.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    try {
      const duplicate = await getDocs(query(collection(db, 'users', dataUserId, 'categories'), where('name', '==', name)));
      if (!duplicate.empty) {
        error.textContent = 'هذه الفئة موجودة بالفعل.';
        showToast('هذه الفئة موجودة بالفعل.');
        button.disabled = false;
        return;
      }
      await addDoc(collection(db, 'users', dataUserId, 'categories'), { name });
      renderCategoriesTab(content);
    } catch (categoryError) {
      button.disabled = false;
      error.textContent = friendlyError(categoryError);
    }
  });
  content.querySelectorAll<HTMLButtonElement>('[data-manage]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    renderCategoryManagement(button.dataset.manage!);
  }));
  content.querySelectorAll<HTMLButtonElement>('[data-bulk]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    renderBulkModal(button.dataset.bulk!);
  }));
}
function categoryProductCount(categoryId: string) { return products.filter((product) => product.categoryId === categoryId).length }
function renderCategoryManagement(id: string) { const category = categories.find((item) => item.id === id); if (!category || !currentUser) return; const element = modal(`<button class="modal-close" aria-label="إغلاق">${svg('close')}</button><p class="eyebrow">إدارة الفئة</p><h2>${escapeHtml(category.name)}</h2><form id="rename-category"><label>اسم الفئة<input name="name" maxlength="50" required value="${escapeHtml(category.name)}"></label><p class="modal-error" id="modal-error"></p><button class="primary-button" type="submit">حفظ الاسم</button></form><button class="danger-button category-delete" id="delete-category">حذف الفئة</button>`); element.querySelector('.modal-close')!.addEventListener('click', () => element.remove()); element.querySelector<HTMLFormElement>('#rename-category')!.addEventListener('submit', async (event) => { event.preventDefault(); const name = String(new FormData(event.currentTarget as HTMLFormElement).get('name')).trim(); const error = element.querySelector('#modal-error')!; if (!name) { error.textContent = 'أدخل اسم الفئة.'; return } const normalizedName = name.toLocaleLowerCase('ar'); if (categories.some((item) => item.id !== id && item.name.toLocaleLowerCase('ar') === normalizedName)) { error.textContent = 'هذه الفئة موجودة بالفعل.'; return } const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!; button.disabled = true; try { const duplicate = await getDocs(query(collection(db, 'users', dataUserId, 'categories'), where('name', '==', name))); if (duplicate.docs.some((item) => item.id !== id)) { error.textContent = 'هذه الفئة موجودة بالفعل.'; button.disabled = false; return } await updateDoc(doc(db, 'users', dataUserId, 'categories', id), { name }); const localCategory = categories.find((item) => item.id === id); if (localCategory) localCategory.name = name; categories.sort((a, b) => a.name.localeCompare(b.name, 'ar')); document.querySelectorAll<HTMLButtonElement>(`.category-name[data-manage="${id}"]`).forEach((nameButton) => { nameButton.innerHTML = `${escapeHtml(name)} <span>${categoryProductCount(id)} منتج</span>` }); updateCategoryBar(); updateProductList(); element.remove() } catch (renameError) { button.disabled = false; error.textContent = friendlyError(renameError) } }); element.querySelector('#delete-category')!.addEventListener('click', () => renderCategoryDeleteConfirmation(id, element)) }
function renderCategoryDeleteConfirmation(id: string, parent: HTMLElement) { const category = categories.find((item) => item.id === id); if (!category || !currentUser) return; const element = modal(`<p class="eyebrow">تأكيد الحذف</p><h2>حذف فئة ${escapeHtml(category.name)}؟</h2><p class="modal-copy">ستصبح المنتجات التابعة لها بدون فئة، ولن يتم حذف المنتجات.</p><p class="modal-error" id="modal-error"></p><div class="modal-actions"><button class="secondary-button" id="cancel-category-delete">إلغاء</button><button class="danger-button" id="confirm-category-delete">حذف الفئة</button></div>`); element.querySelector('#cancel-category-delete')!.addEventListener('click', () => element.remove()); element.querySelector('#confirm-category-delete')!.addEventListener('click', async () => { const button = element.querySelector<HTMLButtonElement>('#confirm-category-delete')!; button.disabled = true; try { const affected = products.filter((product) => product.categoryId === id); if (!affected.length) await deleteDoc(doc(db, 'users', dataUserId, 'categories', id)); for (let index = 0; index < affected.length; index += 499) { const batch = writeBatch(db); affected.slice(index, index + 499).forEach((product) => batch.update(doc(db, 'users', dataUserId, 'products', product.id), { categoryId: null })); if (index + 499 >= affected.length) batch.delete(doc(db, 'users', dataUserId, 'categories', id)); await batch.commit() } categories = categories.filter((item) => item.id !== id); if (selectedCategoryId === id) selectedCategoryId = 'all'; document.querySelector<HTMLElement>(`.category-row[data-manage="${id}"]`)?.remove(); element.remove(); parent.remove(); updateCategoryBar(); updateProductList() } catch (deleteError) { button.disabled = false; element.querySelector('#modal-error')!.textContent = friendlyError(deleteError) } }) }
function renderBulkModal(categoryId: string) { if (!currentUser) return; const available = () => products.filter((product) => !product.categoryId); const element = modal(`<button class="modal-close" aria-label="إغلاق">${svg('close')}</button><p class="eyebrow">إضافة منتجات</p><h2>${escapeHtml(categories.find((category) => category.id === categoryId)?.name || '')}</h2><input id="bulk-search" type="search" placeholder="ابحث عن منتج..."><div id="bulk-list" class="bulk-list"></div><p class="modal-error" id="modal-error"></p><button class="primary-button" id="save-bulk">إضافة المحدد</button>`); const list = element.querySelector<HTMLElement>('#bulk-list')!; const renderList = () => { const term = element.querySelector<HTMLInputElement>('#bulk-search')!.value.trim().toLocaleLowerCase('ar'); list.innerHTML = available().filter((product) => product.name.toLocaleLowerCase('ar').includes(term)).map((product) => `<label class="bulk-item"><input type="checkbox" value="${product.id}"><span>${escapeHtml(product.name)}</span></label>`).join('') || '<p class="empty-copy">لا توجد منتجات غير مصنفة.</p>' }; element.querySelector('.modal-close')!.addEventListener('click', () => element.remove()); element.querySelector('#bulk-search')!.addEventListener('input', renderList); element.querySelector('#save-bulk')!.addEventListener('click', async () => { const ids = [...element.querySelectorAll<HTMLInputElement>('#bulk-list input:checked')].map((input) => input.value); if (!ids.length) { element.querySelector('#modal-error')!.textContent = 'اختر منتجًا واحدًا على الأقل.'; return } const batch = writeBatch(db); ids.filter((id) => available().some((product) => product.id === id)).forEach((id) => batch.update(doc(db, 'users', dataUserId, 'products', id), { categoryId })); const button = element.querySelector<HTMLButtonElement>('#save-bulk')!; button.disabled = true; try { await batch.commit(); element.remove() } catch (bulkError) { button.disabled = false; element.querySelector('#modal-error')!.textContent = friendlyError(bulkError) } }); renderList() }

function isAuthSessionCurrent(user: User, ownerId: string, sessionId: number) {
  return currentUser?.uid === user.uid && dataUserId === ownerId && authSessionId === sessionId
}
async function loadSettings(user: User, ownerId: string, sessionId: number) {
  if (isAuthSessionCurrent(user, ownerId, sessionId)) settings = loadCachedSettings(ownerId)
  try {
    const snapshot = await getDoc(doc(db, 'users', ownerId))
    const loadedSettings = snapshot.exists() ? safeSettings(snapshot.data()) : defaultSettings
    saveCachedSettings(ownerId, loadedSettings)
    if (isAuthSessionCurrent(user, ownerId, sessionId)) settings = loadedSettings
  } catch {
    /* Keep the per-user cache without blocking the products view. */
  }
}
async function startAuth() {
  applyStoredTheme()
  renderInstallButton()
  renderBootstrap()
  try {
    await setPersistence(auth, browserLocalPersistence)
  } catch {
    /* Firebase will still report the current auth state. */
  }
  onAuthStateChanged(auth, async (user) => {
    const nextDataUserId = user ? resolveDataUserId(user) : ''
    if (currentUser?.uid !== user?.uid || dataUserId !== nextDataUserId) {
      authSessionId += 1
      closeSessionInterfaces()
    }
    currentUser = user
    dataUserId = nextDataUserId
    const sessionId = authSessionId
    unsubscribeProducts()
    unsubscribeCategories()
    unsubscribeProducts = () => undefined
    unsubscribeCategories = () => undefined
    products = []
    categories = []
    selectedCategoryId = 'all'
    favoritesFilterActive = false
    if (!user) {
      settings = defaultSettings
      applyTheme(false)
      renderAuth()
      return
    }

    await loadSettings(user, nextDataUserId, sessionId)
    if (!isAuthSessionCurrent(user, nextDataUserId, sessionId)) return

    renderProductsShell()
    const productsQuery = query(collection(db, 'users', nextDataUserId, 'products'))
    unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
      products = snapshot.docs.map((item) => parseProduct(item.id, item.data())).filter((item): item is Product => item !== null).sort(arabicSort)
      updateProductList()
    }, (error) => renderProductsError(error))
    const categoriesQuery = query(collection(db, 'users', nextDataUserId, 'categories'))
    unsubscribeCategories = onSnapshot(categoriesQuery, (snapshot) => {
      categories = snapshot.docs.map((item) => parseCategory(item.id, item.data())).filter((item): item is Category => item !== null).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      updateCategoryBar()
      updateProductList()
    })
  })
}
async function installPwa() { if (!deferredInstall || isStandalone()) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; updateInstallButton() }
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event as BeforeInstallPromptEvent; updateInstallButton() })
window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallButton() })
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistration(new URL(import.meta.env.BASE_URL, window.location.href).href)
      .then((registration) => registration?.unregister())
      .catch((error) => console.error('Failed to disable the service worker during development:', error))
    return
  }
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch((error) => console.error('Failed to register the service worker:', error))
})
startAuth()
