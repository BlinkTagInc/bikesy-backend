#include "config.h"
#include "baldr/graphreader.h"
#include <boost/property_tree/json_parser.hpp>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <set>
int main(int argc,char**argv){try{
 using namespace valhalla::baldr;
 GraphReader r(valhalla::config(argv[1]).get_child("mjolnir"));
 boost::property_tree::ptree p;boost::property_tree::read_json(argv[2],p);
 std::set<uint64_t> wanted;for(auto&v:p.get_child("ways"))wanted.insert(v.second.get_value<uint64_t>());
 std::ofstream out(argv[3]);out<<std::setprecision(9);uint64_t nodes=0,right=0,bikenodes=0,bikeright=0,edges=0,stairs=0;
 for(auto id:r.GetTileSet()){auto t=r.GetGraphTile(id);
  for(uint32_t j=0;j<t->header()->nodecount();++j){auto n=t->node(j);++nodes;right+=n->drive_on_right();if(n->access()&kBicycleAccess){++bikenodes;bikeright+=n->drive_on_right();}
   for(uint32_t i=n->edge_index();i<n->edge_index()+n->edge_count();++i){auto e=t->directededge(i);++edges;if(e->is_shortcut())continue;auto info=t->edgeinfo(e);if(e->use()==Use::kSteps)++stairs;else if(!wanted.count(info.wayid()))continue;
    auto gid=GraphId(id.tileid(),id.level(),i);auto shape=info.shape();if(!e->forward())std::reverse(shape.begin(),shape.end());
    out<<"{\"id\":"<<gid.value<<",\"opposing\":"<<r.GetOpposingEdgeId(gid).value<<",\"way\":"<<info.wayid()<<",\"forward\":"<<e->forward()<<",\"bike\":"<<bool(e->forwardaccess()&kBicycleAccess)<<",\"reverse_bike\":"<<bool(e->reverseaccess()&kBicycleAccess)<<",\"length\":"<<e->length()<<",\"cyclelane\":"<<unsigned(e->cyclelane())<<",\"class\":"<<unsigned(e->classification())<<",\"use\":"<<unsigned(e->use())<<",\"dismount\":"<<e->dismount()<<",\"drive_on_right\":"<<n->drive_on_right()<<",\"shape\":[";
    bool comma=false;for(auto xy:shape){if(comma)out<<',';comma=true;out<<'['<<xy.lat()<<','<<xy.lng()<<']';}out<<"]}\n";
   }
  }
 }
 std::cout<<"{\"nodes\":"<<nodes<<",\"right_side_nodes\":"<<right<<",\"bicycle_nodes\":"<<bikenodes<<",\"right_side_bicycle_nodes\":"<<bikeright<<",\"edges\":"<<edges<<",\"stair_directed_edges\":"<<stairs<<"}\n";
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
