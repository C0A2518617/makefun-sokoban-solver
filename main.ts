import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const letters = 'udlr';
type Node = { boxes: number[]; player: number; g: number; h: number; parent: number; stand: number; dir: number; order: number };

function solve(level: string): string {
  const lines = level.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const w = Math.max(...lines.map(x => x.length)) + 2, h = lines.length + 2, size = w * h;
  const floor = new Uint8Array(size), goals: number[] = [], boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < lines.length; y++) for (let x = 0; x < lines[y].length; x++) {
    const c = lines[y][x], p = (y + 1) * w + x + 1;
    if (' .$*@+'.includes(c)) floor[p] = 1;
    if (c === '.' || c === '*' || c === '+') goals.push(p);
    if (c === '$' || c === '*') boxes.push(p);
    if (c === '@' || c === '+') player = p;
  }
  if (player < 0 || boxes.length !== goals.length) return '';
  const delta = [-w, w, -1, 1], goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  // Reverse-pull BFS gives both dead squares and exact one-box push distances.
  const distances = goals.map(g => {
    const dist = new Int32Array(size); dist.fill(-1); dist[g] = 0;
    const q = [g];
    for (let head = 0; head < q.length; head++) {
      const p = q[head];
      for (const d of delta) { const prev = p - d, support = prev - d;
        if (floor[prev] && floor[support] && dist[prev] < 0) { dist[prev] = dist[p] + 1; q.push(prev); }
      }
    }
    return dist;
  });
  const live = new Uint8Array(size);
  for (const dist of distances) for (let p = 0; p < size; p++) if (dist[p] >= 0) live[p] = 1;
  const cut = new Uint8Array(size), row = Math.floor(player / w);
  for (let x = 0; x < w; x++) { const p = row * w + x; if (floor[p] && !live[p]) cut[p] = 1; }
  const comp = new Int32Array(size); comp.fill(-1);
  let nc = 0;
  for (let p = 0; p < size; p++) if (floor[p] && !cut[p] && comp[p] < 0) {
    const q = [p]; comp[p] = nc;
    for (let i = 0; i < q.length; i++) for (const d of delta) { const n = q[i] + d; if (floor[n] && !cut[n] && comp[n] < 0) { comp[n] = nc; q.push(n); } }
    nc++;
  }
  let rooms: { boxes: number[]; goals: number[] }[] = [];
  let valid = boxes.every(p => !cut[p]) && goals.every(p => comp[p] >= 0);
  for (let c = 0; c < nc; c++) {
    const b = boxes.filter(p => comp[p] === c), gs = goals.filter(p => comp[p] === c);
    if (b.length !== gs.length) valid = false;
    if (b.length) rooms.push({ boxes: b, goals: gs });
  }
  if (!valid) rooms = [{ boxes: boxes.slice(), goals: goals.slice() }];
  let allBoxes = boxes.slice(), result = '';
  const started = Date.now();
  for (const room of rooms) {
    const own = new Set(room.boxes), fixed = new Uint8Array(size);
    for (const b of allBoxes) if (!own.has(b)) fixed[b] = 1;
    const roomDist = room.goals.map(g => distances[goals.indexOf(g)]);
    const heuristicCache = new Map<string, number>();
    function heuristic(bs: number[]): number {
      const key = bs.join(','); const cached = heuristicCache.get(key); if (cached !== undefined) return cached;
      let best = Infinity;
      function match(i: number, mask: number, sum: number) {
        if (sum >= best) return;
        if (i === bs.length) { best = sum; return; }
        for (let j = 0; j < roomDist.length; j++) { const d = roomDist[j][bs[i]]; if (!(mask & (1 << j)) && d >= 0) match(i + 1, mask | (1 << j), sum + d); }
      }
      // Avoid exponential work for a failed decomposition on unusually large levels.
      if (bs.length > 12) return Infinity;
      match(0, 0, 0); heuristicCache.set(key, best); return best;
    }
    function reach(start: number, bs: number[], withPaths = false) {
      const blocked = new Uint8Array(fixed); for (const b of bs) blocked[b] = 1;
      const seen = new Uint8Array(size), prev = new Int32Array(size), dirs = new Int8Array(size); prev.fill(-1);
      const q = [start]; seen[start] = 1; let rep = start;
      for (let i = 0; i < q.length; i++) { const p = q[i]; if (p < rep) rep = p;
        for (let k = 0; k < 4; k++) { const n = p + delta[k]; if (floor[n] && !blocked[n] && !seen[n]) { seen[n] = 1; if (withPaths) { prev[n] = p; dirs[n] = k; } q.push(n); } }
      }
      return { seen, rep, prev, dirs, blocked };
    }
    function frozen(bs: number[], blocked: Uint8Array, p: number): boolean {
      for (const off of [0, -1, -w, -w - 1]) { const a = p + off, cells = [a, a + 1, a + w, a + w + 1];
        if (cells.every(x => !floor[x] || !!blocked[x]) && cells.some(x => blocked[x] && !goalSet[x])) return true;
      }
      return false;
    }
    function search(bfs: boolean): { moves: string; boxes: number[]; player: number } | null {
      const initial = room.boxes.slice().sort((a,b) => a-b), initialH = heuristic(initial);
      if (!Number.isFinite(initialH)) return null;
      const nodes: Node[] = [{ boxes: initial, player, g: 0, h: initialH, parent: -1, stand: -1, dir: -1, order: 0 }];
      const heap: number[] = [], visited = new Map<string, number>(); let seq = 1, expanded = 0;
      function less(a: number, b: number) { const x = nodes[a], y = nodes[b]; const fx = x.g + (bfs ? 0 : x.h), fy = y.g + (bfs ? 0 : y.h); return fx !== fy ? fx < fy : (!bfs && x.h !== y.h ? x.h < y.h : x.order < y.order); }
      function add(v: number) { let i = heap.length; heap.push(v); while (i) { const p = (i - 1) >> 1; if (!less(v, heap[p])) break; heap[i] = heap[p]; i = p; } heap[i] = v; }
      function pop(): number { const top = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++; if (!less(heap[c], last)) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; }
      const r0 = reach(player, initial); visited.set(initial.join(',') + '|' + r0.rep, 0); add(0);
      const deadline = Math.min(started + 55000, Date.now() + (bfs ? 8000 : 8000));
      while (heap.length && expanded < 1500000 && Date.now() < deadline) {
        const idx = pop(), node = nodes[idx], reachNow = reach(node.player, node.boxes), key = node.boxes.join(',') + '|' + reachNow.rep;
        if (visited.get(key) !== node.g) continue;
        if (node.h === 0) {
          const chain: number[] = []; for (let i = idx; nodes[i].parent >= 0; i = nodes[i].parent) chain.push(i); chain.reverse();
          let pos = player, bs = initial.slice(), moves = '';
          for (const i of chain) { const step = nodes[i], paths = reach(pos, bs, true), route: number[] = []; let p = step.stand;
            while (p !== pos) { if (paths.prev[p] < 0) return null; route.push(paths.dirs[p]); p = paths.prev[p]; }
            route.reverse(); for (const k of route) moves += letters[k]; moves += letters[step.dir].toUpperCase();
            pos = step.stand + delta[step.dir]; bs = step.boxes;
          }
          return { moves, boxes: node.boxes, player: pos };
        }
        expanded++;
        for (let bi = 0; bi < node.boxes.length; bi++) for (let k = 0; k < 4; k++) {
          const b = node.boxes[bi], dest = b + delta[k], stand = b - delta[k];
          if (!reachNow.seen[stand] || !floor[dest] || reachNow.blocked[dest] || !live[dest]) continue;
          const next = node.boxes.slice(); next[bi] = dest; next.sort((a,b) => a-b);
          const blocked = new Uint8Array(reachNow.blocked); blocked[b] = 0; blocked[dest] = 1;
          if (frozen(next, blocked, dest)) continue;
          const h = heuristic(next); if (!Number.isFinite(h)) continue;
          const nextReach = reach(b, next), nextKey = next.join(',') + '|' + nextReach.rep, g = node.g + 1;
          const old = visited.get(nextKey); if (old !== undefined && old <= g) continue;
          visited.set(nextKey, g); nodes.push({ boxes: next, player: b, g, h, parent: idx, stand, dir: k, order: seq++ }); add(nodes.length - 1);
        }
      }
      return null;
    }
    const solution = search(false) ?? search(true);
    if (!solution) return '';
    result += solution.moves; player = solution.player;
    allBoxes = allBoxes.filter(b => !own.has(b)).concat(solution.boxes);
  }
  return result;
}

try {
  for (const entry of readdirSync(I, { withFileTypes: true }).filter(x => x.isDirectory()).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    let moves = '';
    try { moves = solve(readFileSync(join(I, entry.name, 'level.txt'), 'utf8')); } catch { moves = ''; }
    try { mkdirSync(join(O, entry.name), { recursive: true }); writeFileSync(join(O, entry.name, 'solution.txt'), moves + '\n'); } catch { /* Continue with other levels. */ }
  }
} catch { /* An unreadable input directory has no processable levels. */ }
