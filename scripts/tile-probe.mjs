// One-off probe: what's inside the map's vector tiles? (run in CI)
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
const style = await (await fetch('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json')).json();
for (const [k, s] of Object.entries(style.sources)) console.log('SOURCE', k, s.type, JSON.stringify(s.tiles ?? s.url), 'maxzoom', s.maxzoom);
let tiles = Object.values(style.sources).find((s) => s.type === 'vector');
if (!tiles.tiles && tiles.url) { tiles = await (await fetch(tiles.url)).json(); console.log('TILEJSON', JSON.stringify(tiles.tiles), 'maxzoom', tiles.maxzoom); }
const tmpl = tiles.tiles[0];
const z = 14, lat = 28.5434, lng = -81.3730;
const x = Math.floor(((lng + 180) / 360) * 2 ** z);
const y = Math.floor((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * 2 ** z);
const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const t0 = Date.now();
const res = await fetch(url);
const buf = new Uint8Array(await res.arrayBuffer());
console.log('TILE', res.status, res.headers.get('content-type'), res.headers.get('content-encoding'), buf.length, 'bytes', Date.now() - t0, 'ms');
const vt = new VectorTile(new Protobuf(buf));
for (const [name, layer] of Object.entries(vt.layers)) {
  const classes = {};
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const c = `${['?', 'Point', 'Line', 'Polygon'][f.type]}:${f.properties.class ?? ''}:${f.properties.subclass ?? f.properties.type ?? ''}`;
    classes[c] = (classes[c] ?? 0) + 1;
  }
  console.log('LAYER', name, layer.length, 'extent', layer.extent, JSON.stringify(classes).slice(0, 600));
}
