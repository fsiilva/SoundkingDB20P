"""Offline inspection; only reads capture and writes a bounded snapshot/report."""
import sys,struct,json,hashlib,collections,datetime
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'referencia/controller'))
from skdmc.pcap_reader import _read_pcap
source=Path(sys.argv[1]);data=source.read_bytes();endian='<' if data[:4] in (b'\xd4\xc3\xb2\xa1',b'\x4d\x3c\xb2\xa1') else '>';offset=24
while offset+16<=len(data):
 length=struct.unpack_from(endian+'I',data,offset+8)[0]
 if offset+16+length>len(data):break
 offset+=16+length
snapshot=data[:offset];out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);(out/'snapshot.pcap').write_bytes(snapshot)
packets=_read_pcap(snapshot);flows={};target='192.168.18.162'
for p in packets:
 if target not in (p.src_ip,p.dst_ip):continue
 k=f'{p.proto} {p.src_ip}:{p.src_port} -> {p.dst_ip}:{p.dst_port}'
 f=flows.setdefault(k,dict(packets=0,bytes=0,lengths=collections.Counter(),syns=0,samples=[]))
 f['packets']+=1;f['bytes']+=len(p.payload);f['lengths'][len(p.payload)]+=1;f['syns']+=bool(p.tcp_flags&2)
 if p.payload and len(f['samples'])<6:f['samples'].append(dict(ts=p.ts,seq=p.seq,hex=p.payload[:160].hex()))
report={'source':str(source),'sha256':hashlib.sha256(snapshot).hexdigest(),'snapshot_bytes':len(snapshot),'first_utc':datetime.datetime.utcfromtimestamp(packets[0].ts).isoformat() if packets else None,'last_utc':datetime.datetime.utcfromtimestamp(packets[-1].ts).isoformat() if packets else None,'flows':flows}
(out/'flows.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
