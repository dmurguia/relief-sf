import { NativeModule, requireNativeModule } from 'expo';

declare class ReliefPlaceSearchModule extends NativeModule<{}> {
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<ReliefPlaceSearchModule>('ReliefPlaceSearch');
