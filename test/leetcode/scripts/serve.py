#!/usr/bin/env python3
"""Serve only the public fixture page/manifest/cases on loopback; never results or credentials."""
import argparse,json,pathlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit
ROOT=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text())
allowed={'/':'fixtures/index.html','/fixtures/':'fixtures/index.html','/fixtures/index.html':'fixtures/index.html','/manifest.json':'manifest.json'}
for item in manifest['problems']: allowed['/cases/'+item['slug']+'.json']='cases/'+item['slug']+'.json'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        filename=allowed.get(urlsplit(self.path).path)
        if not filename: self.send_error(404); return
        data=(ROOT/filename).read_bytes(); self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8' if filename.endswith('.html') else 'application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--port',type=int,default=8771); args=parser.parse_args()
if not 1<=args.port<=65535: parser.error('port must be 1..65535')
print('Public fixture page: http://127.0.0.1:'+str(args.port)+'/fixtures/',flush=True)
try: ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
except KeyboardInterrupt: pass
