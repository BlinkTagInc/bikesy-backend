import unittest,runpy,pathlib
flight=runpy.run_path(str(pathlib.Path(__file__).parents[1]/'scripts/stair-policy.py'))['flight_policy']
class StairsTests(unittest.TestCase):
 def test_threshold(self):
  self.assertEqual(flight({'step_count':'3'},2)['penalty_m'],6)
  self.assertEqual(flight({'step_count':'20'},8)['penalty_m'],40)
  self.assertEqual(flight({'step_count':'21'},8)['penalty_m'],248)
 def test_channel_not_generic_ramp(self):
  self.assertEqual(flight({'step_count':'21','ramp:bicycle':'yes'},8)['penalty_m'],124)
  for t in [{'ramp':'yes'},{'ramp:bicycle':'no'},{'ramp:wheelchair':'yes'}]:self.assertEqual(flight({'step_count':'21',**t},8)['penalty_m'],248)
 def test_unknown_never_invents_count(self):
  for count in ['', '0','-1','20;21','~20','21.0','10000','1']:
   p=flight({'step_count':count},88);self.assertIsNone(p['trusted_step_count']);self.assertEqual(p['penalty_m'],690)
  self.assertEqual(flight({},2)['penalty_m'],28)
 def test_split_and_partial_additivity(self):
  for count in ['20','21','']:
   total=flight({'step_count':count},30)['penalty_m'];segments=[2,3,7,18]
   for _direction in [1,-1]:self.assertAlmostEqual(sum(total*x/30 for x in segments),total)
   self.assertAlmostEqual(sum(total*x/30 for x in [2,3]),total*5/30)
 def test_invalid_geometry(self):
  for v in [0,-1,float('nan'),float('inf')]:
   with self.assertRaises(ValueError):flight({},v)
