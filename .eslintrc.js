module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promesse` marque une tâche asynchrone lancée depuis un gestionnaire.
    'no-void': ['warn', { allowAsStatement: true }],
  },
};
