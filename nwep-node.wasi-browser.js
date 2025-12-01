import {
  createOnMessage as __wasmCreateOnMessageForFsProxy,
  getDefaultContext as __emnapiGetDefaultContext,
  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'



const __wasi = new __WASI({
  version: 'preview1',
})

const __wasmUrl = new URL('./nwep-node.wasm32-wasi.wasm', import.meta.url).href
const __emnapiContext = __emnapiGetDefaultContext()


const __sharedMemory = new WebAssembly.Memory({
  initial: 4000,
  maximum: 65536,
  shared: true,
})

const __wasmFile = await fetch(__wasmUrl).then((res) => res.arrayBuffer())

const {
  instance: __napiInstance,
  module: __wasiModule,
  napiModule: __napiModule,
} = __emnapiInstantiateNapiModuleSync(__wasmFile, {
  context: __emnapiContext,
  asyncWorkPoolSize: 4,
  wasi: __wasi,
  onCreateWorker() {
    const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })

    return worker
  },
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
export default __napiModule.exports
export const Config = __napiModule.exports.Config
export const Connection = __napiModule.exports.Connection
export const H3Config = __napiModule.exports.H3Config
export const H3Connection = __napiModule.exports.H3Connection
export const CongestionControlAlgorithm = __napiModule.exports.CongestionControlAlgorithm
export const encodeAlpn = __napiModule.exports.encodeAlpn
export const generateCid = __napiModule.exports.generateCid
export const isVersionNegotiation = __napiModule.exports.isVersionNegotiation
export const MAX_CONN_ID_LEN = __napiModule.exports.MAX_CONN_ID_LEN
export const MIN_CLIENT_INITIAL_LEN = __napiModule.exports.MIN_CLIENT_INITIAL_LEN
export const negotiateVersion = __napiModule.exports.negotiateVersion
export const nwepAlpn = __napiModule.exports.nwepAlpn
export const nwepAndH3Alpn = __napiModule.exports.nwepAndH3Alpn
export const PacketType = __napiModule.exports.PacketType
export const parseHeader = __napiModule.exports.parseHeader
export const PROTOCOL_VERSION = __napiModule.exports.PROTOCOL_VERSION
export const retry = __napiModule.exports.retry
export const StartupExitReason = __napiModule.exports.StartupExitReason
