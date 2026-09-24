import type { Field } from "./maze";

export type SceneryStatus = "loading" | "animated" | "paused" | "still" | "unavailable";
export type Scenery = { dispose(): void; setTint(rgb: [number, number, number]): void };

type Pass = {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  size: number;
  count: number;
  mode: number;
  time: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  pointer: WebGLUniformLocation | null;
  tint: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  cells: WebGLUniformLocation | null;
};

const mazeVertex = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const mazeFragment = `
precision highp float;
uniform vec2 uViewport;
uniform float uTime;
uniform vec2 uPointer;
uniform vec3 uTint;
uniform vec2 uCells;
uniform sampler2D uMaze;
varying vec2 vUv;

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  float aspect = uViewport.x / uViewport.y;
  vec3 rd = normalize(vec3(ndc.x * 0.58 * aspect, ndc.y * 0.58, 1.0));
  float c = 0.5299;
  float s = 0.8480;
  rd = vec3(rd.x, rd.y * c - rd.z * s, rd.y * s + rd.z * c);
  float t = 1.0 / max(0.05, -rd.y);
  vec2 p = rd.xz * t * 5.2;
  p += vec2(uTime * 0.055, uTime * 0.04) + uPointer * vec2(1.3, 0.9);
  float d = texture2D(uMaze, p / uCells).r * 1.5;
  float core = 1.0 - smoothstep(0.05, 0.12, d);
  float glow = exp(-d * 4.0);
  float halo = exp(-d * 1.4) * 0.3;
  vec2 f = abs(fract(p) - 0.5);
  float tile = (1.0 - smoothstep(0.0, 0.06, 0.5 - max(f.x, f.y))) * 0.05;
  float fog = exp(-t * 0.55);
  float flicker = 0.92 + 0.08 * sin(uTime * 1.1 + floor(p.x) * 1.7 + floor(p.y) * 2.3);
  vec3 hot = vec3(1.0, 0.94, 0.84);
  vec3 color = uTint * (glow * 0.5 + halo + tile) + mix(uTint, hot, 0.7) * core * 1.2;
  float alpha = clamp(glow * 0.45 + halo + core + tile, 0.0, 1.0) * fog;
  gl_FragColor = vec4(color * fog * flicker * 0.95, alpha);
}
`;

const sparkVertex = `
precision highp float;
attribute vec4 aSeed;
uniform vec2 uViewport;
uniform vec2 uPointer;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
varying float vGold;
void main() {
  float depth = 0.3 + aSeed.z * 0.7;
  float life = fract(aSeed.y + uTime * (0.012 + aSeed.z * 0.014));
  float x = aSeed.x + sin(life * 6.0 + aSeed.w * 30.0) * 0.02 * depth + uPointer.x * 0.02 * depth;
  float y = life * 1.1 - 0.05 + uPointer.y * 0.012 * depth;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (2.0 + pow(aSeed.z, 4.0) * 10.0) * uScale;
  vAlpha = pow(sin(life * 3.14159), 1.6) * (0.25 + 0.45 * aSeed.z);
  vGold = step(0.7, aSeed.w);
}
`;

const sparkFragment = `
precision mediump float;
uniform vec3 uTint;
varying float vAlpha;
varying float vGold;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float glow = exp(-d * d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d));
  vec3 color = mix(uTint, vec3(1.0, 0.85, 0.45), vGold);
  color = mix(color, vec3(1.0, 0.95, 0.85), exp(-d * d * 40.0));
  float a = glow * vAlpha;
  gl_FragColor = vec4(color * a, a);
}
`;

export function createScenery(canvas: HTMLCanvasElement, field: Field, onStatus: (status: SceneryStatus) => void): Scenery | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) {
    onStatus("unavailable");
    return null;
  }

  let passes: Pass[] = [];
  let texture: WebGLTexture | null = null;
  let frame = 0;
  let resizeFrame = 0;
  let time = 0;
  let lastFrame = 0;
  let lastDraw = 0;
  let slowFrames = 0;
  let observedFrames = 0;
  let disposed = false;
  let lost = false;
  let settled = false;
  let width = 1;
  let height = 1;
  let scale = 1;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  const tint: [number, number, number] = [0.94, 0.63, 0.23];
  const wanted: [number, number, number] = [0.94, 0.63, 0.23];
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  let economy = false;
  let downgraded = false;

  function makePass(vertex: string, fragment: string, data: Float32Array, size: number, mode: number, count: number): Pass {
    const context = gl!;
    const program = context.createProgram();
    const buffer = context.createBuffer();
    if (!program || !buffer) {
      context.deleteProgram(program);
      context.deleteBuffer(buffer);
      throw new Error("scenery resources");
    }
    for (const [type, source] of [
      [context.VERTEX_SHADER, vertex],
      [context.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = context.createShader(type);
      if (!shader) {
        context.deleteProgram(program);
        context.deleteBuffer(buffer);
        throw new Error("scenery shader");
      }
      context.shaderSource(shader, source);
      context.compileShader(shader);
      context.attachShader(program, shader);
      context.deleteShader(shader);
    }
    context.bindAttribLocation(program, 0, size === 2 ? "aPosition" : "aSeed");
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      context.deleteProgram(program);
      context.deleteBuffer(buffer);
      throw new Error("scenery link");
    }
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
    return {
      program,
      buffer,
      size,
      mode,
      count,
      time: context.getUniformLocation(program, "uTime"),
      viewport: context.getUniformLocation(program, "uViewport"),
      pointer: context.getUniformLocation(program, "uPointer"),
      tint: context.getUniformLocation(program, "uTint"),
      scale: context.getUniformLocation(program, "uScale"),
      cells: context.getUniformLocation(program, "uCells"),
    };
  }

  function clearPasses(): void {
    for (const pass of passes) {
      gl!.deleteBuffer(pass.buffer);
      gl!.deleteProgram(pass.program);
    }
    passes = [];
    gl!.deleteTexture(texture);
    texture = null;
  }

  function initialize(): boolean {
    try {
      texture = gl!.createTexture();
      if (!texture) throw new Error("scenery texture");
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.REPEAT);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.REPEAT);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.LUMINANCE, field.width, field.height, 0, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, field.data);
      if (gl!.getError() !== gl!.NO_ERROR) throw new Error("scenery upload");
      passes.push(makePass(mazeVertex, mazeFragment, new Float32Array([-1, -1, 3, -1, -1, 3]), 2, gl!.TRIANGLES, 3));
      const seeds = new Float32Array(96 * 4);
      let seed = 47;
      for (let i = 0; i < seeds.length; i += 1) {
        seed = (seed * 16807) % 2147483647;
        seeds[i] = seed / 2147483647;
      }
      passes.push(makePass(sparkVertex, sparkFragment, seeds, 4, gl!.POINTS, 96));
      gl!.enable(gl!.BLEND);
      gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
      return true;
    } catch {
      clearPasses();
      onStatus("unavailable");
      return false;
    }
  }

  function resize(): void {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    economy = downgraded || width < 1100 || navigator.hardwareConcurrency <= 4;
    const budget = economy ? 360_000 : 1_000_000;
    scale = Math.min(1, devicePixelRatio || 1, Math.sqrt(budget / (width * height)), 2048 / width, 2048 / height);
    const bufferWidth = Math.max(1, Math.floor(width * scale));
    const bufferHeight = Math.max(1, Math.floor(height * scale));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    gl!.viewport(0, 0, canvas.width, canvas.height);
    if (settled && !lost && passes.length === 2) draw();
  }

  function draw(): void {
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    for (const pass of passes) {
      gl!.useProgram(pass.program);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, pass.buffer);
      gl!.enableVertexAttribArray(0);
      gl!.vertexAttribPointer(0, pass.size, gl!.FLOAT, false, 0, 0);
      gl!.uniform1f(pass.time, time);
      gl!.uniform2f(pass.viewport, width, height);
      gl!.uniform2f(pass.pointer, pointerX, pointerY);
      gl!.uniform3f(pass.tint, tint[0], tint[1], tint[2]);
      gl!.uniform1f(pass.scale, scale);
      gl!.uniform2f(pass.cells, field.cols, field.rows);
      gl!.drawArrays(pass.mode, 0, pass.mode === gl!.POINTS && economy ? 48 : pass.count);
    }
  }

  function tick(now: number): void {
    frame = 0;
    if (disposed || lost || settled || document.hidden) return;
    const elapsed = lastFrame === 0 ? 16 : now - lastFrame;
    lastFrame = now;
    time += Math.min(elapsed, 80) / 1000;
    observedFrames += 1;
    if (elapsed > 48) slowFrames += 1;
    if (observedFrames >= 120) {
      if (slowFrames > 42) {
        if (economy) {
          settled = true;
          onStatus("still");
          return;
        }
        downgraded = true;
        resize();
      }
      observedFrames = 0;
      slowFrames = 0;
    }
    if (now - lastDraw >= (economy ? 1000 / 24 : 1000 / 30) - 1) {
      const smoothing = 1 - Math.exp(-(now - lastDraw) / 700);
      pointerX += (targetX - pointerX) * smoothing;
      pointerY += (targetY - pointerY) * smoothing;
      const blend = 1 - Math.exp(-(now - lastDraw) / 900);
      for (let i = 0; i < 3; i++) tint[i] += (wanted[i]! - tint[i]!) * blend;
      lastDraw = now;
      draw();
      onStatus("animated");
    }
    frame = requestAnimationFrame(tick);
  }

  function pause(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    lastDraw = 0;
  }

  function visibility(): void {
    pause();
    if (disposed || lost || settled) return;
    if (document.hidden) onStatus("paused");
    else frame = requestAnimationFrame(tick);
  }

  function move(event: PointerEvent): void {
    if (!finePointer.matches || event.pointerType !== "mouse") return;
    targetX = event.clientX / width - 0.5;
    targetY = 0.5 - event.clientY / height;
  }

  function resetPointer(): void {
    targetX = 0;
    targetY = 0;
  }

  function contextLost(event: Event): void {
    event.preventDefault();
    lost = true;
    pause();
    passes = [];
    texture = null;
    onStatus("unavailable");
  }

  function contextRestored(): void {
    if (disposed) return;
    lost = false;
    settled = false;
    if (!initialize()) return;
    resize();
    visibility();
  }

  if (!initialize()) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  });
  resize();
  observer.observe(canvas);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("blur", resetPointer);
  document.documentElement.addEventListener("pointerleave", resetPointer);
  visibility();

  return {
    setTint(rgb) {
      wanted[0] = rgb[0];
      wanted[1] = rgb[1];
      wanted[2] = rgb[2];
    },
    dispose() {
      disposed = true;
      pause();
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", resetPointer);
      document.documentElement.removeEventListener("pointerleave", resetPointer);
      clearPasses();
      if (!lost) gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
