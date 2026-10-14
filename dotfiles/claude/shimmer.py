#!/usr/bin/env python3
"""Derive a Claude Code `claudeShimmer` from a `claude` color, the way the dark theme does.

Dark's pair, rgb(215,119,87) -> rgb(235,159,127), measured in OKLCH, is a lift of
L by +0.100, chroma scaled by 0.788 and hue turned +4.5 deg; all three are carried
over. Out-of-gamut results lose chroma, never lightness or hue.

    shimmer.py '#61afef' ...        print claude/claudeShimmer pairs
    shimmer.py --preview '#61afef'  swatches + an animated shimmer sweep (truecolor)
"""
import math, sys, time

def _lin(c):
	c /= 255
	return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _gam(c):
	c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
	return c * 255

def to_oklch(rgb):
	r, g, b = map(_lin, rgb)
	l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
	m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
	s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
	L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
	a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
	bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
	return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360

def _from_oklch(L, C, h):
	a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
	l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
	return tuple(_gam(x) for x in (
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))

def from_oklch(L, C, h):
	lo, hi = 0.0, C  # bisect chroma down into sRGB
	if all(-0.5 <= x <= 255.5 for x in _from_oklch(L, C, h)):
		lo = C
	else:
		for _ in range(40):
			mid = (lo + hi) / 2
			if all(-0.5 <= x <= 255.5 for x in _from_oklch(L, mid, h)): lo = mid
			else: hi = mid
	return tuple(min(255, max(0, round(x))) for x in _from_oklch(L, lo, h))

DARK = (215, 119, 87), (235, 159, 127)
(_L0, _C0, _h0), (_L1, _C1, _h1) = map(to_oklch, DARK)
DL, CK, DH = _L1 - _L0, _C1 / _C0, _h1 - _h0

def shimmer(rgb):
	L, C, h = to_oklch(rgb)
	return from_oklch(min(1.0, L + DL), C * CK, (h + DH) % 360)

def parse(s):
	s = s.strip().lstrip('#')
	if s.startswith('rgb('): return tuple(int(x) for x in s[4:-1].split(','))
	return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

def rgbs(c): return 'rgb(%d,%d,%d)' % c
def fg(c): return '\x1b[38;2;%d;%d;%dm' % c
def bg(c): return '\x1b[48;2;%d;%d;%dm' % c

def preview(pairs):
	word = '✻ Thinking… (esc to interrupt)'
	for name, base, shim in pairs:
		print(f'{bg(base)}      \x1b[0m{bg(shim)}      \x1b[0m  {fg(base)}{name:<10}\x1b[0m {rgbs(base)} -> {rgbs(shim)}')
	print()
	try:
		for t in range(len(word) * 3):
			lines = []
			for name, base, shim in pairs:
				p = t % (len(word) + 6) - 3
				lines.append(f'{name:<10} ' + ''.join(fg(shim if abs(i - p) <= 1 else base) + ch for i, ch in enumerate(word)) + '\x1b[0m')
			sys.stdout.write('\n'.join(lines) + f'\x1b[{len(lines) - 1}A\r' if len(lines) > 1 else '\r')
			sys.stdout.flush()
			time.sleep(0.08)
	finally:
		print('\n' * len(pairs))

if __name__ == '__main__':
	args = sys.argv[1:]
	show = '--preview' in args
	args = [a for a in args if a != '--preview']
	pairs = [('dark', *DARK)]
	for a in args:
		name, _, col = a.rpartition('=')
		base = parse(col)
		pairs.append((name or col, base, shimmer(base)))
	if show: preview(pairs)
	else:
		print(f'# OKLCH: dL={DL:+.3f} Cx{CK:.3f} dh={DH:+.1f}')
		for name, base, shim in pairs: print(f'{name:<12} claude: "{rgbs(base)}", claudeShimmer: "{rgbs(shim)}"')
