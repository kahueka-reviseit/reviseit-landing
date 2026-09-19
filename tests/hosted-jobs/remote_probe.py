"""Read-only host evidence collector. Run over SSH; never emits environment values."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

ROOT = Path('/srv/reviseit')
ORIGIN = 'https://reviseit-teacher-test.vercel.app'


def replay_evidence(receipt):
    if receipt is None:
        return {'steps': [], 'paidProviderCalls': 0, 'trialStatus': None}
    if receipt.get('mode') != 'replay' or not isinstance(receipt.get('calls'), list):
        raise ValueError('Synthetic replay receipt required')
    calls = receipt['calls']
    if any(c.get('phase') != 'returned' or c.get('cost_kind') != 'simulated-not-billed'
           or c.get('usage_known') is not True for c in calls):
        raise ValueError('Incomplete or non-replay call evidence')
    return {'steps': [c['step'] for c in calls], 'paidProviderCalls': 0,
            'trialStatus': receipt['status']}


def inspect_container(name):
    raw = subprocess.check_output(['docker', 'inspect', name], stderr=subprocess.DEVNULL)
    item = json.loads(raw)[0]
    env = dict(v.split('=', 1) for v in item['Config']['Env'] if '=' in v)
    if any(k in env for k in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY')):
        raise ValueError('Provider credential present in synthetic deployment')
    mounts = [{'source': m['Source'], 'destination': m['Destination'], 'type': m['Type']} for m in item['Mounts']]
    if any(m['type'] != 'bind' or not m['source'].startswith('/srv/reviseit/') for m in mounts):
        raise ValueError('Unexpected external runtime mount')
    if item['HostConfig']['PortBindings'] or not item['HostConfig']['ReadonlyRootfs']:
        raise ValueError('Unexpected exposed or writable container')
    if not item['State']['Running'] or item['HostConfig']['RestartPolicy']['Name'] != 'unless-stopped':
        raise ValueError('Persistent container is not running')
    return {'image': item['Image'], 'network': item['HostConfig']['NetworkMode'],
            'mounts': mounts, 'platformOrigin': env.get('TEACHER_PLATFORM_URL')}


def inspect(order):
    if str(uuid.UUID(order)) != order:
        raise ValueError('Canonical order identity required')
    registry = json.loads((ROOT / 'runtime/fixture/registry.json').read_text())
    if registry['ledger'] != '/runtime/fixture/ledger' or not registry['adapters']:
        raise ValueError('Unexpected ledger or adapter registry')
    for cfg in registry['adapters'].values():
        if cfg['mode'] != 'replay':
            raise ValueError('Replay-only registry required')
        for key in ('profile', 'source_root', 'workflow', 'experiment', 'replay'):
            path = Path(cfg[key])
            if '..' in path.parts or not path.is_relative_to('/runtime/fixture'):
                raise ValueError('Runtime dependency outside persistent fixture')
            if not (ROOT / 'runtime/fixture' / path.relative_to('/runtime/fixture')).exists():
                raise ValueError('Missing persistent fixture dependency')
    bridge = inspect_container('reviseit-teacher-test-bridge-1')
    renderer = inspect_container('reviseit-teacher-test-renderer-1')
    if bridge['platformOrigin'] != ORIGIN or renderer['network'] != 'none':
        raise ValueError('Hosted gateway or offline renderer constraint failed')
    identity = json.loads((ROOT / 'state/worker-identity.json').read_text())['worker']
    if identity != registry['worker_id']:
        raise ValueError('Worker identity disagrees with registry')
    ledger = ROOT / 'runtime/fixture/ledger/trials.sqlite3'
    with sqlite3.connect(ledger.as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('select id, receipt from trials').fetchall()
    if any(row[0] != 'order-' + order for row in rows) or len(rows) > 1:
        raise ValueError('Unexpected trial in dedicated synthetic ledger')
    receipt = json.loads(rows[0][1]) if rows else None
    memo = ROOT / 'state' / order / 'memo-review.json'
    # Hash the receipt as the logical ledger record; SQLite file bytes can change
    # during routine checkpoints without changing the recorded trial.
    logical_hash = hashlib.sha256(rows[0][1].encode()).hexdigest() if rows else None
    return dict(replay_evidence(receipt), mode='replay',
                serverId=int(Path('/var/lib/cloud/data/instance-id').read_text()),
                bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                workerIdentity=identity, ledgerHash=logical_hash,
                memoHash=hashlib.sha256(memo.read_bytes()).hexdigest() if memo.exists() else None,
                rendererNetwork=renderer['network'], containers={'bridge': bridge, 'renderer': renderer},
                laptopDependencies=[])


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1])))
