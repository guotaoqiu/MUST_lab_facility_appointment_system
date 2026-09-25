// One booking in "my bookings" (settings) or in the admin list.
// The page prepares `item` (see utils/records.js).
Component({
  properties: {
    item: { type: Object, value: {} },
    t: { type: Object, value: {} }
  },
  methods: {
    onCancel() {
      this.triggerEvent('cancel', { item: this.data.item })
    }
  }
})
