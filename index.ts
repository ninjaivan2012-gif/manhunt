import { registerRootComponent } from 'expo';

// The background location task must be registered before the app renders.
import './src/location/tracker';
import App from './App';

registerRootComponent(App);
