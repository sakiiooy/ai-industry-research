"""Package reviewable source, excluding dependencies, runtime state and secrets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
excluded = {'.git', 'node_modules', 'dist', '.next', '.vinext', '.wrangler', '.sites-runtime', 'work', 'outputs', '__pycache__', '.agents', '.codex'}
archive = root / 'public' / 'source.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if not path.is_file() or set(rel.parts) & excluded:
            continue
        if path.name.startswith(('.env', '.dev.vars')) or path.suffix in {'.pem', '.tsbuildinfo', '.zip', '.mp4'} or path.name == '.DS_Store':
            continue
        bundle.write(path, Path('cleanlens') / rel)
print(f'Created public/source.zip ({archive.stat().st_size} bytes)')
