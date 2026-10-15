jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('')),
  subscribe: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///mock/document', cache: 'file:///mock/cache' },
  Directory: class Directory {
    constructor() {}
    get exists() { return false; }
    create() {}
    list() { return []; }
    delete() {}
  },
  File: class File {
    constructor() {}
    get exists() { return false; }
    get uri() { return 'file:///mock/file'; }
    delete() {}
    base64() { return Promise.resolve(''); }
    json() { return Promise.resolve(null); }
    static createDownloadTask() { return { downloadAsync: jest.fn() }; }
    static pickFileAsync() { return Promise.resolve([]); }
  },
  downloadFileAsync: jest.fn(),
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => ({
    hasPermission: false,
    requestPermission: jest.fn(() => Promise.resolve(false)),
  })),
  usePhotoOutput: jest.fn(() => undefined),
  CommonResolutions: { HD_4_3: { width: 1440, height: 1080 } },
}));

jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: jest.fn(),
}));

jest.mock('react-native-nitro-image', () => ({
  Images: {
    loadFromFileAsync: jest.fn(),
    loadFromRawPixelDataAsync: jest.fn(),
  },
}));

jest.mock('@dariyd/react-native-text-recognition', () => ({
  recognizeText: jest.fn(),
}));

// @expo/vector-icons imports expo-font → expo-asset, which is not installed
// (peer-resolved only in the native build). Tests never render icons, so
// each named export becomes a stable string stub; glyphMap accesses in src
// are type-only and erased at compile time.
jest.mock('@expo/vector-icons', () =>
  new Proxy(
    {},
    {
      get: (target, prop) => {
        if (prop === '__esModule') return true;
        if (!(prop in target)) target[prop] = `Icon-${String(prop)}`;
        return target[prop];
      },
    }
  )
);

// react-native-purchases resolves to its ESM browser build under jest
// (shouldUseBrowserMode sees the jsdom-ish globals), which fails to parse.
// The suites only need the module to import — entitlements are driven
// through subscriptionStore state, not this surface.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    getCustomerInfo: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  },
  LOG_LEVEL: { VERBOSE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    // Mount-fire stand-in for screen focus: the hooks under test pass a
    // stable useCallback ref, so [callback] fires once on mount — the same
    // load-on-focus moment the screens rely on. Caveat: a hook that
    // rebuilds its focus callback every render re-fires here on each
    // render (the real nav stub fires only on focus); keep callbacks
    // memoized, as all tested hooks do.
    useFocusEffect: function useFocusEffect(callback) {
      React.useEffect(() => callback(), [callback]);
    },
  };
});
