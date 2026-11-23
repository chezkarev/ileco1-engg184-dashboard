import gzip,json,tempfile,unittest
from datetime import datetime
from pathlib import Path
import sync_sheets as sync

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.config=json.loads((sync.ROOT/'sheet-config.json').read_text())
    def test_dates_and_five_minute_boundaries(self):
        self.assertEqual(sync.timestamp('Date(2026,7,23,23,5,0)'),int(datetime(2026,8,23,23,5,tzinfo=sync.PHT).timestamp()*1000))
        self.assertEqual(sync.timestamp('2026-08-23 23:05:00'),sync.timestamp('2026-08-23T15:05:00Z'))
        with self.assertRaises(ValueError):sync.timestamp('08/09/2026 1:00')
        with self.assertRaises(ValueError):sync.timestamp('Date(2026,7,23,23,4,0)')
    def test_typed_response_does_not_execute_javascript(self):
        text='/*O_o*/\ngoogle.visualization.Query.setResponse('+json.dumps({'status':'ok','table':{'cols':[{'label':'TIME_INTERVAL'}],'rows':[{'c':[{'v':'Date(2026,7,23,23,5,0)'}]}]}})+');'
        headers,rows=sync.parse_response(text)
        self.assertEqual(rows[0]['TIME_INTERVAL'],'Date(2026,7,23,23,5,0)')
        with self.assertRaises(ValueError):sync.parse_response('<html>Login required</html>')
    def test_signs_nulls_and_conflicting_duplicates(self):
        row={'TIME_INTERVAL':'Date(2026,7,23,23,5,0)','REGION_NAME':'CVIS','RESOURCE_NAME':'08STBAR_SS1','LMP':-1500,'SCHED_MW':-4}
        headers=['TIME_INTERVAL',*sync.NODE_FIELDS]
        result=sync.normalize(headers,[row],sync.NODE_FIELDS,self.config,node='08STBAR_SS1')
        self.assertEqual(result[0][1:4],[-4.,-1500.,None])
        with self.assertRaises(ValueError):sync.normalize(headers,[row,{**row,'LMP':500}],sync.NODE_FIELDS,self.config,node='08STBAR_SS1')
    def test_all_tabs_validate_before_overwriting_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'site';output.mkdir();old=output/'market-data.json.gz';old.write_bytes(b'previous deployment')
            def failed(config,tab):return ['WRONG_COLUMN'],[{'WRONG_COLUMN':1}]
            with self.assertRaises(ValueError):sync.build(output,reader=failed)
            self.assertEqual(old.read_bytes(),b'previous deployment')
    def test_complete_artifact_contract(self):
        def fixture(config,tab):
            fields=sync.REGIONAL_FIELDS if tab==config['regionalTab'] else sync.NODE_FIELDS
            row={'TIME_INTERVAL':'Date(2026,7,23,23,5,0)',**{f:1.5 for f in fields}}
            return ['TIME_INTERVAL',*fields],[row]
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'site';payload=sync.build(output,reader=fixture)
            data=json.loads(gzip.decompress((output/'market-data.json.gz').read_bytes()))
            self.assertEqual(len(data['nodes']),6)
            self.assertEqual(data['sourceMode'],'google-sheets')
            self.assertEqual(json.loads((output/'sync-status.json').read_text())['sourceVersion'],payload['sourceVersion'])
            self.assertTrue((output/'index.html').exists())
            self.assertEqual((output/'iemop-panay-network.svg').read_bytes(),(sync.ROOT/'iemop-panay-network.svg').read_bytes())
            page=(output/'index.html').read_text(encoding='utf-8')
            for asset in ('theme.css','theme.js','interface.js','app.js'):
                digest=sync.hashlib.sha256((output/asset).read_bytes()).hexdigest()[:12]
                self.assertIn('"'+asset+'?v='+digest+'"',page)

if __name__=='__main__':unittest.main()
