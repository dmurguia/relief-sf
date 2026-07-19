import { Platform } from 'react-native';

const MapCanvas = Platform.select({
  web: require('./MapCanvas.web').default,
  default: require('./MapCanvas.native').default,
});

export default MapCanvas;
