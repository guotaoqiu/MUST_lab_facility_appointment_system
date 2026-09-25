// Segmented 繁 | EN switch. Controlled: the page passes `lang` and handles `change`.
Component({
  properties: {
    lang: { type: String, value: 'zh' }
  },
  methods: {
    onTap(e) {
      const lang = e.currentTarget.dataset.lang
      if (lang !== this.data.lang) this.triggerEvent('change', { lang })
    }
  }
})
