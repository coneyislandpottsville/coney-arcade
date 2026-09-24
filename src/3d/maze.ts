export type Field = { width: number; height: number; cols: number; rows: number; data: Uint8Array };

export function mazeField(cols: number, rows: number, cell: number, seed: number): Field {
  const count = cols * rows;
  const east = new Uint8Array(count).fill(1);
  const south = new Uint8Array(count).fill(1);
  const seen = new Uint8Array(count);
  let state = seed >>> 0 || 0x9e3779b9;
  const random = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };

  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const here = stack[stack.length - 1]!;
    const x = here % cols;
    const y = (here - x) / cols;
    const right = ((x + 1) % cols) + y * cols;
    const left = ((x + cols - 1) % cols) + y * cols;
    const down = x + ((y + 1) % rows) * cols;
    const up = x + ((y + rows - 1) % rows) * cols;
    const open: Array<[number, Uint8Array, number]> = [];
    if (!seen[right]) open.push([right, east, here]);
    if (!seen[left]) open.push([left, east, left]);
    if (!seen[down]) open.push([down, south, here]);
    if (!seen[up]) open.push([up, south, up]);
    if (!open.length) {
      stack.pop();
      continue;
    }
    const [next, walls, at] = open[Math.floor(random() * open.length)]!;
    walls[at] = 0;
    seen[next] = 1;
    stack.push(next);
  }
  for (let i = 0; i < count; i++) {
    if (random() < 0.14) (random() < 0.5 ? east : south)[i] = 0;
  }

  const width = cols * cell;
  const height = rows * cell;
  const wall = new Uint8Array(width * height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = x + y * cols;
      if (east[i]) {
        const px = ((x + 1) * cell) % width;
        for (let k = 0; k <= cell; k++) wall[((y * cell + k) % height) * width + px] = 1;
      }
      if (south[i]) {
        const py = ((y + 1) * cell) % height;
        for (let k = 0; k <= cell; k++) wall[py * width + ((x * cell + k) % width)] = 1;
      }
    }
  }

  const far = 1e6;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = wall[i] ? 0 : far;
  const at = (x: number, y: number): number => ((y + height) % height) * width + ((x + width) % width);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        dist[i] = Math.min(
          dist[i]!,
          dist[at(x - 1, y)]! + 1,
          dist[at(x, y - 1)]! + 1,
          dist[at(x - 1, y - 1)]! + 1.4142,
          dist[at(x + 1, y - 1)]! + 1.4142,
        );
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        dist[i] = Math.min(
          dist[i]!,
          dist[at(x + 1, y)]! + 1,
          dist[at(x, y + 1)]! + 1,
          dist[at(x + 1, y + 1)]! + 1.4142,
          dist[at(x - 1, y + 1)]! + 1.4142,
        );
      }
    }
  }

  const data = new Uint8Array(width * height);
  const scale = 255 / (cell * 1.5);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.round(dist[i]! * scale));
  return { width, height, cols, rows, data };
}
