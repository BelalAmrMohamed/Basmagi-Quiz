// Phase 7 tests (complex numbers, frequency domain). Expected numbers are computed by hand.
type Run = (name: string, src: string, check: (o: string, I: any) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: any, n: string) => number[]; eq: (a: any, b: any) => any };
const close = (a: number[], b: number[], tol = 1e-9) => (a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol)) || `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`;

export function runPhase7(ctx: Ctx) {
  const { run, val, eq } = ctx;
  console.log('Phase 7 (complex / frequency domain)');
  run('literals and arithmetic', `z = (1+2i)*(3-1i); r = real(z); m = imag(z);`, (_o, I) => close([...val(I, 'r'), ...val(I, 'm')], [5, 5]));
  // (1+2i)/(1-1i) = (1+2i)(1+1i)/2 = (-1+3i)/2
  run('division imag part', `w = (1+2i)/(1-1i); a = real(w); b = imag(w);`, (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [-0.5, 1.5]));
  run('abs angle conj', `z = 3+4i; a = abs(z); t = angle(1i); c = conj(z); ci = imag(c);`, (_o, I) => close([...val(I, 'a'), ...val(I, 't'), ...val(I, 'ci')], [5, Math.PI / 2, -4]));
  run('exp(1i*pi) is -1', `e = exp(1i*pi); a = real(e); b = imag(e);`, (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [-1, 0]));
  run('display scalar', `z = 3+4i`, o => eq(o.trim(), 'z = 3 + 4i'));
  run('disp complex', `disp(1.5-2i)`, o => eq(o.trim(), '1.5000 - 2.0000i'));
  run('complex indexing and assignment', `z = [1+1i 2 3]; z(2) = 5i; a = z(2); b = imag(z(1)); s = sum(z); sr = real(s); si = imag(s);`, (_o, I) => close([...val(I, 'b'), ...val(I, 'sr'), ...val(I, 'si')], [1, 4, 6]));
  run('conjugate transpose', `z = [1+2i 3]; c = z'; d = z.'; a = imag(c(1)); b = imag(d(1));`, (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [-2, 2]));
  run('isreal', `a = isreal(1+0i); b = isreal(1i);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[1], [0]]));
  run('other functions reject complex', `x = sqrt(1i);`, () => true, 'sqrt: complex values are not supported');
  // impulse -> flat spectrum of ones; constant -> single DC bin of N
  run('fft impulse', `F = fft([1 0 0 0]); a = real(F); b = imag(F);`, (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [1, 1, 1, 1, 0, 0, 0, 0]));
  run('fft constant', `F = fft([2 2 2 2]); a = real(F);`, (_o, I) => close(val(I, 'a'), [8, 0, 0, 0]));
  // fft([1 2 3 4]) = [10, -2+2i, -2, -2-2i]
  run('fft hand-computed N=4', `F = fft([1 2 3 4]); a = real(F); b = imag(F);`, (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [10, -2, -2, -2, 0, 2, 0, -2]));
  // 6-point (Bluestein) fft([1 0 0 0 0 0]) flat; fft([1 2 3 4 5 6]): X0=21, X3=-3, X1=-3+5.196152422706632i
  run('fft 6 points (non power of two)', `F = fft([1 2 3 4 5 6]); a = real(F); b = imag(F);`,
    (_o, I) => close([...val(I, 'a'), ...val(I, 'b')], [21, -3, -3, -3, -3, -3, 0, 5.196152422706632, 1.7320508075688772, 0, -1.7320508075688772, -5.196152422706632]));
  run('fft padding and dim', `F = fft([1 2], 4); a = real(F); G = fft([1 2; 3 4], [], 2); g = real(G);`, (_o, I) => close([...val(I, 'a'), ...val(I, 'g')], [3, 1, -1, 1, 3, 7, -1, -1]));
  // ifft of conjugate-symmetric spectrum is real
  run('ifft returns real for symmetric input', `x = ifft(fft([1 2 3 4 5])); r = isreal(x); v = x;`, (_o, I) => eq(val(I, 'r'), [1]) === true && close(val(I, 'v'), [1, 2, 3, 4, 5]));
  run('ifft2(fft2(I)) round trip', `I = magic(5); J = ifft2(fft2(I)); d = max(max(abs(J - I)));`, (_o, I) => val(I, 'd')[0] < 1e-9 || `d=${val(I, 'd')[0]}`);
  // fft2 of 2x2 [1 2;3 4]: [10 -2; -4 0]
  run('fft2 hand-computed', `F = fft2([1 2; 3 4]); a = real(F);`, (_o, I) => close(val(I, 'a'), [10, -4, -2, 0]));
  run('fft2 padding', `F = fft2(ones(2), 4, 4); s = size(F); d = real(F(1,1));`, (_o, I) => eq([val(I, 's'), val(I, 'd')], [[4, 4], [4]]));
  run('fftshift / ifftshift', `a = fftshift([1 2 3 4 5]); b = ifftshift([1 2 3 4 5]); c = fftshift([1 2; 3 4]);`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[4, 5, 1, 2, 3], [3, 4, 5, 1, 2], [4, 2, 3, 1]]));
  run('spectrum display idiom', `I = magic(8); F = fftshift(fft2(I)); S = mat2gray(log(1+abs(F))); mx = max(S(:)); mn = min(S(:));`, (_o, I) => eq([val(I, 'mx'), val(I, 'mn')], [[1], [0]]));
  run('matrix product complex', `A = [1i 0; 0 1i]; B = A*A; r = real(B(1,1)); `, (_o, I) => eq(val(I, 'r'), [-1]));
  run('mean complex', `m = mean([1+1i 3+3i]); a = real(m); b = imag(m);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[2], [2]]));
}
