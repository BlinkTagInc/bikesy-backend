// Coordinates are [latitude, longitude] internally.
export function decode(text, precision = 6) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Invalid route shape');
  let index = 0;
  const previous = [0, 0], points = [];
  while (index < text.length) {
    for (let axis = 0; axis < 2; axis++) {
      let value = 0, shift = 0, byte;
      do {
        byte = text.charCodeAt(index++) - 63;
        if (!Number.isInteger(byte) || byte < 0 || byte > 63 || shift > 30) throw new Error('Invalid route shape');
        value += (byte & 31) * 2 ** shift;
        shift += 5;
      } while (byte >= 32);
      previous[axis] += value % 2 ? -(value + 1) / 2 : value / 2;
    }
    const point = previous.map(n => n / 10 ** precision);
    if (Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) throw new Error('Invalid route shape');
    if (points.length >= 50_000) throw new Error('Route shape exceeds point limit');
    points.push(point);
  }
  return points;
}
function unsigned(value) {
  let result = '';
  while (value >= 32) {
    result += String.fromCharCode((value % 32) + 95);
    value = Math.floor(value / 32);
  }
  return result + String.fromCharCode(value + 63);
}
export function encode(points, precision = 5) {
  const previous = [0, 0];
  return points.map(point => point.map((n, axis) => {
    // Legacy glineenc truncates, rather than rounds, at 1e5.
    const next = Math.trunc(n * 10 ** precision), delta = next - previous[axis];
    previous[axis] = next;
    return unsigned(delta < 0 ? -delta * 2 - 1 : delta * 2);
  }).join('')).join('');
}
export function legacyPath(points) {
  if (!points.length) return ['', ''];
  // Port of misc/tripplanner/glineenc.py's Douglas-Peucker levels.
  const distances = new Map([[0, 10.48576], [points.length - 1, 10.48576]]);
  if (points.length > 50_000) throw new Error('Route shape exceeds point limit');
  let work = 0;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = points[a], B = points[b];
    const dx = B[0] - A[0], dy = B[1] - A[1], norm = dx * dx + dy * dy;
    let max = 0, chosen = 0;
    for (let i = a + 1; i < b; i++) {
      if (++work > 2_000_000) throw new Error('Route simplification exceeds work limit');
      const p = points[i];
      const u = norm ? Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / norm)) : 0;
      const d = Math.hypot(p[0] - A[0] - u * dx, p[1] - A[1] - u * dy);
      if (d > max) { max = d; chosen = i; }
    }
    if (max > 0.00001) {
      distances.set(chosen, max);
      stack.push([a, chosen], [chosen, b]);
    }
  }
  const selected = [...distances.keys()].sort((a, b) => a - b);
  const levels = selected.map(i => {
    let level = 0;
    while (distances.get(i) < 0.00001 * 32 ** (3 - level)) level++;
    return unsigned(3 - level);
  }).join('');
  return [encode(selected.map(i => points[i])), levels];
}
