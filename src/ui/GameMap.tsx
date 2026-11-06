import { Camera, GeoJSONSource, Layer, Map, Marker, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ring } from '../game/geo';
import type { LatLng, NoGoZone } from '../game/types';
import { C, F, MAP_STYLE } from './theme';

export type MapMarker = {
  id: string;
  pos: LatLng;
  label: string;
  sub?: string;
  kind: 'ping' | 'teammate' | 'point';
};

export type GameMapHandle = { centerOn: (p: LatLng, zoom?: number) => void };

type Props = {
  initialCenter: LatLng;
  border?: LatLng[];
  nextBorder?: LatLng[];
  noGo?: NoGoZone[];
  draft?: LatLng[]; // shape being drawn in the editor
  markers?: MapMarker[];
  onPress?: (p: LatLng) => void;
};

const polygonFC = (polys: LatLng[][]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: polys
    .filter((p) => p.length >= 3)
    .map((p, i) => ({ type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [ring(p)] } })),
});

/** Everything outside the border gets shaded: a world-sized polygon with the border cut out of it. */
const outsideFC = (border: LatLng[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: border.length >= 3
    ? [{
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ring(border).reverse()] },
      }]
    : [],
});

export const GameMap = forwardRef<GameMapHandle, Props>(function GameMap(props, ref) {
  const camera = useRef<CameraRef>(null);
  useImperativeHandle(ref, () => ({
    centerOn: (p, zoom) => camera.current?.easeTo({ center: [p.lng, p.lat], zoom: zoom ?? 16, duration: 600 }),
  }));

  const border = props.border ?? [];
  const borderFC = useMemo(() => polygonFC([border]), [border]);
  const shadeFC = useMemo(() => outsideFC(border), [border]);
  const nextFC = useMemo(() => polygonFC([props.nextBorder ?? []]), [props.nextBorder]);
  const noGoFC = useMemo(() => polygonFC((props.noGo ?? []).map((z) => z.points)), [props.noGo]);
  const draft = props.draft ?? [];
  const draftFC = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: draft.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft.length >= 3 ? ring(draft) : draft.map((p) => [p.lng, p.lat]) } }]
      : [],
  }), [draft]);

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE}
      logo={false}
      attribution
      attributionPosition={{ bottom: 8, left: 8 }}
      compass={false}
      touchPitch={false}
      onPress={(e) => {
        const [lng, lat] = e.nativeEvent.lngLat;
        props.onPress?.({ lat, lng });
      }}
    >
      <Camera ref={camera} initialViewState={{ center: [props.initialCenter.lng, props.initialCenter.lat], zoom: 15.5 }} />

      <GeoJSONSource id="shade" data={shadeFC}>
        <Layer type="fill" id="shade-fill" style={{ fillColor: '#000000', fillOpacity: 0.55 }} />
      </GeoJSONSource>
      <GeoJSONSource id="nogo" data={noGoFC}>
        <Layer type="fill" id="nogo-fill" style={{ fillColor: C.danger, fillOpacity: 0.22 }} />
        <Layer type="line" id="nogo-line" style={{ lineColor: C.redSoft, lineWidth: 1.5, lineDasharray: [2, 1.5] }} />
      </GeoJSONSource>
      <GeoJSONSource id="next" data={nextFC}>
        <Layer type="line" id="next-line" style={{ lineColor: C.red, lineOpacity: 0.55, lineWidth: 1.5, lineDasharray: [3, 3] }} />
      </GeoJSONSource>
      <GeoJSONSource id="border" data={borderFC}>
        <Layer type="line" id="border-line" style={{ lineColor: C.red, lineWidth: 2.5 }} />
      </GeoJSONSource>
      <GeoJSONSource id="draft" data={draftFC}>
        <Layer type="line" id="draft-line" style={{ lineColor: C.fillText, lineWidth: 2, lineDasharray: [2, 2] }} />
      </GeoJSONSource>

      {draft.map((p, i) => (
        <Marker key={`d${i}`} id={`d${i}`} lngLat={[p.lng, p.lat]}>
          <View style={st.draftDot} />
        </Marker>
      ))}

      {(props.markers ?? []).map((m) => (
        <Marker key={m.id} id={m.id} lngLat={[m.pos.lng, m.pos.lat]} anchor="left" offset={[-8, 0]}>
          <View style={st.markerRow}>
            {m.kind === 'ping' ? <View style={st.diamond} /> : <View style={st.mate} />}
            <View>
              <Text style={[st.name, m.kind === 'teammate' && { color: C.redSoft, fontWeight: '400' }]}>{m.label}</Text>
              {m.sub ? <Text style={st.sub}>{m.sub}</Text> : null}
            </View>
          </View>
        </Marker>
      ))}

      <UserLocation accuracy heading animated />
    </Map>
  );
});

const st = StyleSheet.create({
  markerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diamond: { width: 13, height: 13, transform: [{ rotate: '45deg' }], borderWidth: 2, borderColor: C.red, backgroundColor: C.surface2 },
  mate: { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: C.redSoft, backgroundColor: '#000' },
  draftDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.fillText, borderWidth: 2, borderColor: C.danger },
  name: { color: C.red, fontSize: 13, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 3 },
  sub: { color: C.redDim, fontSize: 10, fontFamily: F.mono, textShadowColor: '#000', textShadowRadius: 3 },
});
