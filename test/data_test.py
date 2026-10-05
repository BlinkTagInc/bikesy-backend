import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'lock-inputs.py'

class DataLockTests(unittest.TestCase):
    def test_lock_verify_tamper_and_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg = root / 'config.json'
            cfg.write_text(json.dumps({'bounds': {'left': 0.1, 'bottom': 0.1, 'right': 0.9, 'top': 0.9}}))
            (root / 'region.osm.pbf').write_bytes(b'OSM fixture placeholder for checksum test only')
            def run(*args):
                return subprocess.run(['python3', str(SCRIPT), str(root), str(cfg), *args], capture_output=True, text=True)
            self.assertNotEqual(run('--osm-source', 'test', '--dem-source', 'test').returncode, 0)
            tile = root / 'elevation/N00/N00E000.hgt'
            tile.parent.mkdir(parents=True)
            with tile.open('wb') as out:
                out.truncate(1201 * 1201 * 2)
            self.assertEqual(run('--osm-source', 'test', '--dem-source', 'test').returncode, 0)
            self.assertEqual(run('--verify').returncode, 0)
            self.assertNotEqual(run('--osm-source', 'test', '--dem-source', 'test').returncode, 0)
            (root / 'region.osm.pbf').write_bytes(b'changed')
            self.assertNotEqual(run('--verify').returncode, 0)
            tile.unlink()
            self.assertNotEqual(run('--verify').returncode, 0)


class BuildAndAcquisitionTests(unittest.TestCase):
    def test_build_lock_and_invalid_thread_limit_fail_before_docker(self):
        import os
        script = SCRIPT.parent / 'build-tiles.sh'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lock = root / '.build-in-progress'
            lock.mkdir()
            env = {**os.environ, 'DATA_DIR': tmp, 'BIKESY_REGION': 'sf'}
            result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(lock.exists())
            lock.rmdir()
            result = subprocess.run(['bash', str(script)], env={**env, 'BUILD_THREADS': '0'}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(lock.exists())

    def test_dem_acquisition_is_atomic_resumable_and_refuses_locked_data(self):
        import gzip
        import io
        import runpy
        from unittest.mock import patch
        script = SCRIPT.parent / 'fetch-dem.py'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg = root / 'config.json'
            cfg.write_text(json.dumps({'bounds': {'left': 0.1, 'bottom': 0.1, 'right': 0.9, 'top': 0.9}}))
            tile = root / 'elevation/N00/N00E000.hgt'
            argv = [str(script), str(cfg), str(root)]
            with patch('sys.argv', argv), patch('urllib.request.urlopen', return_value=io.BytesIO(gzip.compress(b'invalid'))):
                with self.assertRaises(SystemExit): runpy.run_path(str(script), run_name='__main__')
            self.assertFalse(tile.exists())
            with patch('sys.argv', argv), patch('urllib.request.urlopen', return_value=io.BytesIO(gzip.compress(bytes(1201 * 1201 * 2)))):
                runpy.run_path(str(script), run_name='__main__')
            self.assertEqual(tile.stat().st_size, 1201 * 1201 * 2)
            self.assertEqual(list(tile.parent.iterdir()), [tile])
            with patch('sys.argv', argv + ['--resume']), patch('urllib.request.urlopen') as network:
                runpy.run_path(str(script), run_name='__main__')
                network.assert_not_called()
            (root / 'inputs.lock.json').write_text('{}')
            with patch('sys.argv', argv + ['--resume']), patch('urllib.request.urlopen') as network:
                with self.assertRaises(SystemExit): runpy.run_path(str(script), run_name='__main__')
                network.assert_not_called()

if __name__ == '__main__':
    unittest.main()
