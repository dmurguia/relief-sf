import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';

import { sfDefaultRegion } from '../data/restrooms';
import type { MapCanvasHandle, MapCanvasProps } from './MapCanvas.types';

declare global { interface Window { mapboxgl?: any; } }

const loadMapbox = () => new Promise<any>((resolve, reject) => {
  if (window.mapboxgl) return resolve(window.mapboxgl);
  if (!document.getElementById('mapbox-gl-css')) {
    const css = document.createElement('link');
    css.id = 'mapbox-gl-css'; css.rel = 'stylesheet'; css.href = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.css';
    document.head.appendChild(css);
  }
  const script = document.createElement('script');
  script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js';
  script.onload = () => resolve(window.mapboxgl); script.onerror = reject;
  document.head.appendChild(script);
});

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(({ restrooms, onSelect }, ref) => {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  useImperativeHandle(ref, () => ({ animateToRegion: (region) => mapRef.current?.easeTo({ center: [region.longitude, region.latitude], zoom: 15, duration: 380 }) }), []);

  useEffect(() => {
    let disposed = false;
    const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
    if (!token || !containerRef.current) return;
    loadMapbox().then((mapboxgl) => {
      if (disposed || !containerRef.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/standard', center: [sfDefaultRegion.longitude, sfDefaultRegion.latitude], zoom: 12 });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
      restrooms.forEach((restroom) => {
        const marker = document.createElement('button');
        marker.type = 'button'; marker.title = restroom.name;
        marker.style.cssText = `width:30px;height:30px;border-radius:50%;border:3px solid #fff;background:${restroom.color};color:#fff;font:800 13px system-ui;box-shadow:0 2px 8px #0004;cursor:pointer;`;
        marker.textContent = restroom.category === 'Public' || restroom.category === 'Park' ? 'P' : restroom.category[0];
        marker.onclick = () => onSelect(restroom);
        new mapboxgl.Marker({ element: marker }).setLngLat([restroom.longitude, restroom.latitude]).addTo(map);
      });
      mapRef.current = map;
    }).catch(() => undefined);
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [onSelect, restrooms]);

  return <View ref={containerRef} style={{ flex: 1, width: '100%', height: '100%', backgroundColor: '#DCE8E0' }} />;
});

export default MapCanvas;
