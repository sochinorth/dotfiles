#!/usr/bin/env python3
"""Regenerate claude-go's model list from models.dev (OpenCode's own catalog).

Rewrites routatic.go.json's "models" (wire format and output limit per model; routatic
clamps each request's max_tokens to that limit) and settings.go.json's "modelPicker"
(one /model row per model). Run it when OpenCode Go's lineup changes:

	python3 dotfiles/claude/go-models.py

Only KEEP's models, in its order; one models.dev no longer lists is skipped. Picked
2026-10-21 by Artificial Analysis' Intelligence Index, Go's requests per 5 hours and
cache-read price (claude-go re-reads its context every turn); left out: MiniMax-M3
(29), Kimi K3, Qwen3.8 Max and Grok 4.7 (110-170 requests per 5h for the same score),
Gemini (routatic sends Go's session header only on its opencode-go path, which won't
speak Gemini), Claude Haiku 5.5 (Go serves it only on the anthropic wire, where
routatic 0.6.5 adds budget_tokens to adaptive thinking and Go refuses the request).
Muse Spark Contributor answers only once the Go workspace's Privacy settings allow
paid endpoints that train on request data.
"""
import json, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = 'deepseek-v4.1-flash'
# index · req/5h · cache read $/M: 45 · 34,670 · 0.003, 206 tok/s
KEEP = ['deepseek-v4.1-flash',
	'muse-spark-1.3-contributor',  # 48 · 45,300 · 0.002; Meta trains on what it's sent
	'mimo-v2.6-pro',            # 46 · 3,250 · 0.0036, but 49 tok/s
	'glm-5.3',                  # 45 · 220 · 0.26
	'glm-5.3-flash',            # 42 · 6,320 · 0.03
	'minimax-m3.1-flash-free',  # 43 · free for a limited time
]
# behavesAs: which Claude model's client-side handling (prompt profile, effort and
# output defaults) a model gets; haiku for small/fast ones, sonnet for the rest
OPUS = {'deepseek-v4.1-flash', 'muse-spark-1.3-contributor', 'mimo-v2.6-pro', 'glm-5.3'}
HAIKU_HINTS = ('flash', 'free')
# routatic's wire format by the AI SDK package models.dev names for the model
WIRE = {'@ai-sdk/anthropic': 'anthropic', '@ai-sdk/openai': 'responses', None: None}

def fetch():
	req = urllib.request.Request('https://models.dev/api.json', headers={'User-Agent': 'go-models.py'})
	with urllib.request.urlopen(req, timeout=30) as r:
		return json.load(r)['opencode-go']['models']

def short(n):
	return f'{n // 1000}k' if n < 1_000_000 else f'{n / 1_000_000:.3g}M'

def main():
	models = {}
	for m in fetch().values():
		npm = (m.get('provider') or {}).get('npm')
		if npm not in WIRE:
			continue
		models[m['id']] = m
	old = lambda i: models[i].get('status') == 'deprecated'
	order = [i for i in KEEP if i in models]

	routes, rows = {}, []
	for i in order:
		m = models[i]
		ctx, out = m['limit']['context'], m['limit']['output']
		wire = WIRE[(m.get('provider') or {}).get('npm')]
		r = {'provider': 'opencode-go', 'model_id': i, 'max_tokens': out,
			'vision': 'image' in m.get('modalities', {}).get('input', [])}
		if wire:
			r['wire_format'] = wire
		routes[i] = r
		row = {'model': i + ('[1m]' if ctx >= 1_000_000 else ''), 'label': m['name'] + (' (deprecated)' if old(i) else ''),
			'description': f"{short(ctx)} context, {short(out)} output · {wire or 'chat'}"}
		if not i.startswith('claude-'):
			row['behavesAs'] = 'claude-opus-5-5' if i in OPUS else \
				'claude-haiku-5-5' if any(h in i for h in HAIKU_HINTS) else 'claude-sonnet-5-5'
		rows.append(row)

	p = os.path.join(HERE, 'routatic.go.json')
	cfg = json.load(open(p))
	cfg['models'] = {'default': routes[DEFAULT], **routes}
	json.dump(cfg, open(p, 'w'), indent=2)
	open(p, 'a').write('\n')

	p = os.path.join(HERE, 'settings.go.json')
	cfg = json.load(open(p))
	cfg['modelPicker'] = {'replaceBuiltInOptions': True, 'options': rows}
	json.dump(cfg, open(p, 'w'), indent=2, ensure_ascii=False)
	open(p, 'a').write('\n')
	print(f'{len(rows)} models; routatic.go.json and settings.go.json rewritten')

if __name__ == '__main__':
	main()
