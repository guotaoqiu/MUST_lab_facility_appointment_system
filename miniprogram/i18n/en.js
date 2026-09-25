// English
module.exports = {
  // Home
  labName: 'Sustainable Building Materials Laboratory',
  labNameAlt: '可持續發展建材實驗室',
  enterBooking: 'Lab Instrument Booking',
  enterBookingSub: 'Check availability and book a time slot',

  // Navigation bar titles
  navBooking: 'Instrument Booking',
  navConfirm: 'Confirm Booking',

  // Booking system
  selectInstrument: 'Select Instrument',
  instrumentCount: '{n} instruments',
  searchPlaceholder: 'Search by name or model',
  noMatch: 'No matching instruments',
  chooseHint: 'Choose an instrument from the side menu',
  thisWeek: 'This Week',
  nextWeek: 'Next Week',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  legendBooked: 'Booked',
  legendMine: 'My booking',
  legendSelected: 'Selected',
  tapHint: 'Tap an empty slot, then drag the dots to adjust',
  book: 'Book',
  clear: 'Clear',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  demoMode: 'Demo mode: data is stored on this device only',

  // Booking details
  bookingDetail: 'Booking Details',
  instrument: 'Instrument',
  date: 'Date',
  time: 'Time',
  duration: 'Duration',
  bookedBy: 'Booked by',
  purpose: 'Purpose',
  mineTag: 'Mine',
  cancelBooking: 'Cancel Booking',
  cancelConfirm: 'Cancel this booking?',
  confirmCancel: 'Cancel', // wx.showModal allows at most 4 CJK / 8 Latin characters
  keepBooking: 'Keep',
  cancelled: 'Cancelled',
  close: 'Close',

  // Confirm booking
  name: 'Name',
  namePlaceholder: 'Your full name',
  purposePlaceholder: 'What will you use it for? e.g. thermal conductivity test of cement specimens',
  submit: 'Confirm Booking',
  submitting: 'Submitting…',
  success: 'Booked',

  // Durations
  minutesUnit: '{n} min',
  hoursUnit: '{n} h',

  // Notices
  noticeTitle: 'Notice',
  gotIt: 'OK',
  errors: {
    NAME_REQUIRED: 'Please enter your name.',
    NAME_TOO_LONG: 'Name must be at most {n} characters.',
    PURPOSE_REQUIRED: 'Please describe the purpose.',
    PURPOSE_TOO_LONG: 'Purpose must be at most {n} characters.',
    CONFLICT: 'Someone has just booked this time. Please choose another slot.',
    IN_PAST: 'You cannot book a time that has already passed.',
    OUT_OF_RANGE: 'Only this week and next week can be booked.',
    INVALID_TIME: 'Invalid time. Please choose again.',
    INVALID_DATE: 'Invalid date. Please choose again.',
    BAD_REQUEST: 'Invalid request. Please try again.',
    BAD_INSTRUMENT: 'Instrument not found.',
    CONTENT_REJECTED: 'The text did not pass the content check. Please edit it and try again.',
    NOT_FOUND: 'This booking no longer exists.',
    FORBIDDEN: 'You can only cancel your own bookings.',
    ALREADY_ENDED: 'A booking that has ended cannot be cancelled.',
    UNAUTHORIZED: 'Could not verify your identity. Please reopen the mini program.',
    NETWORK_ERROR: 'Network error. Please try again later.',
    DEFAULT: 'Something went wrong. Please try again later.'
  }
}
