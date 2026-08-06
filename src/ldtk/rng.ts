/**
 * LDtk-compatible deterministic randomness for auto-layer rules.
 *
 * Auto-rules make four kinds of random decision: whether a `chance` rule fires,
 * which of several tile alternatives to use, how far to jitter a tile, and
 * whether a Perlin-gated rule passes. LDtk derives all of them from the layer
 * instance's `seed` mixed with the rule uid and the cell coordinates — never
 * from a running counter. That is what lets a level be re-resolved from its
 * IntGrid and come back byte-identical instead of reshuffling every save.
 *
 * Reproducing LDtk's bake therefore means reproducing this hash exactly. The
 * oracle suite (`src/tests/ldtk-rules-oracle.test.ts`) is the arbiter.
 *
 * Determinism note: pure integer math, no `Math.random`, no global state.
 *
 * @module
 */

/**
 * Coordinate-seeded hash — the primitive every rule decision goes through.
 *
 * A literal transcription of `dn.M.randSeedCoords` from deepnightLibs, and the
 * literalness is deliberate. LDtk runs on Haxe's JavaScript target, where `Int`
 * multiplication compiles to a plain `*`: the middle step overflows 2^53 and
 * silently loses precision, and the following `^` truncates whatever survived
 * to 32 bits. Reproducing LDtk's output means reproducing that overflow, so
 * this must not be "fixed" with `Math.imul` — doing so yields a different (more
 * correct, equally useless) hash that disagrees with every saved `.ldtk` file.
 *
 * Note the result may be **negative**: Haxe's `%`, like JavaScript's, keeps the
 * dividend's sign, and LDtk does not take an absolute value. Callers must
 * handle that themselves rather than assuming `[0, max)`.
 *
 * @param seed - Layer seed combined with the rule uid.
 * @param x - Cell X.
 * @param y - Cell Y.
 * @param max - Modulus. Must be positive.
 * @returns An integer in `(-max, max)`.
 */
export function ldtkRandSeedCoords(seed: number, x: number, y: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) % max;
}

/**
 * Heaps' Perlin gradient table, restricted to 2D.
 *
 * The upstream table is 256 3D gradients; `gradientAt` only ever reads the x
 * and y components, so the z column is dropped here. Values are the raw
 * upstream floats — the constructor's `* 2.12` scaling is applied once at
 * module load, exactly as Heaps does.
 */
const PERLIN_GRADIENTS_2D: readonly number[] = Object.freeze([
  -0.763874, -0.596439, 0.396055, 0.904518, -0.499004, -0.8665, 0.468724, -0.824756,
  0.829598, 0.43195, -0.454473, 0.629497, -0.162349, -0.869962, 0.932805, 0.253451,
  -0.345419, 0.927299, -0.715026, -0.293698, -0.245997, 0.717467, -0.967409, -0.250435,
  0.901729, 0.397108, 0.892657, -0.0720622, 0.0260084, -0.0361701, 0.949107, -0.19486,
  0.471803, -0.807064, 0.879737, 0.141845, 0.570747, 0.696415, -0.141751, -0.988233,
  -0.58219, -0.0303005, -0.60922, 0.239482, 0.299394, -0.197066, -0.851615, -0.220702,
  0.848886, 0.341829, -0.156129, -0.687241, -0.665651, 0.626724, 0.595914, -0.674582,
  0.171025, -0.509292, 0.78605, 0.536414, 0.18905, -0.791613, -0.294916, 0.844994,
  0.342031, -0.58736, 0.57155, 0.7869, 0.885026, -0.408223, -0.789518, 0.571645,
  0.774571, 0.31566, -0.79695, -0.0433603, -0.142425, -0.473249, -0.0698838, 0.170442,
  0.687815, -0.484748, 0.543703, -0.534446, 0.97186, 0.184391, 0.707084, 0.485713,
  0.942302, 0.331945, 0.499084, 0.599922, -0.289203, 0.211107, 0.412433, -0.71667,
  0.87721, -0.082816, -0.420685, -0.214278, 0.752558, -0.0391579, 0.0765725, -0.996789,
  -0.544312, -0.309435, -0.455358, -0.415572, -0.874586, 0.483746, 0.245172, -0.0838623,
  0.382293, -0.432813, -0.287735, -0.905514, -0.667704, 0.704955, 0.717885, -0.464002,
  0.976342, -0.214895, -0.0733096, -0.921136, -0.986284, 0.151224, -0.899319, -0.429671,
  0.652102, -0.724625, 0.203761, 0.458023, -0.030396, 0.698724, -0.460232, 0.839138,
  -0.0898602, 0.837894, -0.731595, 0.0793784, -0.447236, -0.788397, 0.186481, 0.645855,
  -0.259006, 0.935463, 0.445839, 0.819655, 0.349962, 0.755022, -0.997078, -0.0359577,
  -0.431163, -0.147516, 0.299648, -0.63914, 0.397043, 0.566526, -0.502489, 0.438308,
  0.0687235, 0.354097, -0.0476651, -0.462597, -0.221934, 0.900739, -0.956107, -0.225676,
  -0.187627, 0.391487, -0.224209, -0.315405, -0.730807, -0.537068, -0.0353135, -0.816748,
  -0.941391, 0.176991, -0.154174, 0.390458, -0.283847, 0.533842, -0.482737, -0.850448,
  -0.649175, 0.477748, 0.885373, -0.405387, -0.147261, 0.181623, 0.0959236, -0.115847,
  -0.89724, -0.191348, 0.903553, -0.428461, 0.849072, -0.295807, 0.65551, 0.741754,
  0.61598, -0.178669, 0.0112967, 0.932256, -0.793031, 0.258012, 0.421933, 0.454311,
  -0.319993, 0.0401618, -0.81571, 0.551307, -0.377644, 0.00322313, 0.129759, -0.666581,
  0.601901, -0.654237, -0.927463, -0.0343576, -0.438663, -0.868301, -0.648845, -0.749138,
  0.507393, -0.588294, 0.726958, 0.623665, 0.411159, 0.367614, 0.806333, 0.585117,
  0.263935, -0.880876, 0.421546, -0.201336, -0.683198, -0.569557, -0.117116, -0.0406654,
  -0.643679, -0.109196, -0.561559, -0.62989, 0.0628422, 0.104677, 0.480759, -0.2867,
  -0.228559, -0.228965, -0.10194, -0.65706, 0.0689193, -0.678236, 0.401019, -0.754026,
  -0.742141, 0.547083, -0.00210603, -0.796417, 0.296725, -0.409909, -0.260932, -0.798201,
  -0.641628, 0.742379, -0.186009, -0.101514, 0.106711, -0.962067, -0.743499, 0.30988,
  -0.795853, -0.605066, -0.828661, -0.419471, 0.0847218, -0.489815, -0.381405, 0.788019,
  0.282042, -0.953394, 0.530774, 0.847413, 0.0515397, 0.922524, -0.631467, -0.709046,
  0.688248, 0.517273, 0.646689, -0.333782, -0.932528, -0.247532, 0.630609, 0.68757,
  0.577805, -0.394189, -0.887833, -0.437301, 0.690982, 0.174003, -0.866701, 0.0118182,
  -0.482876, 0.727143, -0.577567, 0.682593, 0.373768, 0.0982991, 0.170744, 0.964243,
  0.993654, -0.035791, 0.587065, 0.4143, -0.396509, 0.26509, -0.0866853, 0.83553,
  0.923193, 0.133398, 0.00379108, -0.258618, 0.239144, 0.245154, 0.758731, -0.555871,
  0.295355, 0.309513, 0.0531222, -0.91003, 0.270452, 0.0229439, 0.563634, 0.0324352,
  0.156326, 0.147392, -0.0410141, 0.981824, -0.385562, -0.576343, 0.388281, 0.904441,
  0.945561, -0.192859, 0.844504, 0.520193, 0.0330893, 0.999121, -0.592616, -0.482475,
  0.539471, 0.631024, 0.655851, -0.027319, 0.274465, 0.887659, -0.123419, 0.975177,
  -0.223429, 0.708045, -0.908654, 0.196302, -0.95759, -0.00863708, 0.960535, 0.030592,
  -0.413146, 0.907537, -0.847992, 0.350849, 0.614736, 0.395841, -0.503504, -0.666128,
  -0.268833, -0.738524, 0.792737, -0.60001, -0.637582, 0.508144, 0.750105, 0.282165,
  -0.351199, -0.392294, 0.250126, -0.960993, -0.732341, 0.680909, -0.760674, -0.141009,
  0.222823, -0.304012, 0.209178, 0.505671, 0.757914, -0.56629, -0.782926, -0.339196,
  -0.462952, 0.585565, 0.61879, 0.194119, 0.741388, -0.276743, 0.707571, 0.702621,
  0.156562, 0.819977, -0.793606, 0.440216, 0.234547, 0.885309, 0.132598, 0.80115,
  -0.377899, -0.639179, -0.865993, -0.396465, -0.624815, -0.44283, -0.485705, 0.825614,
  -0.971788, 0.175535, -0.456027, 0.392629, -0.0104443, 0.521623, -0.660575, -0.74519,
  -0.0157698, -0.307475, -0.603467, -0.250192, 0.506876, 0.25006, 0.255404, 0.966794,
  0.466764, -0.874228, 0.475077, -0.0682351, -0.224967, -0.938972, -0.377929, -0.814757,
  -0.305847, 0.542333, 0.26658, -0.902905, 0.0275773, 0.322158, 0.0185422, 0.716349,
  -0.20483, 0.978416, -0.898276, 0.373969, -0.00909378, 0.546594, 0.6602, -0.751089,
  0.855301, -0.303056, 0.797138, 0.0623013, 0.48947, -0.866813, 0.251142, 0.674531,
  -0.578422, -0.737373, -0.254689, -0.514807, 0.374972, 0.761612, 0.640303, -0.734271,
  -0.638076, 0.285527, 0.772956, -0.15984, 0.798217, -0.590628, -0.986276, -0.0578337,
  -0.312988, -0.94549, -0.497338, 0.178325, -0.101136, -0.981014, -0.521688, 0.0553434,
  -0.786182, -0.583814, -0.565191, 0.821858, 0.437895, 0.152598, -0.92394, 0.353436,
  0.212189, -0.815162, -0.859262, 0.143405, 0.991353, 0.112814, 0.0337884, -0.979891,
]);

/** Upstream scales every gradient component by this constant. */
const GRADIENT_SCALE = 2.12;

/** Scaled gradients, laid out as `[gx, gy]` pairs indexed by hashed byte. */
const SCALED_GRADIENTS: readonly number[] = Object.freeze(
  PERLIN_GRADIENTS_2D.map((component) => component * GRADIENT_SCALE),
);

/**
 * Lattice repeat period. LDtk configures its Perlin with
 * `adjustScale(50, 1)`, which sets `repeat = 50`; the value participates in
 * the gradient hash, so it is part of the contract rather than a tuning knob.
 */
const PERLIN_REPEAT = 50;

/** Heaps' quintic smoothstep: `a³(6a² − 15a + 10)`. */
function scurve(a: number): number {
  const a2 = a * a;
  return a2 * a * (6.0 * a2 - 15.0 * a + 10.0);
}

function linear(a: number, b: number, k: number): number {
  return a + k * (b - a);
}

/**
 * Dot the gradient at lattice point `(ix, iy)` with the offset to `(x, y)`.
 *
 * The index hash is transcribed from Heaps verbatim, including the unsigned
 * shift and the mask to a single byte.
 */
function gradientAt(
  x: number, y: number, ix: number, iy: number, seed: number,
): number {
  let index = seed * 1013 + (ix % PERLIN_REPEAT) * 1619 + (iy % PERLIN_REPEAT) * 31337;
  index = (index ^ (index >>> 8)) & 0xff;
  const gx = SCALED_GRADIENTS[index * 2];
  const gy = SCALED_GRADIENTS[index * 2 + 1];
  return gx * (x - ix) + gy * (y - iy);
}

/** One octave of 2D gradient noise. */
function inlineGradient(seed: number, x: number, y: number): number {
  // Haxe's `Std.int` truncates toward zero, which differs from `Math.floor`
  // for negative coordinates — and rules do sample negative cells.
  const ix = Math.trunc(x);
  const xs = scurve(x - ix);
  const iy = Math.trunc(y);
  const ys = scurve(y - iy);
  const ga = gradientAt(x, y, ix, iy, seed);
  const gb = gradientAt(x, y, ix + 1, iy, seed);
  const gc = gradientAt(x, y, ix, iy + 1, seed);
  const gd = gradientAt(x, y, ix + 1, iy + 1, seed);
  return linear(linear(ga, gb, xs), linear(gc, gd, xs), ys);
}

/**
 * Fractal Perlin noise, normalized to roughly `[-1, 1]`.
 *
 * A transcription of `hxd.Perlin.perlin` with the settings LDtk applies
 * (`normalize = true`, `adjustScale(50, 1)`). Rules with `perlinActive` gate
 * on `noise < 0`, so the normalization divisor is load-bearing: without it the
 * sign flips on a different set of cells and the terrain comes out different.
 *
 * Callers pass coordinates already multiplied by the rule's `perlinScale`,
 * matching LDtk's call site.
 *
 * @param seed - Layer seed plus the rule's `perlinSeed`.
 * @param x - Cell X times `perlinScale`.
 * @param y - Cell Y times `perlinScale`.
 * @param octaves - The rule's `perlinOctaves`.
 * @param persist - Amplitude falloff per octave.
 * @param lacunarity - Frequency growth per octave.
 */
export function ldtkPerlin(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  persist = 0.5,
  lacunarity = 2.0,
): number {
  let v = 0;
  let k = 1;
  let sum = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    v += inlineGradient(seed + i, px, py) * k;
    sum += k;
    k *= persist;
    px *= lacunarity;
    py *= lacunarity;
  }
  return sum === 0 ? 0 : v / sum;
}
