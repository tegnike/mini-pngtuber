module.exports = {
  appId: 'com.mini-pngtuber.app',
  productName: 'mini PNGTuber',

  directories: {
    output: 'dist',
    buildResources: 'build-resources'
  },

  files: [
    'main.js',
    'preload.js',
    'public/**/*',
    'package.json'
  ],

  extraResources: [
    {
      from: 'public',
      to: 'public',
      filter: ['**/*']
    }
  ],

  mac: {
    category: 'public.app-category.entertainment',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    darkModeSupport: true,
    extendInfo: {
      NSMicrophoneUsageDescription: 'マイク入力でアバターの口を動かすために使用します'
    }
  },

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: true
  },

  linux: {
    target: ['AppImage', 'deb'],
    category: 'AudioVideo'
  },

  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ]
  }
};
