"""Region identifiers, region config discovery and supported US administrative scope for build tools."""
import argparse
import json
from pathlib import Path
import re

US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()
ROOT = Path(__file__).resolve().parents[1]
ADDING_A_REGION = 'docs/REGIONS.md#adding-a-region'

def region_name(value):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', value):
        raise argparse.ArgumentTypeError('Use a lowercase region slug, at most 48 characters')
    return value

def available_regions(root=ROOT):
    """Region slugs with a config/SLUG.json; engine settings have no `region` key."""
    return sorted(p.stem for p in (Path(root) / 'config').glob('*.json')
                  if 'region' in json.loads(p.read_text()))

def load_region_config(region, root=ROOT):
    """Read config/REGION.json, failing with an actionable message instead of a traceback."""
    path = Path(root) / 'config' / f'{region}.json'
    if not path.is_file():
        known = ', '.join(available_regions(root)) or 'none'
        raise SystemExit(f'Unknown region {region!r}: {path} does not exist (available: {known}). See {ADDING_A_REGION}')
    config = json.loads(path.read_text())
    if config.get('region') != region:
        raise SystemExit(f'{path}: "region" must be {region!r} to match its file name')
    return config

def default_review_dir(region, root=ROOT):
    """graph/REGION/ when present; graph/ holds the original SF review."""
    candidate = Path(root) / 'graph' / region
    return candidate if candidate.is_dir() else Path(root) / 'graph'
