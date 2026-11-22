"""Read the configured public Google Sheet and build a validated Pages artifact.

No credentials, browser scraping, third-party Python dependencies or IEMOP calls.
All seven input tables must validate before a new artifact is written.
"""
import argparse
import gzip
import hashlib
import json
import math
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PHT = timezone(timedelta(hours=8))
NODE_FIELDS = ['SCHED_MW','LMP','LOSS_FACTOR','LMP_SMP','LMP_LOSS','LMP_CONGESTION']
REGIONAL_FIELDS = ['MKT_REQT','LOAD_BID','LOAD_CURTAILED','LOSSES','GENERATION','MKT_IMPORT','MKT_EXPORT']
ASSETS = ['index.html','styles.css','app.js','interface.js','overview.js','hosted-source.js','panay-grid-logo.svg','sheet-config.json']

def parse_response(text):
    match = re.search(r'google\.visualization\.Query\.setResponse\((.*)\);?\s*$', text, re.S)
    if not match:
        raise ValueError('Google did not return a public Sheets data response. Check link-sharing access.')
    response = json.loads(match.group(1))
    if response.get('status') != 'ok':
        raise ValueError('Sheet query failed: '+ '; '.join(e.get('detailed_message',e.get('message','Unknown error')) for e in response.get('errors',[])))
    table = response.get('table', {})
    headers = [c.get('label','').strip().upper() for c in table.get('cols',[])]
    if len(headers) != len(set(headers)):
        raise ValueError('Duplicate column labels in the Sheet.')
    rows = []
    for r in table.get('rows',[]):
        cells = r.get('c',[])
        rows.append({h: (cells[i] or {}).get('v') if i < len(cells) else None for i,h in enumerate(headers)})
    return headers, rows

def read_tab(config, tab):
    query = urllib.parse.urlencode({'tqx':'out:json','headers':'1','sheet':tab})
    url = 'https://docs.google.com/spreadsheets/d/'+config['spreadsheetId']+'/gviz/tq?'+query
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent':'Panay-Energy-Dashboard/1.0'})
            with urllib.request.urlopen(request, timeout=90) as response:
                text = response.read(128*1024*1024+1)
                if len(text) > 128*1024*1024:
                    raise ValueError('Sheet response is too large; split or archive older records before syncing.')
                return parse_response(text.decode('utf-8-sig'))
        except urllib.error.HTTPError as exc:
            if exc.code not in (429,500,502,503,504) or attempt == 2:
                raise ValueError('Cannot read '+tab+' (HTTP '+str(exc.code)+'). Verify the tab name and public viewing access.') from exc
            time.sleep(2**(attempt+1))
        except urllib.error.URLError:
            if attempt == 2:
                raise
            time.sleep(2**(attempt+1))

def timestamp(value):
    if isinstance(value,str) and value.startswith('Date('):
        match = re.fullmatch(r'Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2})(?:,(\d{1,2}))?)?\)',value)
        if not match:
            raise ValueError('Unrecognized Google datetime value: '+value)
        y,m,d,h,minute,s = [int(v or 0) for v in match.groups()]
        dt = datetime(y,m+1,d,h,minute,s,tzinfo=PHT)
    elif isinstance(value,str):
        try:
            dt = datetime.fromisoformat(value.strip().replace('Z','+00:00'))
        except ValueError as exc:
            raise ValueError('Use a real Sheets datetime or ISO YYYY-MM-DD HH:MM:SS in TIME_INTERVAL; ambiguous text dates are rejected.') from exc
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=PHT)
    else:
        raise ValueError('TIME_INTERVAL must be a datetime, not a number or a blank.')
    if dt.second or dt.microsecond or dt.minute % 5:
        raise ValueError('TIME_INTERVAL must end on a five-minute boundary.')
    if not 2020 <= dt.year <= 2100:
        raise ValueError('Unexpected timestamp year.')
    return int(dt.timestamp()*1000)

def number(value, field):
    if value is None or value == '':
        return None
    if isinstance(value,bool):
        raise ValueError('Boolean value in '+field)
    try:
        v = float(value)
    except (ValueError,TypeError) as exc:
        raise ValueError('Non-numeric value in '+field) from exc
    if not math.isfinite(v):
        raise ValueError('Non-finite number in '+field)
    return v

def normalize(headers, records, fields, config, node=None):
    missing = [h for h in ['TIME_INTERVAL',*fields] if h not in headers]
    if missing:
        raise ValueError('Missing columns: '+', '.join(missing))
    unique = {}
    for row in records:
        if all(v in ('',None) for v in row.values()):
            continue
        if row.get('REGION_NAME') and str(row['REGION_NAME']).upper() not in (config['region'],'VISAYAS'):
            continue
        if row.get('MKT_TYPE') and str(row['MKT_TYPE']).upper() != config['market']:
            continue
        if node and row.get('RESOURCE_NAME') and row['RESOURCE_NAME'] != node:
            continue
        if not node and row.get('COMMODITY_TYPE') and str(row['COMMODITY_TYPE']).upper() not in ('EN','ENERGY'):
            continue
        t = timestamp(row.get('TIME_INTERVAL'))
        values = [t,*[number(row.get(field),field) for field in fields]]
        if t in unique and unique[t] != values:
            raise ValueError('Conflicting records share the same interval end.')
        unique[t] = values
    result = [unique[k] for k in sorted(unique)]
    if not result:
        raise ValueError('No matching observations. The input tab may be empty or use the wrong market/region.')
    return result

def build(output, reader=read_tab):
    config = json.loads((ROOT/'sheet-config.json').read_text(encoding='utf-8'))
    nodes = {}
    for tab in config['nodeTabs']:
        headers, records = reader(config,tab)
        nodes[tab] = normalize(headers,records,NODE_FIELDS,config,node=tab)
        if not any(r[2] is not None for r in nodes[tab]):
            raise ValueError('No numeric LMP values in '+tab)
        print(tab+': '+str(len(nodes[tab]))+' observations',flush=True)
    headers, records = reader(config,config['regionalTab'])
    regional = normalize(headers,records,REGIONAL_FIELDS,config)
    print(config['regionalTab']+': '+str(len(regional))+' observations',flush=True)
    now = datetime.now(timezone.utc).isoformat()
    payload = {'nodes':nodes,'regional':regional,'nodeFields':NODE_FIELDS,'regionalFields':REGIONAL_FIELDS,
        'source':'Google Sheets · Panay market data','sourceMtime':time.time(),'timezone':config['timezone'],
        'region':config['region'],'market':config['market'],'sourceMode':'google-sheets','syncedAt':now,
        'sheetUrl':'https://docs.google.com/spreadsheets/d/'+config['spreadsheetId']+'/edit',
        'mapping':'Candidate nodes; ILECO I settlement mapping unverified.'}
    stable = json.dumps({'nodes':nodes,'regional':regional},separators=(',',':'),allow_nan=False).encode()
    version = hashlib.sha256(stable).hexdigest()
    payload['sourceVersion'] = version
    status = {'status':'connected','sourceVersion':version,'syncedAt':now,'sheetUrl':payload['sheetUrl'],
        'nodeObservations':{k:len(v) for k,v in nodes.items()},'regionalObservations':len(regional)}
    output.mkdir(parents=True,exist_ok=True)
    for filename in ASSETS:
        shutil.copyfile(ROOT/filename,output/filename)
    (output/'.nojekyll').write_text('',encoding='utf-8')
    (output/'market-data.json.gz').write_bytes(gzip.compress(json.dumps(payload,separators=(',',':'),allow_nan=False).encode(),mtime=0))
    (output/'sync-status.json').write_text(json.dumps(status,indent=2),encoding='utf-8')
    print('Validated all inputs and built '+str(output),flush=True)
    return payload

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'dist')
    args = parser.parse_args()
    try:
        build(args.output)
    except Exception as exc:
        raise SystemExit('Sync failed; the previously deployed site is retained. '+str(exc))
