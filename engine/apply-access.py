"""Apply the narrow access variant only to the exact audited base graph."""
import sys,json,hashlib,pathlib,subprocess
p=pathlib.Path(__file__).parent
config=pathlib.Path(sys.argv[1]);manifest=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else p/'access/access-overrides.json';policy=json.loads(manifest.read_text());cfg=json.loads(config.read_text());root=pathlib.Path(cfg['mjolnir']['tile_dir'])
actual={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(root.rglob('*.gph'))}
if actual!=policy['input_graph_files']:raise SystemExit('Refusing access overlay: graph differs from the exact audited base. Restore the original graph before applying.')
subprocess.run([str(p/'out/apply_access'),str(config),str(manifest)],check=True)
