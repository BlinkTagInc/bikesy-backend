"""Complete a California-only regional admin DB using its real OSM state polygon.

The derived US polygon is deliberately clipped to California, not a fabricated
national boundary. This helper is invalid for routing outside California. It
retains the actual state's geometry and supplies the known US parent required
by Valhalla's state/country join. US access defaults come from pinned C++ headers.
"""
import sqlite3,pathlib,sys,json,hashlib
p=pathlib.Path(sys.argv[1]);defaults=json.loads(pathlib.Path(sys.argv[2]).read_text());before=hashlib.sha256(p.read_bytes()).hexdigest()
c=sqlite3.connect(p);c.enable_load_extension(True);c.load_extension('mod_spatialite')
state=c.execute("select rowid from admins where admin_level=4 and iso_code='CA' and name='California' and drive_on_right=1 and ST_IsValid(geom)=1").fetchall()
if len(state)!=1 or c.execute('select count(*) from admins').fetchone()[0]!=1:raise ValueError('Requires exact California-only extract; refuse other administrative scope')
sid=state[0][0]
with c:
 c.execute("insert into admins(admin_level,iso_code,parent_admin,name,name_en,drive_on_right,allow_intersection_names,default_language,geom) select 2,'US',NULL,'United States','United States',1,0,NULL,geom from admins where rowid=?",(sid,))
 uid=c.execute('select last_insert_rowid()').fetchone()[0]
 c.execute('update admins set parent_admin=? where rowid=?',(uid,sid))
 c.execute('insert into admin_access values(?,?,?,?,?,?,?,?,?,?,?)',[uid,'US']+[None if v<0 else v for v in defaults])
 for lat,lon in [(37.78,-122.42),(38.31,-122.296),(37.31,-121.95),(38.08,-122.23),(37.82,-122.36)]:
  assert c.execute("select count(*) from admins where admin_level=2 and ST_Contains(geom,MakePoint(?,?,4326))",(lon,lat)).fetchone()[0]==1
c.close()
p.with_suffix('.regional-manifest.json').write_text(json.dumps({'scope':'California-only; derived US footprint equals authoritative locked OSM California polygon; not usable outside that polygon','input_sha256':before,'output_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'state_id':sid,'country_id':uid,'US_access_defaults_from_pinned_headers':defaults,'graph_gate':'Require right-side driving for every bicycle-accessible node after graph construction'},indent=2))
print('California state joined to regional US parent; official pinned US access defaults retained')
