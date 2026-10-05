#include "bikesy_policy.h"
#include "config.h"
#include "sif/bicyclecost.h"
#include "sif/dynamiccost.h"
#include <iostream>
void require(bool b,const char* msg){if(!b)throw std::runtime_error(msg);}
valhalla::sif::cost_ptr_t model(float roads,float hills){
 valhalla::Costing c;rapidjson::Document d;
 std::string s="{\"bicycle\":{\"bicycle_type\":\"Hybrid\",\"use_roads\":"+std::to_string(roads)+",\"use_hills\":"+std::to_string(hills)+",\"use_ferry\":0}}";
 d.Parse(s.c_str());valhalla::sif::ParseBicycleCostOptions(d,"/bicycle",&c);return valhalla::sif::CreateBicycleCost(c);
}
int main(int argc,char**argv){try{
 using namespace valhalla;using namespace baldr;
 GraphReader reader(valhalla::config(argv[1]).get_child("mjolnir"));auto avoid=model(.5,0),ignore=model(.5,1),direct=model(1,1);
 require(avoid->AStarCostFactor()==0&&direct->AStarCostFactor()==0,"Heuristic must remain admissible");
 size_t uphill=0,downhill=0,mixed=0,total=0;
 for(auto id:reader.GetTileSet()){auto tile=reader.GetGraphTile(id);
  for(uint32_t i=0;i<tile->header()->directededgecount();++i){auto edge=tile->directededge(i);if(edge->is_shortcut()||edge->use()==Use::kFerry||edge->use()==Use::kRailFerry)continue;
   uint8_t flow=0;auto a=avoid->EdgeCost(edge,tile,TimeInfo::invalid(),flow),b=ignore->EdgeCost(edge,tile,TimeInfo::invalid(),flow),c=direct->EdgeCost(edge,tile,TimeInfo::invalid(),flow);float g=bikesy::policy().uphill(edge,tile);
   require(a.cost>=b.cost,"Uphill avoidance gave credit");if(edge->use()==Use::kSteps){require(c.cost>edge->length(),"Direct Ignore omitted stair burden");}else require(std::abs(c.cost-edge->length())<.01,"Nonstair Direct Ignore not distance");require(a.secs==b.secs,"Hill preference altered ETA speed");
   require(std::abs((a.cost-b.cost)-4*g)<std::max(.01f,4*g*.0001f),"Actual engine cost differs from positive grade integral");
   graph_tile_ptr other;auto opposite=reader.GetOpposingEdge(edge,other);if(opposite&&other){float reverse=bikesy::policy().uphill(opposite,other);if(g==0&&reverse>0){require(a.cost==b.cost,"Downhill penalized");++downhill;}if(g>0)++uphill;if(g>0&&reverse>0)++mixed;}
   ++total;
  }
 }
 require(uphill>100&&downhill>100&&mixed>100,"Insufficient real grade/reversal coverage");
 std::cout<<"{\"passed\":true,\"edges_checked\":"<<total<<",\"uphill\":"<<uphill<<",\"downhill_only\":"<<downhill<<",\"mixed_grade\":"<<mixed<<"}\n";
}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
