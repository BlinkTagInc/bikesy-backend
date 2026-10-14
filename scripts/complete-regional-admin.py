"""Join complete CA/NV state polygons to a regional US parent.

Inputs must contain exactly the requested state polygons, or those states plus
an existing US parent. Never substitute a routing rectangle for admin geometry.
"""
from region_common import US_STATES
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('database', type=Path)
parser.add_argument('defaults', type=Path)
parser.add_argument('--states', nargs='+', choices=US_STATES, default=['CA'])
a = parser.parse_args()
if len(a.states) != len(set(a.states)):
    parser.error('Duplicate state')
before = hashlib.sha256(a.database.read_bytes()).hexdigest()
defaults = json.loads(a.defaults.read_text())
c = sqlite3.connect(a.database)
c.enable_load_extension(True)
c.load_extension('mod_spatialite')
states = c.execute("SELECT rowid, iso_code FROM admins WHERE admin_level=4 AND drive_on_right=1 AND ST_IsValid(geom)=1").fetchall()
if len(states) != len(a.states) or {s[1] for s in states} != set(a.states):
    raise ValueError('Admin input must contain exactly the requested complete state polygons')
parents = c.execute("SELECT rowid FROM admins WHERE admin_level=2 AND iso_code='US' AND drive_on_right=1 AND ST_IsValid(geom)=1").fetchall()
if len(parents) > 1 or c.execute('SELECT count(*) FROM admins').fetchone()[0] != len(states) + len(parents):
    raise ValueError('Unexpected administrative scope')
with c:
    if parents:
        uid = parents[0][0]
    else:
        c.execute("""INSERT INTO admins(admin_level,iso_code,parent_admin,name,name_en,drive_on_right,allow_intersection_names,default_language,geom)
            SELECT 2,'US',NULL,'United States','United States',1,0,NULL,ST_Union(geom) FROM admins WHERE admin_level=4""")
        uid = c.execute('SELECT last_insert_rowid()').fetchone()[0]
        c.execute('INSERT INTO admin_access VALUES(?,?,?,?,?,?,?,?,?,?,?)', [uid, 'US'] + [None if v < 0 else v for v in defaults])
    for sid, code in states:
        c.execute('UPDATE admins SET parent_admin=? WHERE rowid=?', (uid, sid))
        if not c.execute('SELECT ST_Covers(p.geom,s.geom) FROM admins p, admins s WHERE p.rowid=? AND s.rowid=?', (uid, sid)).fetchone()[0]:
            raise ValueError(f'US parent does not cover {code}')
c.close()
a.database.with_suffix('.regional-manifest.json').write_text(json.dumps({
    'scope': a.states, 'geometry': 'Authoritative input state polygons; no coverage outside their union is implied',
    'input_sha256': before, 'output_sha256': hashlib.sha256(a.database.read_bytes()).hexdigest(),
    'state_ids': dict((code, sid) for sid, code in states), 'country_id': uid,
    'US_access_defaults_from_pinned_headers': defaults,
}, indent=2))
print('Regional US parent verified for', ', '.join(a.states))
