module.exports = {
  preset: '@react-native/jest-preset',
  // Les autres fichiers de __tests__ sont des utilitaires partagés.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  // lucide-react-native expose du .mjs à la condition « react-native » :
  // Jest utilise sa version CommonJS, identique.
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
};
