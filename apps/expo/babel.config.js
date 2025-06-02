// apps/expo/babel.config.js
module.exports = (api) => {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
    plugins: [
      [
        require.resolve('babel-plugin-module-resolver'),
        {
          root: ['../..'],
          alias: {
            // define aliases to shorten the import paths
            '#core': '../../packages/core',
            '#config': '../../packages/config',
            '#features': '../../packages/core/features',
            '#ui': '../../packages/ui',
          },
          extensions: ['.js', '.jsx', '.tsx', '.ios.js', '.android.js'],
        },
      ],
      // if you want reanimated support
      'react-native-reanimated/plugin',
    ],
  }
}
