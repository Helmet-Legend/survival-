module.exports = {
  preset: '@react-native/jest-preset',
  // Les autres fichiers de __tests__ sont des utilitaires partagés.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
};
