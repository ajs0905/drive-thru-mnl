/**
 * The road signs' models (pipeline/signs.ts places them), built here rather than in
 * props.glb: a gray post with the sign plate on top, facing -z like the traffic lights'
 * heads. The faces are painted on one small canvas (a 4 x 4 grid of cells), the plates cut
 * to shape by the paint's alpha (the octagon, the disc), the backs plain gray metal.
 *
 * One model per face: `signstop:0`, `signoneway:0` (arrow to the right as the driver sees
 * it) and `signoneway:1` (to the left), `signspeed:<index into SIGN_SPEEDS>`.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, MeshLambertMaterial, SRGBColorSpace } from 'three';
import { DRESSING, SIGN_PLATES, SIGN_SPEEDS } from '../geometry/dressing';

const CELL = 128;
const GRID = 4;
/** Cells: the faces, the backs (one per plate shape) and a white one the posts sample. */
const CELLS = { stop: 0, stopBack: 1, onewayRight: 2, onewayLeft: 3, rectBack: 4, white: 5, discBack: 6, speed: 7 };
const RED = '#c62828';
const BACK = '#9aa0a5';
const POST = [0.5, 0.52, 0.55];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** How much of a one-way cell's height its plate uses (its plate is that much wider than tall). */
const RECT = SIGN_PLATES.oneway[1] / SIGN_PLATES.oneway[0];

export function signModels(): { material: MeshLambertMaterial; models: Map<string, BufferGeometry> } {
  const texture = new CanvasTexture(paint());
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 });
  const models = new Map<string, BufferGeometry>();
  const [stopW, stopH] = SIGN_PLATES.stop;
  const [oneW, oneH] = SIGN_PLATES.oneway;
  const [speedW, speedH] = SIGN_PLATES.speed;
  models.set('signstop:0', model('signstop', stopW, stopH, CELLS.stop, CELLS.stopBack, 1));
  models.set('signoneway:0', model('signoneway', oneW, oneH, CELLS.onewayRight, CELLS.rectBack, RECT));
  models.set('signoneway:1', model('signoneway', oneW, oneH, CELLS.onewayLeft, CELLS.rectBack, RECT));
  SIGN_SPEEDS.forEach((_, i) => models.set(`signspeed:${i}`, model('signspeed', speedW, speedH, CELLS.speed + i, CELLS.discBack, 1)));
  return { material, models };
}

/** A cell's texture coordinates: u from its left, v from its bottom, using the middle `tall` of its height. */
function cellUv(cell: number, tall: number) {
  const [col, row] = [cell % GRID, Math.floor(cell / GRID)];
  const pad = 1.5 / (CELL * GRID);
  const [u0, u1] = [col / GRID + pad, (col + 1) / GRID - pad];
  const middle = 1 - (row + 0.5) / GRID;
  const half = tall / GRID / 2 - pad;
  return { u0, u1, v0: middle - half, v1: middle + half };
}

function model(kind: 'signstop' | 'signoneway' | 'signspeed', w: number, h: number, face: number, back: number, tall: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const quad = (corners: number[][], n: number[], uvs: number[][], c: number[]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[i]);
      uv.push(...uvs[i]);
      col.push(...c);
      nor.push(...n);
    }
  };
  // The post: a square tube, from the ground to the plate's top, sampling the white cell.
  const post = DRESSING[kind].size[0] / 2;
  const top = SIGN_PLATES.middle + h / 2;
  const white = cellUv(CELLS.white, 1);
  const wu = [(white.u0 + white.u1) / 2, (white.v0 + white.v1) / 2];
  const flat = [wu, wu, wu, wu];
  const r = post;
  const sides: [number[][], number[]][] = [
    [[[r, 0, -r], [-r, 0, -r], [-r, top, -r], [r, top, -r]], [0, 0, -1]],
    [[[-r, 0, r], [r, 0, r], [r, top, r], [-r, top, r]], [0, 0, 1]],
    [[[r, 0, r], [r, 0, -r], [r, top, -r], [r, top, r]], [1, 0, 0]],
    [[[-r, 0, -r], [-r, 0, r], [-r, top, r], [-r, top, -r]], [-1, 0, 0]],
    [[[-r, top, -r], [-r, top, r], [r, top, r], [r, top, -r]], [0, 1, 0]],
  ];
  for (const [c, n] of sides) quad(c, n, flat, POST);
  // The plate in front of the post: its face toward -z (the driver's right is -x), its back toward +z.
  const z = -(post + SIGN_PLATES.front);
  const [x, y0, y1] = [w / 2, SIGN_PLATES.middle - h / 2, SIGN_PLATES.middle + h / 2];
  const f = cellUv(face, tall);
  quad([[x, y0, z - 0.005], [-x, y0, z - 0.005], [-x, y1, z - 0.005], [x, y1, z - 0.005]], [0, 0, -1], [[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]], [1, 1, 1]);
  const b = cellUv(back, tall);
  quad([[-x, y0, z + 0.005], [x, y0, z + 0.005], [x, y1, z + 0.005], [-x, y1, z + 0.005]], [0, 0, 1], [[b.u0, b.v0], [b.u1, b.v0], [b.u1, b.v1], [b.u0, b.v1]], [1, 1, 1]);
  // A bracket from the post to the plate.
  const k = 0.03;
  const bracket = (y: number) =>
    quad([[-k, y, -post], [k, y, -post], [k, y, z], [-k, y, z]], [0, 1, 0], flat, POST);
  bracket(SIGN_PLATES.middle + h / 4);
  bracket(SIGN_PLATES.middle - h / 4);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/** The faces and backs, one per cell. */
function paint(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * GRID;
  const g = canvas.getContext('2d')!;
  const at = (cell: number) => [(cell % GRID) * CELL, Math.floor(cell / GRID) * CELL] as const;
  const c = CELL / 2;
  const octagon = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(x + c + Math.cos(a) * r, y + c + Math.sin(a) * r);
    }
    g.closePath();
  };
  const disc = (x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x + c, y + c, r, 0, Math.PI * 2);
  };
  const r = c - 3;
  // Stop: a red octagon with a white rim and the word.
  {
    const [x, y] = at(CELLS.stop);
    octagon(x, y, r);
    g.fillStyle = '#ffffff';
    g.fill();
    octagon(x, y, r - 6);
    g.fillStyle = RED;
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `bold 36px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', x + c, y + c + 2, CELL - 30);
  }
  {
    const [x, y] = at(CELLS.stopBack);
    octagon(x, y, r);
    g.fillStyle = BACK;
    g.fill();
  }
  // One way: a black panel, a white arrow, the words on it.
  const tall = CELL * RECT;
  for (const [cell, right] of [[CELLS.onewayRight, true], [CELLS.onewayLeft, false]] as const) {
    const [x, y] = at(cell);
    const top = y + (CELL - tall) / 2;
    g.fillStyle = '#ffffff';
    g.fillRect(x + 2, top + 1, CELL - 4, tall - 2);
    g.fillStyle = '#151515';
    g.fillRect(x + 4, top + 3, CELL - 8, tall - 6);
    // The arrow, pointing right; mirrored for the left one.
    g.save();
    if (!right) {
      g.translate(x * 2 + CELL, 0);
      g.scale(-1, 1);
    }
    const [l, rr, mid, head] = [x + 9, x + CELL - 8, top + tall / 2, 14];
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(l, mid - 7);
    g.lineTo(rr - head, mid - 7);
    g.lineTo(rr - head, mid - 13);
    g.lineTo(rr, mid);
    g.lineTo(rr - head, mid + 13);
    g.lineTo(rr - head, mid + 7);
    g.lineTo(l, mid + 7);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#151515';
    g.font = `bold 11px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ONE WAY', x + c + (right ? -5 : 5), top + tall / 2 + 1, CELL - 44);
  }
  {
    const [x, y] = at(CELLS.rectBack);
    g.fillStyle = BACK;
    g.fillRect(x + 2, y + (CELL - tall) / 2 + 1, CELL - 4, tall - 2);
  }
  {
    const [x, y] = at(CELLS.white);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, CELL, CELL);
  }
  {
    const [x, y] = at(CELLS.discBack);
    disc(x, y, r);
    g.fillStyle = BACK;
    g.fill();
  }
  // Speed limits: a white disc in a red ring, the number in black.
  SIGN_SPEEDS.forEach((kmh, i) => {
    const [x, y] = at(CELLS.speed + i);
    disc(x, y, r);
    g.fillStyle = RED;
    g.fill();
    disc(x, y, r - 12);
    g.fillStyle = '#ffffff';
    g.fill();
    g.fillStyle = '#111111';
    g.font = `bold 50px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(kmh), x + c, y + c + 3, CELL - 44);
  });
  return canvas;
}
