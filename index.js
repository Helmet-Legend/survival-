/**
 * @format
 */

// Doit rester le premier import : fournit crypto.getRandomValues (CSPRNG natif).
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
