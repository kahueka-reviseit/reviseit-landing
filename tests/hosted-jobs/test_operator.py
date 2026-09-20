import importlib.util
from pathlib import Path
import unittest
import subprocess
import sys
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = load('remote_probe')
operator = load('hosted_operator')


class OperatorChecks(unittest.TestCase):
    def test_driver_starts_as_actual_script(self):
        result = subprocess.run([sys.executable, str(Path(__file__).parent/'hosted_operator.py'), '--help'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('restart-at-memo', result.stdout)

    def test_live_and_incomplete_evidence_cannot_claim_zero_spending(self):
        with self.assertRaises(ValueError):
            probe.replay_evidence({'mode':'live','calls':[]})
        with self.assertRaises(ValueError):
            probe.replay_evidence({'mode':'replay','calls':[{'phase':'requesting'}]})
        with self.assertRaises(ValueError):
            probe.replay_evidence({'mode':'replay','calls':[{'phase':'returned','usage_known':True}]})

    def test_completed_replay_reports_recorded_steps(self):
        receipt = {'mode':'replay','status':'awaiting_memo_verification','calls':[
            {'step':i,'phase':'returned','cost_kind':'simulated-not-billed','usage_known':True}
            for i in range(1,5)]}
        self.assertEqual(probe.replay_evidence(receipt), {
            'steps':[1,2,3,4], 'paidProviderCalls':0, 'trialStatus':'awaiting_memo_verification'})

    def test_reboot_refused_outside_settled_checkpoint(self):
        with patch.object(operator,'inspect',return_value={'orderState':'generating'}), \
             patch.object(operator.subprocess,'run') as run:
            with self.assertRaises(ValueError): operator.restart_at_memo('irrelevant')
            run.assert_not_called()

    def test_restart_preserves_checkpoint_and_requires_new_boot(self):
        before = {'orderState':'awaiting_memo_review','trialStatus':'awaiting_memo_verification',
                  'steps':[1,2,3,4],'memoHash':'memo','ledgerHash':'ledger','paidProviderCalls':0,
                  'serverId':166573661,'workerIdentity':'worker','bootId':'old'}
        after = dict(before,bootId='new')
        with patch.object(operator,'inspect',side_effect=[before,before,after]), \
             patch.object(operator.subprocess,'run') as run, patch.object(operator.time,'sleep'):
            self.assertEqual(operator.restart_at_memo('order'),after)
            self.assertEqual(run.call_count,1)
        with patch.object(operator,'inspect',side_effect=[before,dict(after,memoHash='changed')]), \
             patch.object(operator.subprocess,'run'), patch.object(operator.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'memoHash'): operator.restart_at_memo('order')


if __name__ == '__main__': unittest.main()
