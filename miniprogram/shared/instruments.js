/**
 * Bookable instruments of the Sustainable Building Materials Laboratory,
 * taken from the asset list 儀器清單_2026-09-03.
 *
 * `id` is stored with every booking — never change an existing id.
 * After adding or removing an instrument run `npm run sync` and redeploy the
 * `booking` cloud function so it accepts the new id.
 */
module.exports = [
  {
    id: 'thermal-imager',
    name: { zh: '紅外線熱成像儀', en: 'Infrared Thermal Imager' },
    model: '',
    location: 'ITCGF',
    assetNo: '3050101AA01-003209'
  },
  {
    id: 'impedance-analyzer',
    name: { zh: '阻抗分析儀', en: 'Impedance Analyzer' },
    model: '',
    location: 'ITCGF',
    assetNo: '3050101AA01-003208'
  },
  {
    id: 'strain-daq',
    name: { zh: '動態應變測試採集系統', en: 'Dynamic Strain Acquisition System' },
    model: 'Grandinstrument GIN350',
    location: 'ITCGF',
    assetNo: '3050101AA01-003201'
  },
  {
    id: 'potentiostat',
    name: { zh: '雙恆電位儀', en: 'Bipotentiostat' },
    model: 'CS2350M',
    location: 'ITC-81',
    assetNo: '3050101AA01-003195'
  },
  {
    id: 'thermal-conductivity',
    name: { zh: '熱導係數測定儀', en: 'Thermal Conductivity Tester' },
    model: 'DR-FR3030-A',
    location: 'ITCGF',
    assetNo: '3050101AA01-002748'
  },
  {
    id: 'fume-hood-1',
    name: { zh: '通風櫃 1', en: 'Fume Hood 1' },
    model: '',
    location: 'ITCGF',
    assetNo: '3050101AA01-002771'
  },
  {
    id: 'fume-hood-2',
    name: { zh: '通風櫃 2', en: 'Fume Hood 2' },
    model: '',
    location: 'ITCGF',
    assetNo: '3050101AA01-002770'
  },
  {
    id: 'jaw-crusher',
    name: { zh: '顎式破碎機', en: 'Jaw Crusher' },
    model: 'PE100×60',
    location: 'ITCGF',
    assetNo: '3050101AA01-003165'
  },
  {
    id: 'sieve-shaker',
    name: { zh: '標準振篩機', en: 'Standard Sieve Shaker' },
    model: 'ZBSX-92A',
    location: 'ITCGF',
    assetNo: '3050101AA01-003164'
  },
  {
    id: 'ball-mill',
    name: { zh: '立式行星球磨機', en: 'Vertical Planetary Ball Mill' },
    model: 'XQM-4',
    location: 'ITCGF',
    assetNo: '3050101AA01-003163'
  },
  {
    id: 'carbonation-reactor',
    name: { zh: '水泥基材料高溫碳化反應試驗設備', en: 'High-Temperature Carbonation Reactor' },
    model: 'HYT-CRH-1.0',
    location: 'ITCGF',
    assetNo: '3050101AA01-003162'
  },
  {
    id: 'flow-table',
    name: { zh: '水泥膠砂流動度測試儀', en: 'Mortar Flow Table' },
    model: 'NLD-3',
    location: 'ITCGF',
    assetNo: '3050101AA01-002984'
  },
  {
    id: 'air-pump',
    name: { zh: '混凝土脫模氣泵', en: 'Concrete Demoulding Air Pump' },
    model: '',
    location: 'ITCGF',
    assetNo: '3050101AA01-002983'
  },
  {
    id: 'magnetic-stirrer-1',
    name: { zh: '集熱式磁力攪拌器 1', en: 'Magnetic Stirrer with Heating Bath 1' },
    model: 'DF-101S',
    location: 'ITCGF',
    assetNo: '3050101AA01-002982'
  },
  {
    id: 'magnetic-stirrer-2',
    name: { zh: '集熱式磁力攪拌器 2', en: 'Magnetic Stirrer with Heating Bath 2' },
    model: 'DF-101S',
    location: 'ITCGF',
    assetNo: '3050101AA01-002981'
  },
  {
    id: 'high-shear-mixer',
    name: { zh: '微管射流高剪切混合器', en: 'Micro-Jet High-Shear Mixer' },
    model: 'FA25D-052-S',
    location: 'ITCGF',
    assetNo: '3050101AA01-002980'
  },
  {
    id: 'ultrapure-water',
    name: { zh: '超純水機', en: 'Ultrapure Water System' },
    model: 'SNWTP-15',
    location: 'ITCGF',
    assetNo: '3050101AA01-002979'
  },
  {
    id: 'ultrasonic-disperser',
    name: { zh: '超聲波分散儀', en: 'Ultrasonic Disperser' },
    model: 'SCIENTZ-1500F',
    location: 'ITCGF',
    assetNo: '3050101AA01-002978'
  },
  {
    id: 'ultrasonic-cleaner-1',
    name: { zh: '超聲波清洗機 1', en: 'Ultrasonic Cleaner 1' },
    model: 'SN-080S',
    location: 'ITCGF',
    assetNo: '3050101AA01-002977'
  },
  {
    id: 'ultrasonic-cleaner-2',
    name: { zh: '超聲波清洗機 2', en: 'Ultrasonic Cleaner 2' },
    model: 'SN-080S',
    location: 'ITCGF',
    assetNo: '3050101AA01-002976'
  },
  {
    id: 'centrifuge',
    name: { zh: '離心機', en: 'Centrifuge' },
    model: 'TG16-WS',
    location: 'ITCGF',
    assetNo: '3050101AA01-002975'
  },
  {
    id: 'vibrating-table',
    name: { zh: '混凝土振動臺', en: 'Concrete Vibrating Table' },
    model: 'HZJ-1',
    location: 'ITCGF',
    assetNo: '3050101AA01-002974'
  },
  {
    id: '3d-printer',
    name: { zh: '3D 印表機', en: '3D Printer' },
    model: 'Raise3D E2',
    location: 'ITCGF',
    assetNo: '3050101AA01-003185'
  }
].map((item) => Object.assign({ photo: '/images/instruments/' + item.id + '.jpg' }, item))
