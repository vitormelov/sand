import type { Particle } from './Particle';

/** Uniform grid: O(1) insert/remove, neighbour queries touch only nearby cells. */
export class SpatialIndex {
  private cells = new Map<number, Particle[]>();
  private _size = 0;

  constructor(public cellSize: number) {}

  get size(): number {
    return this._size;
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 16384 + (cy + 4096);
  }

  insert(p: Particle): void {
    const k = this.key(Math.floor(p.x / this.cellSize), Math.floor(p.y / this.cellSize));
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(p);
    p.cellKey = k;
    this._size++;
  }

  remove(p: Particle): void {
    const list = this.cells.get(p.cellKey);
    if (!list) return;
    const i = list.indexOf(p);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.pop();
      this._size--;
      if (list.length === 0) this.cells.delete(p.cellKey);
    }
    p.cellKey = Number.NaN;
  }

  clear(): void {
    this.cells.clear();
    this._size = 0;
  }

  /** Calls fn for every particle whose cell intersects the square around (x, y). */
  query(x: number, y: number, radius: number, fn: (p: Particle) => void): void {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs);
    const y1 = Math.floor((y + radius) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) fn(list[i]);
      }
    }
  }
}
