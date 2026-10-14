"""Offline regional build gates and release-context integration tests."""
import hashlib
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

class RegionBuildTests(unittest.TestCase):
    def run_script(self, script, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *map(str, args)], capture_output=True, text=True)

    def test_tahoe_requires_review_before_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'build'
            result = self.run_script('rebuild-variant.py', '--project', ROOT, '--region', 'tahoe', '--output', output)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Tahoe requires --review', result.stderr)
            self.assertFalse(output.exists())

    def test_build_lock_includes_admin_and_detects_admin_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            config = p / 'config.json'
            config.write_text(json.dumps({'bounds': {'left': 0.1, 'bottom': 0.1, 'right': 0.9, 'top': 0.9}}))
            (p / 'region.osm.pbf').write_bytes(b'OSM checksum fixture')
            (p / 'admin-input.osm.pbf').write_bytes(b'Admin checksum fixture')
            tile = p / 'elevation/N00/N00E000.hgt'
            tile.parent.mkdir(parents=True)
            with tile.open('wb') as out:
                out.truncate(1201 * 1201 * 2)
            export = p / 'review/inputs.lock.json'
            result = self.run_script('lock-inputs.py', p, config, '--osm-source', 'fixture', '--dem-source', 'fixture', '--build-lock', export)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(export.read_text())['admin-input.osm.pbf'], sha(p / 'admin-input.osm.pbf'))
            self.assertEqual(self.run_script('lock-inputs.py', p, config, '--verify').returncode, 0)
            (p / 'admin-input.osm.pbf').write_bytes(b'changed')
            self.assertNotEqual(self.run_script('lock-inputs.py', p, config, '--verify').returncode, 0)

    def test_region_facility_gate_rejects_missing_direction_and_wrong_driving_side(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            quality = {'region': 'tahoe', 'minimum_bicycle_nodes': 100, 'facilities': [{'way': 42, 'cyclelane': 3}]}
            (p / 'quality.json').write_text(json.dumps(quality))
            stats = {'nodes': 200, 'right_side_nodes': 200, 'bicycle_nodes': 150, 'right_side_bicycle_nodes': 150}
            (p / 'corrected-graph-quality.json').write_text(json.dumps(stats))
            rows = [{'way': 42, 'bike': True, 'forward': forward, 'cyclelane': 3, 'drive_on_right': True} for forward in [0, 1]]
            def check(rows):
                (p / 'corrected-graph-edges.jsonl').write_text('\n'.join(map(json.dumps, rows)))
                return self.run_script('check-graph-quality.py', p, p / 'quality.json')
            self.assertEqual(check(rows).returncode, 0)
            self.assertNotEqual(check(rows[:1]).returncode, 0)
            stats['right_side_nodes'] = 199
            (p / 'corrected-graph-quality.json').write_text(json.dumps(stats))
            self.assertNotEqual(check(rows).returncode, 0)

    def test_prepare_context_binds_each_region_and_rejects_tampering(self):
        for region in ['sf', 'tahoe']:
            with self.subTest(region=region), tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                runtime = p / 'runtime'
                (runtime / 'data').mkdir(parents=True)
                (runtime / 'engine').mkdir()
                engine = runtime / 'engine/valhalla_service'
                engine.write_bytes(b'fixture engine, not executable')
                files = {}
                for name in ['valhalla.json', 'admin.sqlite', 'bikesy-policy.bin', 'bikesy-stairs.txt']:
                    path = runtime / 'data' / name
                    path.write_text('fixture')
                    files[name] = sha(path)
                lock = {'policy': 'bikesy-distance-v1', 'graph_access_policy': 'bikesy-access-v1', 'graph_import_policy': 'bikesy-import-v2', 'stair_policy': 'counted-stairs-v1', 'region': region, 'build_config': {key: json.loads((ROOT / 'config' / f'{region}.json').read_text())[key] for key in ['bounds', 'admin_states']}, 'engine_sha256': sha(engine), 'files': files}
                (runtime / 'data/engine-policy.json').write_text(json.dumps(lock))
                args = ['--region', region, '--runtime', runtime, '--image', 'example.invalid/data@sha256:' + 'a' * 64]
                result = self.run_script('prepare-release.py', *args, '--output', p / 'app')
                self.assertEqual(result.returncode, 0, result.stderr)
                release = json.loads((p / 'app/release.json').read_text())
                self.assertEqual(release['region'], region)
                self.assertIn(f'BIKESY_CONFIG=/app/config/{region}.json', (p / 'app/Dockerfile.vercel').read_text())
                self.assertFalse((p / 'app/stage.html').exists())
                self.assertNotIn('stage.html', release['runtime_files'])
                # A generated context stays independent of the checked-in SF release.
                self.assertIn(f'config/{region}.json', release['runtime_files'])
                bundled = self.run_script('prepare-release.py', '--region', region, '--runtime', runtime, '--bundle-data', '--output', p / 'bundled')
                self.assertEqual(bundled.returncode, 0, bundled.stderr)
                bundled_docker = (p / 'bundled/Dockerfile.vercel').read_text()
                self.assertNotIn('vcr.vercel.com/blinktag', bundled_docker)
                self.assertIn('COPY runtime/data /data', bundled_docker)
                self.assertEqual((p / 'bundled/runtime/data/admin.sqlite').read_text(), 'fixture')
                (runtime / 'data/admin.sqlite').write_text('tampered')
                result = self.run_script('prepare-release.py', *args, '--output', p / 'tampered')
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((p / 'tampered').exists())

class OSMPreparationTests(unittest.TestCase):
    def test_merge_extract_and_reject_mismatched_snapshots(self):
        import runpy
        from unittest.mock import patch
        for mismatch in [False, True]:
            with self.subTest(mismatch=mismatch), tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                inputs = [p / 'ca.osm.pbf', p / 'nv.osm.pbf']
                for source in inputs:
                    source.write_bytes(b'input fixture')
                admin = p / 'admin.osm.pbf'
                admin.write_bytes(b'complete admin fixture')
                data = p / 'data'
                calls = []
                def run(command, **kwargs):
                    calls.append(command)
                    if command[1] == 'fileinfo':
                        value = 'no' if 'data.multiple_versions' in command else ('different' if mismatch and str(inputs[1].resolve()) in command else '2026-10-01T00:00:00Z')
                        return subprocess.CompletedProcess(command, 0, stdout=value)
                    if command[1] in ['merge', 'extract']:
                        Path(command[command.index('-o') + 1]).write_bytes(b'output fixture')
                    return subprocess.CompletedProcess(command, 0)
                argv = ['prepare-osm.py', '--config', str(ROOT / 'config/tahoe.json'), '--data', str(data), '--admin-input', str(admin), *map(str, inputs)]
                with patch('sys.argv', argv), patch('shutil.which', return_value='/fixture/osmium'), patch('subprocess.run', side_effect=run):
                    if mismatch:
                        with self.assertRaises(SystemExit):
                            runpy.run_path(str(ROOT / 'scripts/prepare-osm.py'), run_name='__main__')
                        self.assertFalse(data.exists())
                    else:
                        runpy.run_path(str(ROOT / 'scripts/prepare-osm.py'), run_name='__main__')
                        self.assertEqual((data / 'admin-input.osm.pbf').read_bytes(), admin.read_bytes())
                        self.assertEqual(len([c for c in calls if c[1] == 'merge']), 1)
                        extract = next(c for c in calls if c[1] == 'extract')
                        self.assertIn('--bbox=-120.5,38.65,-119.55,39.5', extract)
                        self.assertIn('--strategy=complete_ways', extract)
                        self.assertTrue(any(c[1] == 'check-refs' for c in calls))

class RegionalAdminTests(unittest.TestCase):
    def test_real_spatialite_state_union_and_existing_parent(self):
        # Isolate extension loads: repeated unload/reload can crash macOS SpatiaLite.
        probe = subprocess.run([sys.executable, '-c', "import sqlite3; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); c.load_extension('mod_spatialite')"], capture_output=True)
        if probe.returncode:
            self.skipTest('SpatiaLite extension unavailable')
        for states, existing_parent in [(['CA'], False), (['CA', 'NV'], False), (['CA', 'NV'], True)]:
            with self.subTest(states=states, existing_parent=existing_parent), tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                db = p / 'admin.sqlite'
                setup = """
import sqlite3, sys, json
c = sqlite3.connect(sys.argv[1])
c.enable_load_extension(True)
c.load_extension('mod_spatialite')
c.execute('CREATE TABLE admins(admin_level INTEGER,iso_code TEXT,parent_admin INTEGER,name TEXT,name_en TEXT,drive_on_right INTEGER,allow_intersection_names INTEGER,default_language TEXT,geom BLOB)')
c.execute('CREATE TABLE admin_access(id INTEGER,iso_code TEXT,' + ','.join(f'v{i} INTEGER' for i in range(9)) + ')')
for i, code in enumerate(json.loads(sys.argv[2])):
    polygon = f'POLYGON(({i} 0,{i+1} 0,{i+1} 1,{i} 1,{i} 0))'
    c.execute("INSERT INTO admins VALUES(4,?,NULL,?,?,1,0,NULL,GeomFromText(?,4326))", (code, code, code, polygon))
if sys.argv[3] == 'True':
    c.execute("INSERT INTO admins VALUES(2,'US',NULL,'United States','United States',1,0,NULL,GeomFromText('POLYGON((0 0,2 0,2 1,0 1,0 0))',4326))")
    c.execute("INSERT INTO admin_access VALUES(3,'US',1,1,1,1,1,1,1,1,1)")
c.commit()
c.close()
"""
                setup_result = subprocess.run([sys.executable, '-c', setup, str(db), json.dumps(states), str(existing_parent)], capture_output=True, text=True)
                self.assertEqual(setup_result.returncode, 0, setup_result.stderr)
                (p / 'defaults.json').write_text(json.dumps([1] * 9))
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/complete-regional-admin.py'), str(db), str(p / 'defaults.json'), '--states', *states], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                c = sqlite3.connect(db)
                self.assertEqual(c.execute('SELECT count(DISTINCT parent_admin) FROM admins WHERE admin_level=4').fetchone()[0], 1)
                self.assertEqual(c.execute("SELECT count(*) FROM admins WHERE iso_code='US'").fetchone()[0], 1)
                self.assertEqual(c.execute('SELECT count(*) FROM admin_access').fetchone()[0], 1)
                c.close()

if __name__ == '__main__':
    unittest.main()
