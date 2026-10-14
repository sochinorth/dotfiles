#!/usr/bin/env python3
"""Regenerate claude-go's model list from models.dev (OpenCode's own catalog).

Rewrites routatic.go.json's "models" (wire format and output limit per model; routatic
clamps each request's max_tokens to that limit) and settings.go.json's "modelPicker"
(one /model row per model). Run it when OpenCode Go's lineup changes:

	python3 dotfiles/claude/go-models.py

Deprecated models (by models.dev) come last, marked so. Left out: Gemini (routatic
sends Go's session header only on its opencode-go path, which won't speak Gemini).
"""
import json, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = 'glm-5.3'
# first in the picker, in this order; the rest follow alphabetically
FIRST = ['glm-5.3', 'minimax-m3', 'qwen3.8-max', 'kimi-k3', 'deepseek-v4-pro', 'qwen3.8-flash']
# behavesAs: which Claude model's client-side handling (prompt profile, effort and
# output defaults) a model gets; haiku for small/fast ones, sonnet for the rest
OPUS = {'glm-5.3', 'kimi-k3', 'gpt-6-luna', 'grok-4.7', 'deepseek-v4-pro', 'qwen3.8-max',
	'mimo-v2.6-pro', 'muse-spark-1.3-contributor'}
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
	order = [i for i in FIRST if i in models] + sorted(i for i in models if i not in FIRST and not old(i)) \
		+ sorted(i for i in models if i not in FIRST and old(i))

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
