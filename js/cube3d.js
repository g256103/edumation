/**
 * three.js renderer for the "立方体の切断" part.
 *
 * The cube is stood on a corner so that the plane through the six edge
 * midpoints (x + y + z = 0 in cube coordinates) becomes horizontal.
 * The two halves are the same cube mesh rendered with opposite clipping
 * planes; a hexagon "cap" closes each half so the cross-section is solid.
 *
 * three.js is loaded lazily from a CDN the first time a 3D part is shown.
 */

const THREE_URL = "https://unpkg.com/three@0.160.0/build/three.module.js";

const N_LOCAL = [1, 1, 1]; // plane normal in cube coordinates
// hexagon vertices = edge midpoints on x + y + z = 0, in cyclic order
export const HEX_LOCAL = [
  [1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1],
];

let THREE = null;
let loading = null;
let loadError = null;

const R = {
  canvas: null,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  halves: null,
  planes: null,
  mats: {},
  hexWorld: [],
  lastTheme: "",
  w: 0,
  h: 0,
};

export function status() {
  if (loadError) return { state: "error", message: loadError };
  if (THREE && R.renderer) return { state: "ready" };
  return { state: "loading" };
}

export function ensure(canvas) {
  if (R.renderer || loading) return loading;
  loading = import(THREE_URL)
    .then((mod) => {
      THREE = mod;
      build(canvas);
    })
    .catch((e) => {
      loadError = `three.js を読み込めませんでした（${e.message}）`;
    });
  return loading;
}

function build(canvas) {
  R.canvas = canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  R.renderer = renderer;

  const scene = new THREE.Scene();
  R.scene = scene;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 3.4, 8.2);
  camera.lookAt(0, 0.1, 0);
  R.camera = camera;

  // three distinct face tones: ambient + one strong key from upper-left-front
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(5, -1, -4);
  scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  R.root = root;

  // rotate cube so that the (1,1,1) diagonal points up
  const n = new THREE.Vector3(...N_LOCAL).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
  R.hexWorld = HEX_LOCAL.map((v) => new THREE.Vector3(...v).applyQuaternion(q));

  const up = new THREE.Vector3(0, 1, 0);
  const planeTop = new THREE.Plane(up.clone(), 0);               // keep y >= -c
  const planeBottom = new THREE.Plane(up.clone().negate(), 0);   // keep y <= c
  R.planes = { top: planeTop, bottom: planeBottom };

  const faceMat = (planes) => new THREE.MeshStandardMaterial({
    color: 0xdfe6ee, roughness: 0.6, metalness: 0.0, flatShading: true, side: THREE.DoubleSide, clippingPlanes: planes,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const edgeMat = (planes) => new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.9, clippingPlanes: planes });
  const capMat = () => new THREE.MeshStandardMaterial({ color: 0x2b9d8f, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const dotMat = () => new THREE.MeshStandardMaterial({ color: 0xf0a04b, roughness: 0.4 });
  const hexLineMat = () => new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.9 });
  R.mats = { face: [], edge: [], cap: [], dot: [], hexLine: [] };

  const cubeGeo = new THREE.BoxGeometry(2, 2, 2);
  const dotGeo = new THREE.SphereGeometry(0.1, 20, 16);

  // thick edges as thin cylinders (WebGL lines are always 1px)
  const tube = (a, b, radius) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1);
    const m = new THREE.Mesh(geo);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  const cubeCorners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cubeCorners.push(new THREE.Vector3(x, y, z));
  const cubeEdges = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    if (cubeCorners[i].distanceTo(cubeCorners[j]) < 2.01) cubeEdges.push([cubeCorners[i], cubeCorners[j]]);
  }

  // hexagon cap geometry (fan), in world XZ plane at y = 0
  const capGeo = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < 6; i++) {
    const a = R.hexWorld[i], b = R.hexWorld[(i + 1) % 6];
    pos.push(0, 0, 0, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  capGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  capGeo.computeVertexNormals();
  const makeHalf = (planes) => {
    const g = new THREE.Group();
    const fm = faceMat(planes), em = edgeMat(planes), cm = capMat(), dm = dotMat(), hm = hexLineMat();
    R.mats.face.push(fm); R.mats.edge.push(em); R.mats.cap.push(cm); R.mats.dot.push(dm); R.mats.hexLine.push(hm);

    const cube = new THREE.Mesh(cubeGeo, fm);
    cube.quaternion.copy(q);
    g.add(cube);
    const edges = new THREE.Group();
    for (const [a, b] of cubeEdges) {
      const t = tube(a, b, 0.022);
      t.material = em;
      edges.add(t);
    }
    edges.quaternion.copy(q);
    g.add(edges);
    const cap = new THREE.Mesh(capGeo, cm);
    g.add(cap);
    // the cut line (hexagon) is always shown on the surface
    const hexLine = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const t = tube(R.hexWorld[i], R.hexWorld[(i + 1) % 6], 0.03);
      t.material = hm;
      hexLine.add(t);
    }
    g.add(hexLine);
    for (const v of R.hexWorld) {
      const d = new THREE.Mesh(dotGeo, dm);
      d.position.copy(v);
      g.add(d);
    }
    g.userData.cap = cap;
    g.userData.hexLine = hexLine;
    return g;
  };

  const top = makeHalf([planeTop]);
  const bottom = makeHalf([planeBottom]);
  root.add(top, bottom);
  R.halves = { top, bottom };
}

function hexColor(c) {
  return new THREE.Color(c);
}

/**
 * @param {object} o
 * @param {number} o.cut   0..1 separation
 * @param {number} o.spin  degrees around vertical axis
 * @param {object} o.theme
 * @param {number} o.w css px
 * @param {number} o.h css px
 */
export function render({ cut, spin, theme, w, h }) {
  if (!R.renderer) return;
  if (R.w !== w || R.h !== h) {
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h;
    R.camera.updateProjectionMatrix();
    R.w = w; R.h = h;
  }
  if (R.lastTheme !== theme.name) {
    const dark = theme.name === "ink";
    for (const m of R.mats.face) m.color.set(dark ? 0x4a5568 : 0xdfe6ee);
    for (const m of R.mats.edge) m.color.copy(hexColor(theme.ink));
    for (const m of R.mats.hexLine) m.color.copy(hexColor(theme.ink));
    for (const m of R.mats.cap) m.color.copy(hexColor(theme.a));
    for (const m of R.mats.dot) m.color.copy(hexColor(theme.b));
    R.lastTheme = theme.name;
  }

  const sep = cut * 0.95;
  R.halves.top.position.y = sep;
  R.halves.bottom.position.y = -sep;
  // keep y >= sep  ⇔  (0,1,0)·p - sep >= 0
  R.planes.top.constant = -sep;
  // keep y <= -sep ⇔  (0,-1,0)·p - sep >= 0
  R.planes.bottom.constant = -sep;

  // the top half's cap is hidden under it; the bottom cap is the one we look at
  R.halves.top.userData.cap.visible = cut > 0.02;
  R.halves.bottom.userData.cap.visible = cut > 0.02;

  R.root.rotation.y = (spin * Math.PI) / 180;
  R.renderer.render(R.scene, R.camera);
}

/** Screen-space (css px) positions of the hexagon vertices on the bottom cap, and its centre. */
export function projectHexagon(cut, spin) {
  if (!R.renderer) return null;
  const sep = cut * 0.95;
  const rotY = (spin * Math.PI) / 180;
  const proj = (v) => {
    const p = v.clone();
    p.y -= sep;
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    p.project(R.camera);
    return { x: (p.x + 1) / 2 * R.w, y: (1 - p.y) / 2 * R.h, z: p.z };
  };
  return {
    verts: R.hexWorld.map(proj),
    center: proj(new THREE.Vector3(0, 0, 0)),
    topCenter: (() => {
      const p = new THREE.Vector3(0, sep + 1.732, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).project(R.camera);
      return { x: (p.x + 1) / 2 * R.w, y: (1 - p.y) / 2 * R.h };
    })(),
  };
}
