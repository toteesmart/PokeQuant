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
