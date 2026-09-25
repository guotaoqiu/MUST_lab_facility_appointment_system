// 繁體中文
module.exports = {
  // 首頁
  labName: '可持續發展建材實驗室',
  labNameAlt: 'Sustainable Building Materials Laboratory',
  enterBooking: '實驗室儀器預約系統',
  enterBookingSub: '查看儀器使用情況並預約時段',

  // 導航欄標題
  navBooking: '儀器預約',
  navConfirm: '確認預約',

  // 預約系統
  selectInstrument: '選擇儀器',
  instrumentCount: '共 {n} 台儀器',
  searchPlaceholder: '搜尋儀器名稱或型號',
  noMatch: '沒有符合的儀器',
  chooseHint: '請先從側邊欄選擇儀器',
  thisWeek: '本週',
  nextWeek: '下週',
  weekdays: ['日', '一', '二', '三', '四', '五', '六'],
  legendBooked: '已預約',
  legendMine: '我的預約',
  legendSelected: '已選時段',
  tapHint: '點擊空白格子選擇時間，拖動圓點調整時長',
  book: '預約',
  clear: '清除',
  loadFailed: '載入失敗',
  retry: '重試',
  demoMode: '演示模式：資料只保存在本機',

  // 預約詳情
  bookingDetail: '預約詳情',
  instrument: '儀器',
  date: '日期',
  time: '時間',
  duration: '時長',
  bookedBy: '預約人',
  purpose: '用途',
  mineTag: '我的',
  cancelBooking: '取消預約',
  cancelConfirm: '確定要取消這個預約嗎？',
  confirmCancel: '取消預約',
  keepBooking: '保留',
  cancelled: '已取消',
  close: '關閉',

  // 確認預約
  name: '姓名',
  namePlaceholder: '請輸入您的姓名',
  purposePlaceholder: '請說明使用用途，例如：水泥試件導熱係數測試',
  submit: '確定預約',
  submitting: '提交中…',
  success: '預約成功',

  // 時長
  minutesUnit: '{n} 分鐘',
  hoursUnit: '{n} 小時',

  // 提示
  noticeTitle: '提示',
  gotIt: '知道了',
  errors: {
    NAME_REQUIRED: '請填寫姓名',
    NAME_TOO_LONG: '姓名不能超過 {n} 個字',
    PURPOSE_REQUIRED: '請說明用途',
    PURPOSE_TOO_LONG: '用途不能超過 {n} 個字',
    CONFLICT: '該時段剛被其他人預約，請重新選擇',
    IN_PAST: '不能預約已過去的時間',
    OUT_OF_RANGE: '只能預約本週及下週的時段',
    INVALID_TIME: '預約時間無效，請重新選擇',
    INVALID_DATE: '預約日期無效，請重新選擇',
    BAD_REQUEST: '請求無效，請重新操作',
    BAD_INSTRUMENT: '找不到該儀器',
    CONTENT_REJECTED: '內容未通過安全檢查，請修改後再提交',
    NOT_FOUND: '該預約已不存在',
    FORBIDDEN: '只能取消自己的預約',
    ALREADY_ENDED: '已結束的預約不能取消',
    UNAUTHORIZED: '無法確認您的身份，請重新開啟小程序',
    NETWORK_ERROR: '網絡連接失敗，請稍後再試',
    DEFAULT: '操作失敗，請稍後再試'
  }
}
