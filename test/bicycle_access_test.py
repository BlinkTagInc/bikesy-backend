import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/prepare-bicycle-access.py'
class ProfileLockTest(unittest.TestCase):
    def invoke(self, directory, *args):
        return subprocess.run([sys.executable,str(SCRIPT),str(directory),*args],capture_output=True,text=True)
    def test_pinned_profile_roundtrip_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            self.assertEqual(self.invoke(root).returncode,0)
            before=(root/'bikesy-graph.lua').read_bytes()
            self.assertEqual(self.invoke(root,'--verify').returncode,0)
            self.assertNotEqual(self.invoke(root).returncode,0)
            self.assertEqual((root/'bikesy-graph.lua').read_bytes(),before)
    def test_changed_transformer_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);self.assertEqual(self.invoke(root).returncode,0)
            (root/'bikesy-graph.lua').write_text('-- changed')
            self.assertNotEqual(self.invoke(root,'--verify').returncode,0)
    def test_changed_manifest_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);self.assertEqual(self.invoke(root).returncode,0)
            lock=root/'graph-profile.lock.json';v=json.loads(lock.read_text());v['routing_mode']='all';lock.write_text(json.dumps(v))
            self.assertNotEqual(self.invoke(root,'--verify').returncode,0)
