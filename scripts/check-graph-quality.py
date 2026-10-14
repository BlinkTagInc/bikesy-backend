"""Check driving side, graph size and reviewed region-specific facilities."""
import json
from pathlib import Path
import sys

P = Path(sys.argv[1])
review = json.loads((Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / 'graph/quality.json').read_text())
raw = (P / 'corrected-graph-quality.json').read_text()
try:
    stats = json.loads(raw)
except json.JSONDecodeError:
    stats = json.loads(raw.splitlines()[-1])
assert stats['nodes'] == stats['right_side_nodes'], 'Wrong driving-side nodes remain'
assert review['minimum_bicycle_nodes'] > 0
assert stats['bicycle_nodes'] >= review['minimum_bicycle_nodes'], 'Insufficient bicycle graph coverage'
assert stats['right_side_bicycle_nodes'] == stats['bicycle_nodes'], 'Wrong driving-side bicycle nodes remain'
assert review['facilities'], 'Reviewed facility cases required'
rows = [json.loads(x) for x in (P / 'corrected-graph-edges.jsonl').read_text().splitlines()]
proof = []
for case in review['facilities']:
    way, expected = case['way'], case['cyclelane']
    es = [e for e in rows if e['way'] == way and e['bike']]
    assert es, f'Way {way} missing'
    assert {e['forward'] for e in es} == {0, 1}, f'Way {way} lacks both directions'
    assert all(e['cyclelane'] == expected and e['drive_on_right'] for e in es), f'Wrong facility on {way}'
    proof.append({'way': way, 'expected_facility': expected, 'directions': [0, 1], 'edges': len(es)})
(P / 'graph-quality-gate.json').write_text(json.dumps({'passed': True, 'region': review['region'], 'stats': stats, 'exact_way_facility_checks': proof}, indent=2))
print('Graph quality gate passed', stats, proof)
