// Bottom sheet with the details of one booking.
Component({
  options: {
    addGlobalClass: true // shared .btn styles from app.wxss
  },

  properties: {
    // { instrumentName, dateText, timeText, name, purpose, mine, canCancel } or null
    booking: { type: Object, value: null },
    t: { type: Object, value: {} }
  },

  data: {
    show: false,
    view: {}
  },

  observers: {
    booking(booking) {
      // Keep the last content while the sheet slides away.
      if (booking) this.setData({ show: true, view: booking })
      else this.setData({ show: false })
    }
  },

  methods: {
    onClose() {
      this.triggerEvent('close')
    },

    onCancel() {
      this.triggerEvent('cancel')
    },

    noop() {}
  }
})
