export * from "./types";
export {
  BAUD_RATES,
  COLUMN_OPTIONS,
  CONNECTION_LABELS,
  PRINT_PRESETS,
  columnsAtMost,
  layoutDefaults,
  presetOf,
  type FontSize,
  DEFAULT_AGENT_URL,
  defaultConfig,
  loadConfig,
  saveConfig,
  subscribeConfig,
  updateConfig,
  type BaudRate,
  type ConnectionKind,
  type PrinterConfig,
} from "./config";
export { CODEPAGES, columnsFor, type Codepage, type PaperWidth } from "./escpos";
export {
  CHAR_RULER,
  calibrationEscPos,
  calibrationHtml,
  htmlFontMm,
  renderEscPos,
  renderHtml,
  testPageDoc,
} from "./documents";
export {
  DEFAULT_FOOTER,
  SAMPLE_RESTAURANT,
  comandaCozinha,
  comandaDelivery,
  contaMesa,
  sampleDeliveryTicket,
  sampleKitchenTicket,
  sampleReceipt,
} from "./comandas";
export { renderText, type DocLine, type PrintDoc } from "./layout";
export {
  LOGO_DETAIL_WARNING,
  loadPrintLogo,
  processLogoFile,
  type PrintLogo,
  type ProcessedLogo,
} from "./logo";
export { getPrintRestaurant, setPrintRestaurant } from "./restaurant";
export {
  abrirGaveta,
  createTransport,
  desconectar,
  getPrinterStatus,
  getTransport,
  imprimirComanda,
  imprimirCalibracao,
  imprimirExemplo,
  imprimirNota,
  imprimirTeste,
  initializePrinter,
  subscribePrinterStatus,
  testarConexao,
  transportAvailability,
  type ExampleKind,
  type PrinterStatus,
  type PrintResult,
} from "./printer";
export {
  FRIENDLY_PRINT_ERROR,
  PrinterError,
  isNativeApp,
  type PrinterTransport,
  type TransportStatus,
} from "./transports/base";
export {
  AGENT_NOT_FOUND,
  agentHealth,
  listSerialPorts,
  listWindowsPrinters,
  type WindowsPrinterInfo,
} from "./transports/agent";
export { WebSerialTransport } from "./transports/web-serial";
export { ElectronTransport, isDesktopApp } from "./transports/electron";
export { WebUsbTransport, WEBUSB_WINDOWS_HINT } from "./transports/web-usb";
export { BluetoothWebTransport } from "./transports/bluetooth-web";
export { listPairedBluetooth, type PairedDevice } from "./transports/native";
export { avisarFalhaImpressao, printErrorMessage } from "./notify";
