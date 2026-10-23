"""Generate protobufjs reflection schema from the supplied descriptor, offline."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'referencia/controller'))
from skdmc.messages import _FDS
SCALARS={1:'double',2:'float',3:'int64',4:'uint64',5:'int32',6:'fixed64',7:'fixed32',8:'bool',9:'string',12:'bytes',13:'uint32',15:'sfixed32',16:'sfixed64',17:'sint32',18:'sint64'}
def enum(e):return {'values':{v.name:v.number for v in e.value}}
def message(m):
 fields={}
 for f in m.field:
  field={'type':f.type_name if f.type_name else SCALARS[f.type],'id':f.number}
  if f.label==3:field['rule']='repeated'
  fields[f.name]=field
 result={'fields':fields}
 nested={v.name:enum(v) for v in m.enum_type};nested.update({v.name:message(v) for v in m.nested_type})
 if nested:result['nested']=nested
 return result
root={'nested':{}}
for fd in _FDS.file:
 node=root
 for name in fd.package.split('.'):
  node=node.setdefault('nested',{}).setdefault(name,{})
 nested=node.setdefault('nested',{})
 nested.update({m.name:message(m) for m in fd.message_type});nested.update({e.name:enum(e) for e in fd.enum_type})
Path('server/schema.json').write_text(json.dumps(root,indent=2)+'\n')
