# Soundtrack for the Yuzakura film: wind, pad, koto-like plucks (Karplus-Strong)
# in the Japanese in-scale, the shishi-odoshi knock, convolution reverb.
import sys, numpy as np, wave
SR = 48000
DUR = 25.2
N = int(SR * DUR)
rng = np.random.default_rng(7)
t = np.arange(N) / SR
out = np.zeros((N, 2))

def at(sec): return int(sec * SR)
def add(sig, start, pan=0.0, gain=1.0):
    s = at(start); e = min(N, s + len(sig))
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    out[s:e, 0] += sig[:e - s] * l * gain
    out[s:e, 1] += sig[:e - s] * r * gain

def lowpass(x, a):  # one-pole, vectorised via cumulative trick is unstable; do simple IIR in chunks
    y = np.empty_like(x); acc = 0.0
    for i in range(0, len(x), 4096):
        seg = x[i:i + 4096]
        ys = np.empty_like(seg)
        for k in range(len(seg)):
            acc += a * (seg[k] - acc); ys[k] = acc
        y[i:i + 4096] = ys
    return y

def bandnoise(n, lo, hi):
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= np.exp(-((np.log(np.maximum(f, 1)) - np.log(np.sqrt(lo * hi))) ** 2) / (2 * (np.log(hi / lo) / 2.5) ** 2))
    x = np.fft.irfft(spec, n)
    return x / np.max(np.abs(x))

# Wind: slow swells of band-limited noise, a breath of high rustle.
swell = 0.55 + 0.45 * np.sin(t * 0.33 + 1.0) * np.sin(t * 0.17 + 0.4)
wind = bandnoise(N, 250, 900) * swell * 0.11
rustle = bandnoise(N, 3000, 9000) * (swell ** 3) * 0.025
out[:, 0] += wind + rustle * 0.8
out[:, 1] += np.roll(wind, 900) + rustle

# The stream: a gurgling babble and the low rush of the waterfall, rising in
# the shot that looks up the stream (15.5-19.5 s) and in the opening.
gurgle = np.interp(t, np.arange(0, DUR + 0.2, 0.06), rng.random(int((DUR + 0.2) / 0.06) + 1))
near = 0.35 + 0.65 * np.clip(np.minimum((t - 15.0) / 0.8, (20.0 - t) / 0.8), 0, 1)
babble = bandnoise(N, 700, 2800) * (0.4 + 0.6 * gurgle ** 2) * near * 0.06
rush = bandnoise(N, 70, 380) * near * 0.07
out[:, 0] += babble + rush
out[:, 1] += np.roll(babble, 1300) + np.roll(rush, 700)

# Pad: soft partial stacks with slow attack, three chord sections.
def tone(freq, dur, att=2.5, rel=3.0, bright=0.25):
    n = at(dur); tt = np.arange(n) / SR
    x = np.zeros(n)
    for k, a in ((1, 1.0), (2, bright), (3, bright * 0.4), (4, bright * 0.15)):
        x += a * np.sin(2 * np.pi * freq * k * tt * (1 + 0.0015 * np.sin(tt * 0.7 + k)))
    env = np.minimum(1, tt / att) * np.minimum(1, (dur - tt) / rel)
    return x * env
D3, Eb3, G2, A3, Bb2, Bb3, D4, Eb4, G3 = 146.83, 155.56, 98.0, 220.0, 116.54, 233.08, 293.66, 311.13, 196.0
for f, p in ((D3, -0.3), (A3, 0.3), (D4, 0.0)): add(tone(f, 13.5), 0.0, p, 0.045)
for f, p in ((G2, -0.2), (D3, 0.2), (Bb3, 0.0)): add(tone(f, 11.5), 11.0, p, 0.045)
for f, p in ((D3, -0.3), (A3, 0.3), (Eb4, 0.1)): add(tone(f, 3.0, rel=1.5), 19.0, p, 0.04)
for f, p in ((D3, -0.3), (A3, 0.3), (D4, 0.0)): add(tone(f, 5.0, att=1.5, rel=3.5), 20.6, p, 0.045)

# Koto-like pluck: Karplus-Strong, block-vectorised.
def pluck(freq, dur=3.5, bright=0.5):
    n = at(dur); P = int(SR / freq)
    y = np.zeros(n + P + 1)
    y[:P] = rng.uniform(-1, 1, P) * np.hanning(P) * 2
    decay = 0.996 ** (220 / freq)
    for s in range(P, n, P):
        e = min(n, s + P)
        prev = y[s - P:e - P + 1]
        y[s:e] = decay * (bright * prev[:e - s] + (1 - bright) * prev[1:e - s + 1])
    x = y[:n]
    x += 0.3 * np.sin(2 * np.pi * freq * 2.003 * np.arange(n) / SR) * np.exp(-np.arange(n) / (SR * 0.25)) * 0.3
    return x * np.minimum(1, np.arange(n) / 30)
NOTE = {'D4': 293.66, 'Eb4': 311.13, 'G4': 392.0, 'A4': 440.0, 'Bb4': 466.16, 'D5': 587.33, 'Eb5': 622.25, 'G5': 783.99, 'A3': 220.0, 'D3': 146.83}
melody = [
    (1.2, 'D4'), (2.3, 'A4'), (3.1, 'Bb4'), (4.6, 'A4'), (6.4, 'G4'), (7.1, 'A4'),
    (8.1, 'D5'), (9.3, 'Bb4'), (10.6, 'A4'), (12.1, 'Eb4'), (13.0, 'D4'),
    (15.6, 'G4'), (16.5, 'A4'), (17.8, 'D5'), (19.1, 'Bb4'), (20.1, 'A4'),
    (21.1, 'D4'), (21.12, 'A4'), (22.6, 'D5'), (23.6, 'A4'),
]
for i, (s, nm) in enumerate(melody):
    add(pluck(NOTE[nm], 3.6, 0.45 + 0.1 * (i % 3)), s, pan=0.35 * np.sin(i * 1.7), gain=0.16)
# Low bass plucks marking the big cuts.
for s in (0.2, 8.0, 15.5, 21.0): add(pluck(NOTE['D3'], 4.0, 0.6), s, 0.0, 0.12)

# Shishi-odoshi: bamboo knock against stone, then the trickle.
def knock():
    n = at(0.5); tt = np.arange(n) / SR
    x = bandnoise(n, 600, 1100) * np.exp(-tt / 0.012) * 0.9
    x += np.sin(2 * np.pi * 410 * tt) * np.exp(-tt / 0.06) * 0.35
    x += np.sin(2 * np.pi * 690 * tt) * np.exp(-tt / 0.03) * 0.15
    return x
add(knock(), 14.1, 0.25, 0.5)
splash = bandnoise(at(0.9), 2000, 8000) * np.exp(-np.arange(at(0.9)) / (SR * 0.18)) * 0.08
add(splash, 14.18, 0.3)

# Convolution reverb: decaying stereo noise tail.
L = at(3.2)
ir_t = np.arange(L) / SR
dry = out.copy()
wet = np.zeros_like(out)
for c in range(2):
    ir = rng.standard_normal(L) * np.exp(-ir_t / 0.75) * (1 - np.exp(-ir_t / 0.004))
    ir /= np.sqrt(np.sum(ir ** 2))
    m = N + L
    wet[:, c] = np.fft.irfft(np.fft.rfft(dry[:, c], m) * np.fft.rfft(ir, m), m)[:N]
mix = dry * 0.75 + wet * 0.45
fade = np.minimum(1, t / 1.5) * np.minimum(1, (DUR - t) / 3.0)
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) / 0.89
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', DUR)
