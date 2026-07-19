import type { Restroom } from '../data/restrooms';

export type MapCanvasHandle = {
  animateToRegion: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
};

export type MapCanvasProps = {
  restrooms: Restroom[];
  onSelect: (restroom: Restroom) => void;
};
