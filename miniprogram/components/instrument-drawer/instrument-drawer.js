// Side menu listing the instruments, with a search box.
const i18n = require('../../utils/i18n')

Component({
  properties: {
    show: { type: Boolean, value: false },
    // [{ id, name, meta, photo, search }] already in the current language
    instruments: { type: Array, value: [] },
    currentId: { type: String, value: '' },
    t: { type: Object, value: {} }
  },

  data: {
    keyword: '',
    filtered: [],
    countText: ''
  },

  observers: {
    'instruments, keyword, t': function (instruments, keyword, t) {
      const k = keyword.trim().toLowerCase()
      this.setData({
        filtered: k ? instruments.filter((i) => i.search.indexOf(k) !== -1) : instruments,
        countText: t.instrumentCount ? i18n.format(t.instrumentCount, { n: instruments.length }) : ''
      })
    }
  },

  methods: {
    onInput(e) {
      this.setData({ keyword: e.detail.value })
    },

    onClear() {
      this.setData({ keyword: '' })
    },

    onSelect(e) {
      this.triggerEvent('select', { id: e.currentTarget.dataset.id })
    },

    onClose() {
      this.triggerEvent('close')
    },

    noop() {}
  }
})
