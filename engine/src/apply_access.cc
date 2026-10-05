#include "config.h"
#include "baldr/graphreader.h"
#include "mjolnir/graphtilebuilder.h"
#include <boost/property_tree/json_parser.hpp>
#include <set>
#include <iostream>
int main(int argc,char**argv){try{using namespace valhalla::baldr;auto cfg=valhalla::config(argv[1]);GraphReader reader(cfg.get_child("mjolnir"));boost::property_tree::ptree p;boost::property_tree::read_json(argv[2],p);std::set<uint64_t> ways,directed,walk,deny,mainlines;
for(auto&x:p.get_child("osm_motorway_mainlines"))mainlines.insert(x.second.get_value<uint64_t>());
for(auto&x:p.get_child("allow_motorway_ways"))ways.insert(x.second.get_value<uint64_t>());
for(auto&x:p.get_child("allow_directed_edges"))directed.insert(x.second.get<uint64_t>("graph_id"));
for(auto&x:p.get_child("walk_bicycle_ways"))walk.insert(x.second.get_value<uint64_t>());
for(auto&x:p.get_child("deny_ways"))deny.insert(x.second.get_value<uint64_t>());
uint64_t blocked=0,walking=0,changed=0;std::set<uint64_t> found_directed,found_walk;
for(auto id:reader.GetTileSet()){auto t=reader.GetGraphTile(id);std::vector<NodeInfo> nodes(t->node(0),t->node(0)+t->header()->nodecount());std::vector<DirectedEdge> edges(t->directededge(0),t->directededge(0)+t->header()->directededgecount());bool dirty=false;
for(uint32_t i=0;i<edges.size();++i){auto& e=edges[i];if(e.is_shortcut())continue;auto graphid=GraphId(id.tileid(),id.level(),i);auto way=t->edgeinfo(&e).wayid();auto old=e;
 if(directed.count(graphid.value)){if(!(old.forwardaccess()&kBicycleAccess))throw std::runtime_error("Directed allow entry lacks original bicycle access");found_directed.insert(graphid.value);}
 if(deny.count(way)||((e.classification()==RoadClass::kMotorway||mainlines.count(way))&&!ways.count(way))){bool fw=!deny.count(way)&&directed.count(graphid.value);bool rev=!deny.count(way)&&directed.count(reader.GetOpposingEdgeId(graphid).value);if(!fw)e.set_forwardaccess(e.forwardaccess()&~kBicycleAccess);if(!rev)e.set_reverseaccess(e.reverseaccess()&~kBicycleAccess);if(e.forwardaccess()!=old.forwardaccess()||e.reverseaccess()!=old.reverseaccess())++blocked;}
 if(walk.count(way)){if(e.use()!=Use::kFootway&&e.use()!=Use::kPedestrianCrossing)throw std::runtime_error("Walk override must be footway");if(!(old.forwardaccess()&kPedestrianAccess)||!(old.reverseaccess()&kPedestrianAccess))throw std::runtime_error("Walk override lacks pedestrian permission");e.set_forwardaccess(e.forwardaccess()|kBicycleAccess);e.set_reverseaccess(e.reverseaccess()|kBicycleAccess);e.set_dismount(true);found_walk.insert(way);++walking;}
 if(e.forwardaccess()!=old.forwardaccess()||e.reverseaccess()!=old.reverseaccess()||e.dismount()!=old.dismount()){dirty=true;++changed;std::cout<<"{\"edge\":"<<graphid.value<<",\"way\":"<<way<<",\"old_forward\":"<<old.forwardaccess()<<",\"new_forward\":"<<e.forwardaccess()<<",\"old_reverse\":"<<old.reverseaccess()<<",\"new_reverse\":"<<e.reverseaccess()<<",\"dismount\":"<<e.dismount()<<"}\n";}
}
if(dirty){valhalla::mjolnir::GraphTileBuilder builder(cfg.get<std::string>("mjolnir.tile_dir"),id,false);builder.Update(nodes,edges);}}
if(found_directed!=directed||found_walk!=walk)throw std::runtime_error("Overlay contains missing graph edges/ways");std::cerr<<"changed="<<changed<<" blocked="<<blocked<<" walking="<<walking<<"\n";
}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
