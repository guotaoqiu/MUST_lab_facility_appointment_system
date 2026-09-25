// Shared helpers for tests that render pages and components with miniprogram-simulate.
const path = require('path')
const simulate = require('miniprogram-simulate')

const ROOT = path.join(__dirname, '..', '..', 'miniprogram')
// Friday 25 Sep 2026, 10:40 in Macau.
const NOW = new Date('2026-09-25T02:40:00Z')

/** Freeze Date only; real timers keep j-component's async events working. */
function useFixedNow(now = NOW) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout'
    ]
  })
}

/** Replace the wx APIs the app uses with recording fakes. */
function installWx({ language = 'zh_HK' } = {}) {
  const storage = new Map()
  const state = {
    storage,
    modalAnswer: true,
    titles: [],
    toasts: [],
    modals: [],
    navigateTo: [],
    navigateBack: 0,
    reLaunch: [],
    redirectTo: [],
    actionSheetIndex: 0,
    modalContent: undefined, // what the user types into an editable modal
    opened: [],
    files: new Map()
  }
  Object.assign(wx, {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getStorageSync: (key) => (storage.has(key) ? JSON.parse(storage.get(key)) : ''),
    setStorageSync: (key, value) => storage.set(key, JSON.stringify(value)),
    removeStorageSync: (key) => storage.delete(key),
    getAppBaseInfo: () => ({ language }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
    setNavigationBarTitle: (o) => state.titles.push(o.title),
    showNavigationBarLoading() {},
    hideNavigationBarLoading() {},
    stopPullDownRefresh() {},
    showLoading() {},
    hideLoading() {},
    vibrateShort() {},
    showToast: (o) => state.toasts.push(o),
    showModal: (o) => {
      state.modals.push(o)
      if (o.success) o.success({ confirm: state.modalAnswer, cancel: !state.modalAnswer, content: state.modalContent })
    },
    showActionSheet: (o) => {
      state.actionSheets = (state.actionSheets || []).concat([o.itemList])
      if (o.success) o.success({ tapIndex: state.actionSheetIndex })
    },
    navigateTo: (o) => state.navigateTo.push(o.url),
    navigateBack: () => {
      state.navigateBack++
    },
    reLaunch: (o) => state.reLaunch.push(o.url),
    redirectTo: (o) => state.redirectTo.push(o.url),
    getFileSystemManager: () => ({
      writeFile: (o) => {
        state.files.set(o.filePath, o.data)
        o.success && o.success({})
      },
      copyFile: (o) => {
        state.files.set(o.destPath, state.files.get(o.srcPath))
        o.success && o.success({})
      }
    }),
    openDocument: (o) => {
      state.opened.push(o)
      o.success && o.success({})
    },
    openPrivacyContract: () => {},
    onNeedPrivacyAuthorization: (fn) => {
      state.privacyListener = fn
    }
  })
  return state
}

// A component's JS runs once per test file (require cache), so load each path once.
const loaded = {}
function load(relPath) {
  if (!loaded[relPath]) loaded[relPath] = simulate.load(path.join(ROOT, relPath), { rootPath: ROOT })
  return loaded[relPath]
}

function render(relPath, props) {
  const comp = simulate.render(load(relPath), props)
  comp.attach(document.createElement('parent-wrapper'))
  return comp
}

/** Let j-component deliver queued events and pending promises settle. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function text(comp) {
  return comp.dom.textContent.replace(/\s+/g, ' ')
}

module.exports = { ROOT, NOW, useFixedNow, installWx, load, render, flush, text }
