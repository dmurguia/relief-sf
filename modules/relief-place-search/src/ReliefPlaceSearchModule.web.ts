import { registerWebModule, NativeModule } from 'expo';

// ReliefPlaceSearchModule is not available on the web platform.
class ReliefPlaceSearchModule extends NativeModule<{}> {}

export default registerWebModule(ReliefPlaceSearchModule, 'ReliefPlaceSearchModule');
