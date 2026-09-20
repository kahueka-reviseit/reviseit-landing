"""Operator-only acceptance controller for the isolated hosted synthetic order."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
PROJECT = 'tgaganmgccvrphpfipgy'
ORIGIN = 'https://reviseit-teacher-test.vercel.app'
SSH = ['ssh', '-i', str(Path.home()/'.ssh/reviseit-worker-test'), '-o', 'IdentitiesOnly=yes',
       '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', 'root@49.13.116.176']


def binding(order):
    fixture = json.loads(Path(os.environ['HOSTED_JOB_TEST_FIXTURE']).read_text())
    if (str(uuid.UUID(order)) != order or fixture['order'] != order or
        fixture['serverId'] != 166573661 or fixture['project'] != PROJECT or
        fixture['origin'] != ORIGIN or fixture['mode'] != 'replay' or
        fixture['entitlement'] != 'internal_test'):
        raise ValueError('Isolated synthetic target mismatch')
    linked = HERE.parents[1]/'supabase/.temp/project-ref'
    if linked.read_text().strip() != PROJECT:
        raise ValueError('Wrong linked development database')
    return fixture


def inspect(order):
    binding(order)
    host = json.loads(subprocess.check_output(SSH + ['python3 - ' + order],
                     input=(HERE/'remote_probe.py').read_bytes(), stderr=subprocess.PIPE, timeout=40))
    query = ("select o.state, o.memo_hash, o.memo_review->>'actor' as memo_reviewer, "
             "o.release_review->>'actor' as release_reviewer, "
             "(select e.actor from private.paper_job_events e where e.order_id=o.id "
             "and e.event='memo_approved' order by e.id desc limit 1) as memo_actor, "
             "(select e.actor from private.paper_job_events e where e.order_id=o.id "
             "and e.event='release_approved' order by e.id desc limit 1) as release_actor, "
             "(select count(*) from private.paper_job_events e where e.order_id=o.id "
             "and e.event='submitted') as submission_count from private.paper_orders o "
             "where o.id='" + order + "'::uuid and o.entitlement='internal_test'")
    cli = os.environ.get('HOSTED_SUPABASE_CLI')
    command = [cli] if cli else ['npx','--yes','supabase@2.117.0']
    raw = subprocess.check_output(command + ['db','query','--linked',query,
                                  '--output-format','json'], cwd=HERE.parents[1], stderr=subprocess.PIPE, timeout=60)
    rows = json.loads(raw)['rows']
    if len(rows) != 1 or host['serverId'] != 166573661:
        raise ValueError('Hosted order or host identity missing')
    row = rows[0]
    if row['memo_actor'] != row['memo_reviewer'] or row['release_actor'] != row['release_reviewer']:
        raise ValueError('Reviewer records and event history disagree')
    if row['memo_hash'] != host['memoHash']:
        raise ValueError('Platform and worker memorandum hashes disagree')
    host.update(orderState=row['state'], memoReviewer=row['memo_reviewer'],
                releaseReviewer=row['release_reviewer'], submissionCount=int(row['submission_count']))
    return host


def restart_at_memo(order):
    before = inspect(order)
    if (before['orderState'] != 'awaiting_memo_review' or
        before['trialStatus'] != 'awaiting_memo_verification' or
        before['steps'] != [1,2,3,4] or not before['memoHash'] or
        before['paidProviderCalls'] != 0):
        raise ValueError('Reboot requires settled synthetic memorandum checkpoint')
    # Only this fixed test host is rebooted. No retries of the reboot command.
    subprocess.run(SSH + ['systemctl reboot'], check=True, capture_output=True, timeout=20)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        time.sleep(5)
        try:
            after = inspect(order)
        except (subprocess.SubprocessError, ValueError):
            continue
        if after['bootId'] == before['bootId']:
            continue
        for key in ('serverId','workerIdentity','ledgerHash','memoHash','orderState'):
            if after[key] != before[key]:
                raise ValueError('Persistent checkpoint changed across reboot: ' + key)
        return after
    raise TimeoutError('Test server did not return with its preserved checkpoint')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('inspect','report','restart-at-memo'))
    parser.add_argument('order')
    args = parser.parse_args()
    action, order = args.action, args.order
    result = restart_at_memo(order) if action == 'restart-at-memo' else inspect(order)
    print(json.dumps(result))
