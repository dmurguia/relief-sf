import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Text, View } from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';

import { sfDefaultRegion } from '../data/restrooms';
import type { MapCanvasHandle, MapCanvasProps } from './MapCanvas.types';

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(({ restrooms, onSelect }, ref) => {
  const mapRef = useRef<MapView>(null);
  useImperativeHandle(ref, () => ({ animateToRegion: (region) => mapRef.current?.animateToRegion(region, 380) }), []);

  return <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={sfDefaultRegion} showsUserLocation showsMyLocationButton={false}>
    {restrooms.map((restroom) => <Marker key={restroom.id} coordinate={restroom} pinColor={restroom.color} onPress={() => onSelect(restroom)}>
      <Callout onPress={() => onSelect(restroom)}><View style={{ width: 170, padding: 6 }}><Text style={{ fontWeight: '800', marginBottom: 2 }}>{restroom.name}</Text><Text>Tap for details</Text></View></Callout>
    </Marker>)}
  </MapView>;
});

export default MapCanvas;
